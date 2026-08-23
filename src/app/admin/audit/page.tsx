// src/app/admin/audit/page.tsx
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { t, formatDateTime } from '@/lib/i18n/dict';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const d = t(locale);

  const rows = await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 100 });

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold">{d.auditLog}</h1>
      {rows.length === 0 ? (
        <p data-testid="audit-empty" className="text-[var(--muted)]">{d.noResults}</p>
      ) : (
        <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[640px] text-sm" data-testid="audit-table">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="p-2 text-start">{d.time}</th>
              <th className="p-2 text-start">{d.actor}</th>
              <th className="p-2 text-start">{d.action}</th>
              <th className="p-2 text-start">{d.target}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id.toString()} className="border-b border-[var(--border)]"
                data-testid={`audit-row-${r.action}`}>
                <td className="p-2">{formatDateTime(r.createdAt, locale)}</td>
                <td className="p-2"><span className="force-ltr text-xs">{r.actorId ?? '—'}</span></td>
                <td className="p-2 font-medium"><span className="force-ltr">{r.action}</span></td>
                <td className="p-2"><span className="force-ltr text-xs">{r.targetId ?? '—'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
