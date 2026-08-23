// src/middleware.ts
// Runs on the Edge runtime — no Prisma, no argon2 here.
// Responsibilities: security headers + coarse route gating only.
// Real authorization happens server-side in route handlers via authorize().

import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const ACCESS_COOKIE = 'cp_access';
const PUBLIC_PATHS = [
  '/login', '/signup', '/change-password',
  '/api/auth/login', '/api/auth/signup', '/api/auth/refresh', '/api/auth/change-password',
  '/api/healthz', '/api/readyz',
  // The service worker and manifest must load before a session exists, or the
  // app cannot be installed from the login screen.
  '/sw.js', '/manifest.webmanifest',
  // Google and Apple fetch these UNAUTHENTICATED to verify app ownership.
  // Behind the auth gate they receive a redirect to /login, and verification
  // fails with no error surfaced anywhere — the app just ships with a visible
  // address bar.
  '/.well-known',
];

const isDev = process.env.NODE_ENV !== 'production';

function securityHeaders(res: NextResponse, nonce: string) {
  // Next.js dev mode requires 'unsafe-eval' (react-refresh) and 'unsafe-inline'
  // (hydration bootstrap). Without these, React never hydrates and every button
  // renders dead — see CHANGELOG v0.1.2. Production keeps the strict policy.
  // ⚠️ Verify in a production build that script-src is 'self' only.
  // 'strict-dynamic' lets a nonced script load its own chunks without every
  // chunk needing a nonce — which is how Next actually loads code.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  // Phase 2 uploads PUT directly from the browser to object storage — bytes
  // never pass through this server. That means the storage ORIGIN must appear
  // in connect-src, or the browser refuses to send the request at all.
  // Origin only, never a path: this grants no more than necessary.
  const storageOrigin = (() => {
    try { return new URL(process.env.S3_ENDPOINT ?? '').origin; } catch { return ''; }
  })();

  // Phase 3: the browser opens a WebSocket to the SFU for signaling. Without
  // this origin in connect-src the connection is refused before it is sent —
  // exactly the failure Phase 2's direct upload hit.
  const sfuOrigin = (() => {
    try {
      const u = new URL(process.env.LIVEKIT_URL ?? '');
      return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host} ${u.origin}`;
    } catch { return ''; }
  })();

  const connectSrc = isDev
    ? `connect-src 'self' ws: wss: ${storageOrigin} ${sfuOrigin}`.replace(/\s+/g, ' ').trim()
    : `connect-src 'self' ${storageOrigin} ${sfuOrigin}`.replace(/\s+/g, ' ').trim();

  // Thumbnails and image previews are served from storage too.
  const imgSrc = `img-src 'self' data: blob: ${storageOrigin}`.trim();

  const csp = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    imgSrc,
    // Remote video/audio tracks arrive as blob: MediaStreams.
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // The service worker is same-origin; without this the registration is
    // refused and push never works.
    "worker-src 'self'",
    "manifest-src 'self'",
  ].join('; ');

  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  if (!isDev) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const nonce = crypto.randomUUID().replace(/-/g, '');

  /**
   * For responses that RENDER a page, the nonce must reach Next on the REQUEST
   * headers — Next reads x-nonce there and stamps its inline hydration scripts
   * with it. Setting it only on the response means Next emits unnonced inline
   * scripts while the header demands a nonce, and the page is blank.
   */
  const nextWithNonce = () => {
    const headers = new Headers(req.headers);
    headers.set('x-nonce', nonce);
    return NextResponse.next({ request: { headers } });
  };

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return securityHeaders(nextWithNonce(), nonce);
  }

  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return securityHeaders(
        NextResponse.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Not authenticated' } }, { status: 401 }),
        nonce,
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return securityHeaders(NextResponse.redirect(url), nonce);
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    // Force password change before anything else.
    if (payload.mustChangePassword === true && !pathname.startsWith('/change-password')) {
      if (pathname.startsWith('/api/')) {
        return securityHeaders(
          NextResponse.json({ ok: false, error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Password change required' } }, { status: 403 }),
          nonce,
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = '/change-password';
      return securityHeaders(NextResponse.redirect(url), nonce);
    }
  } catch {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return securityHeaders(NextResponse.redirect(url), nonce);
  }

  return securityHeaders(nextWithNonce(), nonce);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts).*)'],
};
