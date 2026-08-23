// src/app/profile/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/session';
import { t } from '@/lib/i18n/dict';
import { ProfileClient } from '@/components/profile/ProfileClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const actor = await getActor();
  if (!actor) redirect('/login');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';

  return <ProfileClient dict={t(locale)} locale={locale} />;
}
