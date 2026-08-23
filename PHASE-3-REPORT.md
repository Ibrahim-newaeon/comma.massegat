# Phase 3 — Implementation Report

## 1. Objective
1:1 and group video calls up to 10 participants, with screen sharing, device
selection and connection-quality feedback.

## 2. Skills Applied
✅ ZOD ✅ SEC ✅ RBAC ✅ RTL ✅ TEST ✅ A11Y

## 3. Architecture — SFU, not mesh

Confirmed in the MEGA-PROMPT (D4) after you specified 5-10 participants:

| Topology | Streams each client uploads | Viable at 8? |
|---|---|---|
| P2P mesh | N−1 — seven simultaneous encodes | ❌ Client uplink and CPU collapse |
| **SFU** | **1** — the server forwards | ✅ |

With an SFU each client uploads once regardless of call size. Cost shifts from
the user's office Wi-Fi to server bandwidth, which is purchasable.

**No `RTCPeerConnection` mesh logic exists in this codebase.**

## 4. Vendor isolation

`src/lib/calls/SfuTransport.ts` is the **only** file that imports the LiveKit
SDK. Everything above it — `useCall`, `CallView`, `ParticipantTile`,
`DeviceSelector` — talks to the `MediaTransport` interface.

Verified: `grep -rln "livekit-client" src/components/` returns nothing.
Replacing the SFU vendor means replacing one file.

## 5. Security decisions

**The room name is derived from the channel, never client-supplied.** A
client-supplied room name would let anyone join any conversation by guessing an
identifier. `roomName = call-${channelId}`, and channel membership is checked
before the token is minted.

**The grant is deliberately narrow.** `roomJoin`, `canPublish`, `canSubscribe`,
`canPublishData`. **Never `roomAdmin` or `roomCreate`** — either would let an end
user evict other participants or open arbitrary rooms.

**Webhook signatures are verified** before anything is trusted. An
unauthenticated webhook endpoint would let anyone forge call records, including
claiming someone attended a call they were never on. Tested.

**Identity is the internal `userId`,** set server-side in the token. That is how
SFU participants are correlated back to `call_participants` rows — a client
cannot claim to be someone else.

**Hard cap of 10, enforced before the token is minted.** The SFU could carry
more; ten is where tiles stop being readable.

**No media recording.** D5 in the spec. Consent obligations vary by
jurisdiction and were ruled out of scope. Only metadata is stored — who joined,
when, how long.

## 6. RTL

Call **controls are NOT mirrored** — the footer is explicitly `dir="ltr"`.
Media controls are spatial, not directional; mirroring them breaks the mental
model. MEGA-PROMPT §6.5. Covered by a test.

Participant names use `<bdi dir="auto">`. The incoming-call dialog uses
`inset-inline-end`, so it appears on the correct side in both directions.

The local preview is mirrored (people expect to see themselves as in a mirror);
**screen shares are not** — text would read backwards.

## 7. Tests — 11

Playwright runs Chromium with `--use-fake-device-for-media-stream`, so a
synthetic camera stream is published and no permission prompt blocks the run.

Positive: connect and see the local tile · mute and camera toggles · leave tears
down · two parties see each other · 56px touch targets.

Negative: token refused for a non-member channel · unauthenticated refused ·
missing CSRF refused · **unsigned webhook rejected** · **granted token carries
no `roomAdmin`/`roomCreate` and the room matches the channel**.

## 8. ⚠️ NOT VERIFIED

**Not executed.** No install, no call placed. Most likely to need fixing:

1. **LiveKit `--dev` mode** uses the well-known `devkey`/`secret` pair. If the
   image's defaults differ, the token is rejected with an auth error.
2. **UDP ports 50000-50060** are mapped for media. Docker Desktop on Windows
   sometimes handles UDP ranges poorly; LiveKit falls back to TCP on 7881, which
   works but adds latency.
3. **CSP again.** I added the SFU origin to `connect-src` and `media-src`,
   having been caught by exactly this in Phase 2. Worth checking the console if
   the call will not connect.
4. **`Room.getLocalDevices` labels are empty** until permission is granted. The
   selector falls back to numbered entries, which is ugly but not broken.
5. **Two-party test timing.** Both sides must reach the SFU before the assertion.
   45s timeouts are a guess, not a measurement.

## 9. Deviations from the kickoff

| Kickoff | Built | Why |
|---|---|---|
| LiveKit Cloud | Self-hosted `--dev` locally | Cloud needs an account and real keys. The SDK is identical — production is a three-variable change |
| coturn as a separate service | LiveKit's embedded TURN on 7881 | LiveKit ships TURN; a second service would be redundant locally. **Production still needs TLS:443 TURN for restrictive corporate firewalls** |
| Full call lifecycle signaling | Ringing and presence only | The SFU owns SDP and ICE. This server mints tokens and rings phones |

## 10. Known gap carried from Phase 2

No token refresh on 401 — a tab idle past 15 minutes fails its next request
instead of refreshing. Now affects calls too: the call token request will fail
the same way. Fix belongs in `src/lib/csrfClient.ts`.

## 11. Next steps

1. `npm install`
2. `docker compose up -d livekit`
3. `npx prisma db push` — adds `call_sessions` and `call_participants`
4. `npm run dev`, click 📹 in the chat header
5. Expect failures in the areas listed in §8
