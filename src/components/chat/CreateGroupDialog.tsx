'use client';
// src/components/chat/CreateGroupDialog.tsx
import { useEffect, useRef, useState } from 'react';
import { apiPost, ApiError } from '@/lib/csrfClient';
import { Avatar } from '@/components/chat/Avatar';
import type { Dict, Locale } from '@/lib/i18n/dict';

type Peer = { id: string; displayName: string; displayNameAr: string | null };

export function CreateGroupDialog({
  dict, locale, peers, onCreated, onClose,
}: {
  dict: Dict;
  locale: Locale;
  peers: Peer[];
  onCreated: (channelId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => { nameInput.current?.focus(); }, []);

  // Escape closes. A modal with no keyboard exit is a trap for anyone not
  // using a mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = (p: Peer) => (locale === 'ar' && p.displayNameAr ? p.displayNameAr : p.displayName);

  const visible = peers.filter((p) =>
    filter.trim() === '' || label(p).toLowerCase().includes(filter.trim().toLowerCase()));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { channelId } = await apiPost<{ channelId: string }>('/api/channels/group', {
        name: name.trim(),
        memberIds: [...selected],
      });
      onCreated(channelId);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : dict.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dict.newGroup}
        data-testid="create-group-dialog"
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl bg-[var(--bg)] shadow-xl"
      >
        <header className="border-b border-[var(--border)] p-4">
          <h2 className="mb-3 text-base font-semibold">{dict.newGroup}</h2>
          <input
            ref={nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            dir="auto"
            maxLength={60}
            placeholder={dict.groupNamePlaceholder}
            aria-label={dict.groupName}
            data-testid="group-name-input"
            className="touch-target w-full rounded-lg border border-[var(--border)] px-3"
          />
        </header>

        <div className="border-b border-[var(--border)] px-4 py-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            dir="auto"
            placeholder={dict.searchPeople}
            aria-label={dict.searchPeople}
            data-testid="group-member-filter"
            className="touch-target w-full rounded-lg bg-[var(--surface)] px-3 text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" data-testid="group-member-list">
          {visible.map((p) => {
            const isOn = selected.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggle(p.id)}
                role="checkbox"
                aria-checked={isOn}
                data-testid={`group-member-${p.id}`}
                data-selected={isOn}
                className={`flex w-full items-center gap-3 rounded-lg p-2 text-start ${
                  isOn ? 'bg-[var(--accent-subtle,#E8F3EF)]' : ''
                }`}
              >
                <Avatar userId={p.id} name={label(p)} size={32} />
                <bdi dir="auto" className="min-w-0 flex-1 truncate text-sm">{label(p)}</bdi>
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    isOn ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]' : 'border-[var(--border)]'
                  }`}
                >
                  {isOn ? '✓' : ''}
                </span>
              </button>
            );
          })}

          {visible.length === 0 && (
            <p className="p-4 text-center text-sm text-[var(--muted)]">{dict.noResults}</p>
          )}
        </div>

        {error && (
          <p role="alert" data-testid="group-error" className="px-4 pb-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] p-4">
          <span className="text-sm text-[var(--muted)]" data-testid="group-selected-count">
            {selected.size} {dict.selected}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} data-testid="cancel-group"
              className="touch-target rounded-lg border border-[var(--border)] px-4 text-sm">
              {dict.cancel}
            </button>
            <button
              type="button"
              onClick={create}
              // Both conditions matter: an unnamed group is unfindable in a
              // sidebar, and a group of one is a different feature.
              disabled={busy || !name.trim() || selected.size === 0}
              data-testid="create-group-submit"
              className="touch-target rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-on)] disabled:opacity-50"
            >
              {dict.create}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
