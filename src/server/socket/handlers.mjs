// src/server/socket/handlers.mjs
// Plain ESM. Deliberately self-contained: server.mjs runs outside Next's
// compiler, so it cannot resolve TypeScript or the @/ path alias.
// Types for this layer live in src/lib/chat/types.ts for the client's benefit.
import * as cookie from 'cookie';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

import webpush from 'web-push';

const prisma = new PrismaClient();

const VAPID_CONFIGURED = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (VAPID_CONFIGURED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

/**
 * A 404 or 410 means the browser discarded the subscription — cleared site
 * data, uninstalled. Delete rather than retry forever, or the table fills with
 * dead endpoints and every send waits on them.
 */
async function sendPush(userId, payload) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      }
    }
  }));
}
const redis = new Redis(process.env.REDIS_URL);
redis.on('error', (e) => console.error('[socket redis]', e.message));

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET);

// ---------------------------------------------------------------------------
// Schemas — NONE of these carry senderId or userId. Identity comes from
// socket.data.userId, set once in auth middleware. Never from the client.
// ---------------------------------------------------------------------------
const MessageSendSchema = z.object({
  channelId: z.string().uuid(),
  // Body may be empty when the message is attachments only.
  body: z.string().max(8000).default(''),
  replyToId: z.string().uuid().optional(),
  clientMsgId: z.string().min(8).max(64),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
}).refine((v) => v.body.trim().length > 0 || (v.attachmentIds?.length ?? 0) > 0, {
  message: 'A message needs text or at least one attachment',
});
const MessageEditSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().min(1).max(8000),
});
const MessageDeleteSchema = z.object({ messageId: z.string().uuid() });
const ReactSchema = z.object({
  messageId: z.string().uuid(),
  /**
   * A literal emoji, length-capped.
   *
   * Not an allowlist: restricting to a fixed set means a Gulf team cannot use
   * the flag or gesture they actually want. The cap stops someone storing a
   * paragraph in the column, which is the real risk.
   *
   * Multi-codepoint sequences (skin tones, ZWJ families) run to ~16 chars, so
   * a tighter cap would reject legitimate emoji.
   */
  emoji: z.string().trim().min(1).max(24),
});
const ChannelRefSchema = z.object({ channelId: z.string().uuid() });
const ReadAdvanceSchema = z.object({
  channelId: z.string().uuid(),
  messageId: z.string().uuid(),
});
const CallInitiateSchema = z.object({ channelId: z.string().uuid() });
const CallRefSchema = z.object({ sessionId: z.string().uuid() });

const SyncSinceSchema = z.object({
  channelId: z.string().uuid(),
  sinceSeq: z.string().regex(/^\d+$/),
});

// ---------------------------------------------------------------------------
const channelRoom = (id) => `channel:${id}`;
const userRoom = (id) => `user:${id}`;
const presenceKey = (id) => `presence:${id}`;
const PRESENCE_TTL = 45;

const LIMITS = {
  message: { limit: 20, window: 10 },
  typing: { limit: 30, window: 60 },
  heartbeat: { limit: 120, window: 3600 },
  sync: { limit: 10, window: 60 },
  edit: { limit: 30, window: 60 },
};

