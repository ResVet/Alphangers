# Security

Alphangers is a public class portal. It holds no student data and has no user accounts except the admin. The goals are: nobody but the owner can change what the class sees, a broken or hostile content document cannot break or hijack the page, and visiting the site does not leak anything about the visitor to third parties.

Report a problem privately to the repository owner on GitHub rather than in a public issue.

## What is public

- Everything in this repository and the built site: schedule, lecturer names, specialties and phone numbers, Drive links and the try out bank. Lecturer phone numbers are published by the class's decision so classmates can reach lecturers about sessions. Student phone numbers are not in the data.
- The Firebase web config (see below). It identifies the project; it grants nothing.

## The portal page

- **One outside host.** Fonts, scripts, the 3D model and media are all served from the site. The only other host contacted is `firestore.googleapis.com`, for public reads of the five content documents, with `credentials: 'omit'` (and none at all while `firebaseConfig` is `null`). The portal end-to-end suite fails if any other host is requested.
- **Content Security Policy** (from `netlify.toml`):
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self'; connect-src 'self' https://firestore.googleapis.com; worker-src 'self'; manifest-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`.
  No inline scripts (the one bootstrap line lives in `public/boot.js`). `wasm-unsafe-eval` is needed only for the meshoptimizer decoder that unpacks the heart model. Inline styles are allowed because the page sets CSS custom properties from script; inline CSS cannot run code. The portal suite runs the built site under these exact headers and fails on any violation.
