// src/app/admin/users/page.tsx
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { t } from '@/lib/i18n/dict';
import { UsersTable } from './UsersTable';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';
  const d = t(locale);

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, displayName: true, displayNameAr: true, role: true,
      isActive: true, totpEnabled: true, createdAt: true,
      approvalStatus: true, createdVia: true,
    },
  });

  return (
    <section>
      <h1 className="mb-4 text-xl font-bold">{d.users}</h1>
      <UsersTable
        dict={d}
        locale={locale}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      />
    </section>
  );
}
