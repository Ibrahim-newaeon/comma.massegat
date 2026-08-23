#!/usr/bin/env bash
# fix-phase1.sh — resolves the two failures from the first Phase 1 run.
#
#   1. Prisma drift: the CITEXT alteration was applied outside migration
#      history, so `migrate dev` wants to reset (destroying your data).
#      Fixed with `db push`, which syncs schema without touching history.
#
#   2. ERR_REQUIRE_CYCLE_MODULE: server.js used tsx to load TypeScript socket
#      handlers. Node 24 refuses. The socket layer is now plain ESM.
#
# Usage:  cd <phase1 folder> && bash fix-phase1.sh

set -euo pipefail
GRN=$'\e[32m'; YEL=$'\e[33m'; RED=$'\e[31m'; DIM=$'\e[2m'; RST=$'\e[0m'
step(){ echo; echo "${GRN}==>${RST} $*"; }
die(){ echo; echo "${RED}✗ $*${RST}"; exit 1; }

[ -f package.json ] || die "Run this from inside the phase1 folder."
grep -q '"name": "comms-platform"' package.json || die "Wrong project."

step "Syncing schema with db push (adds the three chat tables, keeps your data)"
echo "${DIM}db push does not consult migration history, so the CITEXT drift is irrelevant.${RST}"
npx prisma db push --skip-generate
npx prisma generate

step "Re-asserting CITEXT"
npm run db:post

step "Seeding #general"
npm run db:seed:channels

step "Verifying the new server entry point"
[ -f server.mjs ] || die "server.mjs missing — extract the v0.2.1 zip first."
[ -f src/server/socket/handlers.mjs ] || die "handlers.mjs missing — extract the v0.2.1 zip first."
node --check server.mjs && echo "  ✓ server.mjs parses"
node --check src/server/socket/handlers.mjs && echo "  ✓ handlers.mjs parses"

echo
echo "${GRN}════════════════════════════════════${RST}"
echo "${GRN} Ready${RST}"
echo "${GRN}════════════════════════════════════${RST}"
echo
echo "  ${DIM}npm run dev${RST}   then open  ${DIM}http://localhost:3000${RST}"
echo
echo "  ${YEL}Note:${RST} migration history is now out of step with the live schema."
echo "  That is fine for development. Before production, baseline it:"
echo "    ${DIM}npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/baseline.sql${RST}"
echo
