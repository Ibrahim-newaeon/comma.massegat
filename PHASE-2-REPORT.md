# Phase 2 — Implementation Report

## 1. Objective
Attach a file to a message, have the recipient download it, ensure infected
files never reach anyone, and keep Arabic filenames intact end to end.

## 2. Skills Applied
✅ ZOD ✅ SEC ✅ SQL ✅ RBAC ✅ RTL ✅ TEST ✅ DOCKER ✅ A11Y

## 3. What was built

| Area | Files |
|---|---|
| Policy — allowlist, blocked extensions, RFC 5987 | `src/lib/files/policy.ts` |
| Object storage — presign, head, delete | `src/lib/files/storage.ts` |
| ClamAV INSTREAM client | `src/lib/files/clamav.ts` |
| Magic-byte verification | `src/lib/files/magic.ts` |
| Quotas | `src/lib/files/quota.ts` |
| API | `presign`, `[id]/complete`, `[id]/download`, `quota` |
| Scan worker | `worker.mjs` |
| Client upload | `src/lib/files/upload.ts` |
| UI | `AttachmentChip`, `UploadTray`, Composer, MessageBubble |
| Infra | MinIO + ClamAV in docker-compose |
| Tests | `tests/files.spec.ts` — 13 tests |

## 4. Security decisions

**Magic bytes over declared type.** A client controls the extension and the
`Content-Type` header; it does not control the first bytes of the file. An
executable renamed `.png` reaches `verifyMagicBytes` and is rejected before
the scan even runs. The VERIFIED type is what gets stored.

**Allowlist, never blocklist.** A blocklist is a list of the attacks you thought
of. Blocked extensions are checked *in addition*, because Windows decides what
to execute largely from the extension regardless of content.

**No inline HTML or SVG.** Both execute script. Every download carries
`Content-Disposition: attachment`, so an uploaded file is saved, never rendered.
Otherwise an upload becomes stored XSS.

**Fail closed.** A scan error leaves the file undownloadable. Infected objects
are deleted from storage, not merely flagged — a flag can be bypassed by
anything that later reads storage directly.

**Checks before bytes move.** Authorization, quota, size and type are all
verified at presign. Checking after the upload means paying for storage you
then have to reclaim.

**Download authorization is re-checked at request time.** Membership can be
revoked between upload and download.

**Presigned TTLs are short.** Five minutes to upload, sixty seconds to
download. A leaked URL has a small window.

## 5. Arabic filenames

`Content-Disposition` is a Latin-1 header. `filename="تقرير.pdf"` is mangled or
dropped. RFC 5987's `filename*=UTF-8''<percent-encoded>` carries it correctly,
with a plain ASCII `filename=` alongside for older clients.

Object keys are ASCII-sanitised — raw UTF-8 in a key causes signature
mismatches with some S3 implementations. The original name lives in the
database and is what the user sees and downloads.

Display uses `<bdi dir="auto">`, without which the `.pdf` extension jumps to
the wrong end of an Arabic filename.

## 6. Worker design

`BRPOPLPUSH` moves the job to a processing list rather than removing it, so a
worker that dies mid-scan does not silently lose the file. Orphans are
recovered at startup.

Runs as its own process: a scan that hangs cannot block HTTP requests, and it
can be restarted independently.

Thumbnail failure does not block a clean file — a thumbnail is a nicety.

## 7. ⚠️ NOT VERIFIED

**This code has not been executed.** No install, no build, no test run, no
upload. Phase 1 taught what that means: eight bugs invisible from reading.

Most likely to need fixing:

1. **ClamAV first start takes several minutes** to download its ~250MB
   signature database. Until the healthcheck passes, every upload is marked
   `error`. `docker compose logs -f clamav` shows progress.
2. **`sharp` on Windows** may need a rebuild — it ships prebuilt binaries but
   they do not always match. `npm rebuild sharp` if thumbnails fail.
3. **MinIO presigned PUT and CORS.** The browser PUTs cross-origin to
   `localhost:9000`. MinIO allows this by default, but a stricter setup will
   need a CORS policy.
4. **`file-type` is ESM-only.** It should import cleanly in a route handler; if
   Next complains, it needs adding to `serverExternalPackages`.
5. **The EICAR test needs a working scanner.** It skips when
   `CLAMAV_ENABLED=false`, so a green suite does not by itself prove quarantine
   works — check that test did not skip.

## 8. Deviations from the kickoff

| Kickoff | Built | Why |
|---|---|---|
| PDF first-page thumbnails | Images only | PDF rasterisation needs poppler or pdfium — a system dependency on every machine. Images cover the common case |
| Scan enqueued at complete | Same, plus orphan recovery | A worker crash would otherwise lose the job silently |
| — | Added `declaredMimeType` column | Keeps what the client claimed, so a mismatch is auditable rather than overwritten |

## 9. Next steps

1. `npm install && npm rebuild sharp`
2. `docker compose up -d minio clamav` — then wait for ClamAV's healthcheck
3. `npx prisma db push` to add the attachments table
4. `npm run dev` and `npm run worker` in separate terminals
5. Upload something; expect failures in the areas listed in §7

---

## 10. First run — what broke

Two bugs, both found within minutes of starting the server.

| Bug | Why it was invisible until runtime |
|---|---|
| `async function process()` in `worker.mjs` shadowed Node's global `process` object, so `process.env` was undefined | Parsed correctly, passed `node --check`. Function declarations hoist and take precedence over globals |
| CSP `connect-src 'self'` blocked the browser's direct PUT to storage | I added the upload feature without widening the policy to include the storage origin |

The second is worth keeping: **the CSP did exactly its job.** It refused an
outbound connection to an origin the application had not declared. A policy
loose enough not to notice would have been the worse outcome.

## 11. Verified working

| Stage | Evidence |
|---|---|
| Presign → direct PUT | Upload reached MinIO |
| Magic-byte verification | `complete` accepted a real JPEG |
| Redis queue → worker | `scanning 1.jpeg (53 KB)` |
| ClamAV clean path | `✓ clean 1.jpeg (+thumbnail)` |
| **ClamAV infected path** | `⚠ INFECTED eicar.txt — Eicar-Test-Signature, object deleted` |

The last line is the one that matters. A scanner that only ever returns "clean"
proves nothing; EICAR proves the quarantine path actually runs.

## 12. Still unverified

- [ ] Executable disguised as `.png` rejected at `complete` (magic-byte mismatch)
- [ ] Arabic filename round trip — upload, download, saved name intact
- [ ] Server-side 403 on downloading an infected file (attempted, but the
      session had expired and returned 401 before reaching the check)
- [ ] `tests/files.spec.ts` — 13 tests, never run

## 13. Known gap — no token refresh on 401

The client does not retry against `/api/auth/refresh` when a request returns
401. A tab left open past the 15-minute access-token lifetime shows "Network
error during upload" instead of silently refreshing.

Affects chat as well as files. Not a Phase 2 defect — it has been there since
Phase 0 and only became visible now, because uploads are the first thing a user
does after a long idle period.

**Fix belongs in `src/lib/csrfClient.ts`:** on 401, POST to `/api/auth/refresh`
once, then replay the original request. Retry exactly once — a refresh loop on
a genuinely dead session is worse than a clear error.
