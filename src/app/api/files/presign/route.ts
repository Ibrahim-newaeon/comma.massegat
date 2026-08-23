// src/app/api/files/presign/route.ts
export const runtime = 'nodejs';

import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/ratelimit';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';
import { checkDeclaredFile, sanitizeForKey } from '@/lib/files/policy';
import { checkQuota } from '@/lib/files/quota';
import { presignPut } from '@/lib/files/storage';

const Schema = z.object({
  channelId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

/**
 * Issues a short-lived upload URL. Every check happens HERE, before any bytes
 * move — authorization, quota, size, extension, declared type. Checking after
 * the upload means paying for storage you then have to reclaim.
 *
 * The API server never touches file bytes: the client PUTs directly to object
 * storage.
 */
export async function POST(req: Request) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const limiter = await rateLimit(`presign:${actor.id}`, 30, 600);
    if (!limiter.allowed) {
      return fail('RATE_LIMITED', 'Too many uploads. Please wait a moment.', 429, {
        retryAfterSeconds: limiter.retryAfterSeconds,
      });
    }

    const input = Schema.parse(await req.json());

    // Membership, server-side. A client-supplied channelId is never trusted.
    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: input.channelId, userId: actor.id } },
    });
    if (!member) return fail('FORBIDDEN', 'Not a member of this channel', 403);

    const policy = checkDeclaredFile(input.filename, input.mimeType, input.sizeBytes);
    if (!policy.ok) return fail(policy.code, policy.message, 400);

    const quota = await checkQuota(actor.id, input.channelId, input.sizeBytes);
    if (!quota.ok) return fail(quota.code, quota.message, 413);

    // Unguessable key. The original filename — Arabic included — stays in the
    // database; object keys are ASCII only.
    const storageKey = `${input.channelId}/${crypto.randomUUID()}/${sanitizeForKey(input.filename)}`;

    const attachment = await prisma.attachment.create({
      data: {
        channelId: input.channelId,
        uploaderId: actor.id,
        storageKey,
        filename: input.filename,
        mimeType: input.mimeType,          // provisional — replaced after verification
        declaredMimeType: input.mimeType,
        sizeBytes: BigInt(input.sizeBytes),
        scanStatus: 'pending',
      },
    });

    const uploadUrl = await presignPut(storageKey, input.mimeType, 300);

    await audit({
      actorId: actor.id, action: 'FILE.PRESIGNED',
      targetType: 'attachment', targetId: attachment.id,
      metadata: { filename: input.filename, sizeBytes: input.sizeBytes, declaredMime: input.mimeType },
      ...requestContext(req),
    });

    return ok({ attachmentId: attachment.id, uploadUrl, expiresInSeconds: 300 }, 201);
  } catch (err) {
    return handleError(err);
  }
}
