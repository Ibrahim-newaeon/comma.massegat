# Changelog

## v0.17.0 — New Aeon palette

Colours sampled from new-aeon.com rather than invented: aubergine `#330333`,
gold `#F9C01B`, crimson `#EB3149`.

**Translated for a tool, not copied from the site.** The site runs aubergine
full-bleed with gold on top — right for thirty seconds of attention, fatiguing
across a working day. Here the loud colour is rationed to one job and the
surface does the work.

### ⚠️ Gold cannot carry white text
`#F9C01B` against white is about 1.7:1 — unreadable. So the two themes invert:

| | Light | Dark |
|---|---|---|
| Primary | Aubergine `#4A0A47`, white text | Gold `#F9C01B`, aubergine text |
| Ground | Paper with a faint aubergine cast | The brand aubergine, lifted |

The dark pairing is exactly how the site's own Send button is set.

### ⚠️ `--accent-on`, because `text-white` was hardcoded in 18 places
`bubble-own` and seventeen buttons assumed white text on the accent. That held
while the accent was green; with a gold accent in dark mode every one of them
became unreadable. Text that sits on the accent now takes a token that flips
with the theme. Same for `--highlight-on` on unread badges.

### Channel markers and avatars redrawn from the brand arc
The logo runs magenta → red → orange → gold. The seven markers are stops along
that arc rather than an arbitrary rainbow, so a sidebar of seven channels reads
as one identity instead of a colour test card. Every one clears 4.5:1 against
white and stays legible on both grounds.

Avatars changed from light-tint-with-dark-text to solid-fill-with-white: a pale
pill glows against the dark aubergine, while a saturated disc sits correctly on
both themes without a theme-aware variant.

### Also
`themeColor` was `#2b5c4f` — a colour from no palette this project has ever
had. Now a light/dark pair matching the app's own surface, so the browser
chrome does not show a seam against it.

## v0.16.0 — inline replies

`replyToId` had been on the Message model since Phase 1, stored but never
validated or displayed. Now it works.

### Inline quotes, not a thread pane
For a small team, WhatsApp-style replies keep one readable timeline and
everyone already knows the interaction. A thread pane splits the conversation
in two and people miss half of it.

### ⚠️ Security — the reply target must be in the same channel
Without the check, a member of #general could reply to a message id from a
private channel they are not in, and the quote preview would render that
message's author and body straight back to them. An id is easy to obtain from
a screenshot.

The send path now verifies the target's `channelId` matches before writing.

### ⚠️ A deleted original does not leak through its quote
`replyPreview` withholds the body when `deletedAt` is set. The quote becomes a
tombstone. Withdrawing a message has to withdraw it everywhere, including from
the replies pointing at it.

### `onDelete: SetNull`, not Cascade
Deleting an original must not take every reply to it with it. The reply
survives; its quote becomes a tombstone.

### Truncated server-side at 140 characters
A quote is a pointer, not a copy. Sending an 8000-character body so the client
can show 140 of it wastes the payload on every message in a reply-heavy
channel.

### Tapping a quote scrolls to the original and flashes it
A quote you cannot navigate from is a dead end — the reader still has to hunt
for context, which is the problem replies exist to solve. The flash respects
`prefers-reduced-motion` by marking the target without pulsing.

⚠️ Only works for messages already loaded. Older targets would need paging back
through history; doing nothing is better than jumping somewhere wrong.

### The bar clears BEFORE the round-trip
Leaving it up means a second message typed quickly attaches to the same target
by accident — a quote asserting a connection that was never intended.

## v0.15.0 — reactions

A row per (message, user, emoji), not a JSON blob on the message. Two people
reacting in the same moment would otherwise read-modify-write one column and
one would silently lose. The unique constraint makes a duplicate impossible at
the database, not just in the UI.

**Toggling goes through that constraint rather than a read-then-write.** Two
taps arriving together would both see "no row" and both insert; the second
fails with P2002, which means it was already there — so remove it. No race to
lose.

### `userIds` instead of a server-computed `mine`
The client derives whether a reaction is its own. The alternative is
serialising every broadcast once per recipient so each gets the right `mine` —
one emit becomes N. Not a leak either: these are channel members, already
visible to each other in the People list.

### Reactions live in the SHARED include
Every path that loads a message gets them. Adding it per-query is how one
endpoint ends up returning messages whose reactions vanish on refresh — which
reads as "it was never saved" rather than "one query is missing a field".

⚠️ The REST list and the socket path have separate includes, so there is a test
asserting a reaction survives a reload specifically.

### Six emoji, not a picker
A searchable grid is a lot of interface for a feature whose point is being
faster than typing "noted". Acknowledge, agree, thanks, done, question,
celebrate covers most of what a work channel needs.

⚠️ `groupReactions` exists twice — `src/lib/chat/reactions.ts` for the TS paths
and inline in `handlers.mjs`, which is plain ESM and cannot import a `.ts`
module. Both carry a comment pointing at the other. Divergence would show as
counts that differ between a fresh load and a live update.

## v0.14.0 — Android app packaging

### Added — Trusted Web Activity
`mobile/android/twa-manifest.json` plus `public/.well-known/assetlinks.json`.
A Chrome shell around the live site: no separate codebase, no separate release,
and the Android app updates whenever the web app does. $25 once.

⚠️ **Two fingerprints, not one.** Play re-signs the app after upload, so the
array needs the local signing key AND the Play App Signing key. With only the
first, the address bar appears for everyone who installed from Play — the exact
users the wrapper was built for, and the one group never tested with.

### Fixed — `.well-known` sat behind the auth gate
Google fetches that file **unauthenticated**. The middleware would have
redirected it to `/login`, verification fails with no error surfaced anywhere,
and the app ships with a visible address bar while nothing explains why.

### iOS — not pursued
Apple's guideline 4.2 rejects apps that are primarily a repackaged website.
iPhone users install the PWA from Safari instead, which costs nothing and
behaves nearly identically once on the home screen.

## v0.14.0 — app store packaging

