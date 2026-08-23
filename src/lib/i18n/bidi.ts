// src/lib/i18n/bidi.ts
// Unicode bidi isolation. Without this, interpolating Arabic names or filenames
// into an English sentence (or vice versa) visibly reorders surrounding characters.

const FSI = '\u2068'; // FIRST STRONG ISOLATE
const PDI = '\u2069'; // POP DIRECTIONAL ISOLATE

/** Wrap untrusted or mixed-direction text before embedding it in a sentence. */
export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/** Rough direction detection for a single string. Used for `dir` attributes. */
export function detectDirection(text: string): 'rtl' | 'ltr' {
  const firstStrong = text.match(/[\p{Script=Arabic}\p{Script=Hebrew}\p{L}]/u);
  if (!firstStrong) return 'ltr';
  return /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(firstStrong[0]) ? 'rtl' : 'ltr';
}

/**
 * Normalizes Arabic for search indexing and querying.
 * Must be applied identically at index time and query time.
 * (Not used in Phase 0 — lands with search in Phase 4. Kept here so the
 * implementation exists in one place from the start.)
 */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670]/g, '')            // strip harakat
    .replace(/\u0640/g, '')                            // strip tatweel
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')  // آ أ إ ٱ -> ا
    .replace(/\u0629/g, '\u0647')                      // ة -> ه
    .replace(/\u0649/g, '\u064A')                      // ى -> ي
    .replace(/\u0624/g, '\u0648')                      // ؤ -> و
    .replace(/\u0626/g, '\u064A')                      // ئ -> ي
    .normalize('NFKC')
    .trim();
}
