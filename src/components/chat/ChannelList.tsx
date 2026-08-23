'use client';
// src/components/chat/ChannelList.tsx
import { useState } from 'react';
import { Avatar } from '@/components/chat/Avatar';
import type { ChannelDTO } from '@/lib/chat/types';
import type { Dict, Locale } from '@/lib/i18n/dict';

/**
 * Deterministic per channel, so a group keeps its colour everywhere and across
 * reloads. A coloured dot is how you find "Marketing" in a list of twelve
 * without reading any of them.
 */
/**
 * Channel markers, drawn from the brand's own arc.
 *
 * The logo runs magenta → red → orange → gold. These are stops along that
 * arc rather than an arbitrary rainbow, so a sidebar of seven channels still
 * reads as one identity instead of a colour test card.
 *
 * All carry white text at 4.5:1 or better, and all sit legibly on BOTH the
 * light paper and the dark aubergine — a marker that disappears in one theme
 * is worse than no marker.
 */
const GROUP_COLOURS = [
  '#B5177A',  // magenta — the logo's first stop
  '#C42340',  // crimson — the site's numerals
  '#B84E15',  // burnt orange
  '#8A6206',  // dark gold, legible on light
  '#7A2E8F',  // violet, bridging back to the aubergine
  '#A81E5C',  // deep rose
  '#8F4A0E',  // amber-brown
];

function colourFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return GROUP_COLOURS[Math.abs(h) % GROUP_COLOURS.length]!;
}

type FilterKey = 'all' | 'unread' | 'groups';

/**
 * Today → clock. This week → weekday. Older → date.
 * A full timestamp on every row is unreadable at a glance, which is the only
 * thing a sidebar timestamp is for.
 */
function shortTime(iso: string | null, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(locale === 'ar' ? 'ar' : 'en-GB',
      { hour: '2-digit', minute: '2-digit' });
  }
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-GB', { weekday: 'short' });
  return d.toLocaleDateString(locale === 'ar' ? 'ar' : 'en-GB', { day: '2-digit', month: '2-digit' });
}