### Added — Android (Trusted Web Activity)
`mobile/android/twa-manifest.json` plus `public/.well-known/assetlinks.json`.
Google supports the pattern explicitly; approval is routine. $25 once.

⚠️ **Two fingerprints, not one.** Play re-signs the app after upload, so the
array needs both the local signing key AND the Play App Signing key. With only
the first, the address bar appears for everyone who installed from Play — the
exact users the wrapper was built for.

### Added — iOS (Capacitor, aimed at TestFlight)
`mobile/ios/capacitor.config.json` and `public/.well-known/apple-app-site-association`.

⚠️ **Apple guideline 4.2 rejects repackaged websites.** A wrapper around the
site is precisely that, so the public App Store is the wrong target. TestFlight
takes up to 100 internal testers with a light review and no 4.2 argument to
lose. The Enterprise programme requires 100+ employees — a ten-person team will
not qualify.

Stated in `mobile/README.md` before any of the build steps, so the $99 is spent
knowingly.

### Fixed — `.well-known` was behind the auth gate
Google and Apple fetch these files **unauthenticated**. The middleware would
have redirected both to `/login`, and verification fails with no error surfaced
anywhere — the app simply ships with a visible address bar and nothing explains
why.

### Fixed — the Apple file has no extension
Apple requires `apple-app-site-association` with no extension, served as
`application/json`. Next guesses the content type from the extension, so it
would have shipped as `text/plain` and iOS would have ignored it silently.
An explicit header in `next.config.mjs` now sets it.

## v0.13.1 — settings reachable on mobile, and installable

### Fixed — settings were unreachable on a phone
Three things combined into a dead end:

- `IconRail` is `md:flex` — hidden below 768px, and it holds the links to
  profile, notifications and the sound toggle.
- The chat header's profile link is `sm:flex` — hidden below 640px. It was also
  only the user's NAME, which nobody taps looking for preferences.
- **The admin layout had no settings link at all, at any width.**

So an admin on a phone could open the console, approve someone, and then have
no way to change their own password, language or theme without typing `/profile`
by hand.

A gear now appears in the chat header below `sm`, and in the admin header at
every width.

### Fixed — the app could not be installed
`manifest.webmanifest` referenced `/icon-192.png` and `/icon-512.png`, and
**neither file existed**. Chrome silently refuses to offer installation when a
manifest icon 404s — no error, no prompt, nothing to debug.

Icons generated in the app's own palette, sized inside the maskable safe zone
because Android launchers crop to a circle and a glyph filling the square loses
its edges.

Added the iOS tags too: iOS ignores the manifest entirely for the home-screen
icon and standalone mode, so without `apple-touch-icon` and
`apple-mobile-web-app-capable`, "Add to Home Screen" produces a Safari bookmark
rather than an app.

## v0.13.0 — split call layout and pop-out window

### Split view
On desktop the call now sits BESIDE the conversation rather than above it.
Stacked, one or the other was always mostly off-screen and the composer was
pushed below the fold — you could be on a call or reading chat, not both.

Below the md breakpoint it stacks, because a phone has no width to split.

⚠️ Both flex children carry `min-h-0`. A flex child defaults to
`min-height: auto` and refuses to shrink below its content, which makes the
message list overflow the viewport instead of scrolling — the same trap as the
`min-w-0` fix in the mobile drawer.

### Pop-out to a floating window
Uses the **Document Picture-in-Picture API** — a real OS-level window the user
can drag to a second monitor.

⚠️ **Why not `window.open`.** A new window means a second React tree, which
would rejoin the LiveKit room in a fresh context. Same identity, two
connections: LiveKit evicts the first with `DUPLICATE_IDENTITY` and the
disconnect handler tears down the second. Both calls die — the exact failure
that cost an hour in Phase 3.

Document PiP **moves the existing DOM node**. The media elements, their tracks
and the connection are never re-established.

Details that matter: stylesheets do not follow the node, so they are copied
into the new window (cross-origin sheets are re-linked rather than read); the
theme and direction attributes are carried across, or the window is light-mode
LTR whatever the user chose; and a comment node marks the original position so
the call returns exactly where it came from.

Chrome and Edge only. The button is hidden entirely elsewhere rather than
shown dead.

## v0.12.1 — remove an attachment before sending

### Fixed — the remove control vanished when you needed it
The ✕ appeared only WHILE uploading. The moment the tray said "Ready — press
Send" it disappeared — which is exactly when someone realises they picked the
wrong file. It is now present at every stage.

### Fixed — a removed attachment was still sent
`cancelUpload` removed the row from the tray but left the attachment id in
`readyAttachments`. A completed upload the user had visibly removed was still
attached to the next message they sent.

Silent, and the sort of thing that puts a document in front of the wrong
person. Removing now detaches as well.

## v0.12.0 — Railway deployment

### Fixed — the Dockerfile could never have built
It copied `.next/standalone`, but `output: 'standalone'` was never set in
`next.config.mjs`. Written in Phase 0, never run, and it would have failed on
the first attempt.

Standalone is also the wrong choice here: it traces imports from Next's own
server, and this app runs a CUSTOM server that hosts Socket.IO alongside Next.
`socket.io`, `ioredis`, `prisma` and `web-push` are all imported by
`server.mjs` and none would be traced. The image is larger with full
`node_modules` and it actually works.

**One image serves both services.** The worker is the same code with a
different start command, so it cannot drift out of step with the app.

### Added — deploy-time migration
`npm run deploy:migrate` runs `prisma db push` plus the post-migrate SQL before
the app starts.

Today's worst failure was a build that regenerated the Prisma client while the
database kept its old columns — every login returned 500, twice, for two
different columns. The build and the schema now move together.

⚠️ `db push` compares and alters, and can drop a column it believes unwanted.
Acceptable while the schema is still moving; switch to `migrate deploy` once it
settles.

### Added — RAILWAY.md
Two decisions stated up front rather than discovered: **where files live** (R2,
since Railway has no S3 and MinIO does not belong on a container platform) and
**what happens to virus scanning** (ClamAV holds ~2 GB of signatures in memory,
which is a real monthly cost).

