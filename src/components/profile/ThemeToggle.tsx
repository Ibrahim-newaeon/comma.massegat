'use client';
// src/components/profile/ThemeToggle.tsx
import { useRouter } from 'next/navigation';
import type { Dict } from '@/lib/i18n/dict';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Three options, not a switch.
 *
 * A binary toggle forces a choice the user may not want to make — "follow my
 * machine" is a legitimate preference, and it is the one most people are
 * already relying on without knowing it. A two-state switch silently opts them
 * out of it the moment they touch it.
 */
export function ThemeToggle({
  dict, value, onChange,
}: {
  dict: Dict;
  value: Theme;
  onChange: (t: Theme) => void;
}) {
  const router = useRouter();

  const options: { key: Theme; label: string; icon: string }[] = [
    { key: 'light', label: dict.themeLight, icon: '☀' },
    { key: 'dark', label: dict.themeDark, icon: '☾' },
    { key: 'system', label: dict.themeSystem, icon: '🖥' },
  ];

  function pick(next: Theme) {
    onChange(next);
    // Applied immediately via the cookie + attribute so the change is visible
    // before the save round-trips. The stored preference follows on save.
    document.cookie = `cp_theme=${next}; path=/; max-age=31536000; samesite=strict`;
    document.documentElement.setAttribute('data-theme', next);
    router.refresh();
  }

  return (
    <div
      role="radiogroup"
      aria-label={dict.theme}
      data-testid="theme-toggle"
      className="flex gap-2"
    >
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(o.key)}
            data-testid={`theme-${o.key}`}
            data-active={active}
            className={`touch-target flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border text-xs ${
              active
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)] font-medium text-[var(--accent-strong)]'
                : 'border-[var(--border)]'
            }`}
          >
            <span aria-hidden className="text-base">{o.icon}</span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
