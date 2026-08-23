# Phase 1 — Implementation Report

## 1. Objective
Two people hold a conversation — group channel and DM — in Arabic and English,
with presence, typing, and read state.

## 2. Skills Applied
✅ ZOD ✅ SEC ✅ SQL ✅ RBAC ✅ RTL ✅ TEST ✅ DOCKER ✅ A11Y

## 3. What was built

| Area | Files |
|---|---|
| Custom server | `server.js`, `src/server/socket/register.mjs` |
| Socket auth + handlers | `src/server/socket/{handlers,events,presence,rooms}.ts` |
| Schema | `Channel`, `ChannelMember`, `Message` in `prisma/schema.prisma` |
| Seed | `prisma/seed-channels.ts` — #general + membership backfill |
| REST | `/api/channels`, `/api/channels/dm`, `/api/messages` |
| UI | `ChatClient`, `MessageBubble`, `Composer`, `ChannelList`, `ChatHeader` |
| Client socket | `src/lib/chat/useSocket.ts` |
| Tests | `tests/chat.spec.ts`, `tests/chat-rtl.spec.ts`, `tests/pages/ChatPage.ts` |

## 4. Guardrails honored

- **Identity never from the client.** No socket payload schema contains
  `senderId` or `userId`. `socket.data.userId` is set once, in auth middleware,
  from the `cp_access` cookie, and re-checked against the DB so a deactivated
  user is refused immediately.
- **Membership checked server-side** on every read and write, including room
  join. A client-supplied `channelId` is never trusted.
- **Idempotent send.** `@@unique([senderId, clientMsgId])` plus a pre-insert
  lookup means a retried emit returns the original row.
- **Ordering by `seq`**, an autoincrement BigInt. Never by client clock.
- **Redis adapter installed on day 1** despite one instance.
- **Soft delete only.** Row survives; body withheld from the wire.
- **Rate limits per event type**, reusing the Phase 0 Redis limiter. Breach
  drops the event and warns — it does not disconnect.

## 5. RTL implementation

The two axes are kept separate throughout:

| Axis | Mechanism |
|---|---|
| Bubble alignment | `items-end`/`items-start` driven by ownership |
| Text direction | `dir="auto"` per bubble, never inherited |
| Interpolated names | `<bdi dir="auto">` in bubble, channel list, header |
| URLs / emails / paths inside messages | regex-split into `.force-ltr` spans |
| Sidebar, badges, delete button | logical properties (`border-e`, `ms-*`, `end-*`) |
| Timestamps | `Intl.DateTimeFormat` with locale + numeral preference |

## 6. Tests written

**`tests/chat.spec.ts`** — two-party delivery with round-trip timing, per-viewer
ownership, typing appear/clear, duplicate `clientMsgId`, order across reload.
Negative: non-member history refused, oversize body rejected, unauthenticated
refused, XSS payload escaped not executed.

**`tests/chat-rtl.spec.ts`** — English-in-Arabic-UI renders LTR, Arabic-in-
English-UI renders RTL, mixed AR+EN preserved exactly, URL isolated to LTR,
sidebar mirrors, no letter-spacing on Arabic, composer flips on first strong
character, Shift+Enter in RTL, 56px touch target.

Both suites run under `chromium-en`, `chromium-ar`, and `mobile`.

## 7. ⚠️ NOT VERIFIED — read this before trusting the code

**This code has not been executed.** No `npm install`, no build, no test run,
no two-browser session. Phase 0 taught us what that means: four blocking bugs
that were invisible from reading the source.

Specific areas most likely to need fixing on first run:

1. **`src/server/socket/register.mjs` uses `tsx/esm/api` to load TypeScript
   handlers from plain-ESM `server.js`.** This is the least certain part of the
   build. If it fails, the fallback is to compile the socket layer separately
   or rewrite `handlers.ts` as `.mjs`.
2. **`@/` path alias at runtime.** Next resolves it for app code; `tsx` may not
   resolve it inside `handlers.ts`. If imports fail, switch to relative paths in
   `src/server/socket/*`.
3. **BigInt serialization.** `seq` is converted to string at every boundary I
   found, but an unconverted path would throw
   `Do not know how to serialize a BigInt`.
4. **The duplicate-`clientMsgId` test** reaches for `window.__chatSocket`, which
   the app does not currently expose. The test is written to degrade gracefully
   (it falls back to a UI count assertion), but the direct-socket path will not
   execute until that handle is added.
5. **Presence flicker.** Disconnect shortens the TTL to 10s and re-checks after
   11s. The timing is a guess, not a measurement.

## 8. Deviations from the kickoff

| Kickoff said | Built | Why |
|---|---|---|
| `sync:since` on reconnect | Same, plus on channel switch | Covers the case where a channel was open in another tab |
| `lastReadMessageId` only | Added `lastReadSeq` BigInt | Comparing seq is cheap; comparing via a join to fetch the message's seq is not |
| Edit by author only | Same — moderators can delete, not rewrite | Rewriting someone's words under their name is worse than removing them |

## 9. Next steps

1. `npm install && npm run db:setup`
2. `npm run dev` — expect failures in the areas listed in §7
3. Fix, then run `npm run test:e2e`
4. Report back; I will patch and repackage as v0.2.1