Turning scanning off is a genuine reduction, not a formality — the quarantine
path is verified working.

## v0.11.2 — #general membership on every path

Three of the four paths that create or restore an account already joined
#general: admin creation, auto-approved signup, and admin approval.

**Reactivation did not.** Someone deactivated and later brought back returned to
an empty sidebar with no way to reach anyone — which reads as a broken account
rather than a missing channel membership.

Added `npm run db:backfill-general` for accounts that predate the auto-join.
Reports by default, adds with `--apply`. Only touches active, approved users:
a pending account with channel membership would receive messages before anyone
approved it.

## v0.11.1 — the server stops talking to itself through the internet

### Fixed — "Upload did not complete" (400 on /complete)
`S3_ENDPOINT` became a public hostname so the BROWSER could reach storage. But
one client served both sides, so when the server fetched an object back to
verify its magic bytes, it went out to Cloudflare and back in through its own
tunnel — to read a file sitting in a container on the same Docker network.

That round trip fails on DNS, on access control, or on the proxy. The app
received an HTML error page, magic-byte detection saw `text/html`, and returned
400. The upload itself had succeeded.

Two clients now. Presigned URLs are signed with the **public** endpoint because
a browser must be able to reach them; server-side reads use
`S3_INTERNAL_ENDPOINT`, falling back to the public one when unset so a local
setup needs no extra configuration.

The worker was doing the same thing on a larger scale — it downloads every
object to scan it, so each file was making a round trip to the CDN and back.

### Also
`media-src` now includes the storage origin. Without it, an uploaded voice note
plays back as media error 4 — "format not supported" — which points at the
codec and is entirely misleading.

## v0.11.0 — storage routing, call aspect ratio

### Fixed — uploads returned 403, then "text/html files are not permitted"
Two symptoms, one cause, and the error message pointed nowhere near it.

MinIO was served at `comma.massegat.com/storage`, with the proxy stripping the
prefix before forwarding. **S3 signatures cover host and path exactly**, so the
stripped path no longer matched what was signed, and MinIO returned 403. The
Host rewrite needed to reach the container broke the signature a second way.

The app then fetched the object back to verify magic bytes, received an HTML
error page instead of the file, and correctly refused it — surfacing a routing
fault two layers down as a file-type complaint. **That check working as
designed**: it caught HTML pretending to be an upload.

Storage now lives on its own hostname, which needs no rewriting at all.
Requires a second public hostname on the tunnel and an Access **bypass** policy
for it — a presigned URL is already the authorisation and cannot carry a
session cookie.

### Changed — call view follows the camera
`aspect-video` rather than a fixed viewport fraction. The camera publishes
1280×720; a container of any other shape either letterboxes it or crops the
face. The earlier horizontal-strip rendering was exactly this.

⚠️ A shared screen still letterboxes slightly — monitors are rarely 16:9. The
fix is switching the container's ratio when a screen share is active; not yet
built.

## v0.10.0 — self-registration and a visible sign-out

### Added — domain-restricted signup, off by default
`SIGNUP_ALLOWED_DOMAINS` empty disables registration entirely, and that is the
default. An open form on a reachable URL is an open door; enabling it has to be
a deliberate act.

**The impersonation gap this closes.** Cloudflare Access proves WHO someone is;
a signup form asks them to TYPE an email. Without a check, a person who
authenticated as `ibrahim@` could register as `ceo@` and the platform would
believe them.

Behind Access, the app reads `Cf-Access-Authenticated-User-Email` — which
Cloudflare sets and strips from client input — and refuses any registration
where the typed address differs from the proven one. Trusted only when
`TRUST_PROXY` says a proxy is genuinely in front; otherwise it is a header
anyone can send.

Other guards:
- **Pending by default.** An account that can read every channel the moment it
  is created is a self-service door into the company's conversations. Admins
  see pending registrations at the top of the users page and approve with one
  click.
- **#general membership on approval, not registration.** A pending account with
  channel membership would receive messages while it waited.
- **Role is always `member`**, with no input that can change it.
- **Duplicate registrations are byte-identical to new ones.** Differing would
  turn the endpoint into an account-enumeration oracle — useful for phishing,
  worthless to a legitimate user.
- **Rejected accounts keep their row.** Deleting would let the same person
  register again immediately and erase the record that they tried.
- Five attempts per IP per hour. The endpoint writes rows and hashes passwords;
  both are expensive, which makes it the most attractive target in the app.

### Added — sign out in the rail
It lived on the profile page, two clicks deep — the wrong place for the control
someone reaches for when leaving a shared machine.

## v0.9.1 — warm palette, taller calls, back navigation

### Colour
Moved off pure white. `#ffffff` over a working day is fatiguing, and it is what
makes an interface read as a default rather than a decision. The base is now a
warm sand — slight enough to feel considered, not enough to look tinted.

The accent deepens from `#17795F` to `#146B54`: the lighter green floated on a
warm background instead of sitting against it, and lost contrast with body text.

**A second accent joins the palette.** Every emphasis in the app was the same
green, so nothing could be highlighted INSIDE an already-accented area — an
unread badge on a selected row was green on green. Unread counts now use the
terracotta highlight.

Dark mode is warm-neutral to match. A cold grey dark next to a warm light reads
as two different products.

### Taller call view
`70vh` → `78vh`, capped at `calc(100vh - 11rem)` so the composer and a couple of
messages stay reachable.

### Back navigation
Admin now carries a back link to chat. An admin who arrived from the chat had no
way back except the browser button — invisible on mobile and absent entirely in
an installed PWA.

## v0.11.0 — public URL via Cloudflare Tunnel

### Added — `npm run setup:tunnel`
A real HTTPS address reachable from anywhere, with no port forwarding, no VPN
client and no certificate on any device. `cloudflared` dials out, so nothing is
exposed inbound.

The tunnel points at **Caddy**, not the app: a tunnel can target one service
and this app is three (app, storage, SFU). Caddy does the routing.

