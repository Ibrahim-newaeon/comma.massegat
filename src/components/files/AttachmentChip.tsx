'use client';
// src/components/files/AttachmentChip.tsx
import { useState } from 'react';
import type { AttachmentDTO } from '@/lib/chat/types';
import type { Dict } from '@/lib/i18n/dict';
import { requestDownload, formatBytes } from '@/lib/files/upload';
import { Waveform } from '@/components/files/Waveform';
import { ApiError } from '@/lib/csrfClient';

const BLOCKED = new Set(['infected', 'rejected', 'error']);

export function AttachmentChip({ attachment, dict }: { attachment: AttachmentDTO; dict: Dict }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const isAudio = attachment.mimeType.startsWith('audio/');
  const isVoiceNote = isAudio && attachment.filename.startsWith('voice-');

  const blocked = BLOCKED.has(attachment.scanStatus);
  const pending = attachment.scanStatus === 'pending';

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { url, filename } = await requestDownload(attachment.id);
      // The presigned URL carries Content-Disposition: attachment, so the
      // browser saves rather than renders. Nothing uploaded ever executes.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : dict.error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Fetches a fresh presigned URL for playback. Not fetched on render: a
   * channel of voice notes would issue one signed URL per message on every
   * page load, and each expires in 60 seconds anyway.
   */
  async function loadAudio() {
    if (audioUrl) return;
    setBusy(true);
    try {
      // Inline: an <audio> element cannot play a source the browser has been
      // told to download. Reports as error code 4, which is misleading.
      const { url } = await requestDownload(attachment.id, { inline: true });
      setAudioUrl(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : dict.error);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel =
    attachment.scanStatus === 'infected' ? dict.fileInfected
    : attachment.scanStatus === 'rejected' ? dict.fileRejected
    : attachment.scanStatus === 'error' ? dict.fileError
    : pending ? dict.scanPending
    : null;

  return (
    <div
      className={`mt-1 flex items-center gap-2 rounded-md border p-2 text-xs ${
        blocked ? 'border-[var(--danger)] opacity-70' : 'border-[var(--border)]'
      }`}
      data-testid="attachment-chip"
      data-attachment-id={attachment.id}
      data-scan-status={attachment.scanStatus}
    >
      <span aria-hidden className="shrink-0">
        {blocked ? '⚠' : isVoiceNote ? '🎙' : attachment.mimeType.startsWith('image/') ? '🖼' : '📎'}
      </span>

      <span className="min-w-0 flex-1">
        {/* <bdi> keeps an Arabic filename from dragging its extension to the
            wrong end of the line. */}
        <bdi dir="auto" className="block truncate" data-testid="attachment-filename">
          {isVoiceNote ? dict.voiceNote : attachment.filename}
        </bdi>
        {isVoiceNote && !audioUrl ? (
          <span className="mt-1 block"><Waveform seed={attachment.id} /></span>
        ) : (
          <span className="force-ltr block opacity-60">{formatBytes(attachment.sizeBytes)}</span>
        )}
        {statusLabel && (
          <span className="block opacity-80" data-testid="attachment-status">{statusLabel}</span>
        )}
      </span>

      {!blocked && !pending && isAudio && (
        audioUrl ? (
          <span className="flex items-center gap-2">
            <Waveform seed={attachment.id} progress={progress} />
            <audio
              controls
              autoPlay
              src={audioUrl}
              onTimeUpdate={(e) => {
                const el = e.currentTarget;
                // duration is NaN until metadata loads; guard or the bars fill
                // instantly and then reset.
                if (el.duration > 0) setProgress(el.currentTime / el.duration);
              }}
              onEnded={() => setProgress(0)}
              data-testid={`audio-${attachment.id}`}
              className="h-8 max-w-[180px]"
            />
          </span>
        ) : (
          <button
            type="button"
            onClick={loadAudio}
            disabled={busy}
            data-testid={`play-${attachment.id}`}
            aria-label={`${dict.play}: ${attachment.filename}`}
            className="touch-target shrink-0 rounded-full border border-[var(--border)] px-3 disabled:opacity-50"
          >
            {busy ? '…' : '▶'}
          </button>
        )
      )}

      {!blocked && !pending && !isAudio && (
        <button
          type="button"
          onClick={download}
          disabled={busy}
          data-testid={`download-${attachment.id}`}
          aria-label={`${dict.download}: ${attachment.filename}`}
          className="touch-target shrink-0 rounded border border-[var(--border)] px-3 disabled:opacity-50"
        >
          {busy ? '…' : dict.download}
        </button>
      )}

      {error && <span role="alert" className="text-[var(--danger)]">{error}</span>}
    </div>
  );
}
