# Android app

The platform is already an installable PWA. This wraps it as a Trusted Web
Activity so it can be distributed through Play.

A TWA is a Chrome shell around the live site — no separate codebase, no
separate release. Ship the web app and the Android app updates with it.

**Cost:** $25, once.

---

## 1 · Install Bubblewrap

```bash
npm i -g @bubblewrap/cli
```

Needs a JDK and the Android SDK. Bubblewrap offers to fetch both on first run;
accept.

## 2 · Initialise

```bash
cd mobile/android
bubblewrap init --manifest https://comma.massegat.com/manifest.webmanifest
```

⚠️ Take the values from `twa-manifest.json` in this folder rather than the
prompts' defaults — the package id (`com.newaeon.comms`) and colours must match
what ships, and changing the package id later means a new listing.

## 3 · Build

```bash
bubblewrap build
```

Produces:
- `app-release-bundle.aab` — for Play
- `app-release-signed.apk` — for direct install and testing

⚠️ **Install the APK on a real device and sign in before going further.** The
session cookie is `SameSite=Strict`; it should hold in a TWA, but a wrapper
that cannot keep you logged in is worse than a browser tab, and that failure
usually appears only after distribution.

## 4 · Digital asset links — the step everyone forgets

Without this the app opens **with the browser address bar visible**, which
defeats the entire exercise.

```bash
bubblewrap fingerprint list
```

Copy the SHA-256 into `public/.well-known/assetlinks.json`, replacing
`REPLACE_WITH_YOUR_SIGNING_KEY_SHA256`. Redeploy the site, then verify:

```bash
curl -s https://comma.massegat.com/.well-known/assetlinks.json
```

⚠️ **Play re-signs your app after upload.** Once the first build is in Play
Console, take the SHA-256 from **Setup → App integrity → App signing key
certificate** and **add it as a second entry in the array**. Both must be
present.

With only the local key, the address bar appears for everyone who installed
from Play — the exact people the wrapper was built for, and the one group you
will not have tested with.

## 5 · Distribute

Play Console → Create app → **Internal testing** → upload the `.aab`.

⚠️ Internal testing goes to a named email list with no review delay. For ten
colleagues that is the right track — Production invites a review you do not
need.

---

## What to check on a real device

- [ ] Sign in works and **survives closing the app**
- [ ] No address bar (this proves asset links verified)
- [ ] A file uploads
- [ ] A voice note records and plays
- [ ] A video call connects — camera and microphone prompts appear once
- [ ] Push notifications arrive ⚠️ untested end to end
- [ ] Arabic layout renders right-to-left

⚠️ The last two are the ones most likely to surprise you. Push has never been
exercised by real use on any platform, and RTL in a wrapper occasionally
differs from RTL in a browser tab.

---

## iOS

Not pursued. Apple's guideline 4.2 rejects apps that are primarily a
repackaged website, which this is. People on iPhones install the PWA instead:

**Safari → Share → Add to Home Screen.**

It gets its own icon and opens without browser chrome — the practical
difference from a store app is small, and it costs nothing.
