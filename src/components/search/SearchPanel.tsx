'use client';
// src/components/search/SearchPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime, type Dict, type Locale } from '@/lib/i18n/dict';

type Result = {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  senderName: string;
  snippet: string;
  createdAt: string;
  attachmentCount: number;
};

export function SearchPanel({
  dict, locale, onOpenChannel, onClose,
}: {
  dict: Dict;
  locale: Locale;
  onOpenChannel: (channelId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [fuzzy, setFuzzy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { input.current?.focus(); }, []);

  const run = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (json.ok) { setResults(json.data.results); setFuzzy(json.data.fuzzy); }
      else setResults([]);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced: typing "budget" would otherwise fire six queries and trip the
  // rate limiter before the user finished the word.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(query), 350);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, run]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.search}
      data-testid="search-panel"
      className="fixed inset-0 z-40 flex flex-col bg-[var(--bg)]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] p-3">
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          // dir="auto" so an Arabic query reads correctly in an English UI
          dir="auto"
          placeholder={dict.searchPlaceholder}
          aria-label={dict.search}
          data-testid="search-input"
          className="touch-target min-w-0 flex-1 rounded-md border border-[var(--border)] px-3"
        />
        <button
          type="button"
          onClick={onClose}
          data-testid="close-search"
          aria-label={dict.close}
          className="touch-target shrink-0 rounded-md border border-[var(--border)] px-4"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="search-results">
        {loading && <p data-testid="search-loading">{dict.loading}</p>}

        {!loading && searched && results.length === 0 && (
          <p data-testid="search-empty" className="text-[var(--muted)]">{dict.noResults}</p>
        )}

        {fuzzy && results.length > 0 && (
          <p data-testid="search-fuzzy" className="mb-2 text-xs text-[var(--muted)]">
            {dict.approximateMatches}
          </p>
        )}

        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => { onOpenChannel(r.channelId); onClose(); }}
            data-testid="search-result"
            data-channel-id={r.channelId}
            className="mb-2 block w-full rounded-md border border-[var(--border)] p-3 text-start"
          >
            <span className="mb-1 flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
              <span className="truncate">
                <bdi dir="auto">{r.senderName}</bdi>
                {' · '}
                <bdi dir="auto">{r.channelType === 'dm' ? dict.directMessages : r.channelName}</bdi>
              </span>
              <time className="shrink-0">{formatDateTime(new Date(r.createdAt), locale)}</time>
            </span>

            {/* Per-message direction, never inherited from the panel. */}
            <span
              dir="auto"
              className="block text-sm"
              // ts_headline wraps matches in <mark>. The snippet comes from
              // Postgres, built from stored message text — not user-supplied
              // markup echoed back.
              dangerouslySetInnerHTML={{ __html: r.snippet }}
            />

            {r.attachmentCount > 0 && (
              <span className="mt-1 block text-xs text-[var(--muted)]">
                📎 {r.attachmentCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
