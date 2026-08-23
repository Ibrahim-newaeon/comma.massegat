// src/app/api/admin/users/[id]/route.ts
export const runtime = 'nodejs';

import { z } from 'zod';
import { env } from '@/env';
import { prisma } from '@/lib/db';
import { authorize } from '@/lib/authorize';
import { getActor } from '@/lib/session';
import { assertCsrf } from '@/lib/csrf';
import { revokeAllUserTokens, createSetupToken } from '@/lib/tokens';
import { audit, requestContext } from '@/lib/audit';
import { ok, fail, handleError } from '@/lib/http';

const PatchSchema = z.object({
  action: z.enum(['deactivate', 'reactivate', 'reset_password', 'change_role', 'approve', 'reject']),
  role: z.enum(['member', 'moderator', 'admin']).optional(),
});

/** Guard: never allow the org to lose its last active admin. */
async function wouldRemoveLastAdmin(userId: string): Promise<boolean> {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.role !== 'admin' || !target.isActive) return false;
  const activeAdmins = await prisma.user.count({ where: { role: 'admin', isActive: true } });
  return activeAdmins <= 1;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCsrf(req);
    const actor = await getActor();
    const { id } = await params;
    const body = PatchSchema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return fail('NOT_FOUND', 'User not found', 404);

    const ctx = requestContext(req);

    switch (body.action) {
      case 'deactivate': {
        authorize(actor, 'user:deactivate');
        if (await wouldRemoveLastAdmin(id)) {
          return fail('LAST_ADMIN', 'Cannot deactivate the last active admin', 409);
        }
        await prisma.user.update({
          where: { id },
          data: { isActive: false, deactivatedAt: new Date() },
        });
        await revokeAllUserTokens(id); // immediate lockout
        await audit({ actorId: actor.id, action: 'ADMIN.USER_DEACTIVATED',
          targetType: 'user', targetId: id, ...ctx });
        return ok({ deactivated: true });
      }

      case 'reactivate': {
        authorize(actor, 'user:deactivate');
        await prisma.$transaction(async (tx) => {
          // Reactivating does NOT approve. A rejected account brought back
          // should still be refused at login until someone approves it
          // deliberately — otherwise "reactivate" silently becomes "approve".
          await tx.user.update({
            where: { id },
            data: { isActive: true, deactivatedAt: null, mustChangePassword: true },
          });

          // Restore #general. Without this, someone reactivated after leaving
          // the channel returns to an empty sidebar and no way to reach anyone
          // — which reads as a broken account rather than a missing membership.
          const general = await tx.channel.findFirst({ where: { slug: 'general' } });
          if (general) {
            await tx.channelMember.upsert({
              where: { channelId_userId: { channelId: general.id, userId: id } },
              update: {},
              create: { channelId: general.id, userId: id },
            });
          }
        });
        await audit({ actorId: actor.id, action: 'ADMIN.USER_REACTIVATED',
          targetType: 'user', targetId: id, ...ctx });
        return ok({ reactivated: true });
      }

      case 'approve': {
        authorize(actor, 'user:create');
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id },
            data: { isActive: true, approvalStatus: 'approved' },
          });

          // Join #general on approval, not on registration. A pending account
          // with channel membership would have been receiving messages while
          // it waited.
          const general = await tx.channel.findFirst({ where: { slug: 'general' } });
          if (general) {
            await tx.channelMember.upsert({
              where: { channelId_userId: { channelId: general.id, userId: id } },
              update: {},
              create: { channelId: general.id, userId: id },
            });
          }
        });

        await audit({ actorId: actor.id, action: 'ADMIN.USER_APPROVED',
          targetType: 'user', targetId: id, ...ctx });
        return ok({ approved: true });
      }

      case 'reject': {
        authorize(actor, 'user:deactivate');
        // The row survives. Deleting it would let the same person register
        // again immediately, and would erase the record that they tried.
        await prisma.user.update({
          where: { id },
          data: { isActive: false, approvalStatus: 'rejected' },
        });
        await audit({ actorId: actor.id, action: 'ADMIN.USER_REJECTED',
          targetType: 'user', targetId: id, ...ctx });
        return ok({ rejected: true });
      }

      case 'reset_password': {
        authorize(actor, 'user:reset_password');
        await prisma.$transaction([
          prisma.authIdentity.updateMany({
            where: { userId: id, provider: 'password' },
            data: { passwordHash: null },
          }),
          prisma.user.update({ where: { id }, data: { mustChangePassword: true } }),
        ]);
        await revokeAllUserTokens(id);
        const token = await createSetupToken(id);
        await audit({ actorId: actor.id, action: 'ADMIN.PASSWORD_RESET_FORCED',
          targetType: 'user', targetId: id, ...ctx });
        return ok({ setupUrl: `${env.APP_URL}/change-password?setup=${token}` });
      }

      case 'change_role': {
        authorize(actor, 'user:change_role');
        if (!body.role) return fail('VALIDATION_ERROR', 'role is required', 400);
        if (body.role !== 'admin' && (await wouldRemoveLastAdmin(id))) {
          return fail('LAST_ADMIN', 'Cannot demote the last active admin', 409);
        }
        await prisma.user.update({ where: { id }, data: { role: body.role } });
        await audit({ actorId: actor.id, action: 'ADMIN.ROLE_CHANGED',
          targetType: 'user', targetId: id,
          metadata: { from: target.role, to: body.role }, ...ctx });
        return ok({ role: body.role });
      }
    }
  } catch (err) {
    return handleError(err);
  }
}
