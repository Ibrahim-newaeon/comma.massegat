// scripts/preflight.mjs
// Validates .env and dependency reachability BEFORE Next.js starts.
// Run: npm run preflight   (also runs automatically via `npm run dev`)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';
const problems = [];
const warnings = [];

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  console.error(`${RED}✗ .env not found.${RESET}  Run: cp .env.example .env`);
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');

if (raw.includes('\r\n')) {
  warnings.push('.env has CRLF line endings. Values are trimmed at load, but LF is safer. In VS Code: click CRLF in the status bar → LF.');
}

const envVars = {};
for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  envVars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}

function check(name, fn, hint) {
  const value = envVars[name];
  if (value === undefined) { problems.push(`${name} is missing.  ${hint}`); return; }
  if (value.startsWith('CHANGE_ME')) { problems.push(`${name} is still the placeholder.  ${hint}`); return; }
  if (/^["'].*["']$/.test(value)) { problems.push(`${name} is wrapped in quotes. Remove them.`); return; }
  const err = fn(value);
  if (err) problems.push(`${name}: ${err}  ${hint}`);
}

check('DATABASE_URL', (v) => (v.startsWith('postgresql://') || v.startsWith('postgres://') ? null : 'must start with postgresql://'), '');
check('REDIS_URL', (v) => (v.startsWith('redis://') ? null : 'must start with redis://'), '');
check('JWT_SECRET', (v) => (v.length >= 32 ? null : `only ${v.length} chars, need >= 32.`),
  'Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"');
check('TOTP_ENCRYPTION_KEY', (v) => {
  let bytes;
  try { bytes = Buffer.from(v, 'base64').length; } catch { return 'is not valid base64.'; }
  return bytes === 32 ? null : `decodes to ${bytes} bytes, need exactly 32.`;
}, 'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
check('APP_URL', (v) => { try { new URL(v); return null; } catch { return 'is not a valid URL.'; } },
  'Example: http://localhost:3000');
check('S3_ACCESS_KEY', (v) => (v.length >= 3 ? null : 'too short.'), '');
check('S3_SECRET_KEY', (v) => (v.length >= 8 ? null : 'must be at least 8 characters.'), '');
check('S3_ENDPOINT', (v) => { try { new URL(v); return null; } catch { return 'is not a valid URL.'; } }, 'Example: http://localhost:9000');
check('LIVEKIT_API_KEY', (v) => (v.length >= 3 ? null : 'too short.'), '');
check('LIVEKIT_API_SECRET', (v) => (v.length >= 8 ? null : 'must be at least 8 characters.'), '');
check('BOOTSTRAP_ADMIN_EMAIL', (v) => (v.includes('@') ? null : 'is not a valid email.'), '');
check('BOOTSTRAP_ADMIN_PASSWORD', (v) => (v.length >= 12 ? null : `only ${v.length} chars, need >= 12.`), '');

function probe(host, port, label) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve({ label, up: true }); });
    socket.once('timeout', () => { socket.destroy(); resolve({ label, up: false }); });
    socket.once('error', () => { socket.destroy(); resolve({ label, up: false }); });
    socket.connect(port, host);
  });
}

function portInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => server.close(() => resolve(false)));
    server.listen(port, '127.0.0.1');
  });
}

function parseHostPort(url, fallbackPort) {
  try { const u = new URL(url); return { host: u.hostname, port: Number(u.port) || fallbackPort }; }
  catch { return null; }
}

const results = [];
const pg = parseHostPort(envVars.DATABASE_URL ?? '', 5432);
const rd = parseHostPort(envVars.REDIS_URL ?? '', 6379);
if (pg) results.push(await probe(pg.host, pg.port, `PostgreSQL (${pg.host}:${pg.port})`));
if (rd) results.push(await probe(rd.host, rd.port, `Redis (${rd.host}:${rd.port})`));

const s3 = parseHostPort(envVars.S3_ENDPOINT ?? '', 9000);
if (s3) results.push(await probe(s3.host, s3.port, `Object storage (${s3.host}:${s3.port})`));

for (const r of results) {
  if (!r.up) problems.push(`${r.label} is not reachable.  Run: docker compose up -d postgres redis`);
}

