// src/lib/http.ts
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ForbiddenError } from '@/lib/authorize';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(code: string, message: string, status: number, extra?: object) {
  return NextResponse.json({ ok: false, error: { code, message, ...extra } }, { status });
}

/**
 * Never leaks a stack trace to the client. Full detail goes to server logs only.
 */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return fail('VALIDATION_ERROR', 'Invalid request', 400, {
      fields: err.flatten().fieldErrors,
    });
  }
  if (err instanceof ForbiddenError) {
    return fail('FORBIDDEN', 'You do not have permission to perform this action', 403);
  }
  console.error('[UNHANDLED]', err);
  return fail('INTERNAL_ERROR', 'Something went wrong', 500);
}
