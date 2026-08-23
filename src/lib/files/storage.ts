// src/lib/files/storage.ts
// S3-compatible object storage. MinIO locally, real S3 in production —
// only the endpoint changes.
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/env';

const globalForS3 = globalThis as unknown as { s3?: S3Client; s3Internal?: S3Client };

export const s3 =
  globalForS3.s3 ??
  new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,   // MinIO requires this
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });

/**
 * The client the SERVER uses to read and write objects directly.
 *
 * Presigned URLs must be signed with the PUBLIC endpoint — a browser has to be
 * able to reach them. But the server reading an object back for magic-byte
 * verification should talk to storage directly: routing that through a public
 * hostname sends the request out to the CDN and back through the tunnel to
 * reach a container on the same Docker network, and it fails on DNS, on
 * access control, or on the proxy.
 *
 * Falls back to the public endpoint when unset, so a local setup needs no
 * extra configuration.
 */
export const s3Internal =
  globalForS3.s3Internal ??
  (env.S3_INTERNAL_ENDPOINT
    ? new S3Client({
        endpoint: env.S3_INTERNAL_ENDPOINT,
        region: env.S3_REGION,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
      })
    : s3);

if (process.env.NODE_ENV !== 'production') {
  globalForS3.s3 = s3;
  globalForS3.s3Internal = s3Internal;
}

export const BUCKET = env.S3_BUCKET;

/** Idempotent. Called at boot so a fresh MinIO volume works without setup. */
export async function ensureBucket(): Promise<void> {
  try {
    await s3Internal.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3Internal.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log(`> created bucket ${BUCKET}`);
  }
}

/** Short TTL: a leaked upload URL is only useful for five minutes. */
export function presignPut(key: string, contentType: string, ttlSeconds = 300) {
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), {
    expiresIn: ttlSeconds,
  });
}

/**
 * Download URLs carry Content-Disposition and nosniff so the browser saves the
 * file rather than rendering it. An uploaded HTML file must never execute.
 */
export function presignGet(key: string, disposition: string, contentType: string, ttlSeconds = 60) {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: disposition,
      ResponseContentType: contentType,
    }),
    { expiresIn: ttlSeconds },
  );
}

export async function headObject(key: string) {
  try {
    const r = await s3Internal.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { exists: true as const, size: Number(r.ContentLength ?? 0) };
  } catch {
    return { exists: false as const, size: 0 };
  }
}

export async function getObjectBytes(key: string, maxBytes?: number): Promise<Buffer> {
  const r = await s3Internal.send(new GetObjectCommand({
    Bucket: BUCKET, Key: key, ...(maxBytes ? { Range: `bytes=0-${maxBytes - 1}` } : {}),
  }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of r.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3Internal.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(key: string) {
  await s3Internal.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
