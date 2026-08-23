-- prisma/post-migrate.sql
-- Manual SQL Prisma does not generate. Idempotent; safe to re-run.

CREATE EXTENSION IF NOT EXISTS citext;
-- Trigram index backs the fuzzy fallback when full-text finds nothing.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Case-insensitive email. Without this, Ahmad@x.com never matches ahmad@x.com
-- and login fails for some users with no error message.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email' AND data_type <> 'USER-DEFINED'
  ) THEN
    ALTER TABLE users ALTER COLUMN email TYPE CITEXT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Full-text search
--
-- A GENERATED column rather than a trigger: Postgres keeps it in step
-- automatically, and there is no trigger function to drift out of sync with
-- the schema.
--
-- Config is 'simple', NOT 'arabic'. Two reasons:
--   1. An Arabic snowball configuration is not present on every Postgres build,
--      so relying on it makes the schema environment-dependent.
--   2. The text is already normalised in JS (alef forms, taa marbuta, tatweel,
--      harakat), which is the part that actually matters for Arabic recall.
-- Verify what your instance has:  SELECT cfgname FROM pg_ts_config;
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'messages' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE messages
      ADD COLUMN search_vector tsvector
      GENERATED ALWAYS AS (to_tsvector('simple', coalesce(search_text, ''))) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON messages USING GIN (search_vector);

-- Fuzzy fallback for typos and partial words.
CREATE INDEX IF NOT EXISTS idx_messages_search_trgm
  ON messages USING GIN (search_text gin_trgm_ops);

-- Attachment filenames are searchable too — people look for "the budget
-- spreadsheet", not the message it was attached to.
CREATE INDEX IF NOT EXISTS idx_attachments_filename_trgm
  ON attachments USING GIN (filename gin_trgm_ops);
