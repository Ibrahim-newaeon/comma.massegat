// src/lib/files/clamav.ts
// Talks to clamd over TCP using the INSTREAM command.
//
// Implemented directly rather than via a wrapper package: the protocol is
// about forty lines, and it avoids a dependency with native build steps that
// would have to compile on every developer machine and in CI.
//
// Wire format:
//   send  "zINSTREAM\0"
//   then  repeated <4-byte big-endian length><chunk>
//   then  <4 zero bytes> to terminate
//   read  "stream: OK\0"  or  "stream: <SIGNATURE> FOUND\0"
import net from 'node:net';
import { env } from '@/env';

export type ScanResult =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'error'; detail: string };

const CHUNK = 64 * 1024;

export async function scanBuffer(buf: Buffer, timeoutMs = 120_000): Promise<ScanResult> {
  if (!env.CLAMAV_ENABLED) {
    return { status: 'error', detail: 'CLAMAV_DISABLED' };
  }

  return new Promise<ScanResult>((resolve) => {
    const socket = new net.Socket();
    let response = '';
    let settled = false;

    const finish = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish({ status: 'error', detail: 'SCAN_TIMEOUT' }));
    socket.on('error', (e) => finish({ status: 'error', detail: e.message }));
    socket.on('data', (d) => { response += d.toString('utf8'); });

    socket.on('close', () => {
      const text = response.replace(/\0/g, '').trim();
      if (!text) return finish({ status: 'error', detail: 'EMPTY_RESPONSE' });
      if (text.endsWith('OK')) return finish({ status: 'clean' });
      if (text.includes('FOUND')) {
        const sig = text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '');
        return finish({ status: 'infected', signature: sig || 'UNKNOWN' });
      }
      finish({ status: 'error', detail: text });
    });

    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write('zINSTREAM\0');
      for (let off = 0; off < buf.length; off += CHUNK) {
        const chunk = buf.subarray(off, Math.min(off + CHUNK, buf.length));
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length, 0);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));   // zero-length chunk terminates the stream
    });
  });
}

/** Liveness check for /api/readyz. */
export async function pingClamav(timeoutMs = 3000): Promise<boolean> {
  if (!env.CLAMAV_ENABLED) return false;
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let out = '';
    socket.setTimeout(timeoutMs);
    const done = (v: boolean) => { socket.destroy(); resolve(v); };
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.on('data', (d) => { out += d.toString(); });
    socket.on('close', () => done(out.includes('PONG')));
    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => socket.write('zPING\0'));
  });
}
