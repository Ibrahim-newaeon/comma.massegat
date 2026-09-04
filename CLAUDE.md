# Comms Platform Project Guide

This repository is a self-hosted communications platform built with Next.js, a custom Node server, Prisma/PostgreSQL, Redis, Socket.IO, BullMQ-style worker processes, object storage, TOTP, and role-based access. It includes chat, files, search, notifications, and real-time services; dated phase reports describe history rather than current runtime truth.

## Sources of truth

Prefer code and tests, then **package.json**, Prisma schema/migrations, **README.md**, **SECURITY-CHECKLIST.md**, Docker/Compose, and Railway configuration.

## Setup and validation

~~~bash
cp .env.example .env
npm ci
docker compose up -d postgres redis
npm run preflight
npm run db:setup
npm run dev
npm run worker
npm run typecheck
npm run lint
npm run test:e2e
npm run build
~~~

Use **npm run dev:all** when both application and worker are required. Production migration and deployment helpers require explicit authorization.

## Security and data rules

- Generate independent JWT and TOTP encryption secrets. Never commit, quote in logs, or expose them to the browser.
- Keep authentication, RBAC, forced-password-change, TOTP enrollment, and audit enforcement server-side.
- Scope every conversation, message, file, search result, and socket room to authorized users and tenants/workspaces as implemented.
- Validate uploads and message payloads, enforce size/type limits, and keep object storage private by default.
- Preserve idempotency and retry safety between the web process, worker, Redis, and database.
- Apply Prisma migrations and post-migration SQL together. Do not replace them with an unreviewed **db push** on shared data.
- Run **preflight** before debugging startup; it validates environment format and required native dependencies.
- Do not run forced dependency-audit upgrades or accept Prisma major upgrades without compatibility work.
- Purge, backfill, reset, and production migration commands can materially change data and require explicit approval plus a backup.

Preserve English/Arabic behavior, RTL, accessibility, and real-time reconnect/error states. A change is ready when type checking, lint, build, relevant E2E tests, and worker startup pass.
