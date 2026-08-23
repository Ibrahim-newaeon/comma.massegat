// src/lib/files/magic.ts
// MIME verification by content, not by claim.
//
// A client controls both the file extension and the Content-Type header. It
// does not control the first bytes of the file. Anything that trusts the
// declared type is trusting the attacker.
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_MIME, extensionOf, BLOCKED_EXTENSIONS } from './policy';

export type MagicResult =
  | { ok: true; mimeType: string }
  | { ok: false; code: string; message: string; detected: string | null };

/**
 * Audio-only and video WebM share ONE container format (EBML) with identical
 * magic bytes. file-type reports 'video/webm' for both — it cannot know the
 * container holds no video track without parsing it.
 *
 * So a voice note declared as audio/webm is detected as video/webm and the
 * strict mismatch check rejects it. These pairs are the same bytes, not a
 * spoof attempt, and are treated as equivalent.
 *
 * This is NOT a loosening of the mismatch check generally: an .exe declared as
 * a PNG is still caught, because those containers are genuinely different.
 */
const EQUIVALENT_CONTAINERS: Record<string, string[]> = {
  'audio/webm': ['video/webm'],
  'audio/ogg': ['video/ogg', 'application/ogg'],
  'audio/mp4': ['video/mp4'],
  'audio/aac': ['audio/mp4', 'video/mp4'],
};

/** Types file-type cannot fingerprint because they have no signature bytes. */
const TEXTUAL = new Set(['text/plain', 'text/csv']);

export async function verifyMagicBytes(
  head: Buffer,
  declaredMime: string,
  filename: string,
): Promise<MagicResult> {
  const ext = extensionOf(filename);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, code: 'BLOCKED_EXTENSION', message: `.${ext} files are not permitted`, detected: null };
  }

  const detected = await fileTypeFromBuffer(head);

  if (!detected) {
    // Plain text genuinely has no magic bytes. Accept it only if the claim was
    // textual AND the content contains no NUL — a NUL means it is binary
    // pretending to be text.
    if (TEXTUAL.has(declaredMime)) {
      if (head.includes(0)) {
        return {
          ok: false, code: 'MIME_MISMATCH',
          message: 'File claims to be text but contains binary data',
          detected: null,
        };
      }
      return { ok: true, mimeType: declaredMime };
    }
    return {
      ok: false, code: 'UNRECOGNISED_TYPE',
      message: 'File type could not be verified from its contents',
      detected: null,
    };
  }

  if (!ALLOWED_MIME.has(detected.mime)) {
    return {
      ok: false, code: 'BLOCKED_MIME',
      message: `This file is actually ${detected.mime}, which is not permitted`,
      detected: detected.mime,
    };
  }

  // Same container, different declared track type — not a spoof.
  const equivalents = EQUIVALENT_CONTAINERS[declaredMime] ?? [];
  if (detected.mime !== declaredMime && equivalents.includes(detected.mime)) {
    return { ok: true, mimeType: declaredMime };
  }

  // The declared type disagreeing with the content is the interesting case:
  // an .exe renamed to .png reaches exactly here.
  if (detected.mime !== declaredMime) {
    return {
      ok: false, code: 'MIME_MISMATCH',
      message: `File was declared as ${declaredMime} but is actually ${detected.mime}`,
      detected: detected.mime,
    };
  }

  return { ok: true, mimeType: detected.mime };
}