- **Other headers.** HSTS (two years, subdomains), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a Permissions-Policy that turns off camera, microphone, geolocation, payment and similar (motion sensors stay on for the hero's tilt effect), `X-Frame-Options: DENY` and `frame-ancestors 'none'` against clickjacking.
- **Rendering.** Content from Firestore or the cache is validated (next section) and then written with `textContent` and attributes. Where a module builds HTML strings for speed (the schedule and lecturer rows), every value passes through an escaping helper. Links are `https:` only and open with `rel="noopener noreferrer"`.
- **Storage.** The portal stores only conveniences on the visitor's device: the content cache, try out progress and scores, the last date picked in the schedule, and whether the intro has been seen. All of it is wrapped so a browser that blocks storage still gets a working page (covered by tests).
- **Service worker.** Same-origin GET requests only. It never caches `/admin/`, never touches other hosts, and is served with `Cache-Control: no-cache` so a fix reaches visitors on their next load.

## Firebase content store

The portal ships with bundled JSON for every content key and works without Firebase. When `src/lib/firebase-config.js` is filled in, the admin editor at `/admin/` writes edited copies to Firestore and the portal reads them over plain REST. This section covers what that adds to the attack surface.

### What is public, and why that is fine

- The web config (`apiKey`, `authDomain`, `projectId`, `appId`) is a set of identifiers, not credentials. It is committed on purpose. The API key is restricted in Google Cloud to the site's origins and to three APIs (Firestore, Identity Toolkit, Token Service).
- `content/{key}` allows `get` for the five known keys and nothing else. Listing the collection is denied. These documents hold the same kind of data the bundled JSON already publishes, including lecturer phone numbers, which are public by the owner's decision.
- `history/*` and `admins/*` are not public. `admins/{uid}` can only be read by that same user, and only to answer "am I an admin?".

### Who can write

A request is from an admin only if all of these hold, checked by `firestore.rules` on every write:

1. It carries a Firebase ID token.
2. The token says `email_verified == true`.
3. The sign-in provider is `google.com`.
4. `admins/{uid}` exists.

No client can write to `admins`. Admins are added and removed by hand in the Firebase console, and removal takes effect on the next write because the rule checks the document every time.

### Abuse of the public read path

Anyone can call the REST endpoint, so anyone can burn read quota and the monthly outbound transfer allowance. The rules limit reads to five fixed document ids, and every field of those documents is public (`json`, `rev`, `updatedAt`, and `updatedBy`, which is an admin's UID). The field mask is only what the portal asks for: a visitor who already holds a copy first asks for `rev` alone, which also returns the document's update time, and downloads `json` only when that time changed, so normal traffic stays small. A changed document therefore costs that visitor two reads once. If Firestore fails, rate limits, or times out (6 s), the portal keeps the copy it already has (localStorage, then bundled JSON) without an error. At worst visitors see stale content until the quota resets (reads daily, transfer monthly), and the admin cannot save until then. App Check is not enforced on Firestore, because the portal reads without the SDK and would be locked out; this is a deliberate trade-off.

### Hostile or broken documents

The portal does not trust Firestore. Every remote document, and every cached copy read back from localStorage, goes through `src/lib/validate.js`, the same validator the admin editor uses before saving. It enforces a strict schema per key, drops unknown fields, caps lengths, strips control and bidirectional override characters, accepts only `https:` URLs without credentials, restricts ids and lecturer codes to fixed patterns, limits heart part ids to the fixed list the 3D model knows, and rebuilds WhatsApp targets from the phone number so a document cannot point a chat button somewhere else. Parsing does not copy `__proto__` or other inherited keys. A document that fails is ignored with one console warning, and the portal keeps its fallback. The rules add a second bound: exactly four fields, typed, and `json` under 900,000 characters. Rendering stays the portal's job: content must go into the page through `textContent` and attributes, never `innerHTML`.

### Account takeover

Only a Google account on the allowlist can write, so a stolen password for any other account gets nothing. Google sign-in brings Google's own protections; admins should have 2-step verification on. If an admin account is taken over, the attacker can rewrite content and delete history entries. Recovery: remove the `admins/{uid}` document and disable the user in Firebase Auth, then use **Kembalikan ke bawaan** to fall back to the JSON in git, or import a previous export. The bundled JSON in the repository is a copy the attacker cannot touch from the site.

### Stale overwrites

Two tabs editing the same content cannot silently undo each other. Each document has a `rev` counter. A save runs in a Firestore transaction that re-reads `rev` and stops with a conflict if it moved; the editor then shows what changed on the server and offers merge, overwrite, or discard. The rules enforce the same thing server side, so a client that skips the check still cannot write: `rev` must equal the stored `rev + 1`, `updatedAt` must be the server time, and `updatedBy` must be the caller.

### Losing the audit trail

Every update and every delete must, in the same atomic write, create `history/{key}-{rev}-{millis}` holding the exact version being replaced. The rules check that the snapshot's `json` and `rev` match the stored document, that its id is derived from that version, and that the content document really moves to `rev + 1` (or is deleted) in the same batch. History entries cannot be edited. Admins can delete them, so history protects against mistakes. It is not a tamper-proof log if an admin account is compromised.

### XSS

The admin page has no inline scripts, no `eval`, and no `innerHTML`: all DOM is built with a small helper that refuses `innerHTML` and `outerHTML` and sets text as text. Its CSP is `script-src 'self' https://apis.google.com` (the second host is Firebase Auth's sign-in loader) and `style-src 'self'`, with `object-src 'none'`, `base-uri 'none'` and `form-action 'none'`. The Firebase SDK is bundled at build time; nothing else is loaded from a CDN. The portal's CSP allows no inline scripts either (`script-src 'self' 'wasm-unsafe-eval'`, the latter only for the 3D model decoder). It does allow inline styles, which the portal markup needs; inline CSS cannot run script. Because content URLs are `https:` only, `javascript:` links cannot reach either page.

### Clickjacking

Both pages send `frame-ancestors 'none'` and `X-Frame-Options: DENY`. `Cross-Origin-Opener-Policy` is `same-origin-allow-popups`, the strictest value that still lets the Google sign-in popup report back.

### Finding the admin page

`/admin/` is not linked from the portal and sends `noindex` (meta tag and `X-Robots-Tag`). That keeps it out of search results and nothing more. Access control comes from the rules.

### Secrets

There are none in the repository. The web config is public by design, there are no service account keys, and admin identity is a Firebase UID, not an email address. `.firebaserc` holds only the project id.

### Tests

`tests/firestore.rules.test.mjs` runs against the Firestore emulator and covers public reads, denied listing, non-admin and unverified writes, wrong providers, stale `rev`, missing or forged history snapshots, extra fields, spoofed authors and timestamps, oversized documents, resets, history immutability, the `admins` collection, and default deny. `tests/content.test.mjs` covers the portal's fallbacks (remote newer, invalid, network down, storage blocked, no config), and `tests/validate.test.mjs` covers the validator.

### Accepted risks

- A compromised admin account can rewrite content and delete history. Git and JSON exports are the backup.
- App Check is not enforced on Firestore, so read quota and outbound transfer can be burned by anyone. The portal degrades to cached or bundled content.
- The portal allows inline styles.
- If popups are blocked, sign-in falls back to a redirect, which can fail in browsers that block third-party storage unless the optional same-domain auth proxy in `netlify.toml` is set up. A redirect that comes back empty, and a browser that refuses storage to the auth domain outright (some private windows), each get their own message asking for popups or a normal window. This affects only the admin, and fails closed.

## Checklist when changing things

- A new HTML page needs its own CSP block in `netlify.toml`; header rules on Netlify are combined, so keep page rules on exact paths.
- New content fields go through `src/lib/validate.js` first, then the rules' size limit still applies.
- Never render content with `innerHTML` without the escaping helper.
- Run `npm run test:e2e` before deploying: it catches CSP violations, console errors and stray third-party requests.
