---
paths:
  - "prisma/**"
  - "scripts/**"
  - "src/**/*worker*"
---

# Database and worker rules

- Append Prisma migrations and keep required post-migration SQL in the same reviewed workflow.
- Do not substitute an unreviewed db push for migrations on shared data.
- Review data loss, locks, indexes, constraints, defaults, backfills, and recovery.
- Purges, backfills, resets, production migrations, and deployment require explicit approval and a backup.