/** Fails OPEN on Redis error — availability over strictness. */
async function rateLimit(key, limit, windowSeconds) {
  try {
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
    const ttl = await redis.ttl(k);
    return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch {
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Classifies text for the bodyLang column. NOT used for rendering —
 *  rendering direction is decided per-element by dir="auto" in the browser. */
/**
 * Arabic users type the same word many ways — harakat, tatweel, alef variants.
 * The index stores one normalised spelling so all of them match.
 *
 * Mirrors src/lib/search/normalize.ts. Duplicated because this file is plain
 * ESM loaded outside Next's compiler and cannot import from @/lib. If the two
 * ever diverge, Arabic search silently returns nothing.
 */
function toSearchText(body) {
  if (!body) return null;
  const normalized = body
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function detectBodyLang(text) {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin === 0) return 'en';
  if (arabic > 0 && latin === 0) return 'ar';
  if (latin > 0 && arabic === 0) return 'en';
  const ratio = arabic / (arabic + latin);
  if (ratio > 0.8) return 'ar';
  if (ratio < 0.2) return 'en';
  return 'mixed';
}

/**
 * Posts a "call ended" notice into the channel and returns the DTO so it can
 * be broadcast immediately — otherwise nobody sees it until they reload.
 *
 * Mirrors src/lib/calls/systemMessage.ts. Duplicated because this file is
 * plain ESM loaded outside Next's compiler and cannot import from @/lib.
 */
async function postCallEndedMessage(sessionId) {
  const session = await prisma.callSession.findUnique({
    where: { id: sessionId },
    include: { participants: { include: { user: { select: { displayName: true } } } } },
  });
  if (!session || !session.endedAt) return null;

  const clientMsgId = `call-${sessionId}`;
  const existing = await prisma.message.findUnique({
    where: { senderId_clientMsgId: { senderId: session.startedBy, clientMsgId } },
    include: SENDER_SELECT,
  });
  if (existing) return toDTO(existing);

  const durationSeconds = Math.max(0,
    Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1000));

  // A call nobody answered is noise, not history.
  if (session.participants.length <= 1 && durationSeconds < 15) return null;

  const count = session.participants.length;
  const mins = durationSeconds < 60
    ? `${durationSeconds}s`
    : `${Math.floor(durationSeconds / 60)} min`;

  const created = await prisma.message.create({
    data: {
      channelId: session.channelId,
      // Attributed to whoever started the call — senderId stays non-null.
      senderId: session.startedBy,
      body: `Call ended · ${count} participant${count === 1 ? '' : 's'} · ${mins}`,
      bodyLang: 'en',
      kind: 'system',
      systemData: {
        type: 'call_ended',
        durationSeconds,
        participantCount: count,
        participantNames: session.participants.map((p) => p.user.displayName),
      },
      clientMsgId,
    },
    include: SENDER_SELECT,
  });

  return toDTO(created);
}

/** A quote is a pointer, not a copy. Long originals are cut here. */
const REPLY_SNIPPET = 140;

/**
 * Serialises the message being replied to.
 *
 * Truncated server-side rather than in CSS: sending an 8000-character body so
 * the client can show 140 of it wastes the payload on every message in a
 * reply-heavy channel.
 */
function replyPreview(r) {
  if (!r) return null;
  return {
    id: r.id,
    senderName: r.sender?.displayName ?? '',
    senderNameAr: r.sender?.displayNameAr ?? null,
    // A withdrawn original must not leak its body through the quote — the
    // whole point of deleting it.
    body: r.deletedAt
      ? null
      : (r.body ?? '').slice(0, REPLY_SNIPPET),
    deleted: Boolean(r.deletedAt),
    hasAttachments: (r._count?.attachments ?? 0) > 0,
  };
}

const SENDER_SELECT = {
  sender: { select: { displayName: true, displayNameAr: true } },
  attachments: {
    select: {
      id: true, filename: true, mimeType: true, sizeBytes: true,
      scanStatus: true, thumbnailKey: true,
    },
  },
  // In the SHARED include, so every path that loads a message gets reactions.
  // Adding it per-query is how one endpoint ends up returning messages whose
  // reactions vanish on refresh.
  reactions: {
    select: { emoji: true, userId: true, user: { select: { displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  replyTo: {
    select: {
      id: true, body: true, deletedAt: true,
      sender: { select: { displayName: true, displayNameAr: true } },
      _count: { select: { attachments: true } },
    },
  },
};

/**
 * Rows → grouped counts, viewer-independent.
 *
 * ⚠️ MIRRORS src/lib/chat/reactions.ts. This file is plain ESM loaded by
 * server.mjs and cannot import a .ts module, so the logic exists twice.
 * Change one, change the other — divergence shows up as counts that differ
 * between a fresh load and a live update.
 *
 * `userIds` ships instead of a server-computed `mine` so a broadcast is
 * serialised once for everyone rather than once per recipient.
 */
function groupReactions(rows) {
  const byEmoji = new Map();
  for (const r of rows ?? []) {
    let g = byEmoji.get(r.emoji);
    if (!g) { g = { emoji: r.emoji, count: 0, userIds: [], names: [] }; byEmoji.set(r.emoji, g); }
    g.count += 1;
    g.userIds.push(r.userId);
    // Capped: a tooltip listing forty names is unreadable, and the payload
    // grows with every reaction on a busy message.
    if (g.names.length < 8) g.names.push(r.user?.displayName ?? '');
  }
  // Most-reacted first, so the emoji people actually used leads.
  return [...byEmoji.values()].sort((a, b) => b.count - a.count);
}

function toDTO(m) {
  return {
    id: m.id,
    channelId: m.channelId,
    senderId: m.senderId,
    senderName: m.sender.displayName,
    senderNameAr: m.sender.displayNameAr,
    // Tombstone: body withheld from the wire, row preserved for reply chains.
    body: m.deletedAt ? null : m.body,
    bodyLang: m.bodyLang,
    replyToId: m.replyToId,
    clientMsgId: m.clientMsgId,
    seq: m.seq.toString(),          // JSON cannot carry BigInt
    kind: m.kind ?? 'user',
    systemData: m.systemData ?? null,
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      sizeBytes: Number(a.sizeBytes),
      scanStatus: a.scanStatus,
      hasThumbnail: Boolean(a.thumbnailKey),
    })),
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
    reactions: groupReactions(m.reactions ?? []),
    replyTo: replyPreview(m.replyTo),
  };
}

/** Server-side membership check. A client-supplied channelId is never trusted. */
async function isMember(userId, channelId) {
  const row = await prisma.channelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { userId: true },
  });
  return row !== null;
}

// ---------------------------------------------------------------------------
/**
 * Sends a push to channel members who are OFFLINE.
 *
 * Presence is the gate: someone with the tab open already saw the message and
 * heard the sound. A push on top of that is noise, and noise is how people end
 * up disabling notifications entirely.
 *
 * Never notifies the sender.
 */
async function notifyOfflineMembers(channelId, senderId, senderName, body) {
  if (!VAPID_CONFIGURED) return;

  try {
    const members = await prisma.channelMember.findMany({
      where: { channelId, userId: { not: senderId } },
      select: {
        userId: true,
        mutedUntil: true,
        user: { select: { locale: true } },
      },
    });
    if (members.length === 0) return;

    const now = new Date();
    const candidates = members.filter((m) => !m.mutedUntil || m.mutedUntil < now);
    if (candidates.length === 0) return;

    // Absence of the presence key means offline. A tab that was killed never
    // sends a goodbye, so the TTL is the only reliable signal.
    const presence = await redis.mget(candidates.map((m) => presenceKey(m.userId)));
    const offline = candidates.filter((_, i) => !presence[i]);
    if (offline.length === 0) return;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true, type: true },
    });

    for (const member of offline) {
      const isArabic = member.user.locale === 'ar';
      await sendPush(member.userId, {
        title: senderName,
        // The body is included deliberately: a notification saying only "new
        // message" forces the user to open the app to learn whether it matters.
        // Make this configurable if that is ever the wrong trade-off.
        body: body.slice(0, 140),
        channelId,
        dir: isArabic ? 'rtl' : 'ltr',
        lang: member.user.locale ?? 'en',
      });
      void channel;
    }
  } catch (err) {
    // A failed notification must never fail the message it was about.
    console.error('[push] notify failed', err.message);
  }
}