// Port collision — the exact failure that breaks APP_URL silently.
const appUrl = parseHostPort(envVars.APP_URL ?? '', 3000);
if (appUrl && (await portInUse(appUrl.port))) {
  warnings.push(
    `Port ${appUrl.port} is already in use. Next.js will fall back to another port, ` +
    `but APP_URL still says ${appUrl.port} — admin setup links would break.\n` +
    `    Either free it:   npx kill-port ${appUrl.port}\n` +
    `    or force it:      npm run dev -- -p ${appUrl.port}\n` +
    `    or update APP_URL in .env to the port actually used.`
  );
}

// ClamAV is a WARNING, not an error: chat works without it, files degrade.
if (envVars.CLAMAV_ENABLED !== 'false') {
  const clam = await probe(envVars.CLAMAV_HOST ?? 'localhost', Number(envVars.CLAMAV_PORT ?? 3310), 'ClamAV');
  if (!clam.up) {
    warnings.push(
      'ClamAV is not reachable. Uploads will be marked "error" and stay undownloadable.\n' +
      '    First start downloads a ~250MB signature database and can take several minutes:\n' +
      '      docker compose up -d clamav && docker compose logs -f clamav'
    );
  }
}

// The SFU is a WARNING, not an error: chat and files work without it.
{
  let lkHost = 'localhost', lkPort = 7880;
  try { const u = new URL(envVars.LIVEKIT_URL ?? ''); lkHost = u.hostname; lkPort = Number(u.port) || 7880; } catch { /* defaults */ }
  const lk = await probe(lkHost, lkPort, 'LiveKit');
  if (!lk.up) {
    warnings.push(
      `LiveKit is not reachable at ${lkHost}:${lkPort}. Video calls will not connect.\n` +
      '    Start it:  docker compose up -d livekit'
    );
  }
}

if (envVars.LIVEKIT_API_SECRET === 'secret' && envVars.NODE_ENV === 'production') {
  problems.push('LIVEKIT_API_SECRET is the public dev value. Generate real keys: docker run --rm livekit/livekit-server generate-keys');
}

// The trap that costs a whole afternoon: everything looks configured, the app
// loads on another device, and camera, microphone, push and the service worker
// are all silently dead.
{
  const appUrl = envVars.APP_URL ?? '';
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(appUrl);
  const isHttps = appUrl.startsWith('https://');

  if (appUrl && !isLocal && !isHttps) {
    problems.push(
      `APP_URL is ${appUrl} — not HTTPS and not localhost.\n` +
      '    Browsers treat this as an INSECURE CONTEXT and silently disable\n' +
      '    camera, microphone, push notifications and the service worker.\n' +
      '    Nothing errors; the buttons simply do nothing.\n' +
      '    Fix: npm run setup:network   (see DEPLOYMENT.md)'
    );
  }

  // Presigned upload URLs are generated against S3_ENDPOINT. If the app is on
  // a hostname and storage still says localhost, uploads fail from every other
  // device with "Network error during upload".
  const s3 = envVars.S3_ENDPOINT ?? '';
  if (appUrl && !isLocal && /localhost|127\.0\.0\.1/.test(s3)) {
    problems.push(
      `S3_ENDPOINT still points at localhost (${s3}) while APP_URL does not.\n` +
      '    Uploads will fail on every device except this one.\n' +
      '    Fix: npm run setup:network'
    );
  }

  const lk = envVars.LIVEKIT_URL ?? '';
  if (appUrl && !isLocal && /localhost|127\.0\.0\.1/.test(lk)) {
    warnings.push(
      `LIVEKIT_URL still points at localhost (${lk}). Calls will not connect\n` +
      '    from other devices.  Fix: npm run setup:network'
    );
  }
}

if (!fs.existsSync(path.resolve('public/fonts/Cairo-Variable.woff2'))) {
  warnings.push('public/fonts/Cairo-Variable.woff2 is missing — Arabic will fall back to a system font. See public/fonts/README.md');
}

console.log('');
for (const w of warnings) console.log(`${YELLOW}⚠${RESET}  ${w}`);
if (warnings.length) console.log('');

if (problems.length) {
  console.error(`${RED}✗ Preflight failed${RESET}\n`);
  for (const p of problems) console.error(`   ${RED}•${RESET} ${p}`);
  console.error(`\n   ${DIM}Fix .env, then run again.${RESET}\n`);
  process.exit(1);
}

console.log(`${GREEN}✓ Preflight passed${RESET} ${DIM}— env valid, Postgres and Redis reachable${RESET}\n`);
