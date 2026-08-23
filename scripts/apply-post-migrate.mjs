// scripts/apply-post-migrate.mjs
// Applies prisma/post-migrate.sql (CITEXT) without requiring a local psql binary.
// Windows-friendly. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL is not set. Check your .env');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve('prisma/post-migrate.sql'), 'utf8');
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);

  const { rows } = await client.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'email'`,
  );

  if (rows[0]?.data_type === 'USER-DEFINED') {
    console.log('✓ users.email is CITEXT — email comparison is case-insensitive');
  } else {
    console.error('✗ users.email is NOT CITEXT. Login will be case-sensitive.');
    console.error('  Run `npx prisma migrate dev` first, then this script again.');
    process.exit(1);
  }
} catch (err) {
  console.error('✗ post-migrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}
