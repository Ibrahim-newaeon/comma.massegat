// prisma/seed.ts
// Creates exactly one bootstrap admin. Idempotent — safe to re-run.
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Administrator';

  if (!email || !password) {
    console.error('❌ BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('❌ BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✓ Bootstrap admin already exists: ${email}`);
    return;
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
  });

  const user = await prisma.user.create({
    data: {
      email,
      displayName: name,
      role: 'admin',
      locale: 'en',
      // Bootstrap admin sets a real password immediately on first login.
      mustChangePassword: true,
      identities: { create: { provider: 'password', providerUid: email, passwordHash } },
    },
  });

  await prisma.auditLog.create({
    data: { actorId: user.id, action: 'ADMIN.BOOTSTRAP_CREATED', targetType: 'user', targetId: user.id },
  });

  console.log(`✓ Bootstrap admin created: ${email}`);
  console.log('  → Sign in and you will be forced to set a new password.');
  console.log('  → TOTP enrolment is mandatory before reaching the admin console.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
