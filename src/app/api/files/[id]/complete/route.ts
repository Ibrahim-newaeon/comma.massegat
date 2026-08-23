// src/app/api/files/[id]/complete/route.ts
export const runtime = 'nodejs';

import { prisma } from '@/lib/db';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';
import { headObject, getObjectBytes, deleteObject } from '@/lib/files/storage';
import { verifyMagicBytes } from '@/lib/files/magic';
import { enqueueScan } from '@/server/worker/queue';

/**
 * Called once the client has PUT the bytes. Verifies the object actually
 * landed, that its size matches what was declared, and that its CONTENT
 * matches its claimed type — then queues the virus scan.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    if (!actor) return fail('UNAUTHENTICATED', 'Not authenticated', 401);

    const { id } = await params;
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) return fail('NOT_FOUND', 'Attachment not found', 404);
    if (att.uploaderId !== actor.id) return fail('FORBIDDEN', 'Not your upload', 403);
    if (att.completedAt) return ok({ attachmentId: att.id, scanStatus: att.scanStatus, alreadyComplete: true });

    const head = await headObject(att.storageKey);
    if (!head.exists) return fail('OBJECT_MISSING', 'Upload did not complete', 400);

    // A size mismatch means the client lied at presign time and the quota
    // check was made against the wrong number.
    if (head.size !== Number(att.sizeBytes)) {
      await deleteObject(att.storageKey);
      await prisma.attachment.update({
        where: { id }, data: { scanStatus: 'rejected', scanDetail: 'SIZE_MISMATCH', completedAt: new Date() },
      });
      await audit({
        actorId: actor.id, action: 'FILE.REJECTED', targetType: 'attachment', targetId: id,
        metadata: { reason: 'SIZE_MISMATCH', declared: Number(att.sizeBytes), actual: head.size },
        ...requestContext(req),
      });
      return fail('SIZE_MISMATCH', 'Uploaded file does not match the declared size', 400);
    }

    // 4 KB is ample for every signature file-type recognises.
    const sample = await getObjectBytes(att.storageKey, 4096);
    const magic = await verifyMagicBytes(sample, att.declaredMimeType ?? att.mimeType, att.filename);

    if (!magic.ok) {
      await deleteObject(att.storageKey);
      await prisma.attachment.update({
        where: { id },
        data: { scanStatus: 'rejected', scanDetail: `${magic.code}: ${magic.detected ?? 'unknown'}`, completedAt: new Date() },
      });
      await audit({
        actorId: actor.id, action: 'FILE.REJECTED', targetType: 'attachment', targetId: id,
        metadata: { reason: magic.code, declared: att.declaredMimeType, detected: magic.detected },
        ...requestContext(req),
      });
      return fail(magic.code, magic.message, 400);
    }

    // Store the VERIFIED type, not the claim.
    await prisma.attachment.update({
      where: { id }, data: { mimeType: magic.mimeType, completedAt: new Date() },
    });

    await enqueueScan(id);

    await audit({
      actorId: actor.id, action: 'FILE.UPLOADED', targetType: 'attachment', targetId: id,
      metadata: { filename: att.filename, verifiedMime: magic.mimeType, sizeBytes: head.size },
      ...requestContext(req),
    });

    return ok({ attachmentId: id, scanStatus: 'pending', mimeType: magic.mimeType });
  } catch (err) {
    return handleError(err);
  }
}