export function ChannelList({
  dict, locale, channels, activeId, online, onSelect, onOpenDm, onSearch, peers, meId, open, onClose,
}: {
  dict: Dict;
  locale: Locale;
  channels: ChannelDTO[];
  activeId: string | null;
  online: Set<string>;
  onSelect: (id: string) => void;
  /** Opens the DM with this person, creating it if it does not exist yet. */
  onOpenDm: (peerId: string) => void;
  onSearch: () => void;
  peers: { id: string; displayName: string; displayNameAr: string | null }[];
  meId: string;
  /** Drawer state — only meaningful below md. */
  open: boolean;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const unreadTotal = channels.reduce((sum, c) => sum + c.unreadCount, 0);

  // Applied to what each section renders, not to the sections themselves —
  // hiding a heading whose contents are filtered out is less confusing than
  // showing an empty one.
  const matches = (c: ChannelDTO) =>
    filter === 'all' ? true
    : filter === 'unread' ? c.unreadCount > 0
    : c.type === 'private';

  const publicChannels = channels.filter((c) => c.type === 'public');
  // A group IS a channel — type 'private' with a chosen membership. Listing
  // them separately matters because they mean different things: a channel is
  // org structure, a group is a few people arranging something.
  const groups = channels.filter((c) => c.type === 'private');
  const dms = channels.filter((c) => c.type === 'dm');

  const label = (c: ChannelDTO) =>
    c.type === 'dm' && c.peer
      ? (locale === 'ar' && c.peer.displayNameAr ? c.peer.displayNameAr : c.peer.displayName)
      : c.name;

  const preview = (c: ChannelDTO): string => {
    const m = c.lastMessage;
    if (!m) return '';
    // A file with no caption reads as an empty row otherwise.
    const text = m.kind === 'system'
      ? (m.body ?? '')
      : m.body?.trim()
        ? m.body
        : m.attachmentCount > 0 ? `📎 ${dict.attachment}` : '';
    if (!text) return '';
    // Only in group contexts: in a DM, prefixing every incoming line with the
    // other person's name is noise — you know who it is.
    const prefix = c.type !== 'dm' && m.senderId !== meId ? `${m.senderName}: ` : '';
    const own = m.senderId === meId ? `${dict.you}: ` : prefix;
    return `${own}${text}`;
  };

  const Row = ({ c }: { c: ChannelDTO }) => {
    const isActive = c.id === activeId;
    const line = preview(c);

    return (
      <button
        type="button"
        onClick={() => { onSelect(c.id); onClose(); }}
        data-testid={`channel-${c.slug}`}
        aria-current={isActive}
        className={`flex w-full items-start gap-3 rounded-lg p-2 text-start ${
          isActive ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--surface)]'
        }`}
      >
        {c.type === 'dm' && c.peer ? (
          <Avatar userId={c.peer.id} name={label(c)} size={40} online={online.has(c.peer.id)} />
        ) : (
          <span
            aria-hidden
            data-testid={`channel-colour-${c.slug}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: colourFor(c.id) }}
          >
            {c.type === 'public' ? '#' : <bdi>{c.name.trim().charAt(0).toUpperCase()}</bdi>}
          </span>
        )}

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-baseline justify-between gap-2">
            {/* <bdi> keeps a mixed-script name from reordering the row */}
            <bdi dir="auto" className={`truncate text-sm ${c.unreadCount > 0 ? 'font-semibold' : ''}`}>
              {label(c)}
            </bdi>
            <time className="shrink-0 text-[11px] text-[var(--muted)]">
              {shortTime(c.lastMessageAt, locale)}
            </time>
          </span>

          <span className="flex items-center justify-between gap-2">
            <bdi
              dir="auto"
              data-testid={`preview-${c.slug}`}
              className={`truncate text-xs ${
                c.unreadCount > 0 ? 'text-[var(--fg)]' : 'text-[var(--muted)]'
              }`}
            >
              {line}
            </bdi>
            {c.unreadCount > 0 && (
              <span
                data-testid={`unread-${c.slug}`}
                className="shrink-0 rounded-full bg-[var(--highlight)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--highlight-on)]"
              >
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </span>
            )}
          </span>
        </span>
      </button>
    );
  };

  return (
    <>
      {/* Backdrop — mobile only. Tapping it closes the drawer. */}
      {open && (
        <button
          type="button"
          aria-label={dict.close}
          data-testid="channel-list-backdrop"
          onClick={onClose}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
        />
      )}

      <nav
        aria-label={dict.channels}
        data-testid="channel-list"
        data-open={open}
        // Below md: fixed overlay drawer, slid off-screen unless open.
        // inset-inline-start + translate keep it on the correct side in RTL.
        // At md and above: an ordinary static column, unchanged.
        className={`fixed inset-block-0 inset-inline-start-0 z-30 w-64 shrink-0 overflow-y-auto
          border-e border-[var(--border)] bg-[var(--bg)] p-2 transition-transform
          md:static md:z-auto md:translate-x-0 md:bg-transparent
          ${open ? 'translate-x-0' : 'max-md:rtl:translate-x-full max-md:ltr:-translate-x-full'}`}
      >
      {/* Slack moved its people directory and saved messages into the top of
          the sidebar after testing showed users looked there first. Search
          belongs in the same place. */}
      <button
        type="button"
        onClick={() => { onSearch(); onClose(); }}
        data-testid="sidebar-search"
        className="touch-target mb-2 flex w-full items-center gap-2 rounded-md bg-[var(--surface)] px-3 text-sm text-[var(--muted)]"
      >
        <span aria-hidden>🔍</span>
        {dict.search}
      </button>

      <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1" data-testid="filter-pills">
        {([
          { key: 'all' as const, label: dict.all, count: 0 },
          { key: 'unread' as const, label: dict.unread, count: unreadTotal },
          { key: 'groups' as const, label: dict.groups, count: groups.length },
        ]).map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            data-testid={`filter-${f.key}`}
            data-active={filter === f.key}
            aria-pressed={filter === f.key}
            className={`shrink-0 rounded-full px-3 py-1 text-xs ${
              filter === f.key
                ? 'bg-[var(--accent)] font-medium text-[var(--accent-on)]'
                : 'bg-[var(--surface)] text-[var(--muted)]'
            }`}
          >
            {f.label}
            {f.count > 0 && <span className="force-ltr ms-1">{f.count}</span>}
          </button>
        ))}
      </div>

      {publicChannels.filter(matches).length > 0 && (
        <p className="px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
          {dict.channels}
        </p>
      )}
      {publicChannels.filter(matches).map((c) => <Row key={c.id} c={c} />)}

      {groups.filter(matches).length > 0 && (
        <>
          <p className="mt-4 px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
            {dict.groups}
          </p>
          {groups.filter(matches).map((c) => <Row key={c.id} c={c} />)}
        </>
      )}

      {/* PEOPLE — every active user, always visible.
          Previously you had to open a dropdown to find someone, and an unread
          message from a person you had no DM with was invisible. */}
      <p className="mt-4 px-3 py-2 text-xs font-semibold uppercase text-[var(--muted)]">
        {dict.people}
      </p>
      {peers.filter((p) => p.id !== meId).map((p) => {
        // The DM with this person, if one exists yet.
        const dm = dms.find((c) => c.peer?.id === p.id);
        const unread = dm?.unreadCount ?? 0;
        const isActive = dm && dm.id === activeId;

        return (
          <button
            key={p.id}
            type="button"
            onClick={() => { onOpenDm(p.id); onClose(); }}
            data-testid={`person-${p.id}`}
            data-unread={unread}
            aria-current={isActive}
            className={`touch-target flex w-full items-center justify-between rounded-md px-3 text-start text-sm ${
              isActive ? 'bg-[var(--surface)] font-medium' : ''
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                data-testid={`presence-${p.id}`}
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  online.has(p.id) ? 'bg-green-500' : 'bg-[var(--border)]'
                }`}
              />
              {/* <bdi> keeps a mixed-script name from reordering the row */}
              <bdi dir="auto" className={`truncate ${unread > 0 ? 'font-semibold' : ''}`}>
                {locale === 'ar' && p.displayNameAr ? p.displayNameAr : p.displayName}
              </bdi>
            </span>
            {unread > 0 && (
              <span
                data-testid={`person-unread-${p.id}`}
                className="ms-2 shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] text-[var(--accent-on)]"
              >
                {unread}
              </span>
            )}
          </button>
        );
      })}
      </nav>
    </>
  );
}
