// src/app/api/files/[id]/download/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';
import { presignGet } from '@/lib/files/storage';
import { contentDisposition, INLINE_SAFE } from '@/lib/files/policy';

/**
 * Returns a 60-second presigned GET URL. Authorization is re-checked HERE, at
 * download time — not inherited from whoever uploaded the file. Membership can
 * be revoked between upload and download.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { id } = await params;
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) return fail('NOT_FOUND', 'File not found', 404);

    const member = await prisma.channelMember.findUnique({
      where: { channelId_userId: { channelId: att.channelId, userId: actor.id } },
    });
    if (!member) return fail('FORBIDDEN', 'Not a member of this channel', 403);

    // Nothing leaves storage until the scanner has cleared it.
    if (att.scanStatus === 'infected') {
      return fail('FILE_INFECTED', 'This file was found to contain malware and has been removed', 403);
    }
    if (att.scanStatus === 'rejected') {
      return fail('FILE_REJECTED', 'This file was rejected and is not available', 403);
    }
    if (att.scanStatus !== 'clean') {
      return fail('SCAN_PENDING', 'This file is still being scanned', 409, { scanStatus: att.scanStatus });
    }

    // Inline is OPT-IN and only for types that cannot execute anything.
    // The default stays 'attachment': an uploaded HTML or SVG file must be
    // saved, never rendered, or an upload becomes stored XSS.
    const wantsInline = new URL(req.url).searchParams.get('inline') === '1';
    const mayBeInline = wantsInline && INLINE_SAFE.has(att.mimeType);

    const disposition = mayBeInline
      // Still carries the filename, so "Save as" from the player names the file
      // correctly rather than offering a UUID.
      ? contentDisposition(att.filename).replace(/^attachment/, 'inline')
      : contentDisposition(att.filename);

    const url = await presignGet(att.storageKey, disposition, att.mimeType, 60);

    await audit({
      actorId: actor.id, action: 'FILE.DOWNLOADED', targetType: 'attachment', targetId: id,
      metadata: { filename: att.filename, inline: mayBeInline }, ...requestContext(req),
    });

    return ok({ url, filename: att.filename, mimeType: att.mimeType, expiresInSeconds: 60 });
  } catch (err) {
    return handleError(err);
  }
}
