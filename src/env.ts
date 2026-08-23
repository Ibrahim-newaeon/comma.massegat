// src/env.ts
// Zod-validated environment. Fails loudly and specifically at boot.
//
// Windows note: values edited in Notepad can carry a trailing \r. Every string
// here is .trim()'d so a CRLF line ending cannot produce a cryptic failure.
import { z } from 'zod';

/** Decodes base64 and asserts an exact byte length. Length-in-chars is not enough. */
function base64Bytes(expectedBytes: number, varName: string) {
  return z
    .string()
    .trim()
    .refine((v) => !v.startsWith('CHANGE_ME'), {
      message: `${varName} is still the placeholder from .env.example. Generate one: openssl rand -base64 ${expectedBytes}`,
    })
    .refine(
      (v) => {
        try {
          return Buffer.from(v, 'base64').length === expectedBytes;
        } catch {
          return false;
        }
      },
      {
        message: `${varName} must be base64 that decodes to exactly ${expectedBytes} bytes. Generate: openssl rand -base64 ${expectedBytes}  (no quotes, no trailing space)`,
      },
    );
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().trim().url('DATABASE_URL must be a valid postgresql:// URL'),
  REDIS_URL: z.string().trim().url('REDIS_URL must be a valid redis:// URL'),

  JWT_SECRET: z
    .string()
    .trim()
    .refine((v) => !v.startsWith('CHANGE_ME'), {
      message: 'JWT_SECRET is still the placeholder. Generate: openssl rand -base64 48',
    })
    .refine((v) => v.length >= 32, {
      message: 'JWT_SECRET must be at least 32 characters. Generate: openssl rand -base64 48',
    }),

  TOTP_ENCRYPTION_KEY: base64Bytes(32, 'TOTP_ENCRYPTION_KEY'),

  APP_URL: z
    .string()
    .trim()
    .url('APP_URL must be a full URL including protocol, e.g. http://localhost:3000')
    // Trailing slash would produce double-slash setup links.
    .transform((v) => v.replace(/\/+$/, '')),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),      // 15 min
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000), // 30 days
  SETUP_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),     // 24 h

  // ── Phase 2: files ────────────────────────────────────────────────────
  /**
   * Where the SERVER reaches storage. Defaults to S3_ENDPOINT.
   *
   * Set this when the public endpoint is a hostname that only makes sense from
   * a browser — behind a tunnel or a CDN, the server would otherwise route its
   * own reads out to the internet and back to reach a container beside it.
   *
   *   S3_INTERNAL_ENDPOINT=http://localhost:9000
   */
  S3_INTERNAL_ENDPOINT: z.string().trim().optional(),
  S3_ENDPOINT: z.string().trim().url().default('http://localhost:9000'),
  S3_REGION: z.string().trim().default('us-east-1'),
  S3_BUCKET: z.string().trim().default('comms-files'),
  S3_ACCESS_KEY: z.string().trim().min(3),
  S3_SECRET_KEY: z.string().trim().min(8),
  /** MinIO needs path-style addressing; real S3 does not. */
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  CLAMAV_HOST: z.string().trim().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  /** Set false only if you accept unscanned files reaching users. */
  CLAMAV_ENABLED: z.coerce.boolean().default(true),

  MAX_FILE_BYTES: z.coerce.number().int().positive().default(104857600),      // 100 MB
  USER_QUOTA_BYTES: z.coerce.number().int().positive().default(10737418240),  // 10 GB
  CHANNEL_QUOTA_BYTES: z.coerce.number().int().positive().default(53687091200), // 50 GB

  // ── Phase 3: video ────────────────────────────────────────────────────
  /** Browser-facing URL. ws:// locally, wss:// in production. */
  LIVEKIT_URL: z.string().trim().default('ws://localhost:7880'),
  LIVEKIT_API_KEY: z.string().trim().min(3),
  /** Server-side only. Never sent to a client. */
  LIVEKIT_API_SECRET: z.string().trim().min(8),
  /** Hard cap. Mesh was rejected; an SFU handles this comfortably. */
  MAX_CALL_PARTICIPANTS: z.coerce.number().int().min(2).max(50).default(10),
  /** Room tokens are short-lived; a leaked one has a small window. */
  CALL_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(21600),  // 6h

  // ── Phase 4: notifications and retention ──────────────────────────────
  /// Generate with: npm run vapid
  VAPID_PUBLIC_KEY: z.string().trim().optional(),
  VAPID_PRIVATE_KEY: z.string().trim().optional(),
  /// Must be a mailto: or https: URL — push services reject anything else.
  VAPID_SUBJECT: z.string().trim().default('mailto:admin@example.com'),

  /// Retention. 0 disables that sweep entirely.
  RETENTION_FILES_MONTHS: z.coerce.number().int().min(0).default(24),
  RETENTION_AUDIT_MONTHS: z.coerce.number().int().min(0).default(24),
  RETENTION_PURGE_DELETED_DAYS: z.coerce.number().int().min(1).default(30),

  /// Only read by docker-compose, not by the app. Declared so a typo here
  /// surfaces at preflight rather than as a tunnel that silently never starts.
  /// Whether a proxy in front is REWRITING forwarding headers.
  /// false means client-supplied headers are ignored entirely — see
  /// requestContext() in src/lib/audit.ts for why that matters.
  /// ⚠️ NOT z.coerce.boolean(): that treats the STRING "false" as true,
  /// because every non-empty string is truthy. TRUST_PROXY=false would then
  /// enable proxy trust — exactly inverting the safe default.
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  CLOUDFLARE_TUNNEL_TOKEN: z.string().trim().optional(),

  /// Comma-separated domains that may self-register, e.g. "new-aeon.com,al-ai.ai".
  /// EMPTY DISABLES SIGNUP ENTIRELY — the safe default. An open form on a
  /// reachable URL is an open door, so this must be an explicit decision.
  SIGNUP_ALLOWED_DOMAINS: z.string().trim().default(''),
  /// false: new accounts wait for an admin. true: they are usable immediately.
  /// Only sensible when Cloudflare Access (or equivalent) already proves the
  /// person's identity before they reach the form.
  SIGNUP_AUTO_APPROVE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  BOOTSTRAP_ADMIN_EMAIL: z.string().trim().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().optional(),
});

