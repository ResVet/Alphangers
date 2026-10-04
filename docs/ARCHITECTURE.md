# Architecture

Alphangers is a static site. Everything a visitor sees ships in the build; Firebase only replaces the bundled copy of the content with a newer, validated one when it is configured. This document covers how the page is assembled, where content comes from, and how the 3D heart is made and drawn.

## The page

`index.html` holds the markup for every section, so the page is readable before any script runs and still makes sense with JavaScript off. `src/main.js` then:

1. Starts the v3 shell (`src/legacy/app.js`): loader, hero, channel list, try out, the scroll-driven heartbeat section and the sound toggle. v3 was a single hand-written HTML file; it was moved into modules with its behaviour kept, and its data (channels, try out bank, media) now comes from the same sources as everything else.
2. Mounts the newer sections. The announcement board and schedule mount at once, because they sit under the hero. The lecturer list and the heart mount when they come within a screen or so of the viewport (`IntersectionObserver`), so a visitor who only wants today's schedule never downloads three.js.
3. Wires the search palette, which is loaded the first time it is opened and can mount a section early when a result lives there.
4. Registers the service worker in production builds.

Each section is a module with the same contract:

```js
const view = mountX(rootElement, { ...contentKeys, portal });
view.update({ ...freshContent });   // when the admin publishes a change
view.destroy();
```

Sections talk to each other with one DOM event, `alpha:open`, instead of importing each other. The schedule sends `{ type: 'dosen', id }` when a lecturer's name is tapped; the lecturer list answers by opening that person. A lecturer's session list sends `{ type: 'date', date, uid }` and the schedule jumps to that day and highlights the session. Search uses the same event.

### Section order

Hero, announcements, **Jadwal**, **Drive** (the channel list), **Dosen**, the heartbeat walkthrough, **Jantung 3D**, footer. The schedule is first because "what is on today" is the most common reason to open the site.

### Styling

Design tokens live in `src/styles/tokens.css` (colours, type, radii, easing). The palette is the v3 one: near-black green, a single bright green accent, warm red and amber only for meaning (exam, deadline). Type is Bricolage Grotesque for display, Instrument Serif italic for the emphasised half of each heading (a v3 signature), Archivo for body text and JetBrains Mono for labels and numbers. All fonts are self-hosted from `@fontsource`, so the page makes no font requests to other hosts. New modules scope their CSS under one class (`.jw`, `.dz`, `.hx`, `.fd`, `.ib`) and use container queries where layout depends on the section's own width.

## Content

Five content keys: `links`, `announcements`, `schedule`, `dosen`, `heart`.

```
            bundled JSON (src/data)                    always present, in the build
                     │
localStorage cache ──┼──▶ load(key) ──▶ section renders at once
                     │
Firestore REST ──────┘     (6 s timeout, field mask, no cookies)
      │
      └─▶ validate.js ──▶ differs from what is shown? ──▶ subscribers re-render
```

`src/lib/content.js` answers `load(key)` immediately from the best copy on hand, then asks Firestore for the current document. A remote copy is used only if it passes `src/lib/validate.js`, the same validator the admin runs before saving. A missing document means "use the bundled copy" (that is how the admin's reset works). The localStorage copy keeps the document's update time; on the next visit the portal first asks for the `rev` field alone (Firestore still returns the update time) and downloads `json` only if the time changed. With `firebaseConfig` left `null`, the portal makes no network requests at all.

### Where the data came from

- **Schedule.** The three block schedules (a PDF and two spreadsheets) were transcribed by hand into `content/jadwal/blok-*.txt`, one session per line, and checked against the originals. `scripts/build_data.py` turns them into `src/data/schedule.json`: blocks with dates, room and coordinator, days with sessions, session kind, lecturer codes and notes. Where the official sheet itself was ambiguous (two sessions in one slot, "sampai selesai" end times) the transcript keeps a note and the UI shows it.
- **Lecturers.** The faculty contact sheet, merged with the codes used in each block, into `src/data/dosen.json`. Names are normalised for sorting (titles such as dr., Prof. and degrees are ignored), phones are stored in three forms (dialable, display, WhatsApp). Lecturer phone numbers are public by the class's decision; student numbers are not included.
- **Try out bank.** `content/bank/bank.json`, curated from the class's question sets with explanations, lazily imported when the try out opens.

### Schedule model

`src/lib/schedule-model.js` is pure (no DOM) and covered by unit tests. It resolves lecturer codes per block, gives every session a stable id, and answers questions such as "what is on now and next", "next exam", "which sessions does this lecturer teach here", and text search. All times are Palembang time: a session at 08.00 starts at 08.00 WIB whatever time zone the phone is set to. `src/lib/ics.js` writes RFC 5545 calendar files (with line folding and escaping) and Google Calendar links.

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
- **Picking.** On tap, the scene is rendered once more with an override material that writes part id into an 11 by 11 pixel target around the pointer; the nearest non-empty pixel wins. It respects the cut plane, prefers the thin inner structures in the electrical view, and costs one tiny draw per tap.
- **Modes.** Whole, Cut (three presets plus a slider), Electrical (see-through walls, conduction system lit, ECG playing, slow motion and scrubbing) and Blood flow (particles along the traced routes, blue before the lungs and red after, speed following systole and diastole).
- **Power.** Rendering is on demand: frames are drawn only while something moves (camera, wave, flow, the short pulse after a pick). Off screen or in a hidden tab the loop stops. Pixel ratio is capped at 2 (1.5 on low-power devices); on a CPU-only WebGL fallback the scene drops to 0.75 and starts paused.
- **Fallbacks.** No WebGL: a still image of the model and the full part list and notes. Reduced motion: no idle spin, no auto-play, instant camera moves. Lost GPU context: handled and restored.

## Offline and install

`public/sw.js` serves pages network-first with the last good copy as the offline fallback, hashed build files cache-first, and other same-origin files (model, images, sound) from cache while refreshing them. It never touches `/admin/` or other hosts. `public/manifest.webmanifest` makes the portal installable with shortcuts to the schedule, the lecturers and the heart.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/schedule-model.test.mjs` | dates, WIB clock, now/next, exams, search, ics output |
| `tests/validate.test.mjs`, `tests/content.test.mjs` | the validator and every content fallback path |
| `tests/firestore.rules.test.mjs` | the security rules, on the emulator |
| `tests/jadwal-dosen.e2e.mjs` | schedule and lecturer sections at 7 viewports, keyboard, reduced motion, storage blocked, axe |
| `tests/admin.e2e.mjs` | the setup guide, the real Google sign-in screen, and the editor signed in against a mock backend |
| `tests/portal.e2e.mjs` | the built site under the production headers at 6 viewports: section order, channels and panels, try out, search, lecturers, the heart, no sideways scroll, no console errors, no CSP violations, no requests to other hosts except the Firestore content reads (answered as an empty database); plus reduced motion, storage blocked, no WebGL and axe |
