// server.mjs — hosts Next.js and Socket.IO in one process.
// Next route handlers cannot hold a long-lived socket server, hence this entry point.
import { createServer } from 'node:http';
import next from 'next';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { installAuth, installHandlers } from './src/server/socket/handlers.mjs';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));

const io = new Server(httpServer, {
  path: '/socket.io',
  // Same-origin only. Never '*'.
  cors: { origin: process.env.APP_URL, credentials: true },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Redis adapter installed on day 1 even with a single instance. Retrofitting it
// later means re-testing every realtime path under multi-instance conditions.
const pub = new Redis(process.env.REDIS_URL);
const sub = pub.duplicate();
pub.on('error', (e) => console.error('[redis pub]', e.message));
sub.on('error', (e) => console.error('[redis sub]', e.message));
io.adapter(createAdapter(pub, sub));

installAuth(io);
installHandlers(io);
console.log('> socket handlers registered');

// Idempotent — a fresh MinIO volume needs no manual setup step.
try {
  const { S3Client, HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
  });
  const bucket = process.env.S3_BUCKET ?? 'comms-files';
  try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); }
  catch { await s3.send(new CreateBucketCommand({ Bucket: bucket })); console.log(`> created bucket ${bucket}`); }
} catch (e) {
  console.warn('> object storage unreachable — file features will not work:', e.message);
}

httpServer.listen(port, () => {
  console.log(`> ready on http://localhost:${port}`);
  console.log(`> socket.io mounted at /socket.io`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down`);
    io.close(() => httpServer.close(() => process.exit(0)));
  });
}
