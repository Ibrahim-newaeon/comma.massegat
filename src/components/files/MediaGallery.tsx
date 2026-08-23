'use client';
// src/components/files/MediaGallery.tsx
import { useCallback, useEffect, useState } from 'react';
import { requestDownload } from '@/lib/files/upload';
import type { Dict, Locale } from '@/lib/i18n/dict';
import { formatDateTime } from '@/lib/i18n/dict';

type Tab = 'media' | 'docs' | 'links';

type MediaItem = {
  id: string; filename: string; mimeType: string; sizeBytes: number;
  createdAt: string; uploaderName: string; hasThumbnail: boolean;
};
type LinkItem = { url: string; messageId: string; senderName: string; createdAt: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function MediaGallery({
  channelId, channelName, dict, locale, onClose,
}: {
  channelId: string;
  channelName: string;
  dict: Dict;
  locale: Locale;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('media');
  const [items, setItems] = useState<(MediaItem | LinkItem)[]>([]);
  const [loading, setLoading] = useState(true);
  // Thumbnails are fetched per item on demand. Requesting all sixty on open
  // would issue sixty signed URLs, each valid for 60 seconds, for images the
  // user may never scroll to.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const load = useCallback(async (which: Tab) => {
    setLoading(true);
    setItems([]);
    try {
      const res = await fetch(`/api/channels/${channelId}/media?tab=${which}`);
      const json = await res.json();
      setItems(json.ok ? json.data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { void load(tab); }, [tab, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function openItem(id: string) {
    try {
      const { url } = await requestDownload(id, { inline: true });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch { /* the chip in the message shows the error */ }
  }

  async function loadThumb(id: string) {
    if (thumbs[id]) return;
    try {
      const { url } = await requestDownload(id, { inline: true });
      setThumbs((p) => ({ ...p, [id]: url }));
    } catch { /* falls back to the icon */ }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'media', label: dict.media },
    { key: 'docs', label: dict.docs },
    { key: 'links', label: dict.links },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dict.media}
        data-testid="media-gallery"
        className="flex h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-[var(--bg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{dict.media}</h2>
            <p className="truncate text-xs text-[var(--muted)]">
              <bdi dir="auto">{channelName}</bdi>
            </p>
          </div>
          <button type="button" onClick={onClose} data-testid="close-gallery"
            aria-label={dict.close}
            className="touch-target rounded-lg border border-[var(--border)] px-4">
            ✕
          </button>
        </header>

        <div role="tablist" aria-label={dict.media}
          className="flex border-b border-[var(--border)]">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              data-testid={`gallery-tab-${t.key}`}
              className={`flex-1 border-b-2 py-3 text-sm ${
                tab === t.key
                  ? 'border-[var(--accent)] font-medium text-[var(--accent-strong)]'
                  : 'border-transparent text-[var(--muted)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="gallery-body">
          {loading && <p className="p-4 text-center text-sm text-[var(--muted)]">{dict.loading}</p>}

          {!loading && items.length === 0 && (
            <p data-testid="gallery-empty" className="p-8 text-center text-sm text-[var(--muted)]">
              {dict.noMedia}
            </p>
          )}

          {!loading && tab === 'media' && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {(items as MediaItem[]).map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => openItem(it.id)}
                  onMouseEnter={() => void loadThumb(it.id)}
                  onFocus={() => void loadThumb(it.id)}
                  data-testid={`gallery-item-${it.id}`}
                  className="relative aspect-square overflow-hidden rounded-lg bg-[var(--surface)]"
                >
                  {thumbs[it.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[it.id]} alt={it.filename}
                      className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>
                      🖼
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {!loading && tab === 'docs' && (items as MediaItem[]).map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => openItem(it.id)}
              data-testid={`gallery-item-${it.id}`}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-[var(--surface)]"
            >
              <span aria-hidden className="text-xl">
                {it.mimeType.startsWith('audio/') ? '🎙' : it.mimeType.includes('pdf') ? '📄' : '📎'}
              </span>
              <span className="min-w-0 flex-1">
                <bdi dir="auto" className="block truncate text-sm">{it.filename}</bdi>
                <span className="block text-xs text-[var(--muted)]">
                  <bdi dir="auto">{it.uploaderName}</bdi>
                  <span className="force-ltr ms-2">{formatBytes(it.sizeBytes)}</span>
                </span>
              </span>
              <time className="shrink-0 text-[11px] text-[var(--muted)]">
                {formatDateTime(new Date(it.createdAt), locale)}
              </time>
            </button>
          ))}

          {!loading && tab === 'links' && (items as LinkItem[]).map((it) => (
            <a
              key={it.url}
              href={it.url}
              target="_blank"
              // noreferrer as well as noopener: a link posted in a private
              // channel should not send that channel's URL to the destination.
              rel="noopener noreferrer"
              data-testid="gallery-link"
              className="block rounded-lg p-2 hover:bg-[var(--surface)]"
            >
              {/* force-ltr: a URL inside an RTL layout otherwise reorders and
                  becomes unreadable. */}
              <span className="force-ltr block truncate text-sm text-[var(--info)]">{it.url}</span>
              <span className="block text-xs text-[var(--muted)]">
                <bdi dir="auto">{it.senderName}</bdi>
                <span className="ms-2">{formatDateTime(new Date(it.createdAt), locale)}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