### ⚠️ Call media does not pass through a tunnel
Cloudflare Tunnel carries HTTP and WebSockets; WebRTC media is UDP. Self-hosted
LiveKit connects to signalling and then carries no audio or video for anyone
outside the network — which presents as a broken feature rather than a network
limit. The wizard offers LiveKit Cloud, which was the original D4 decision;
self-hosted was a local-development convenience.

### Fixed — forwarding headers were trusted unconditionally
`requestContext()` read the leftmost `X-Forwarded-For` entry on every request,
with no check for whether a proxy was actually in front.

Those headers are **client-supplied** unless a proxy overwrites them. Anyone
could send `X-Forwarded-For: 1.2.3.4` and appear as a different address on
every request — defeating per-IP rate limiting entirely, and writing
attacker-chosen addresses into the audit log, where they look like evidence.

Now read only when `TRUST_PROXY` is set, with `CF-Connecting-IP` preferred
behind Cloudflare (Cloudflare sets it itself and strips any client copy). With
no trusted proxy the answer is null, which is honest: per-IP limiting is
skipped and must be enforced at the edge in that configuration.

### Fixed — `TRUST_PROXY` was coerced wrong
`z.coerce.boolean()` treats the **string** `"false"` as true, because every
non-empty string is truthy. `TRUST_PROXY=false` would therefore have enabled
proxy trust — inverting the safe default, in the exact variable that decides
whether client-supplied headers are believed.

Now `z.enum(['true','false']).transform(...)`.

## v0.10.0 — network deployment and invitations

### The constraint that shapes this
Browsers treat any origin that is not `localhost` and not HTTPS as an
**insecure context**, and silently disable camera, microphone, Web Push, the
service worker and clipboard write. Nothing errors — the buttons are there and
do nothing, which is worse than a visible failure.

Everything below follows from that.

### Added — `npm run setup:network`
The app is not one origin: presigned uploads point at object storage, calls
open a WebSocket to the SFU, and the CSP has to name all of them. Changing the
hostname by hand means missing one — usually the storage origin, which surfaces
as "Network error during upload" from every device except the one you tested on.

The wizard lists the machine's addresses, asks for a hostname, warns plainly if
HTTPS is declined, writes every dependent variable, and keeps a `.env.backup`.

### Added — Caddy reverse proxy (`--profile proxy`)
One HTTPS origin for the app, storage and the SFU, with certificates from
Caddy's internal CA. Sets `X-Forwarded-For`, and `TRUST_PROXY=true` follows —
without it the rate limiter sees only the proxy and buckets the entire company
as one client, which is a denial of service on your own users.

⚠️ Call media does NOT pass through the proxy. WebRTC uses UDP 50000-50060
directly, with TCP 7881 as fallback. Those must be reachable on the host.

### Added — preflight catches the insecure-context trap
Refuses to pass when `APP_URL` is a non-local HTTP address, or when
`S3_ENDPOINT` still says localhost while `APP_URL` does not.

### Added — invitation dialog with a QR code
Most people set the app up on a phone, and typing a 43-character token by hand
is where an onboarding fails.

- QR rendered **locally**. Pasting a setup URL into an online QR generator
  hands a live credential to a stranger.
- **New link** on any user reissues and invalidates every previous link — a
  stale link in an old email is otherwise a live credential.
- The token is never written to the audit log, which every admin can read.
- Warns in the dialog that the link sets the account's password, so it goes in
  a direct message rather than a group.

⚠️ The copy button needs a secure context. On plain HTTP it fails, so the URL
stays selectable as a fallback.

### Added — DEPLOYMENT.md
Three certificate routes with the tradeoffs stated: Caddy's internal CA (a root
certificate on every device, and Android has warned about user-installed CAs
since version 7), Tailscale (real certificates, nothing to install), and a real
domain (the production answer).

## v0.9.0 — dark mode, richer sidebar, media gallery

### Added — light / dark / system
Three options, not a switch. "Follow my machine" is a legitimate preference and
the one most people are already relying on without knowing it; a two-state
toggle silently opts them out of it the moment they touch it.

**Stored per USER, not per browser** — signing in on a colleague's machine
should not inherit their eye preference.

**Applied server-side, from a cookie, in the first paint.** Setting the theme
from JS after hydration means every load flashes white before going dark, which
is the single most noticeable failure a dark mode can have.

Dark surfaces are near-black rather than pure `#000`: pure black under white
text produces halation, and OLED smearing on scroll. The accent is lifted from
`#17795F` to `#2FA184` — the light accent fails contrast against dark body
text — with saturation dropped as luminance rises so it does not glow.
`color-scheme: dark` is set, or a dark page renders white scrollbars.

### Added — sidebar rows with previews
Avatar, name, last message, relative timestamp, unread badge. Today shows a
clock, this week a weekday, older a date — a full timestamp on every row is
unreadable, which defeats the only thing a sidebar timestamp is for.

The sender is prefixed only in group contexts. In a DM, prefixing every
incoming line with the other person's name is noise.

### Added — filter pills
All · Unread · Groups. Applied to what each section renders rather than to the
sections themselves — hiding a heading whose contents are filtered out is more
confusing than showing an empty one.

### Added — media gallery
Media, Files and Links per channel, from attachments already stored.

- **Membership is checked first.** Without it the gallery lists the files of
  any channel by guessing an id — messages protected, attachments not.
- **Quarantined files never appear**, not even as a name. A quarantined item
  listed in a gallery invites someone to ask for it.
- **Links are extracted on read, not indexed.** Storing them means a second
  write path to keep in step with edits and deletions, for a view most people
  open rarely.
- **Thumbnails load on hover or focus.** Fetching all sixty on open issues
  sixty signed URLs, each valid 60 seconds, for images the user may never
  scroll to.

## v0.8.0 — groups, and a colour pass

### Added — groups
A group **is a channel**: `type: 'private'` with an explicit membership list.
No separate model — groups and channels have the same messages, files and
calls. The only difference is who can see them and who decided that.

