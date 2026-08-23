'use client';
// src/components/SignOutButton.tsx
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/csrfClient';

export function SignOutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      data-testid="sign-out"
      onClick={async () => {
        try { await apiPost('/api/auth/logout', {}); } catch { /* fall through to redirect */ }
        router.push('/login');
        router.refresh();
      }}
      className="touch-target rounded-md border border-[var(--border)] px-4 text-sm"
    >
      {label}
    </button>
  );
}
