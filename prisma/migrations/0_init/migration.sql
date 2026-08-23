-- prisma/migrations/0_init/migration.sql
-- Manual extensions. Prisma does NOT generate these — if this file is not
-- applied, email comparison becomes case-sensitive and login silently breaks.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Run AFTER `prisma migrate deploy` creates the tables:
--   ALTER TABLE users ALTER COLUMN email TYPE CITEXT;
