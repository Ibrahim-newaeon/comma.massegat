// src/app/signup/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { t } from '@/lib/i18n/dict';
import { SignupForm } from '@/app/signup/SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  // Signup is off unless someone explicitly listed domains. Rendering the form
  // regardless would advertise a route that only ever refuses.
  const domains = env.SIGNUP_ALLOWED_DOMAINS
    .split(',').map((d) => d.trim()).filter(Boolean);
  if (domains.length === 0) redirect('/login');

  const jar = await cookies();
  const locale = (jar.get('cp_locale')?.value === 'ar' ? 'ar' : 'en') as 'en' | 'ar';

  return (
    <SignupForm
      dict={t(locale)}
      domains={domains}
      needsApproval={!env.SIGNUP_AUTO_APPROVE}
    />
  );
}
