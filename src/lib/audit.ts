// src/lib/audit.ts
import { prisma } from '@/lib/db';
import { env } from '@/env';

export type AuditInput = {
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Writes an audit row. NEVER throws into the request path — a failed audit
 * write must not break the user's action, but it must be visible in logs.
 * There is deliberately no delete path for audit rows.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? {}) as object,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[AUDIT WRITE FAILED]', input.action, err);
  }
}

/**
 * Extracts the client IP and user agent.
 *
 * ⚠️ Forwarding headers are CLIENT-SUPPLIED unless a proxy overwrites them.
 * Trusting them unconditionally lets anyone send
 *   X-Forwarded-For: 1.2.3.4
 * and appear as a different address on every request — which defeats per-IP
 * rate limiting entirely and writes attacker-chosen addresses into the audit
 * log, where they look like evidence.
 *
 * So they are read ONLY when TRUST_PROXY says a proxy is in front and is
 * overwriting them. With no trusted proxy there is no trustworthy client IP,
 * and null is the honest answer — per-IP limiting is skipped in that
 * configuration and must be enforced at the edge instead.
 */
export function requestContext(req: Request) {
  const h = req.headers;
  const userAgent = h.get('user-agent');

  if (!env.TRUST_PROXY) return { ipAddress: null, userAgent };

  // Cloudflare sets this itself and strips any client-supplied copy, so it is
  // authoritative behind a tunnel. X-Forwarded-For behind Cloudflare also
  // contains Cloudflare's edge address, which is not the user.
  const cf = h.get('cf-connecting-ip');
  if (cf) return { ipAddress: cf.trim(), userAgent };

  // Otherwise the LEFTMOST entry is the original client — but only because a
  // trusted proxy is guaranteed to have rewritten the header.
  const fwd = h.get('x-forwarded-for');
  return {
    ipAddress: fwd ? (fwd.split(',')[0]?.trim() ?? null) : null,
    userAgent,
  };
}