export function installAuth(io) {
  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.cookie;
      if (!header) return next(new Error('UNAUTHENTICATED'));

      const token = cookie.parse(header)['cp_access'];
      if (!token) return next(new Error('UNAUTHENTICATED'));

      let claims;
      try {
        const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
        claims = payload;
      } catch {
        return next(new Error('UNAUTHENTICATED'));
      }

      // Re-read the DB so a deactivated user is refused immediately rather
      // than staying connected until their JWT expires.
      const user = await prisma.user.findFirst({
        where: { id: String(claims.sub), isActive: true },
        select: { id: true, role: true, displayName: true },
      });
      if (!user) return next(new Error('ACCOUNT_INACTIVE'));

      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.displayName = user.displayName;
      next();
    } catch (err) {
      console.error('[socket auth]', err);
      next(new Error('AUTH_FAILED'));
    }
  });
}

/**
 * Bridges worker scan results to connected clients. A DEDICATED subscriber
 * connection is required — a Redis client in subscriber mode cannot run normal
 * commands, and this one is shared with rate limiting and presence.
 */
function installScanRelay(io) {
  const sub = redis.duplicate();

  sub.on('error', (e) => console.error('[scan relay]', e.message));

  sub.subscribe('attachment:scanned', (err) => {
    if (err) return console.error('[scan relay] subscribe failed', err.message);
    console.log('> scan relay listening');
  });

  sub.on('message', (_channel, payload) => {
    try {
      const data = JSON.parse(payload);
      if (!data.channelId) return;
      io.to(channelRoom(data.channelId)).emit('attachment:updated', {
        attachmentId: data.attachmentId,
        messageId: data.messageId,
        scanStatus: data.scanStatus,
        hasThumbnail: data.hasThumbnail,
      });
    } catch (err) {
      console.error('[scan relay] bad payload', err.message);
    }
  });
}