/**
 * Docker build-time bypass.
 *
 * `next build` imports this module to compile pages, but a container build has
 * no runtime configuration — Railway, Fly and every other platform inject
 * variables when the container STARTS, not when the image is built. Validating
 * here fails the build with "APP_URL: Required" for variables that are
 * correctly set.
 *
 * Set only in the Dockerfile builder stage. The runtime container never sets
 * it, so a genuinely misconfigured deployment still refuses to start — which
 * is the behaviour worth keeping.
 */
const SKIP = process.env.SKIP_ENV_VALIDATION === 'true';

const parsed = SKIP
  ? EnvSchema.partial().safeParse(process.env)
  : EnvSchema.safeParse(process.env);

if (!parsed.success && !SKIP) {
  const fields = parsed.error.flatten().fieldErrors;
  console.error('\n❌ Invalid environment configuration\n');
  for (const [key, messages] of Object.entries(fields)) {
    for (const msg of messages ?? []) console.error(`  • ${key}: ${msg}`);
  }
  console.error('\n  Fix .env, then restart. See .env.example for generation commands.\n');
  process.exit(1);
}

// Cast back to the full type: with SKIP the parse is partial, and without the
// cast every consumer would see `string | undefined` and fail type checking.
// At runtime SKIP is never set, so the values are real.
export const env = parsed.data as z.infer<typeof EnvSchema>;

/**
 * Warns when APP_URL does not match the port the server actually bound to.
 * A mismatch silently breaks admin setup links — they are built from APP_URL.
 */
export function warnOnPortMismatch(actualPort: string | number) {
  try {
    const configured = new URL(env.APP_URL).port || '80';
    if (String(actualPort) !== configured) {
      console.warn(
        `\n⚠️  APP_URL is ${env.APP_URL} but the server is on port ${actualPort}.\n` +
          `   Admin setup links will point to the wrong port.\n` +
          `   Fix: set APP_URL=http://localhost:${actualPort} in .env\n`,
      );
    }
  } catch {
    /* URL already validated above */
  }
}
