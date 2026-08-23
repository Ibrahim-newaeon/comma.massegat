// tests/global-setup.ts
// Next dev compiles routes on demand. The first test to touch an uncompiled
// route pays 30-60s of build time and blows its timeout — which reads as a
// failure of whatever that test happened to be asserting. Warming the routes
// once moves that cost outside the test bodies.
import { request } from '@playwright/test';

export default async function globalSetup() {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const ctx = await request.newContext({ baseURL: base });
  for (const route of ['/api/healthz', '/login', '/chat', '/admin/users', '/change-password']) {
    const t = Date.now();
    try { await ctx.get(route, { timeout: 120_000 }); console.log(`  warmed ${route} (${Date.now() - t}ms)`); }
    catch { console.log(`  could not warm ${route} — continuing`); }
  }
  await ctx.dispose();
}
