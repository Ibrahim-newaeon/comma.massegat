// scripts/setup-network.mjs
// Points every service at one hostname so the app works from other devices.
//
//   node scripts/setup-network.mjs
//
// The problem this solves: the app is not one origin. Presigned upload URLs
// point at object storage, calls open a WebSocket to the SFU, and the CSP has
// to name all of them. Change the hostname by hand and you will miss one —
// usually the storage origin, which fails as "Network error during upload".
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const G = '\x1b[32m'; const Y = '\x1b[33m'; const R = '\x1b[31m'; const D = '\x1b[2m'; const X = '\x1b[0m';

/** Every non-internal IPv4 address, so the user can pick the right interface. */
function localAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

console.log(`\n${G}Network setup${X}\n`);
console.log('This points the app, object storage, the SFU and the CSP at one');
console.log(`hostname, so other devices can reach them.\n`);

const addrs = localAddresses();
if (addrs.length > 0) {
  console.log(`${D}Addresses on this machine:${X}`);
  addrs.forEach((a, i) => console.log(`  ${i + 1}. ${a.address}  ${D}(${a.name})${X}`));
  console.log('');
}

const host = (await rl.question(
  `Hostname or IP other devices will use ${D}(e.g. comms.company.local or 192.168.1.50)${X}: `
)).trim();

if (!host) { console.log(`${R}Nothing entered. Aborted.${X}`); rl.close(); process.exit(1); }

const isLocalhost = host === 'localhost' || host === '127.0.0.1';
const looksLikeIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

console.log('');
const httpsAnswer = (await rl.question(
  `Will you serve this over HTTPS? ${D}(strongly recommended — Y/n)${X}: `
)).trim().toLowerCase();
const https = httpsAnswer !== 'n';

if (!https && !isLocalhost) {
  console.log(`\n${R}⚠️  Without HTTPS, browsers treat this as an insecure context.${X}`);
  console.log(`${R}    Camera, microphone, push notifications and the service worker${X}`);
  console.log(`${R}    are ALL disabled — no video calls, no voice notes, no PWA.${X}`);
  console.log(`${R}    localhost is exempt, which is why it works on this machine.${X}`);
  console.log(`${D}    See DEPLOYMENT.md for the certificate options.${X}\n`);
  const go = (await rl.question('Continue anyway? (y/N): ')).trim().toLowerCase();
  if (go !== 'y') { rl.close(); process.exit(1); }
}

const scheme = https ? 'https' : 'http';
const wsScheme = https ? 'wss' : 'ws';

// Behind a reverse proxy everything is one origin on 443. Direct, each service
// keeps its own port.
const proxied = https;
const appUrl = proxied ? `${scheme}://${host}` : `${scheme}://${host}:3000`;
const s3Endpoint = proxied ? `${scheme}://${host}/storage` : `http://${host}:9000`;
const livekitUrl = proxied ? `${wsScheme}://${host}/rtc` : `ws://${host}:7880`;

const updates = {
  APP_URL: appUrl,
  S3_ENDPOINT: s3Endpoint,
  LIVEKIT_URL: livekitUrl,
  // With a proxy in front, the client IP is in X-Forwarded-For. Without this
  // the rate limiter sees only the proxy and buckets the whole company as one
  // client — which is a denial of service on your own users.
  TRUST_PROXY: proxied ? 'true' : 'false',
};

console.log(`\n${G}Configuration${X}`);
for (const [k, v] of Object.entries(updates)) console.log(`  ${k}=${v}`);

console.log('');
const confirm = (await rl.question('Write these to .env? (Y/n): ')).trim().toLowerCase();
if (confirm === 'n') { console.log('Aborted.'); rl.close(); process.exit(0); }

let env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
fs.writeFileSync('.env.backup', env);

for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${env.trimEnd()}\n${line}\n`;
}
fs.writeFileSync('.env', env);

console.log(`\n${G}✓ .env updated${X} ${D}(previous version saved as .env.backup)${X}`);

if (looksLikeIp && https) {
  console.log(`\n${Y}⚠️  A certificate for a bare IP address is awkward — public CAs`);
  console.log(`    will not issue one. Use a hostname, or the internal CA route`);
  console.log(`    in DEPLOYMENT.md.${X}`);
}

console.log(`\n${G}Next${X}`);
console.log('  1. Restart everything:  docker compose up -d  &&  npm run dev');
if (proxied) {
  console.log('  2. Start the proxy:     docker compose --profile proxy up -d caddy');
  console.log(`  3. Open:                ${appUrl}`);
} else {
  console.log(`  2. Open:                ${appUrl}`);
}
console.log('');

rl.close();
