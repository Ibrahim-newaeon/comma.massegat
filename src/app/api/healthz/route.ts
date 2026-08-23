// src/app/api/healthz/route.ts
// Liveness. Returns no sensitive information.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok' });
}