Pick a name, pick people, done. Listed under their own Groups heading, because
a channel is org structure and a group is a few people arranging something —
different meanings deserve different sections.

**Members can create groups; only moderators can create public channels.**
A public channel adds a row to everyone's sidebar, which is a moderation
decision. Requiring a moderator to approve three people starting a project
thread just pushes that conversation to WhatsApp, which is worse for everyone
including the moderator.

Guards: every member id must be an active user (a typo'd or deactivated id
would otherwise create a group with a member who can never appear), the creator
is always included and made owner, and the slug keeps Arabic — stripping
non-Latin would slug "فريق التسويق" to an empty string and collide on the
unique index.

### Removed — "New message"
It opened a dropdown to start a DM. The People list does that in one click, so
the header button now does what the sidebar cannot: create a group.

### Colour
Named tokens rather than scattered hex — `--accent-subtle`, `--info`,
`--warning`, `--success`, `--danger`, each with a subtle tint. Every colour
that carries meaning is in one place, so a change is one edit and a contrast
audit has one place to look.

Channels and groups get a coloured marker keyed on the channel id, so a group
keeps its colour everywhere and across reloads. Finding "Marketing" in a list
of twelve stops requiring you to read all twelve.

Own messages keep the accent; incoming ones stay neutral. Colouring both sides
removes the only cue that tells them apart at a glance.

## v0.7.0 — user profile

`/profile` — reachable from the avatar in the rail, or your name in the header
on mobile.

### Added
- **Display name**, and an **Arabic display name**. `displayNameAr` has existed
  in the schema since Phase 0 but only an admin could set it, so Gulf users had
  no way to give themselves an Arabic name.
- **Language preference, persisted to the user record.** It was a cookie only —
  which meant push notifications, which read `user.locale` for direction and
  language, would have gone out in the wrong language and direction for anyone
  who had switched. The cookie and the stored preference now move together.
- **Change password**, requiring the current one. Without that check a hijacked
  session could lock the real owner out. Succeeding revokes every other session.
- **Active sessions** — device, last seen, IP, and whether 2FA was used, with
  per-device sign-out and "sign out everywhere else".
- **Storage used** against the 10GB quota. It was enforced with no way to see it.
- **Sign out.**

### Sessions are refresh-token families
There is no session table: rotation creates a new row in the same family, so
the family is the device and its rows are the history. The list collapses each
family to one entry — first row is when it signed in, last is when it was last
active. Showing every rotation would list the same laptop dozens of times.

`RefreshToken` gains `userAgent`, `ipAddress` and `amr`. Device context is
captured at LOGIN and carried forward on rotation rather than re-read: a
rotated token comes from the same device by definition, and re-reading would
let a proxy change alter what the user sees.

### Deliberately not editable
`email` and `role` are absent from the patch schema. A user changing their own
role is privilege escalation; changing their own email is takeover of whatever
that address can reset. Both stay with an admin, where they are audited.

### ⚠️ Known limit
Revoking another device kills its refresh token, but its ACCESS token stays
valid until it expires — up to 15 minutes of continued access. Killing it
instantly would mean a revocation check on every request, which is the tradeoff
stateless JWTs exist to avoid. Shorten `ACCESS_TOKEN_TTL_SECONDS` if that
window is unacceptable.

## v0.6.0 — three-column layout

Moves to the pattern Slack, Discord and Teams converged on: an app rail, a
navigation sidebar, and the message thread. The header was accumulating
controls — search, push, sound, call, connection status — and header space is
finite. It is now about the CHANNEL.

### Added
- **Avatars**, coloured deterministically from the user id so a person keeps
  the same colour everywhere and across reloads. Index-based colours would
  shuffle whenever the member list changed.
- **Message grouping** — consecutive messages from one person share an avatar
  and drop the repeated name, but only within five minutes. Two messages hours
  apart are separate thoughts, and hiding the second timestamp would make the
  gap invisible.
- **Icon rail** (desktop only). Its controls are 44px, below the 56px touch
  minimum, which is exactly why it is hidden on mobile — the header and drawer
  carry these there instead.
- **Voice note waveforms** with playback progress. The bars are derived from
  the attachment id, not from decoded audio: real peaks would mean downloading
  every note in a channel on render — dozens of signed URLs and megabytes for
  decoration. Stable per note, different between notes, which is all the shape
  needs to say.
- **Search in the sidebar.** Slack found in testing that users looked to the
  top of the sidebar first; search belongs where the people directory does.

### RTL
The avatar column is reserved even when empty, so grouped and ungrouped
messages stay aligned rather than jumping horizontally. The rail uses
`border-e` and logical properties, so it sits on the right in Arabic. Waveforms
are always LTR — a waveform maps to time, and time does not mirror.

## v0.5.1 — voice notes play

### Fixed — audio would not play

Every presigned download URL carried `Content-Disposition: attachment`, telling
the browser to SAVE the file. An `<audio>` element cannot play a source it has
been instructed to download — it reports media error code 4, "format not
supported", which points at the codec and is entirely misleading.

That header is not decoration: it is what stops an uploaded HTML or SVG file
executing as stored XSS. So it stays the default.

Inline delivery is now **opt-in per request AND restricted to an allowlist** of
formats that cannot execute anything — images, audio, video. HTML, SVG and PDF
are deliberately excluded: the first two run script, and PDF viewers have a
long history of doing more than display a document.

Passing `?inline=1` for anything outside that list is ignored, not honoured.
`INLINE_SAFE` in policy.ts is the security boundary; adding a type to it is a
decision about code execution, not convenience.

### Fixed — /chat returned 500

A JSX comment inside a ternary branch. A branch takes one expression; a comment
plus an element is two siblings with no wrapper. `node --check` passed because
it validates JavaScript syntax, not JSX — the same blind spot that let the
`process()` shadowing through in Phase 2.

## v0.5.0 — Phase 4: search, notifications, PWA, retention

**Not yet executed** — see PHASE-4-REPORT.md §7.

### Search
- Postgres full-text with **one** Arabic normalisation implementation, shared by
  the indexer and the query path. Two implementations that drift would make
  Arabic search silently return nothing — the index holding one spelling while
  the query asks for another. Nothing errors; results are just empty.
