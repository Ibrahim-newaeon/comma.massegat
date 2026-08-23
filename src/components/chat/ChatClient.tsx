'use client';
// src/components/chat/ChatClient.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket, newClientMsgId } from '@/lib/chat/useSocket';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { ChannelList } from './ChannelList';
import type { MessageDTO, ChannelDTO } from '@/lib/chat/types';
import { uploadFile, type UploadProgress, type UploadHandle } from '@/lib/files/upload';
import { apiPost } from '@/lib/csrfClient';
import { playMessageSound, soundEnabled, setSoundEnabled } from '@/lib/chat/sound';
import { UploadTray } from '@/components/files/UploadTray';
import { useCall } from '@/lib/calls/useCall';
import { CallView } from '@/components/calls/CallView';
import { SystemNotice } from '@/components/chat/SystemNotice';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { IconRail } from '@/components/chat/IconRail';
import { CreateGroupDialog } from '@/components/chat/CreateGroupDialog';
import { MediaGallery } from '@/components/files/MediaGallery';
import { ReplyBar } from '@/components/chat/ReplyBar';
import { usePictureInPicture } from '@/lib/calls/usePictureInPicture';
import { SearchPanel } from '@/components/search/SearchPanel';
import { pushSupported, pushPermission, subscribeToPush, registerServiceWorker } from '@/lib/notifications/client';
import { IncomingCall } from '@/components/calls/IncomingCall';
import type { Dict, Locale } from '@/lib/i18n/dict';

type Me = { id: string; role: string; displayName: string; displayNameAr?: string | null };
type Peer = { id: string; displayName: string; displayNameAr: string | null };

