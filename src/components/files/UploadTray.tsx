'use client';
// src/components/files/UploadTray.tsx
import type { Dict } from '@/lib/i18n/dict';
import { formatBytes, type UploadProgress } from '@/lib/files/upload';

export function UploadTray({
  uploads, dict, onCancel,
}: {
  uploads: UploadProgress[];
  dict: Dict;
  onCancel: (filename: string) => void;
}) {
  if (uploads.length === 0) return null;

  return (
    <ul className="border-t border-[var(--border)] p-2" data-testid="upload-tray">
      {uploads.map((u) => (
        <li
          key={`${u.filename}-${u.sizeBytes}`}
          className="flex items-center gap-2 py-1 text-xs"
          data-testid="upload-item"
          data-status={u.status}
        >
          <span className="min-w-0 flex-1">
            <bdi dir="auto" className="block truncate">{u.filename}</bdi>
            <span className="force-ltr opacity-60">{formatBytes(u.sizeBytes)}</span>
          </span>

          {u.status === 'failed' ? (
            <span role="alert" className="text-[var(--danger)]" data-testid="upload-error">
              {u.error ?? dict.uploadFailed}
            </span>
          ) : u.status === 'done' ? (
            <span data-testid="upload-done" className="text-[var(--accent)]">
              ✓ {dict.readyToSend}
            </span>
          ) : (
            <>
              <span className="force-ltr w-10 text-end">{u.percent}%</span>
              <div className="h-1 w-20 overflow-hidden rounded bg-[var(--border)]" aria-hidden>
                <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${u.percent}%` }} />
              </div>
            </>
          )}

          {/* Outside the status branch, so it is present at EVERY stage.
              Previously it disappeared the moment upload finished — which is
              exactly when someone notices they picked the wrong file. */}
          <button
            type="button"
            onClick={() => onCancel(u.filename)}
            data-testid="remove-upload"
            aria-label={`${dict.removeAttachment}: ${u.filename}`}
            title={dict.removeAttachment}
            className="touch-target shrink-0 rounded border border-[var(--border)] px-3 text-[var(--muted)] hover:text-[var(--danger)]"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
