# Phase 4 — Implementation Report

## 1. Objective
Search across history, notifications when offline, an installable PWA, and
retention enforcement.

## 2. Skills Applied
✅ ZOD ✅ SEC ✅ SQL ✅ RTL ✅ TEST ✅ A11Y

## 3. Search

**One normalisation implementation.** `normalizeArabic()` runs in JavaScript at
index time and at query time. A Postgres function would be a second
implementation, and if the two ever drifted, Arabic search would silently
return nothing — the index holding one spelling while the query asks for
another. Nothing would error; results would just be empty.

**Config is `simple`, not `arabic`.** An Arabic snowball configuration is not
present on every Postgres build, so depending on it makes the schema
environment-specific. The normalisation in JS (harakat, tatweel, alef variants,
taa marbuta) is the part that actually matters for Arabic recall. Verify what
your instance has: `SELECT cfgname FROM pg_ts_config;`

**A GENERATED column, not a trigger.** Postgres keeps `search_vector` in step
automatically, and there is no trigger function to drift out of sync.

**Membership is a JOIN CONDITION, not a filter.** A user must be unable to
learn that a message exists in a channel they are not in — not even from a
result count. Filtering after the fetch would leak that.

**Trigram fallback, second.** When full-text finds nothing, `pg_trgm`
similarity catches typos and partial words. Deliberately second so exact
matches are never buried under fuzzy ones.

## 4. Notifications

**Only for genuinely offline recipients.** Presence is the gate: someone with
the tab open already saw the message and heard the sound. A push on top is
noise, and noise is how people end up disabling notifications entirely.

**Permission requested only from a click.** A prompt on page load is the
fastest route to a permanent denial, and browser denials are sticky — there is
no second chance.

**Direction and language come from the RECIPIENT's locale**, so an Arabic
notification renders RTL on a device set to English.

**Notifications collapse by channel** (`tag: channelId`). Twenty messages from
one conversation is one notification, not twenty.

**Dead subscriptions are deleted, not retried.** A 404 or 410 means the browser
discarded it. Retrying forever fills the table and makes every send wait on
endpoints that will never answer.

## 5. The 401 gap, finally closed

Present since Phase 0: a tab idle past the 15-minute access-token lifetime
failed its next request instead of refreshing. It surfaced as "Network error
during upload" in Phase 2 and would have hit calls too.

`withRefresh()` retries **exactly once**. A refresh loop against a genuinely
dead session is worse than a clear error — it hammers the server and leaves the
user watching a spinner instead of a login page.

**A single in-flight refresh, shared.** Without that, a page with four pending
requests fires four refreshes; each rotates the token, three then present an
already-consumed one, and reuse detection correctly treats that as theft and
revokes the whole family. The user is logged out for making four requests at
once — a security control firing on legitimate traffic, which is exactly the
class of bug Phase 1 was full of.

## 6. Retention

`npm run purge:dry` first, always. Every run writes an audit entry with counts.

Message **rows** survive permanently — deleting them would break reply chains.
Only bodies are cleared. Attachment rows survive with the object removed, so
the conversation still shows a file was there rather than a silent gap.

⚠️ The defaults are a starting point, not a compliance position. Confirm the
periods with counsel.

## 7. ⚠️ NOT VERIFIED

**Not executed.** Most likely to need attention:

1. **`Prisma.join(filters, ' ')` with an empty array** may throw. The search
   works without filters in the common path, but a filtered query is untested.
2. **Push needs HTTPS in production.** `localhost` is exempt; a LAN IP is not.
3. **`ts_headline` returns HTML** rendered with `dangerouslySetInnerHTML`. It is
   Postgres-generated from stored message text, not user markup echoed back —
   but it is the one place in this codebase that renders raw HTML, and worth a
   second look.
4. **Icons are missing.** `manifest.webmanifest` references `/icon-192.png` and
   `/icon-512.png`. Installation will fail without them.
5. **The service worker caches an offline shell** but the app needs a live
   socket. Offline mode shows the shell, not messages — closer to a graceful
   failure than genuine offline support.

## 8. Setup

```bash
npm install
npm run vapid                    # add the pair to .env
node node_modules/prisma/build/index.js db push
npm run db:post                  # search_vector, GIN + trigram indexes
npm run db:backfill-search       # index everything sent before Phase 4
npm run purge:dry                # see what retention would remove
```

Icons: any 192px and 512px PNG in `public/`.

## 9. Deviations from the kickoff

| Kickoff | Built | Why |
|---|---|---|
| Email digest via Microsoft Graph | Not built | Needs an Azure app registration and admin consent — configuration you have to do, not code I can write. Push covers the same need for a 10-person team |
| Postgres FTS with an Arabic config | `simple` config over JS-normalised text | The Arabic snowball dictionary is not guaranteed present, and normalisation is what carries Arabic recall |
| Full offline PWA | Installable, offline shell only | A chat app showing stale messages is worse than showing an offline notice |
