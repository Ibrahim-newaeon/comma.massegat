// src/lib/search/normalize.ts
//
// ONE normalisation implementation, used at index time and at query time.
// If these ever diverge, searches silently return nothing for Arabic — the
// index holds one spelling and the query asks for another.

/**
 * Arabic users type the same word many ways. None of these differences are
 * meaningful for search:
 *
 *   مَدْرَسَة  مدرسه  مدرسة  مـدرسـة   →  all become  مدرسه
 *
 * Harakat are optional diacritics, tatweel is decorative stretching, and the
 * alef/yaa/taa-marbuta variants are routinely typed interchangeably.
 */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670]/g, '')            // harakat (diacritics)
    .replace(/\u0640/g, '')                            // tatweel ـ
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')  // آ أ إ ٱ → ا
    .replace(/\u0629/g, '\u0647')                      // ة → ه
    .replace(/\u0649/g, '\u064A')                      // ى → ي
    .replace(/\u0624/g, '\u0648')                      // ؤ → و
    .replace(/\u0626/g, '\u064A')                      // ئ → ي
    .normalize('NFKC')
    .trim();
}

/**
 * Prepares text for the search index. Lowercases Latin, normalises Arabic,
 * collapses whitespace.
 */
export function toSearchText(body: string | null): string | null {
  if (!body) return null;
  const normalized = normalizeArabic(body).toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}