export function installHandlers(io) {
  installScanRelay(io);

  io.on('connection', async (socket) => {
    const userId = socket.data.userId;

    try {
      await socket.join(userRoom(userId));

      // Rooms are derived from DB membership. The client does not nominate them.
      const memberships = await prisma.channelMember.findMany({
        where: { userId },
        select: { channelId: true },
      });
      for (const m of memberships) await socket.join(channelRoom(m.channelId));

      await redis.set(presenceKey(userId), Date.now().toString(), 'EX', PRESENCE_TTL);
      io.emit('presence:update', { userId, status: 'online', lastSeenAt: new Date().toISOString() });

      const peers = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
      const values = peers.length ? await redis.mget(peers.map((p) => presenceKey(p.id))) : [];
      const online = peers.filter((_, i) => values[i]).map((p) => p.id);
      socket.emit('presence:snapshot', { online });
    } catch (err) {
      console.error('[socket connect]', err);
      socket.disconnect(true);
      return;
    }

    const limited = async (bucket) => {
      const cfg = LIMITS[bucket];
      const res = await rateLimit(`sock:${bucket}:${userId}`, cfg.limit, cfg.window);
      // Drop the event and warn. Do NOT disconnect — that punishes a slow
      // network the same as abuse.
      if (!res.allowed) socket.emit('rate:limited', { bucket, retryAfterSeconds: res.retryAfterSeconds });
      return !res.allowed;
    };

    socket.on('message:send', async (raw, ack) => {
      try {
        if (await limited('message')) return ack?.({ ok: false, code: 'RATE_LIMITED' });
        const input = MessageSendSchema.parse(raw);
        if (!(await isMember(userId, input.channelId))) return ack?.({ ok: false, code: 'FORBIDDEN' });

        // Idempotent: a retry with the same clientMsgId returns the original row.
        const existing = await prisma.message.findUnique({
          where: { senderId_clientMsgId: { senderId: userId, clientMsgId: input.clientMsgId } },
          include: SENDER_SELECT,
        });
        if (existing) return ack?.({ ok: true, message: toDTO(existing), duplicate: true });

        // Attachments must belong to this uploader AND this channel, and must
        // not already be attached to another message. Otherwise a client could
        // claim someone else's upload by guessing an id.
        let attachmentIds = [];
        if (input.attachmentIds?.length) {
          const owned = await prisma.attachment.findMany({
            where: {
              id: { in: input.attachmentIds },
              uploaderId: userId,
              channelId: input.channelId,
              messageId: null,
            },
            select: { id: true },
          });
          if (owned.length !== input.attachmentIds.length) {
            return ack?.({ ok: false, code: 'INVALID_ATTACHMENTS' });
          }
          attachmentIds = owned.map((a) => a.id);
        }

        /**
         * A reply target must live in the SAME channel.
         *
         * Without this, a member of #general could reply to a message id from
         * a private channel they are not in — and the quote preview would
         * render that message's author and body back to them. An id is easy to
         * guess at scale and easy to obtain from a screenshot.
         *
         * Membership on the containing channel is already proven above; this
         * checks the target belongs to it.
         */
        if (input.replyToId) {
          const target = await prisma.message.findUnique({
            where: { id: input.replyToId },
            select: { channelId: true },
          });
          if (!target || target.channelId !== input.channelId) {
            return ack?.({ ok: false, code: 'INVALID_REPLY' });
          }
        }

        const created = await prisma.message.create({
          data: {
            channelId: input.channelId,
            senderId: userId,                  // NEVER from the payload
            body: input.body,
            bodyLang: detectBodyLang(input.body),
            searchText: toSearchText(input.body),
            replyToId: input.replyToId ?? null,
            clientMsgId: input.clientMsgId,
            ...(attachmentIds.length
              ? { attachments: { connect: attachmentIds.map((id) => ({ id })) } }
              : {}),
          },
          include: SENDER_SELECT,
        });

        const dto = toDTO(created);
        io.to(channelRoom(input.channelId)).emit('message:new', dto);
        ack?.({ ok: true, message: dto });

        // Fire and forget — a push must never delay or fail the send.
        void notifyOfflineMembers(
          input.channelId, userId, socket.data.displayName, input.body || '📎',
        );
      } catch (err) {
        if (err instanceof z.ZodError) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        console.error('[message:send]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('message:edit', async (raw, ack) => {
      try {
        if (await limited('edit')) return ack?.({ ok: false, code: 'RATE_LIMITED' });
        const input = MessageEditSchema.parse(raw);

        const msg = await prisma.message.findUnique({ where: { id: input.messageId } });
        if (!msg || msg.deletedAt) return ack?.({ ok: false, code: 'NOT_FOUND' });
        // A system notice is a record of what happened, not something anyone
        // said. It is attributed to the call starter only so senderId can stay
        // non-null — that must not become a licence to rewrite it.
        if (msg.kind === 'system') return ack?.({ ok: false, code: 'FORBIDDEN' });
        // Author only. Moderators may delete, not rewrite — putting different
        // words under someone's name is worse than removing the message.
        if (msg.senderId !== userId) return ack?.({ ok: false, code: 'FORBIDDEN' });

        const updated = await prisma.message.update({
          where: { id: input.messageId },
          data: {
            body: input.body,
            bodyLang: detectBodyLang(input.body),
            searchText: toSearchText(input.body),   // keep the index in step
            editedAt: new Date(),
          },
          include: SENDER_SELECT,
        });
        io.to(channelRoom(msg.channelId)).emit('message:updated', toDTO(updated));
        ack?.({ ok: true });
      } catch (err) {
        if (err instanceof z.ZodError) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        console.error('[message:edit]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('message:delete', async (raw, ack) => {
      try {
        const input = MessageDeleteSchema.parse(raw);
        const role = socket.data.role;

        const msg = await prisma.message.findUnique({ where: { id: input.messageId } });
        if (!msg || msg.deletedAt) return ack?.({ ok: false, code: 'NOT_FOUND' });
        // Same reasoning as edit: the call starter did not "say" this.
        if (msg.kind === 'system') return ack?.({ ok: false, code: 'FORBIDDEN' });

        const isOwn = msg.senderId === userId;
        const isModerator = role === 'moderator' || role === 'admin';
        if (!isOwn && !isModerator) return ack?.({ ok: false, code: 'FORBIDDEN' });

        // Soft delete — the row survives so reply chains stay intact.
        const updated = await prisma.message.update({
          where: { id: input.messageId },
          data: { deletedAt: new Date(), deletedBy: userId },
          include: SENDER_SELECT,
        });
        io.to(channelRoom(msg.channelId)).emit('message:deleted', toDTO(updated));
        ack?.({ ok: true });
      } catch (err) {
        if (err instanceof z.ZodError) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        console.error('[message:delete]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    const typingIn = new Set();

    socket.on('message:react', async (raw, ack) => {
      try {
        const { messageId, emoji } = ReactSchema.parse(raw);

        const msg = await prisma.message.findUnique({
          where: { id: messageId },
          select: { id: true, channelId: true, deletedAt: true },
        });
        if (!msg) return ack?.({ ok: false, error: 'NOT_FOUND' });

        // Membership, not authorship. Anyone in the channel may react; only
        // the author may edit. Different questions, different checks.
        if (!(await isMember(userId, msg.channelId))) {
          return ack?.({ ok: false, error: 'FORBIDDEN' });
        }
        // A tombstone still holds a row for reply chains, but reacting to a
        // withdrawn message is meaningless.
        if (msg.deletedAt) return ack?.({ ok: false, error: 'MESSAGE_DELETED' });

        /**
         * Toggle, via the unique constraint rather than a read-then-write.
         * Two taps arriving together would both see "no row" and both insert;
         * the constraint makes the second fail, and P2002 means it was already
         * there — so remove it.
         */
        let added;
        try {
          await prisma.reaction.create({ data: { messageId, userId, emoji } });
          added = true;
        } catch (err) {
          if (err?.code !== 'P2002') throw err;
          await prisma.reaction.deleteMany({ where: { messageId, userId, emoji } });
          added = false;
        }

        const rows = await prisma.reaction.findMany({
          where: { messageId },
          select: { emoji: true, userId: true, user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        });

        const payload = {
          messageId,
          channelId: msg.channelId,
          reactions: groupReactions(rows),
        };

        // Broadcast to everyone including the sender: the optimistic update
        // and the authoritative state must converge, and the server's count
        // includes reactions the sender never saw.
        io.to(channelRoom(msg.channelId)).emit('reaction:updated', payload);
        ack?.({ ok: true, added });
      } catch (err) {
        console.error('[message:react]', err);
        ack?.({ ok: false, error: 'INTERNAL' });
      }
    });

    socket.on('typing:start', async (raw) => {
      try {
        if (await limited('typing')) return;
        const { channelId } = ChannelRefSchema.parse(raw);
        if (!(await isMember(userId, channelId))) return;
        typingIn.add(channelId);
        socket.to(channelRoom(channelId)).emit('typing:update', { channelId, userId, typing: true });
      } catch { /* malformed — ignore */ }
    });

    socket.on('typing:stop', async (raw) => {
      try {
        const { channelId } = ChannelRefSchema.parse(raw);
        typingIn.delete(channelId);
        socket.to(channelRoom(channelId)).emit('typing:update', { channelId, userId, typing: false });
      } catch { /* ignore */ }
    });

    socket.on('read:advance', async (raw, ack) => {
      try {
        const input = ReadAdvanceSchema.parse(raw);
        if (!(await isMember(userId, input.channelId))) return ack?.({ ok: false, code: 'FORBIDDEN' });

        const msg = await prisma.message.findUnique({
          where: { id: input.messageId },
          select: { seq: true, channelId: true },
        });
        if (!msg || msg.channelId !== input.channelId) return ack?.({ ok: false, code: 'NOT_FOUND' });

        const member = await prisma.channelMember.findUnique({
          where: { channelId_userId: { channelId: input.channelId, userId } },
        });
        // Read position only moves forward — scrolling up must not reset it.
        if (member && member.lastReadSeq >= msg.seq) return ack?.({ ok: true, noop: true });

        await prisma.channelMember.update({
          where: { channelId_userId: { channelId: input.channelId, userId } },
          data: { lastReadMessageId: input.messageId, lastReadSeq: msg.seq },
        });
        socket.to(channelRoom(input.channelId)).emit('read:update', {
          channelId: input.channelId, userId, messageId: input.messageId,
        });
        ack?.({ ok: true });
      } catch (err) {
        if (err instanceof z.ZodError) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        console.error('[read:advance]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('presence:heartbeat', async () => {
      if (await limited('heartbeat')) return;
      await redis.set(presenceKey(userId), Date.now().toString(), 'EX', PRESENCE_TTL);
    });

    // Reconnect gap-fill. Without this, messages sent during a brief
    // disconnect vanish with no error anywhere.
    socket.on('sync:since', async (raw, ack) => {
      try {
        if (await limited('sync')) return ack?.({ ok: false, code: 'RATE_LIMITED' });
        const input = SyncSinceSchema.parse(raw);
        if (!(await isMember(userId, input.channelId))) return ack?.({ ok: false, code: 'FORBIDDEN' });

        const rows = await prisma.message.findMany({
          where: { channelId: input.channelId, seq: { gt: BigInt(input.sinceSeq) } },
          orderBy: { seq: 'asc' },
          take: 200,
          include: SENDER_SELECT,
        });
        ack?.({ ok: true, messages: rows.map(toDTO) });
      } catch (err) {
        if (err instanceof z.ZodError) return ack?.({ ok: false, code: 'VALIDATION_ERROR' });
        console.error('[sync:since]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    // The worker publishes here when a scan finishes, so a bubble showing
    // "scanning…" updates without the user reloading.
    socket.on('attachment:subscribe', async (raw, ack) => {
      try {
        const { channelId } = ChannelRefSchema.parse(raw);
        if (!(await isMember(userId, channelId))) return ack?.({ ok: false, code: 'FORBIDDEN' });
        ack?.({ ok: true });
      } catch { ack?.({ ok: false, code: 'VALIDATION_ERROR' }); }
    });

    // ── Calls ───────────────────────────────────────────────────────────
    // Signaling here is RINGING and presence only. SDP and ICE belong to the
    // SFU; this server never sees them. Tokens come from /api/calls/token.

    socket.on('call:initiate', async (raw, ack) => {
      try {
        const { channelId } = CallInitiateSchema.parse(raw);
        if (!(await isMember(userId, channelId))) return ack?.({ ok: false, code: 'FORBIDDEN' });

        const session = await prisma.callSession.findFirst({
          where: { roomName: `call-${channelId}`, endedAt: null },
          select: { id: true },
        });

        // Ring everyone else in the channel, on every device they have open.
        const members = await prisma.channelMember.findMany({
          where: { channelId, userId: { not: userId } },
          select: { userId: true },
        });
        for (const m of members) {
          io.to(userRoom(m.userId)).emit('call:incoming', {
            sessionId: session?.id ?? null,
            channelId,
            fromUserId: userId,
            fromName: socket.data.displayName,
          });
        }

        ack?.({ ok: true, sessionId: session?.id ?? null });
      } catch (err) {
        console.error('[call:initiate]', err);
        ack?.({ ok: false, code: 'INTERNAL_ERROR' });
      }
    });

    socket.on('call:decline', async (raw) => {
      try {
        const { sessionId } = CallRefSchema.parse(raw);
        const session = await prisma.callSession.findUnique({ where: { id: sessionId } });
        if (!session) return;
        io.to(channelRoom(session.channelId)).emit('call:declined', { sessionId, userId });
      } catch { /* malformed — ignore */ }
    });

    socket.on('call:joined', async (raw) => {
      try {
        const { sessionId } = CallRefSchema.parse(raw);
        const session = await prisma.callSession.findUnique({ where: { id: sessionId } });
        if (!session) return;
        io.to(channelRoom(session.channelId)).emit('call:participant-joined', { sessionId, userId });
      } catch { /* ignore */ }
    });

    socket.on('call:left', async (raw) => {
      try {
        const { sessionId } = CallRefSchema.parse(raw);
        const session = await prisma.callSession.findUnique({ where: { id: sessionId } });
        if (!session) return;

        await prisma.callParticipant.updateMany({
          where: { sessionId, userId, leftAt: null },
          data: { leftAt: new Date() },
        });

        const remaining = await prisma.callParticipant.count({ where: { sessionId, leftAt: null } });
        if (remaining === 0) {
          await prisma.callSession.updateMany({
            where: { id: sessionId, endedAt: null },
            data: { endedAt: new Date(), endReason: 'all_participants_left' },
          });
          io.to(channelRoom(session.channelId)).emit('call:ended', { sessionId, reason: 'empty' });

          // Post the notice AFTER marking the session ended, so the duration
          // is correct, and broadcast it so it appears without a reload.
          try {
            const dto = await postCallEndedMessage(sessionId);
            if (dto) io.to(channelRoom(session.channelId)).emit('message:new', dto);
          } catch (err) {
            // A missing notice must never break leaving a call.
            console.error('[call:left] could not post system message', err);
          }
        } else {
          io.to(channelRoom(session.channelId)).emit('call:participant-left', { sessionId, userId });
        }
      } catch (err) {
        console.error('[call:left]', err);
      }
    });

    socket.on('disconnect', async () => {
      try {
        for (const channelId of typingIn) {
          socket.to(channelRoom(channelId)).emit('typing:update', { channelId, userId, typing: false });
        }
        // Shorten the TTL rather than deleting — a page navigation reconnects
        // within a second and should not flicker the user offline.
        await redis.expire(presenceKey(userId), 10);

        setTimeout(async () => {
          const still = await io.in(userRoom(userId)).fetchSockets();
          if (still.length === 0) {
            io.emit('presence:update', { userId, status: 'offline', lastSeenAt: new Date().toISOString() });
          }
        }, 11000);
      } catch (err) {
        console.error('[socket disconnect]', err);
      }
    });
  });
}
