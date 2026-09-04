---
name: security-preflight
description: Run Comms Platform startup and security validation without deploying or changing production data.
---

Run `npm run preflight`, then the smallest affected type, lint, build, E2E, and worker checks. For auth, upload, message, socket, or worker changes, include denied-access and retry/duplicate cases. Report exact results and never print secret values.
