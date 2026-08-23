// src/app/page.tsx
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.mustChangePassword) redirect('/change-password');
  redirect('/chat');
}
