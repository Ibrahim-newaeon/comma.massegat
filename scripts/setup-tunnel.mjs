// scripts/setup-tunnel.mjs
// Configures the app for a public HTTPS URL via Cloudflare Tunnel.
//
//   node scripts/setup-tunnel.mjs
import 'dotenv/config';
import fs from 'node:fs';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const G = '\x1b[32m'; const Y = '\x1b[33m'; const R = '\x1b[31m'; const D = '\x1b[2m'; const X = '\x1b[0m';

console.log(`\n${G}Cloudflare Tunnel setup${X}\n`);
console.log('Gives the app a real HTTPS URL with no port forwarding and no');
console.log(`certificate on any device.\n`);

console.log(`${D}Before continuing, in the Cloudflare dashboard:${X}`);
console.log(`${D}  1. Zero Trust → Networks → Tunnels → Create a tunnel${X}`);
console.log(`${D}  2. Choose Docker; copy the token from the command shown${X}`);
console.log(`${D}  3. Public hostname → your subdomain → Type HTTP → URL caddy:80${X}\n`);

const host = (await rl.question('Public hostname (e.g. comms.yourcompany.com): ')).trim()
  .replace(/^https?:\/\//, '').replace(/\/$/, '');
if (!host) { console.log(`${R}Nothing entered.${X}`); rl.close(); process.exit(1); }

const token = (await rl.question(`Tunnel token ${D}(starts with eyJ…)${X}: `)).trim();
if (!token) { console.log(`${R}Nothing entered.${X}`); rl.close(); process.exit(1); }

console.log('');
console.log(`${Y}Calls:${X} WebRTC media is UDP and does NOT pass through a tunnel.`);
console.log(`${D}Self-hosted LiveKit will connect to signalling and then carry no${X}`);
console.log(`${D}audio or video for anyone outside your network.${X}\n`);

const useCloud = (await rl.question(
  `Use LiveKit Cloud for calls? ${D}(recommended for remote users — Y/n)${X}: `
)).trim().toLowerCase() !== 'n';

let lkUrl = `wss://${host}/rtc`;
let lkKey = process.env.LIVEKIT_API_KEY ?? '';
let lkSecret = process.env.LIVEKIT_API_SECRET ?? '';

if (useCloud) {
  console.log(`\n${D}From cloud.livekit.io → your project → Settings → Keys:${X}`);
  lkUrl = (await rl.question('  LiveKit Cloud URL (wss://…livekit.cloud): ')).trim();
  lkKey = (await rl.question('  API key: ')).trim();
  lkSecret = (await rl.question('  API secret: ')).trim();
} else {
  console.log(`\n${Y}⚠️  Calls will work on your local network only.${X}`);
}

const updates = {
  APP_URL: `https://${host}`,
  // A SUBDOMAIN, not a path. S3 signatures cover host and path exactly, so a
  // path prefix that gets stripped in the proxy invalidates every presigned URL.
  S3_ENDPOINT: `https://storage.${host.split('.').slice(-2).join('.')}`,
  LIVEKIT_URL: lkUrl,
  LIVEKIT_API_KEY: lkKey,
  LIVEKIT_API_SECRET: lkSecret,
  // Behind Cloudflare the socket sees the tunnel, not the user. Without this
  // the rate limiter buckets everyone together and one person's failed logins
  // lock out the company.
  TRUST_PROXY: 'true',
  CLOUDFLARE_TUNNEL_TOKEN: token,
  NODE_ENV: 'production',
};

console.log(`\n${G}Configuration${X}`);
for (const [k, v] of Object.entries(updates)) {
  const shown = /TOKEN|SECRET/.test(k) ? `${v.slice(0, 12)}…` : v;
  console.log(`  ${k}=${shown}`);
}

console.log('');
if ((await rl.question('Write to .env? (Y/n): ')).trim().toLowerCase() === 'n') {
  rl.close(); process.exit(0);
}

let env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
fs.writeFileSync('.env.backup', env);
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, 'm').test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, 'm'), line)
    : `${env.trimEnd()}\n${line}\n`;
}
fs.writeFileSync('.env', env);

console.log(`\n${G}✓ .env updated${X} ${D}(previous saved as .env.backup)${X}`);

console.log(`\n${R}⚠️  This URL is now reachable from the public internet.${X}`);
console.log(`${R}    Put Cloudflare Access in front of it before inviting anyone:${X}`);
console.log(`${D}    Zero Trust → Access → Applications → Add → Self-hosted${X}`);
console.log(`${D}    Domain: ${host}   Policy: emails ending @yourcompany.com${X}`);
console.log(`${D}    Without it, your login page is exposed to the whole internet.${X}`);

console.log(`\n${Y}⚠️  Storage needs its own public hostname on the tunnel:${X}`);
console.log(`${D}    storage.${host.split('.').slice(-2).join('.')}  →  HTTP  →  caddy:80${X}`);
console.log(`${D}    plus an Access policy of BYPASS / Everyone for it — a presigned${X}`);
console.log(`${D}    URL is already the authorisation and carries no session cookie.${X}`);

console.log(`\n${G}Then${X}`);
console.log('  npm run build');
console.log('  docker compose --profile proxy --profile tunnel up -d');
console.log('  npm start');
console.log(`\n  Open  https://${host}\n`);

rl.close();