- `simple` config over JS-normalised text, **not** an `arabic` config: the
  Arabic snowball dictionary is not present on every Postgres build, and the
  normalisation is what actually carries Arabic recall.
- A GENERATED column, not a trigger — nothing to drift out of sync.
- **Membership is a JOIN condition**, not a filter applied afterwards. A user
  must not be able to learn a message exists in a channel they are not in.
- Trigram fallback for typos, deliberately second so exact matches are never
  buried under fuzzy ones.
- `npm run db:backfill-search` indexes everything sent before Phase 4.

### Notifications
- Web Push, **only for genuinely offline recipients**. Presence is the gate:
  someone with the tab open already saw the message and heard the sound.
- Permission requested only from a click. A prompt on load is the fastest route
  to a permanent denial, and denials are sticky.
- Direction and language from the RECIPIENT's locale, so an Arabic notification
  renders RTL on an English device.
- Collapsed by channel — twenty messages is one notification.
- Dead subscriptions deleted on 404/410, not retried forever.

### Fixed — the 401 gap, open since Phase 0
A tab idle past the 15-minute token lifetime failed its next request instead of
refreshing. It surfaced as "Network error during upload" in Phase 2.

`withRefresh()` retries **exactly once** — a loop against a dead session is
worse than a clear error. Crucially, **one in-flight refresh is shared**:
without that, four pending requests fire four refreshes, three present an
already-consumed token, and reuse detection revokes the family. The user would
be logged out for making four requests at once — a security control firing on
legitimate traffic, the same class of bug that filled Phase 1.

### PWA and retention
- Installable manifest, service worker, network-first navigation. A chat app
  showing stale messages is worse than showing an offline notice.
- `npm run purge` with a dry-run default. Message rows survive permanently —
  only bodies are cleared, so reply chains stay intact. Attachment rows survive
  with the object removed, so the conversation shows a file was there rather
  than a silent gap.

## v0.4.5 — live scan status

### Fixed — "Scanning…" never cleared

The worker wrote `scanStatus='clean'` to the database and stopped there. It is a
separate process and cannot reach `io`, so nothing told the browser. A sent
attachment showed "Scanning…" until the page was reloaded — while the database
had said `clean` for a minute.

Redis pub/sub bridges it: the worker publishes to `attachment:scanned`, the
socket server subscribes and broadcasts to the channel room, the client patches
the attachment in place. A **dedicated subscriber connection** is required —
a Redis client in subscriber mode cannot run normal commands, and the shared
one also handles rate limiting and presence.

A missed notification is treated as cosmetic: the status is already persisted
and a reload shows it. The publish never fails the scan.

### Fixed — the upload tray lied

A finished upload was labelled "Scanning…", which reads as *the system is still
working* when it actually means *uploaded, press Send*. Now "✓ Ready — press
Send".

This mattered most for voice notes: recording, stopping, then watching
"Scanning…" sit there looks like a hang, when the note was ready and simply
waiting for the user.

## v0.4.4 — voice notes

Rides the existing Phase 2 upload path: presign → direct PUT → magic-byte
verification → ClamAV → attachment. A voice note is an audio file with a nicer
recording UI and an inline player.

### The interesting part — the WebM container problem

MediaRecorder emits `audio/webm` in Chromium. But audio-only and video WebM
share **one container format (EBML) with identical magic bytes**, so `file-type`
reports `video/webm` for both — it cannot know the container holds no video
track without parsing it.

The strict mismatch check would therefore have rejected every voice note as a
spoof attempt.

Fixed with an explicit equivalence table (`audio/webm` ↔ `video/webm`,
`audio/ogg` ↔ `video/ogg`, `audio/mp4` ↔ `video/mp4`). **This is not a general
loosening**: an `.exe` declared as a PNG is still caught, because those
containers are genuinely different bytes.

### Added
- Mic button in the composer. Click to record, timer, cancel or send.
- Five-minute cap — past that, send a file.
- Inline `<audio>` player. The presigned URL is fetched **on play, not on
  render**: a channel of voice notes would otherwise issue one signed URL per
  message on every page load, each expiring in 60 seconds regardless.
- Voice notes display as "Voice note", not `voice-1787....webm`.
- The microphone is released on unmount — a held mic leaves a recording
  indicator in the browser chrome indefinitely.
- Codec parameters are stripped from the declared MIME (`audio/webm;codecs=opus`
  → `audio/webm`) so it matches what magic-byte detection reports.

### Fixed — the call button stayed disabled after hanging up

`leave()` set `phase: 'idle'`, but LiveKit's asynchronous `Disconnected` event
then fired and set `phase: 'ended'` — a race the SDK usually won. The button is
disabled unless idle, so it stayed dead until a page refresh.

Two guards: `leave()` bumps the generation counter so the stale disconnect
callback is a no-op, and `'ended'` now returns to `'idle'` after 1.5s — long
enough for the end tone to play.

## v0.4.3 — sidebar visible, notification sounds

### Fixed — the sidebar was parked off-screen

`transform: matrix(1, 0, 0, 1, -256, 0)`. The mobile drawer classes ordered
`md:translate-x-0` BEFORE `ltr:-translate-x-full`; equal specificity means CSS
source order decides, so the later rule won at every viewport width. The People
list, channel list and unread badges were all rendered — 256px wide, just
outside the window.

Now `max-md:` scopes the translate to below the breakpoint, so above it no
transform is emitted at all. Nothing to override.

### Added — notification sounds

Synthesised with the Web Audio API rather than shipping an audio file: no asset
to host, no CSP `media-src` to widen, no extra request, and the tone is tunable
in code.

| Event | Sound |
|---|---|
| Message from someone else | Two rising notes, quiet |
| Incoming call | Three-note pattern, repeating until answered |
| Call ended | Descending pair — reads as "ended", not "arrived" |

- **Never chimes for your own message**, or for a system notice. Hearing a tone
  for something you just sent is the fastest way to make someone mute sound
  permanently.