export function ChatClient({
  dict, locale, me, initialChannels, peers,
}: {
  dict: Dict;
  locale: Locale;
  me: Me;
  initialChannels: ChannelDTO[];
  peers: Peer[];
}) {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [channels, setChannels] = useState<ChannelDTO[]>(initialChannels);

  // A server-component refresh delivers new props, but React keeps client
  // state — so a newly created DM never appeared. Re-sync when the prop
  // changes, PRESERVING live unread counts the socket has already applied:
  // a blind overwrite made the badge appear and then vanish.
  useEffect(() => {
    setChannels((prev) => initialChannels.map((incoming) => {
      const live = prev.find((c) => c.id === incoming.id);
      return live && live.unreadCount > incoming.unreadCount
        ? { ...incoming, unreadCount: live.unreadCount }
        : incoming;
    }));
  }, [initialChannels]);
  const [activeId, setActiveId] = useState<string | null>(initialChannels[0]?.id ?? null);
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, Set<string>>>({});
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setHasMore] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);

  /**
   * Scroll to a quoted original and flash it.
   *
   * Only works for messages already loaded. Older ones would need paging back
   * through history to find them — worth doing eventually, but silently doing
   * nothing is better than jumping somewhere wrong.
   */
  const jumpTo = useCallback((messageId: string) => {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash-highlight');
    setTimeout(() => el.classList.remove('flash-highlight'), 1600);
  }, []);
  const callNode = useRef<HTMLDivElement>(null);
  const pip = usePictureInPicture();
  const [pushState, setPushState] = useState<NotificationPermission | 'unsupported'>('default');

  // Register the service worker on load so push can be enabled later without a
  // reload. Registering is silent — it does NOT prompt for permission.
  useEffect(() => {
    if (!pushSupported()) { setPushState('unsupported'); return; }
    setPushState(pushPermission());
    void registerServiceWorker();
  }, []);
  // localStorage is not available during SSR, so read it after mount.
  useEffect(() => { setSound(soundEnabled()); }, []);

  /**
   * Opens the DM with a person, creating it on first use. The endpoint is
   * idempotent — a deterministic slug means the same pair always resolves to
   * one channel, whoever initiates.
   */
  const openDm = useCallback(async (peerId: string) => {
    const existing = channels.find((c) => c.type === 'dm' && c.peer?.id === peerId);
    if (existing) { setActiveId(existing.id); return; }

    try {
      const { channelId } = await apiPost<{ channelId: string }>('/api/channels/dm', { peerId });
      setActiveId(channelId);
      router.refresh();
    } catch {
      setError(dict.error);
    }
  }, [channels, router, dict.error]);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const call = useCall(socket);
  // Attachments uploaded and verified, waiting to be attached to a message.
  const readyAttachments = useRef<string[]>([]);
  const handles = useRef<Record<string, UploadHandle>>({});

  const paneRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(activeId);
  // Highest seq seen per channel — the watermark for reconnect gap-fill.
  const highestSeq = useRef<Record<string, string>>({});

  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const isCanonical = (m: MessageDTO) => m.seq !== '0';

  /**
   * Consecutive messages from one person collapse into a group — one avatar,
   * one name. But only within five minutes: two messages from the same person
   * hours apart are separate thoughts, and hiding the second timestamp makes
   * the gap invisible.
   */
  const GROUPING_WINDOW_MS = 5 * 60 * 1000;

  const startsGroup = (m: MessageDTO, prev: MessageDTO | undefined): boolean => {
    if (!prev) return true;
    if (prev.senderId !== m.senderId) return true;
    if (prev.kind === 'system' || m.kind === 'system') return true;
    return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GROUPING_WINDOW_MS;
  };

  const upsert = useCallback((incoming: MessageDTO) => {
    setMessages((prev) => {
      // Reconcile by clientMsgId, NEVER by array position — positions shift
      // when other people's messages arrive mid-flight.
      const idx = prev.findIndex(
        (m) => m.id === incoming.id ||
               (m.senderId === incoming.senderId && m.clientMsgId === incoming.clientMsgId),
      );
      if (idx === -1) return [...prev, incoming];
      const next = [...prev];
      next[idx] = incoming;
      return next;
    });
    if (isCanonical(incoming)) {
      const current = highestSeq.current[incoming.channelId] ?? '0';
      if (BigInt(incoming.seq) > BigInt(current)) {
        highestSeq.current[incoming.channelId] = incoming.seq;
      }
    }
  }, []);

  // -- load history on channel switch ---------------------------------------
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/messages?channelId=${activeId}&limit=50`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) { setError(dict.error); return; }
        setMessages(json.data.messages);
        setHasMore(json.data.hasMore);
        const last = json.data.messages.at(-1) as MessageDTO | undefined;
        if (last) highestSeq.current[activeId] = last.seq;
      })
      .catch(() => { if (!cancelled) setError(dict.error); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [activeId, dict.error]);

  // -- socket wiring ---------------------------------------------------------
  useEffect(() => {
    const s = socket.current;
    if (!s) return;

    const onNew = (m: MessageDTO) => {
      // Never chime for your own message, or for a system notice.
      if (m.senderId !== me.id && m.kind !== 'system') playMessageSound();
      if (m.channelId === activeIdRef.current) upsert(m);
      else setChannels((prev) => {
        const known = prev.some((c) => c.id === m.channelId);
        if (known) {
          return prev.map((c) =>
            c.id === m.channelId
              ? {
                  ...c,
                  unreadCount: c.unreadCount + 1,
                  lastMessageAt: m.createdAt,
                  lastMessage: {
                    body: m.body,
                    senderId: m.senderId,
                    senderName: m.senderName ?? '',
                    kind: m.kind ?? 'user',
                    attachmentCount: m.attachments?.length ?? 0,
                  },
                }
              : c);
        }
        // First message in a DM this client has never seen — the channel was
        // created by the other person. Pull it in rather than dropping the
        // badge on the floor.
        router.refresh();
        return prev;
      });
    };

    const onUpdated = (m: MessageDTO) => { if (m.channelId === activeIdRef.current) upsert(m); };

    const onTyping = (p: { channelId: string; userId: string; typing: boolean }) => {
      setTypingUsers((prev) => {
        const set = new Set(prev[p.channelId] ?? []);
        if (p.typing) set.add(p.userId); else set.delete(p.userId);
        return { ...prev, [p.channelId]: set };
      });
    };

    const onPresence = (p: { userId: string; status: string }) => {
      setOnline((prev) => {
        const next = new Set(prev);
        if (p.status === 'online') next.add(p.userId); else next.delete(p.userId);
        return next;
      });
    };

    const onSnapshot = (p: { online: string[] }) => setOnline(new Set(p.online));

    // The worker finished scanning. Patch the attachment in place rather than
    // refetching the channel — the message is already on screen and only one
    // field changed.
    const onAttachment = (p: {
      attachmentId: string; scanStatus: string; hasThumbnail: boolean;
    }) => {
      setMessages((prev) => prev.map((m) => {
        if (!m.attachments?.some((a) => a.id === p.attachmentId)) return m;
        return {
          ...m,
          attachments: m.attachments.map((a) =>
            a.id === p.attachmentId
              ? { ...a, scanStatus: p.scanStatus, hasThumbnail: p.hasThumbnail }
              : a),
        };
      }));
    };

    /**
     * The server's list is authoritative and REPLACES the optimistic one.
     * It carries reactions from other people that this client never applied,
     * so merging would double-count.
     */
    const onReaction = (p: {
      messageId: string; channelId: string; reactions: MessageDTO['reactions'];
    }) => {
      setMessages((prev) => prev.map((m) =>
        m.id === p.messageId ? { ...m, reactions: p.reactions } : m));
    };

    s.on('message:new', onNew);
    s.on('message:updated', onUpdated);
    s.on('message:deleted', onUpdated);
    s.on('typing:update', onTyping);
    s.on('presence:update', onPresence);
    s.on('presence:snapshot', onSnapshot);
    s.on('attachment:updated', onAttachment);
    s.on('reaction:updated', onReaction);

    return () => {
      s.off('message:new', onNew);
      s.off('message:updated', onUpdated);
      s.off('message:deleted', onUpdated);
      s.off('typing:update', onTyping);
      s.off('presence:update', onPresence);
      s.off('presence:snapshot', onSnapshot);
      s.off('attachment:updated', onAttachment);
      s.off('reaction:updated', onReaction);
    };
  }, [socket, upsert, me.id, router]);

  // -- reconnect gap-fill ----------------------------------------------------
  // Without this, messages sent during a two-second disconnect vanish silently.
  useEffect(() => {
    const s = socket.current;
    if (!s || !connected || !activeId) return;

    const since = highestSeq.current[activeId] ?? '0';
    s.emit('sync:since', { channelId: activeId, sinceSeq: since },
      (res: { ok: boolean; messages?: MessageDTO[] }) => {
        if (res?.ok && res.messages?.length) res.messages.forEach(upsert);
      });
  }, [connected, activeId, socket, upsert]);

  // -- autoscroll ------------------------------------------------------------
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 150;
    if (nearBottom) pane.scrollTop = pane.scrollHeight;
  }, [messages]);

  // -- mark read -------------------------------------------------------------
  useEffect(() => {
    const s = socket.current;
    const last = messages.filter(isCanonical).at(-1);
    if (!s || !activeId || !last) return;

    s.emit('read:advance', { channelId: activeId, messageId: last.id });
    setChannels((prev) => prev.map((c) => (c.id === activeId ? { ...c, unreadCount: 0 } : c)));
  }, [messages, activeId, socket]);

  // -- uploads ---------------------------------------------------------------
  const handleFiles = useCallback((files: File[]) => {
    if (!activeId) return;

    for (const file of files) {
      setUploads((prev) => [...prev, {
        attachmentId: null, filename: file.name, sizeBytes: file.size,
        percent: 0, status: 'presigning', error: null,
      }]);

      const handle = uploadFile(file, activeId, (patch) => {
        setUploads((prev) => prev.map((u) =>
          u.filename === file.name && u.sizeBytes === file.size ? { ...u, ...patch } : u));
      });
      handles.current[file.name] = handle;

      handle.promise
        .then((attachmentId) => { readyAttachments.current.push(attachmentId); })
        .catch((err: Error & { message?: string }) => {
          setUploads((prev) => prev.map((u) =>
            u.filename === file.name && u.sizeBytes === file.size
              ? { ...u, status: 'failed', error: err.message ?? dict.uploadFailed }
              : u));
        })
        .finally(() => { delete handles.current[file.name]; });
    }
  }, [activeId, dict.uploadFailed]);

  /**
   * Toggle a reaction.
   *
   * Applied optimistically so the tap feels instant, then overwritten by the
   * server's authoritative list — which includes reactions from other people
   * that this client had not seen. Without the optimistic step there is a
   * visible round-trip delay on every tap.
   */
  const react = useCallback((messageId: string, emoji: string) => {
    if (!socket.current) return;

    setMessages((prev) => prev.map((m) => {
      if (m.id !== messageId) return m;
      const existing = m.reactions ?? [];
      const hit = existing.find((r) => r.emoji === emoji);
      const mine = hit?.userIds.includes(me.id) ?? false;

      if (!hit) {
        return { ...m, reactions: [...existing, { emoji, count: 1, userIds: [me.id], names: [] }] };
      }
      if (mine) {
        // Removing the last one drops the chip entirely rather than leaving a
        // zero.
        const next = hit.count <= 1
          ? existing.filter((r) => r.emoji !== emoji)
          : existing.map((r) => r.emoji === emoji
              ? { ...r, count: r.count - 1, userIds: r.userIds.filter((u) => u !== me.id) }
              : r);
        return { ...m, reactions: next };
      }
      return {
        ...m,
        reactions: existing.map((r) => r.emoji === emoji
          ? { ...r, count: r.count + 1, userIds: [...r.userIds, me.id] }
          : r),
      };
    }));

    socket.current.emit('message:react', { messageId, emoji });
  }, [me.id]);

  const cancelUpload = useCallback((filename: string) => {
    handles.current[filename]?.cancel();

    /**
     * Also drop it from readyAttachments.
     *
     * Removing the tray row alone left a COMPLETED upload's id in that list,
     * so the next message still carried the file the user thought they had
     * removed — silently, and to whoever they sent it to next.
     */
    setUploads((prev) => {
      const removed = prev.find((u) => u.filename === filename);
      if (removed?.attachmentId) {
        readyAttachments.current = readyAttachments.current.filter(
          (id) => id !== removed.attachmentId,
        );
      }
      return prev.filter((u) => u.filename !== filename);
    });
  }, []);

  // -- send ------------------------------------------------------------------
  const send = useCallback((body: string) => {
    const s = socket.current;
    if (!s || !activeId) return;

    const clientMsgId = newClientMsgId();
    const attachmentIds = [...readyAttachments.current];
    readyAttachments.current = [];

    // Optimistic: seq '0' marks it pending until the server echoes the real row.
    const optimistic: MessageDTO = {
      id: `pending-${clientMsgId}`,
      channelId: activeId,
      senderId: me.id,
      senderName: me.displayName,
      senderNameAr: null,
      body,
      bodyLang: null,
      replyToId: replyTo?.id ?? null,
      clientMsgId,
      seq: '0',
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      attachments: [],
      kind: 'user',
      systemData: null,
      reactions: [],
      // Built from the target already in hand, so the quote renders instantly
      // rather than appearing when the server echo lands.
      replyTo: replyTo
        ? {
            id: replyTo.id,
            senderName: replyTo.senderName,
            senderNameAr: replyTo.senderNameAr,
            body: replyTo.body?.slice(0, 140) ?? null,
            deleted: false,
            hasAttachments: (replyTo.attachments?.length ?? 0) > 0,
          }
        : null,
    };
    setMessages((prev) => [...prev, optimistic]);

    // Cleared BEFORE the round-trip. Leaving it up means a second message
    // typed quickly attaches to the same target by accident.
    const replyingToId = replyTo?.id;
    setReplyTo(null);

    const timeout = setTimeout(() => {
      setError(dict.sendFailed);
      setMessages((prev) => prev.filter((m) => m.clientMsgId !== clientMsgId));
    }, 10_000);

    s.emit('message:send',
      {
        channelId: activeId, body, clientMsgId,
        ...(replyingToId ? { replyToId: replyingToId } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      },
      (res: { ok: boolean; message?: MessageDTO; code?: string }) => {
        clearTimeout(timeout);
        if (res?.ok && res.message) {
          upsert(res.message);
          // Only clear the tray once the server has taken the attachments.
          setUploads((prev) => prev.filter((u) => u.status !== 'done'));
        }
        else {
          setError(
            res?.code === 'RATE_LIMITED' ? dict.rateLimited
            : res?.code === 'INVALID_REPLY' ? dict.sendFailed
            : dict.sendFailed);
          setMessages((prev) => prev.filter((m) => m.clientMsgId !== clientMsgId));
        }
      });
  }, [socket, activeId, me, upsert, dict, replyTo]);

  const remove = useCallback((messageId: string) => {
    socket.current?.emit('message:delete', { messageId });
  }, [socket]);

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;
  const typingHere = [...(typingUsers[activeId ?? ''] ?? [])].filter((id) => id !== me.id);

  return (
    <div className="flex h-screen flex-col">
      <ChatHeader
        dict={dict}
        locale={locale}
        user={{ displayName: me.displayName, displayNameAr: me.displayNameAr ?? null, role: me.role }}
        onNewGroup={() => setGroupOpen(true)}
        // Below md the icon rail is hidden, so the mobile menu inside the
        // header is the ONLY route to the sound control. Declared on
        // ChatHeader all along and never passed — the toggle was unreachable
        // on a phone.
        soundOn={sound}
        onToggleSound={() => { const next = !sound; setSound(next); setSoundEnabled(next); }}
      />
      <div className="flex min-h-0 flex-1">
        <IconRail
          dict={dict}
          locale={locale}
          me={me}
          sound={sound}
          pushState={pushState}
          unreadTotal={channels.reduce((sum, c) => sum + c.unreadCount, 0)}
          onSearch={() => setSearchOpen(true)}
          onToggleSound={() => { const next = !sound; setSound(next); setSoundEnabled(next); }}
          onEnablePush={async () => {
            const r = await subscribeToPush();
            setPushState(r.ok ? 'granted' : pushPermission());
          }}
          onSwitchLocale={() => {
            const next = locale === 'en' ? 'ar' : 'en';
            document.cookie = `cp_locale=${next}; path=/; max-age=31536000; samesite=strict`;
            router.refresh();
          }}
        />
      <ChannelList
        dict={dict}
        locale={locale}
        channels={channels}
        activeId={activeId}
        online={online}
        onSelect={setActiveId}
        onOpenDm={openDm}
        onSearch={() => setSearchOpen(true)}
        peers={peers}
        meId={me.id}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      <section className="flex min-w-0 flex-1 flex-col" data-testid="chat-pane">
        <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            data-testid="open-channel-list"
            aria-label={dict.channels}
            aria-expanded={drawerOpen}
            className="me-2 h-14 w-14 shrink-0 rounded-md border border-[var(--border)] md:hidden"
          >
            ☰
          </button>
          <h2 className="font-semibold" data-testid="channel-title">
            <bdi dir="auto">
              {activeChannel?.type === 'dm' && activeChannel.peer
                ? (locale === 'ar' && activeChannel.peer.displayNameAr
                    ? activeChannel.peer.displayNameAr
                    : activeChannel.peer.displayName)
                : (activeChannel?.name ?? '')}
            </bdi>
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGalleryOpen(true)}
              disabled={!activeId}
              data-testid="open-gallery"
              aria-label={dict.media}
              className="touch-target rounded-lg border border-[var(--border)] px-3 text-sm disabled:opacity-50"
            >
              🖼
            </button>

            <button
              type="button"
              onClick={() => activeId && call.join(activeId)}
              disabled={!connected || !activeId || call.state.phase !== 'idle'}
              data-testid="start-call"
              aria-label={dict.startCall}
              className="touch-target rounded-md border border-[var(--border)] px-3 text-sm disabled:opacity-50"
            >
              📹
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              data-testid="open-search"
              aria-label={dict.search}
              className="touch-target rounded-md border border-[var(--border)] px-3 text-sm md:hidden"
            >
              🔍
            </button>

            {pushState !== 'unsupported' && pushState !== 'granted' && (
              <button
                type="button"
                disabled={pushState === 'denied'}
                title={pushState === 'denied' ? dict.notificationsBlocked : undefined}
                onClick={async () => {
                  // Only ever from a click. A permission prompt on page load is
                  // the fastest way to get permanently denied, and the denial
                  // is sticky — there is no second chance.
                  const r = await subscribeToPush();
                  setPushState(r.ok ? 'granted' : pushPermission());
                }}
                data-testid="enable-push"
                aria-label={dict.enableNotifications}
                className="touch-target rounded-md border border-[var(--border)] px-3 text-sm disabled:opacity-50 md:hidden"
              >
                🔔+
              </button>
            )}

            <button
              type="button"
              onClick={() => { const next = !sound; setSound(next); setSoundEnabled(next); }}
              data-testid="toggle-sound"
              data-enabled={sound}
              aria-pressed={sound}
              aria-label={sound ? dict.muteSound : dict.unmuteSound}
              className="touch-target rounded-md border border-[var(--border)] px-3 text-sm md:hidden"
            >
              {sound ? '🔔' : '🔕'}
            </button>
            <span
              className="text-xs text-[var(--muted)]"
              data-testid="connection-status"
              data-connected={connected}
            >
              {connected ? dict.connected : dict.reconnecting}
            </span>
          </div>
        </header>

        {/* Split view. On desktop the call sits BESIDE the conversation, so
            chat stays usable during a call — stacking them meant one or the
            other was always mostly off-screen. Below md it stacks, because a
            phone has no width to split.

            min-h-0 on both children: a flex child defaults to min-height auto
            and refuses to shrink below its content, which makes the message
            list overflow the viewport instead of scrolling. */}
        <div
          className={`flex min-h-0 flex-1 ${
            call.state.phase === 'connected' && !pip.active
              ? 'flex-col md:flex-row md:gap-2 md:p-2'
              : 'flex-col'
          }`}
          data-testid="call-split"
          data-split={call.state.phase === 'connected' && !pip.active}
        >
        {call.state.phase === 'connected' && (
          <div
            ref={callNode}
            data-testid="call-container"
            data-pip={pip.active}
            className={
              pip.active
                ? 'flex h-full w-full flex-col'
                : 'aspect-video max-h-[45vh] w-full shrink-0 overflow-hidden md:aspect-auto md:h-auto md:max-h-none md:w-[58%] md:shrink md:self-stretch'
            }
          >
            <CallView
              participants={call.participants}
              activeSpeaker={call.activeSpeaker}
              stats={call.stats}
              dict={dict}
              locale={locale}
              startedAt={call.startedAt}
              audioOn={call.audioOn}
              videoOn={call.videoOn}
              sharing={call.sharing}
              onToggleAudio={call.toggleAudio}
              onToggleVideo={call.toggleVideo}
              onToggleShare={call.toggleScreenShare}
              onLeave={call.leave}
              onPopOut={() => {
                if (pip.active) pip.close();
                else if (callNode.current) void pip.open(callNode.current);
              }}
              pipActive={pip.active}
              pipSupported={pip.supported}
            />
          </div>
        )}

        {call.state.phase === 'ringing' && (
          <IncomingCall
            from={call.state.from}
            dict={dict}
            onAccept={() => { const c = call.state; if (c.phase === 'ringing') void call.join(c.channelId); }}
            onDecline={call.decline}
          />
        )}

        {call.error && (
          <p role="alert" data-testid="call-error" className="px-4 py-2 text-sm text-[var(--danger)]">
            {call.error}
          </p>
        )}

        {/* The conversation column: messages, typing, uploads and composer
            move together, so the composer stays under the messages rather
            than under the video. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="chat-column">
        <div ref={paneRef} className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="message-list">
          {loading && <p data-testid="messages-loading">{dict.loading}</p>}
          {error && (
            <p role="alert" data-testid="chat-error" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
          {!loading && messages.length === 0 && (
            <p data-testid="messages-empty" className="text-[var(--muted)]">{dict.noMessages}</p>
          )}

          {messages.map((m, i) => (
            m.kind === 'system' ? (
              <SystemNotice key={m.id} message={m} dict={dict} locale={locale} />
            ) : (
            <MessageBubble
              key={m.id}
              message={m}
              isOwn={m.senderId === me.id}
              locale={locale}
              dict={dict}
              showSender={startsGroup(m, messages[i - 1])}
              canDelete={m.senderId === me.id || me.role === 'moderator' || me.role === 'admin'}
              meId={me.id}
              onReact={react}
              onReply={setReplyTo}
              onJump={jumpTo}
              onDelete={remove}
            />
            )
          ))}
        </div>

        <div className="h-6 px-4 text-xs text-[var(--muted)]" aria-live="polite" data-testid="typing-indicator">
          {typingHere.length > 0 && dict.someoneTyping}
        </div>

        {replyTo && (
          <ReplyBar target={replyTo} locale={locale} dict={dict}
            onCancel={() => setReplyTo(null)} />
        )}

        <UploadTray uploads={uploads} dict={dict} onCancel={cancelUpload} />

        <Composer
          dict={dict}
          disabled={!connected || !activeId}
          onFiles={handleFiles}
          hasPendingAttachments={uploads.some((u) => u.status === 'done')}
          onSend={send}
          onTypingStart={() => activeId && socket.current?.emit('typing:start', { channelId: activeId })}
          onTypingStop={() => activeId && socket.current?.emit('typing:stop', { channelId: activeId })}
        />
        </div>
        </div>
      </section>
      </div>

      {galleryOpen && activeId && (
        <MediaGallery
          channelId={activeId}
          channelName={channels.find((c) => c.id === activeId)?.name ?? ''}
          dict={dict}
          locale={locale}
          onClose={() => setGalleryOpen(false)}
        />
      )}

      {groupOpen && (
        <CreateGroupDialog
          dict={dict}
          locale={locale}
          peers={peers.filter((p) => p.id !== me.id)}
          onCreated={(channelId) => { setActiveId(channelId); router.refresh(); }}
          onClose={() => setGroupOpen(false)}
        />
      )}

      {searchOpen && (
        <SearchPanel
          dict={dict}
          locale={locale}
          onOpenChannel={(id) => setActiveId(id)}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
