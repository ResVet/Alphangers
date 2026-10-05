# Architecture

Alphangers is a static site. Everything a visitor sees ships in the build; Firebase only replaces the bundled copy of the content with a newer, validated one when it is configured. This document covers how the page is assembled, where content comes from, and how the 3D heart is made and drawn.

## The page

`index.html` holds the markup for every section, so the page is readable before any script runs and still makes sense with JavaScript off. `src/main.js` then:

1. Starts the v3 shell (`src/legacy/app.js`): loader, hero, channel list, try out, the scroll-driven heartbeat section and the sound toggle. v3 was a single hand-written HTML file; it was moved into modules with its behaviour kept, and its data (channels, try out bank, media) now comes from the same sources as everything else.
2. Mounts the newer sections. The announcement board and schedule mount at once, because they sit under the hero. The lecturer list, the heart, the divisions and the class photo mount when they come within a screen or so of the viewport (`IntersectionObserver`), so a visitor who only wants today's schedule never downloads three.js. The heart's model file is prefetched once the lecturer list is reached, so it is usually in cache by the time the explorer opens.
3. Applies the page texts the admin changed (`src/lib/texts.js`, see below) to the static markup and to each section as it mounts.
4. Wires the search palette, which is loaded the first time it is opened and can mount a section early when a result lives there.
5. Loads the live editor, but only for an admin (see [The live editor](#the-live-editor)).
6. Registers the service worker in production builds.

Each section is a module with the same contract:

```js
const view = mountX(rootElement, { ...contentKeys, portal });
view.update({ ...freshContent });   // when the admin publishes a change
view.destroy();
```

Sections talk to each other with one DOM event, `alpha:open`, instead of importing each other. The schedule sends `{ type: 'dosen', id }` when a lecturer's name is tapped; the lecturer list answers by opening that person. A lecturer's session list sends `{ type: 'date', date, uid }` and the schedule jumps to that day and highlights the session. Search uses the same event.

### Section order

Hero, announcements, **Jadwal**, **Drive** (the channel list), **Dosen**, the heartbeat walkthrough, **Jantung 3D**, **Divisi**, the class photo, footer. The schedule is first because "what is on today" is the most common reason to open the site.

### Divisions, photos and the class photo

`src/features/divisi/` draws one chapter per division: name, full name, a short line and the description on one side, and on the other a stack of up to three prints. The arrows, a swipe or the arrow keys toss the top print to the back of the stack (Web Animations API, transforms only). Empty slots show a labelled placeholder until the admin adds a photo. The prints tilt with the pointer, float only while the chapter is near the viewport, and the chapters slide in with scroll-driven CSS (`animation-timeline: view()`) where the browser supports it.

Every photo is a record, not just a URL: `src`, a `set` of smaller copies for `srcset`, the `full` original, its size, `alt`, a tiny blurred `lq` preview as a data URI and the dominant colour. `src/lib/photo.js` turns a record into a `<picture>` that shows the colour and the blurred preview until the real file arrives. Bundled photos are prepared by `scripts/media.mjs` (sharp: AVIF and WebP at 640, 1280 and 2000 px, original copied byte for byte); uploaded ones by the editor (below).

`src/features/viewer/` is the full view shared by divisions and the class photo: a `<dialog>` that grows out of the tapped image, pinch and double-tap zoom, wheel zoom and drag on desktop, swipe between photos, swipe down to close, a filmstrip, and the back button closes it. It starts with the size already on screen and swaps in the original once the photo is zoomed past 1.3×, so the HD file is only downloaded when someone wants the detail.

The class photo (`#kelas`) is plain markup in `index.html` with a scroll-driven entrance; `src/features/kelas/` only adds the tap-to-zoom and swaps in a newer photo when the admin sets one.

### Styling

Design tokens live in `src/styles/tokens.css` (colours, type, radii, easing). The palette is the v3 one: near-black green, a single bright green accent, warm red and amber only for meaning (exam, deadline). Type is Bricolage Grotesque for display, Instrument Serif italic for the emphasised half of each heading (a v3 signature), Archivo for body text and JetBrains Mono for labels and numbers. All fonts are self-hosted from `@fontsource`, so the page makes no font requests to other hosts. New modules scope their CSS under one class (`.jw`, `.dz`, `.hx`, `.fd`, `.ib`) and use container queries where layout depends on the section's own width.

## Content

Five content keys: `links`, `announcements`, `schedule`, `dosen`, `heart`. Besides the channel list, `links` carries `site.t` (page texts the admin changed, keyed by the `data-k` attribute of the element they replace), `site.photo` (the class photo) and `divisi` (the divisions and their photos). Each is optional; without them the page uses the text in the markup and `src/data/divisi.json`. Schedule sessions may carry `batal` (cancelled) and `alasan` (the reason).

```
            bundled JSON (src/data)                    always present, in the build
                     │
localStorage cache ──┼──▶ load(key) ──▶ section renders at once
                     │
Firestore REST ──────┘     (6 s timeout, field mask, no cookies)
      │
      └─▶ validate.js ──▶ differs from what is shown? ──▶ subscribers re-render
```

`src/lib/content.js` answers `load(key)` immediately from the best copy on hand, then asks Firestore for the current document. A remote copy is used only if it passes `src/lib/validate.js`, the same validator the admin runs before saving. A missing document means "use the bundled copy" (that is how the admin's reset works). The localStorage copy keeps the document's update time; on the next visit the portal first asks for the `rev` field alone (Firestore still returns the update time) and downloads `json` only if the time changed. With `firebaseConfig` left `null`, the portal makes no network requests at all. `inject(key, data)` lets the live editor show its draft through the same path: subscribers re-render with the draft, and a remote copy arriving later does not overwrite it.

### Page texts

Every heading and paragraph in the static markup that the admin may change has a `data-k` key (`hero.lede`, `siklus.h1`, `foot.credit` and so on); sections that build their own headings give them keys too. `src/lib/texts.js` keeps the admin's replacements from `links.site.t` and writes them with `textContent` (never HTML) into matching elements, now and whenever a section mounts or re-renders. Removing a replacement restores the original text, which it remembers.

### Where the data came from

- **Schedule.** The three block schedules (a PDF and two spreadsheets) were transcribed by hand into `content/jadwal/blok-*.txt`, one session per line, and checked against the originals. `scripts/build_data.py` turns them into `src/data/schedule.json`: blocks with dates, room and coordinator, days with sessions, session kind, lecturer codes and notes. Where the official sheet itself was ambiguous (two sessions in one slot, "sampai selesai" end times) the transcript keeps a note and the UI shows it.
- **Lecturers.** The faculty contact sheet, merged with the codes used in each block, into `src/data/dosen.json`. Names are normalised for sorting (titles such as dr., Prof. and degrees are ignored), phones are stored in three forms (dialable, display, WhatsApp). Lecturer phone numbers are public by the class's decision; student numbers are not included.
- **Try out bank.** `content/bank/bank.json`, curated from the class's question sets with explanations, lazily imported when the try out opens.

### Schedule model

`src/lib/schedule-model.js` is pure (no DOM) and covered by unit tests. It resolves lecturer codes per block, gives every session a stable id and a reference back to its place in the document (block, date, index) for the editor, and answers questions such as "what is on now and next", "next exam", "which sessions does this lecturer teach here", and text search. Cancelled sessions stay in the day but are skipped by "now and next" and the exam countdown, are found by searching "batal", and are exported with `STATUS:CANCELLED`. All times are Palembang time: a session at 08.00 starts at 08.00 WIB whatever time zone the phone is set to. `src/lib/ics.js` writes RFC 5545 calendar files (with line folding and escaping) and Google Calendar links.

## The 3D heart

The heart is original work, modelled in code rather than downloaded, so every part could be given an id, a correct position and content.

### Building the model (`scripts/heart/`)

1. **Sculpt** (`anatomy.py`, `sdf.py`, `build_heart.py`). Chambers, walls, septa and great vessels are signed distance fields in centimetres, in a patient frame (+x patient left, +y superior, +z anterior), combined with smooth unions and subtractions. Chamber cavities are subtracted from the wall, so the model has real inner surfaces for the cut views. Marching cubes (scikit-image) meshes it; the mesh is simplified to 150 000 faces.
2. **Label** (`label_heart.py`). Every vertex gets one of 55 part ids from `parts.py`, plus a flag for "inner (endocardial) surface".
3. **Grooves and vessels** (`grooves.py`, `vessels.py`). The atrioventricular and interventricular grooves are found on the surface, and the coronary arteries and cardiac veins are swept as tubes along them, with outward winding so back-face culling works.
4. **Internals** (`internals.py`). Valve leaflets, chordae, papillary muscles, the moderator band and the conduction system (SA node to Purkinje fibres) as tubes and sheets. It also computes an activation time in milliseconds for every vertex, following the conduction sequence: atria outward from the SA node (the left atrium through Bachmann's bundle), the AV node delay, His bundle and bundle branches, then the ventricles outward from the Purkinje network with the endocardium ahead of the epicardium, and traces the blood flow routes.
5. **Export** (`export_glb.py`). Four meshes (body, coronary, valves, conduction) with three custom vertex attributes: `_PART` (part id), `_T` (activation time) and `_AO` (ambient occlusion baked by marching rays through a voxelised copy of the surfaces). Normals are computed on the welded mesh so part borders do not show seams.
6. **Pack** (`pack.mjs`). glTF Transform reorders, quantises positions to 14 bits and normals to 10, and compresses with meshoptimizer: 4.7 MB raw to 908 KB.

`npm run heart` runs the whole chain. `python3 scripts/heart/content.py` writes the medical notes to `src/data/heart-parts.json`.

### Drawing it (`src/features/anatomi/`)

- **Materials.** One `MeshPhysicalMaterial` per mesh with an `onBeforeCompile` patch. Part colours are a uniform array indexed by the vertex's part id, so recolouring, hiding or highlighting a part is a uniform change, not a new material. The same patch draws the cut faces (back faces seen through a clipping plane are shaded as cut muscle), the x-ray look, and the depolarisation wave: a bright front where `uTime` passes the vertex's activation time and a held glow until repolarisation, synced to the ECG strip under the model.
- **Picking.** On tap, the scene is rendered once more with an override material that writes part id into an 11 by 11 pixel target around the pointer; the nearest non-empty pixel wins. It respects the cut plane, prefers the thin inner structures in the electrical view, and costs one tiny draw per tap. The pixels are read back asynchronously where WebGL2 allows it, so a tap never stalls the main thread waiting on the GPU; hover picking is throttled to one read in flight.
- **Shaders.** The four meshes share one shader program (the mesh kind is a uniform) instead of one each. The solid body, the see-through body and the picking shader are compiled while the loading bar is still up, in parallel off the main thread where the browser has `KHR_parallel_shader_compile`, and setup yields to the page between steps so scrolling stays responsive while the explorer loads.
- **Modes.** Whole, Cut (three presets plus a slider), Electrical (see-through walls, conduction system lit, ECG playing, slow motion and scrubbing) and Blood flow (particles along the traced routes, blue before the lungs and red after, speed following systole and diastole).
- **Power.** Rendering is on demand: frames are drawn only while something moves (camera, wave, flow, the short pulse after a pick). Off screen or in a hidden tab the loop stops. Still frames render at the full pixel ratio (capped at 2, 1.5 on low-power devices). While the heart moves it renders at a lower ratio that a frame timer adjusts to the GPU, and the first still frame after a movement is redrawn sharp. The idle spin draws every other frame. On a CPU-only WebGL fallback the scene drops to 0.75 and starts paused.
- **Touch.** One finger rotates, two fingers zoom; a vertical swipe that starts on the model still scrolls the page (`touch-action: pan-y`), so the explorer never traps the scroll. In full screen the model takes every gesture.
- **Fallbacks.** No WebGL: a still image of the model and the full part list and notes. Reduced motion: no idle spin, no auto-play, instant camera moves. Lost GPU context: handled and restored.

## The rest of the page

The v3 shell (`src/legacy/`) runs one `requestAnimationFrame` loop for the hero, the heartbeat walkthrough and the footer. It caches every offset it needs (re-measured by a `ResizeObserver`, never during a frame), writes a style only when the value changed, and goes to sleep after a dozen frames with nothing to animate; scroll, pointer and resize wake it. The hologram heart in the hero is a raymarched signed distance field in WebGL1; its resolution follows a pixel budget per device class and a frame-time median, and each vessel group is skipped outside its bounding sphere. The ECG strip batches its canvas draws by alpha. Sections off screen pause their CSS animations (`hero-off`, `foot-off`, `jw-off` classes and `animation-play-state`).

## The live editor

`src/edit/` is downloaded only after the footer's Admin button, a visit to `/?admin`, `Ctrl Shift E`, or on a device where an admin signed in before. Visitors never load it or the Firebase SDK.

- **`editor.js`** signs in with Google, checks `/admins/{uid}`, loads every content document with its revision, and draws the dock: Lihat or Edit, undo and redo, the count of unpublished changes, Terbitkan. Publishing uses the same Firestore transaction as `/admin/` (history snapshot plus revision check); if someone else published in between, the admin chooses whose version wins.
- **`store.js`** keeps a draft per content key. Every change runs the full validator before it is accepted, goes on the undo stack, and is shown through `content.inject`, so the page re-renders exactly as it will look after publishing. Unpublished drafts survive a reload.
- **`overlay.js`** finds what is under the pointer through adapters, outlines it, and shows its actions. Texts with a `data-k` key are edited in place (`contenteditable="plaintext-only"`, committed on blur). In edit mode clicks on links and cards are intercepted so they select instead of navigate.
- **`adapters.js`** knows each kind of thing on the page (a session, a block, a lecturer, a channel, an announcement, a heart part, a division, a photo, the class photo) and how to turn it into a form and back into the document. `sheet.js` draws the forms and dialogs.
- **`media.js`** prepares uploads in the browser. The original, for the zoom view, keeps its exact pixels: EXIF, GPS, XMP and maker notes are cut out of the JPEG, PNG or WebP file without re-encoding it. Only a photo that is stored sideways (EXIF orientation) or is too large is re-encoded, upright, at quality 0.94. Then come 640, 1280 and 2048 px WebP copies for `srcset`, the blurred preview and the dominant colour, and each file goes to the upload function.

### Photo uploads (`netlify/`)

`netlify/functions/media-upload.mjs` (`POST /api/media`, `DELETE /api/media/:key`) accepts a request only from the site's own origin with a Firebase ID token, verifies the token's RS256 signature against Google's published keys, issuer, audience and expiry (`netlify/lib/auth.mjs`, WebCrypto, no SDK), and checks that the user is in `/admins` by reading Firestore with the caller's own token. It then sniffs the real file type from its first bytes, refuses anything that is not JPEG, PNG, WebP or AVIF or is over 5.8 MB, and stores it in Netlify Blobs under a key made from the SHA-256 of the bytes, so the same file uploaded twice is stored once and a key can never be guessed or overwritten. Requests are rate limited per IP by Netlify and per admin inside the function. `netlify/functions/media.mjs` serves `/media/:key` with immutable caching and a sandboxing CSP; the service worker keeps the newest 80 photos for offline use.

## Offline and install

`public/sw.js` serves pages network-first with the last good copy as the offline fallback, hashed build files cache-first, uploaded photos (`/media/`) cache-first, and other same-origin files (model, images, sound) from cache while refreshing them. It never touches `/admin/`, `/api/` or other hosts. `public/manifest.webmanifest` makes the portal installable with shortcuts to the schedule, the lecturers and the heart.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/schedule-model.test.mjs` | dates, WIB clock, now/next, exams, search, ics output |
| `tests/validate.test.mjs`, `tests/content.test.mjs` | the validator and every content fallback path |
| `tests/v5.test.mjs` | page texts, photo records and divisions in the validator, cancelled sessions in the model and `.ics`, draft injection, metadata stripping, upload token verification and file sniffing |
| `tests/firestore.rules.test.mjs` | the security rules, on the emulator |
| `tests/jadwal-dosen.e2e.mjs` | schedule and lecturer sections at 7 viewports, keyboard, reduced motion, storage blocked, axe |
| `tests/admin.e2e.mjs` | the setup guide, the real Google sign-in screen, and the editor signed in against a mock backend |
| `tests/editor.e2e.mjs` | the live editor on the mock build: visitors never download it, a non-admin can edit nothing; cancelling a session, typing a page text, undo, redo and publishing; editing a lecturer, a session, a channel, an announcement and a heart note; uploading a division photo and renaming a division in place, on desktop and phone |
| `tests/portal.e2e.mjs` | the built site under the production headers at 6 viewports: section order, channels and panels, try out, search, lecturers, the heart, no sideways scroll, no console errors, no CSP violations, no requests to other hosts except the Firestore content reads (answered as an empty database); plus reduced motion, storage blocked, no WebGL and axe |