- The ringtone returns a stop function, cleared on every phase change. A ring
  that outlives the call is worse than no ring.
- Bell toggle in the header, persisted to localStorage.
- The AudioContext is created lazily on first sound: browsers block audio until
  the user has interacted, so creating it eagerly leaves it suspended and logs
  a warning on every load.

## v0.4.2 — DM routing and a People list

### Fixed — direct messages went to the whole company

`ChatHeader.startDm()` created the DM, received a `channelId`, then called
`router.refresh()` and **discarded the id**. Nothing selected the new channel,
so the user stayed in #general — and their "private" message went to everyone.

The header was a sibling of `ChatClient` in the server component and could not
reach `setActiveId`. It now lives inside `ChatClient`, which owns the selection.

### Fixed — a new DM never appeared in the sidebar

`channels` was initialised from `initialChannels` and never re-read. A server
refresh delivered new props; React kept the old client state.

Re-syncing naively then caused the opposite bug: live unread counts applied by
the socket were **overwritten on every refresh**, so a badge appeared and then
vanished. The re-sync now preserves whichever count is higher.

### Fixed — a message in an unseen channel raised no badge

If the other person created the DM, this client had never heard of the channel,
so incrementing its unread count matched nothing and the badge was dropped. It
now pulls the channel in.

### Added — People list

Every active user is listed permanently in the sidebar, with a presence dot and
an unread badge. Clicking someone opens the DM, creating it on first use.

Previously you had to open a dropdown to find a person, and an unread message
from someone you had no DM with was invisible — there was no row for it to
appear on.

## v0.4.1 — Phase 3 verified, plus call notices in chat

Video confirmed working end to end:

```
participant active ... connectionType: "udp", connectTime: "1.03s"
mediaTrack published ... kind: "audio"  mime: audio/red
mediaTrack published ... kind: "video"  VP8 1280x720, 3 simulcast layers
```

### Seven bugs fixed on first run

| # | Bug | Why it was invisible |
|---|---|---|
| 1 | `roomName @unique` — the SECOND call in any channel failed with P2002 | Only appears on the second call |
| 2 | Call button stayed clickable while connecting → `DUPLICATE_IDENTITY` | Needs a second click inside a ~5s window. LiveKit evicts the first connection; the disconnect handler then tore down the second |
| 3 | **LiveKit advertised its Docker-internal IP (172.19.0.x)** | Signaling connected, tokens validated, the room opened — everything looked healthy. Only `requestsSent: 8, responsesReceived: 0` in the ICE stats revealed it |
| 4 | `LIVEKIT_API_SECRET` mismatch between .env and livekit.yaml | Presents as a random disconnect, not an auth error |
| 5 | Call controls rendered off-screen | A flex child sizes to its content and pushes siblings out unless `overflow-hidden` is set — same class as the `min-w-0` mobile fix |
| 6 | Video flickered continuously | `snapshot()` returns fresh objects on every SFU event, and `ActiveSpeakersChanged` fires constantly. Depending on object identity re-attached the video element each time |
| 7 | Video cropped to a letterbox strip | `object-cover` filling a wide container. Also mattered for screen shares, which lost their edges |

**#3 is the one worth remembering.** Every high-level signal said the call was
fine. The truth was four levels down in ICE candidate statistics.

### Added — call timer

Elapsed time in the call header, next to a pulsing dot so it reads as "in
progress" rather than a static number.

**Anchored to a timestamp, not counting ticks.** A `setInterval` that
increments a counter drifts, and browsers throttle timers in background tabs —
a call left in another tab for ten minutes would come back showing two.
Recomputing from the join time each tick is always correct, and a
`visibilitychange` listener recomputes the moment the tab returns.

Rendered `dir="ltr"`: a duration is not directional text, and 12:05 must not
read as 05:12 in an RTL layout.

Call area raised to `70vh`, capped at `calc(100vh - 14rem)` so the composer and
message list stay reachable on short screens.

### Added — call notices in chat

A call that leaves no trace is confusing: someone scrolling back has no idea a
meeting happened. Completed calls now post a centred notice —
*"Call ended · 2 participants · 4 min"*.

- `Message.kind` ('user' | 'system') and `Message.systemData` (JSON).
- **`senderId` stays non-null**, attributed to whoever started the call. Making
  it nullable would have touched every existing query and join.
- Rendered as a centred notice with divider rules, **not a bubble** — a system
  message has no "side" and must not look like something a person said.
- Posted from BOTH the socket leave handler and the SFU webhook, so a tab
  closed without a graceful leave still produces one. Idempotent via a
  deterministic `clientMsgId` of `call-<sessionId>`.
- **Not editable or deletable by anyone**, including moderators. The attribution
  to the call starter is a schema convenience, not a licence to rewrite the record.
- Suppressed when a single participant was in for under 15 seconds — a call
  nobody answered is noise, not history.

## v0.4.0 — Phase 3: video

1:1 and group calls up to 10 participants via a LiveKit SFU. **Not yet
executed** — see PHASE-3-REPORT.md §8.

### Added
- **SFU, not mesh.** At eight participants a mesh asks each client to encode and
  upload seven streams; an SFU asks for one. Confirmed as D4 after the 5-10
  participant requirement.
- **`MediaTransport` interface.** `SfuTransport.ts` is the only file importing
  the LiveKit SDK — no component references it. Swapping vendors means
  replacing one file.
- **Scoped room tokens.** Room name derived from the channel, never
  client-supplied. Grant is `roomJoin`/`canPublish`/`canSubscribe` only —
  **never `roomAdmin` or `roomCreate`**.
- **Signature-verified webhooks.** An unauthenticated endpoint would let anyone
  forge call records.
- Screen sharing, device selection with persistence, active-speaker detection,
  simulcast, connection-quality indicator, grid up to six then speaker focus.
- 11 tests including an unsigned-webhook rejection and a token-claims assertion.

### RTL
Call controls are explicitly `dir="ltr"` — media controls are spatial, not
directional. The local preview is mirrored; screen shares are not, or text
would read backwards.

