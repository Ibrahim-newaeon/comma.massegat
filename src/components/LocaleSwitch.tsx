'use client';
// src/components/LocaleSwitch.tsx
import { useRouter } from 'next/navigation';

export function LocaleSwitch({ locale }: { locale: 'en' | 'ar' }) {
  const router = useRouter();

  function switchTo(next: 'en' | 'ar') {
    document.cookie = `cp_locale=${next}; path=/; max-age=31536000; samesite=strict`;
    router.refresh();
  }

  return (
    <button
      type="button"
      data-testid="locale-switch"
      aria-label={locale === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
      onClick={() => switchTo(locale === 'en' ? 'ar' : 'en')}
      className="touch-target rounded-md border border-[var(--border)] px-4 text-sm"
    >
      {locale === 'en' ? 'العربية' : 'English'}
    </button>
  );
}
