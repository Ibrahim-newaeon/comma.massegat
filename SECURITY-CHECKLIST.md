# Phase 0 — Exit Checklist

Verify before Phase 1.

## Security
- [ ] Argon2id parameters benchmarked on target hardware and recorded in `src/lib/password.ts`
- [ ] `password_hash` on `auth_identities`, never on `users` — `grep -r "passwordHash" prisma/schema.prisma`
- [ ] Refresh rotation + reuse detection passing — `tests/auth.spec.ts`
- [ ] Rate limits active on login, refresh, TOTP, admin mutations
- [ ] Helmet-equivalent headers + CSP with no `unsafe-inline` script-src — `src/middleware.ts`
- [ ] CSRF enforced on every cookie-authenticated mutation
- [ ] Zero unsafe raw SQL — `grep -rn "RawUnsafe" src/` returns nothing
- [ ] No secrets in code or git history — `git log -p | grep -iE "jwt_secret|password" | head`
- [ ] Generic auth errors — no account-existence disclosure
- [ ] Access cookie httpOnly + SameSite=Strict, invisible to JS

## Correctness
- [ ] Every RBAC matrix cell covered by a test
- [ ] Every mutation writes an audit row
- [ ] Audit log has no delete path — `grep -rn "auditLog.delete" src/` returns nothing
- [ ] Last-admin lockout guard verified
- [ ] Boot fails loudly on a missing env var — try `unset JWT_SECRET && npm run dev`
- [ ] Deactivated user loses access immediately, not at token expiry

## UI / RTL
- [ ] Login + admin console fully usable in `ar`
- [ ] No physical direction CSS — stylelint passes
- [ ] Cairo loaded, subset, `font-display: swap`
- [ ] `data-testid` on every interactive element
- [ ] ARIA labels present; full keyboard navigation
- [ ] 56px minimum touch targets
- [ ] Loading and error states on every async surface

## Ops
- [ ] `docker compose up --build` works from a clean clone
- [ ] Dockerfile multi-stage, non-root, no toolchain in the final layer
- [ ] `/api/healthz` + `/api/readyz` leak nothing sensitive
- [ ] Seed script idempotent — run it twice
- [ ] README covers setup and first-admin creation

## Not done in Phase 0 (expected)
- Email delivery · bulk CSV import · session management UI · SSO callbacks

---

## Added after the first local run (v0.1.2)

- [ ] **Production CSP verified.** Dev relaxes `script-src` for React hydration.
      Confirm the strict policy in a real production build:
      `npm run build && npm start`, then
      `curl -sI http://localhost:3000/login | grep -i content-security-policy`
      → `script-src 'self'` with no `unsafe-*`
- [ ] **No redirect loops.** `npx playwright test tests/redirect-loops.spec.ts`
- [ ] **Hydration works.** Login button enables after filling both fields
      (covered by the same spec — a dead button means CSP broke hydration)
- [ ] **Versions pinned.** `next`, `prisma`, `@prisma/client` exact in package.json
- [ ] **Native modules load.** `node -e "require('argon2')"` and
      `node -e "require('@prisma/client')"` both succeed
- [ ] **`npm audit` reviewed, not auto-fixed.** Assess reachability per advisory