### Not recorded
No media recording, per D5. Only metadata — who joined, when, how long.

## v0.3.1 — Phase 2 first run

Pipeline verified end to end, including quarantine:

```
  scanning 1.jpeg (53 KB)
  ✓ clean 1.jpeg (+thumbnail)
  ⚠ INFECTED eicar.txt — Eicar-Test-Signature, object deleted
```

### Fixed
- **`async function process()` in worker.mjs** shadowed Node's global `process`
  object, so `process.env` was undefined and the worker would not start. Renamed
  to `handleJob`. Parsed fine and passed `node --check` — function declarations
  hoist and take precedence over globals, so nothing static catches this.
- **CSP blocked the direct-to-storage upload.** `connect-src 'self'` refused the
  browser's PUT to `localhost:9000`. The storage origin is now derived from
  `S3_ENDPOINT` and added to `connect-src` and `img-src`. The policy was working
  correctly — it refused a connection to an origin the app had not declared.

### Still unverified
Disguised-executable rejection, Arabic filename round trip, server-side 403 on
an infected download, and `tests/files.spec.ts` (13 tests, never run).

### Known gap
No token refresh on 401. A tab idle past the 15-minute access-token lifetime
shows "Network error" instead of refreshing silently. Predates Phase 2; affects
chat too. See PHASE-2-REPORT.md §13.

## v0.3.0 — Phase 2: files

### Added
- **MinIO + ClamAV** in docker-compose. ClamAV's first start downloads a ~250MB
  signature database and can take several minutes.
- **Presigned upload and download.** The API server never touches file bytes.
  5 min TTL to upload, 60 s to download.
- **Magic-byte MIME verification.** A client controls the extension and the
  Content-Type header but not the first bytes of the file. An executable
  renamed `.png` is rejected before the scan runs.
- **ClamAV INSTREAM client**, written directly rather than via a wrapper — the
  protocol is forty lines and avoids a native build dependency.
- **Scan worker** (`worker.mjs`) using BRPOPLPUSH, so a crash mid-scan does not
  lose the job. Recovers orphans at startup.
- **Quotas** — 100 MB per file, 10 GB per user, 50 GB per channel, all checked
  before a presigned URL is issued.
- **RFC 5987 filenames.** `Content-Disposition` is Latin-1; a raw Arabic
  filename is mangled. `filename*=UTF-8''…` carries it, with an ASCII fallback.
- Drag-drop, paste-to-upload, progress, cancel.
- 13 tests including EICAR quarantine and an executable disguised as a PNG.

### Security posture
- Allowlist, never blocklist. Blocked extensions checked in addition.
- No inline HTML or SVG — both execute script.
- Infected objects deleted from storage, not merely flagged.
- Scan errors fail closed: the file stays undownloadable.
- Download authorization re-checked at request time, not inherited from upload.

## v0.2.2 — full suite green

**132/132 passing** across `chromium-en`, `chromium-ar` and `mobile`.

### Eight production bugs found by running the suite

None were visible from reading the code. All were found by something that
signs in repeatedly and looks at a phone-sized viewport.

| # | Bug | Effect in production |
|---|---|---|
| 1 | A successful login consumed the per-account lockout budget | Six sign-ins in fifteen minutes locked the account |
| 2 | `TOTP_REQUIRED` counted as a failed attempt | Five **successful** 2FA logins locked the account |
| 3 | A successful login consumed the per-IP budget | Twenty office sign-ins locked out everyone |
| 4 | Per-IP limit of 20/15min too tight for a shared office IP | Same, on a normal Monday morning |
| 5 | A valid TOTP code consumed its own counter | Ten sign-ins locked the user out of their second factor |
| 6 | Admin-created users joined no channels | Every new hire signed in to an empty app |
| 7 | Chat layout unusable below 768px | Phone users got a 156px message pane |
| 8 | Admin table overflowed the viewport | **Deactivate was untappable on mobile** |

Bugs 1-5 are one mistake repeated: **the limiters counted traffic instead of
failures.** A rate limiter that punishes success is a quota, not a lockout.

Bug 8 is the one worth remembering — a security control that silently does
nothing is worse than one that visibly fails. The test that should have caught
it asserted the outcome without verifying the precondition; it now checks both.

### Rule for future phases

Any counter guarding a credential must be cleared when that credential
verifies successfully. Phase 2's upload quotas and presign limits have the
same shape.

### Test infrastructure built along the way

- `tests/helpers/totp.ts` — derives a live TOTP code by decrypting the stored
  secret. **2FA is not disabled for tests**; disabling it would mean the login
  path under test is not the one that ships.
- `tests/global-setup.ts` — warms routes before the run. Next dev compiles on
  demand, so the first test to touch a route paid 30-60s and blew its timeout,
  which read as a failure of whatever it happened to be asserting.
- `ChatPage.neutralizeDevOverlay()` — the Next dev indicator renders bottom-left;
  in RTL the send button mirrors into the same corner and the portal swallowed
  every click. Only Arabic tests failed, which looked like an RTL bug for hours.
- `selectChannel()` opens the mobile drawer before clicking.
- Negative tests use throwaway addresses so they stop draining the admin's
  rate-limit budget.
- `rbac.spec.ts` asserts deactivation actually happened before asserting login
  is refused.

### Also
- `npm run db:cleanup-tests` — removes accounts the suite leaves behind.
  Dry-run by default; `--confirm` to delete. Refuses to touch an admin.
- Cairo font install command documented, with the Latin-subset caveat.
- Argon2id benchmarked at 291ms.
- Production CSP verified: `script-src 'self'`, no `unsafe-*`.

## v0.2.1 — socket layer rewritten as ESM
`ERR_REQUIRE_CYCLE_MODULE` on Node 24: server.mjs could not load TypeScript
handlers through tsx. The socket layer is now self-contained plain ESM.

## v0.2.0 — Phase 1 initial
Chat, DMs, presence, typing, read state, RTL message rendering, Socket.IO with
the Redis adapter.
