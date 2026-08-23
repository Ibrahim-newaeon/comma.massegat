// src/lib/files/policy.ts
import { env } from '@/env';

/**
 * ALLOWLIST, never a blocklist. A blocklist is a list of the attacks you
 * happened to think of; everything you did not think of is permitted.
 */
export const ALLOWED_MIME = new Set([
  // images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic',
  // documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  // archives
  'application/zip', 'application/x-7z-compressed', 'application/vnd.rar',
  // media
  // MediaRecorder emits webm/opus in Chromium and mp4 in Safari. Neither is
  // negotiable — the browser picks, not us.
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/aac',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

/**
 * Rejected regardless of detected MIME. An attacker controls the extension,
 * and Windows decides what to execute largely from the extension.
 */
export const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'com', 'scr', 'msi', 'msp', 'cpl',
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'jar', 'app', 'deb', 'rpm', 'dmg', 'pkg',
  'lnk', 'reg', 'hta', 'chm', 'gadget',
]);

/**
 * Types that may be served WITHOUT Content-Disposition: attachment.
 *
 * Every one of these is inert: a decoder renders it, nothing executes. HTML,
 * SVG and PDF are deliberately absent — HTML and SVG run script, and PDF
 * viewers have a long history of doing more than display a document.
 *
 * This list is the security boundary for inline delivery. Adding a type to it
 * is a decision about code execution, not about convenience.
 */
export const INLINE_SAFE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/aac',
  'video/mp4', 'video/webm',
]);

/**
 * Previewable inline. Deliberately excludes HTML and SVG — both execute
 * script in the browser, which turns an upload into stored XSS.
 */
export const INLINE_PREVIEWABLE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'application/pdf',
]);

export const THUMBNAILABLE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
]);

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

export type PolicyResult = { ok: true } | { ok: false; code: string; message: string };

export function checkDeclaredFile(filename: string, mimeType: string, sizeBytes: number): PolicyResult {
  if (sizeBytes <= 0) return { ok: false, code: 'EMPTY_FILE', message: 'File is empty' };

  if (sizeBytes > env.MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `File exceeds the ${Math.floor(env.MAX_FILE_BYTES / 1_048_576)} MB limit`,
    };
  }

  const ext = extensionOf(filename);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { ok: false, code: 'BLOCKED_EXTENSION', message: `.${ext} files are not permitted` };
  }

  if (!ALLOWED_MIME.has(mimeType)) {
    return { ok: false, code: 'BLOCKED_MIME', message: `${mimeType} files are not permitted` };
  }

  return { ok: true };
}

/**
 * Object keys must be ASCII and unguessable. The original filename — Arabic
 * included — is stored in the database, not in the key.
 */
export function sanitizeForKey(filename: string): string {
  const ext = extensionOf(filename);
  const base = filename
    .slice(0, filename.length - (ext ? ext.length + 1 : 0))
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')      // strips Arabic, spaces, punctuation
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const safeBase = base.length > 0 ? base : 'file';
  return ext ? `${safeBase}.${ext}` : safeBase;
}

/**
 * RFC 5987. Content-Disposition is a Latin-1 header: a raw Arabic filename in
 * `filename=` is mangled or dropped. `filename*` carries the UTF-8 version and
 * the plain `filename=` is the ASCII fallback for old clients.
 */
export function contentDisposition(filename: string): string {
  const ascii = sanitizeForKey(filename).replace(/["\\]/g, '');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
