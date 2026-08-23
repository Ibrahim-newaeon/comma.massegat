# Comms Platform — Phase 0

Auth, admin user provisioning, RBAC, and audit logging.
Chat, files, video, and search land in Phases 1–4.

---

## Quick start

```bash
# 1. Config
cp .env.example .env
```

Generate the two secrets and paste them into `.env` **unquoted**:

**macOS / Linux**
```bash
openssl rand -base64 48    # -> JWT_SECRET
openssl rand -base64 32    # -> TOTP_ENCRYPTION_KEY
```

**Windows (Git Bash / PowerShell — no openssl needed)**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # -> JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # -> TOTP_ENCRYPTION_KEY
```

Then set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ chars).

```bash
# 2. Dependencies
npm install

# 3. Postgres + Redis
docker compose up -d postgres redis

# 4. Check everything before starting  ← catches most first-run failures
npm run preflight

# 5. Schema + CITEXT + bootstrap admin (one command, cross-platform)
npm run db:setup

# 6. Run
npm run dev
```

Sign in with the bootstrap admin → forced password change → TOTP enrolment → admin console.

> `npm run dev` runs preflight automatically via `predev`. To skip it, run `npx next dev`.

---

## Troubleshooting first run

| Symptom | Cause | Fix |
|---|---|---|
| `TOTP_ENCRYPTION_KEY must be base64...` | Placeholder still in `.env`, or key isn't 32 bytes | Regenerate with the command above. Must decode to exactly 32 bytes — `npm run preflight` verifies this |
| `Port 3000 is in use, using 3001 instead` | Another process holds 3000 | Free it (`npx kill-port 3000`), force it (`npm run dev:3000`), **or** set `APP_URL=http://localhost:3001` — see below |
| Setup link 404s | `APP_URL` doesn't match the actual port | `APP_URL` builds those links. Keep them in sync — preflight warns on mismatch |
| Login fails for `Ahmad@x.com` but works for `ahmad@x.com` | CITEXT migration not applied | `npm run db:post` |
| `Environment variable not found: DATABASE_URL` | `.env` missing or CRLF-mangled | `cp .env.example .env`, save with LF endings |
| Values wrapped in quotes | `KEY="value"` in `.env` | Remove the quotes — preflight catches this |
| Arabic text looks wrong | Cairo font file missing | See `public/fonts/README.md` |

### Windows / MINGW64

- Save `.env` with **LF** line endings. In VS Code, click `CRLF` in the status bar → `LF`. Every value is `.trim()`'d at load, so a stray `\r` won't break you — but preflight will warn.
- No `openssl`? Use the Node commands above.
- No `psql`? `npm run db:post` applies the CITEXT migration through the Node `pg` driver instead.

### If npm blocks install scripts

npm may refuse to run package install scripts, printing `allow-scripts` warnings.
Two of them are load-bearing: `argon2` (compiles a native binary) and
`@prisma/client` (generates the query client). Nothing works without them.

If `npm approve-scripts --allow-scripts-pending` does not take, run them directly:

```bash
npx prisma generate
npm rebuild argon2
```

Then verify:

```bash
node -e "require('argon2'); console.log('argon2 OK')"
node -e "require('@prisma/client'); console.log('prisma OK')"
```

### Do not run `npm audit fix --force`

It performs breaking major upgrades. It will move Next.js 15 → 16, which this
codebase is not written for. Versions are pinned exactly for this reason.

The remaining advisories are in `@prisma/config` — a dev dependency used by the
Prisma CLI at migration time. Not in the runtime bundle, not reachable by a user
request. Assess reachability before acting on audit output.

Likewise ignore the Prisma 7 upgrade banner. The schema and `$queryRaw` usage
target 6.x.

### No local Postgres password?

If a native Postgres already occupies 5432, run the containers on different
ports instead of fighting it:

```bash
sed -i "s|ports: \['5432:5432'\]|ports: ['5433:5432']|" docker-compose.yml
sed -i "s|ports: \['6379:6379'\]|ports: ['6380:6379']|" docker-compose.yml
sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://comms:comms_dev_password@localhost:5433/comms|' .env
sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://localhost:6380|' .env
docker compose up -d postgres redis
```

Your existing services keep running untouched.

---

## Before production

```bash
npm run benchmark
```

Target 250–500 ms. Tune `memoryCost` in `src/lib/password.ts`, then record the measured figure in the comment there.

---

## Tests

```bash
npx playwright install --with-deps
npm run test:e2e                          # en + ar + mobile
npx playwright test --project=chromium-ar
```

The whole suite runs twice — once LTR, once RTL. Deliberate.

---

## Architecture notes

**Password hash lives on `auth_identities`, never on `users`.** Adding Google or Microsoft SSO later is an insert plus a callback route — no migration.

**Refresh tokens rotate on every use.** Presenting a consumed token means the token leaked: the whole family is revoked and a `SECURITY.REFRESH_TOKEN_REUSE` audit event is written. Covered in `tests/auth.spec.ts`.

**`authorize()` in `src/lib/authorize.ts` is the only enforcement point.** Hiding buttons is cosmetic; every route handler re-authorizes.

**Middleware runs on Edge** — no Prisma, no argon2. Security headers and coarse route gating only.

**Deactivation is immediate.** `getActor()` re-reads the DB every request, so a deactivated user loses access without waiting for JWT expiry.

**Audit rows have no delete path.** By design.

---

## RTL

| Rule | Where |
|---|---|
| UI direction from locale; content direction per-element | `layout.tsx`, `dir="auto"` |
| Logical CSS properties only | `.stylelintrc.json` bans physical ones |
| `.force-ltr` for emails, code, URLs, IDs | `globals.css` |
| No `letter-spacing` on Arabic | `globals.css` + `tests/rtl.spec.ts` |
| `<bdi>` around interpolated names | `UsersTable.tsx`, `admin/layout.tsx` |
| Cairo covers Arabic + Latin in one family | `globals.css` |

`normalizeArabic()` already exists in `src/lib/i18n/bidi.ts`, unused until search arrives in Phase 4. One implementation, one place.

---

## Known gaps (deliberate)

- **No email sending.** Setup links display in the admin UI for manual delivery. Microsoft Graph is Phase 4.
- **Cairo font file not committed.** See `public/fonts/README.md`. Verify the license yourself.
- **Argon2 parameters are unbenchmarked defaults.** Run `npm run benchmark`.
- **No bulk CSV user creation.** Single-user only.
- **No session-list UI.** Revocation happens automatically on deactivate, password change, and reuse detection.

---

## Scope boundary

Phase 0 ends here. Do not add channels, messages, Socket.IO, file upload, video, search, or notifications to this codebase — those are Phases 1–4, each with its own kickoff.
