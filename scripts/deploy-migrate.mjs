// scripts/deploy-migrate.mjs
// Runs at deploy time, before the app starts.
//
// Today's worst failure was a build that regenerated the Prisma client while
// the database kept its old columns — every login returned 500. The build and
// the schema must move together, and this is where that happens.
import { execSync } from 'node:child_process';

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

try {
  // db push, not migrate deploy: this project has no migration history —
  // it has been developed with push throughout.
  //
  // ⚠️ push COMPARES and ALTERS. It can drop a column it believes is
  //    unwanted. Acceptable while the schema is still moving; switch to
  //    `prisma migrate deploy` once it settles and the data matters.
  run('npx prisma db push --skip-generate');

  // CITEXT, the search vector column, GIN and trigram indexes. Idempotent.
  run('node scripts/apply-post-migrate.mjs');

  console.log('✓ schema in sync');
} catch (err) {
  console.error('✗ migration failed — refusing to start with a stale schema');
  console.error(err.message);
  process.exit(1);
}
