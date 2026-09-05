---
paths:
  - "src/**"
  - "mobile/**"
  - "public/**"
---

# Communications security rules

- Keep authentication, RBAC, forced-password-change, TOTP, audit enforcement, and workspace scope on the server.
- Scope conversations, messages, files, searches, notifications, and socket rooms to authorized users.
- Validate uploads and messages; enforce type and size limits; keep object storage private by default.
- Never expose JWT, TOTP encryption, storage, database, mail, or deployment secrets in browser code or logs.
- Preserve real-time reconnect, duplicate-delivery, job idempotency, and failure behavior.
