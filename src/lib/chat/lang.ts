// src/lib/chat/lang.ts
/**
 * Classifies message text for the bodyLang column.
 * Used for analytics and future search config selection — NOT for rendering.
 * Rendering direction is decided per-element by dir="auto" in the browser,
 * which implements the Unicode bidi algorithm properly.
 */
export function detectBodyLang(text: string): 'ar' | 'en' | 'mixed' {
  const arabic = (text.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;

  if (arabic === 0 && latin === 0) return 'en';
  if (arabic > 0 && latin === 0) return 'ar';
  if (latin > 0 && arabic === 0) return 'en';

  const total = arabic + latin;
  const ratio = arabic / total;
  if (ratio > 0.8) return 'ar';
  if (ratio < 0.2) return 'en';
  return 'mixed';
}
