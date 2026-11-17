# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install     # one-time dependency install
npm start       # production: node server.js
npm run dev     # development: node --watch server.js (auto-reload on edits)
./backup.sh     # tar.gz snapshot of data/deepskylog.sqlite + uploads/ into backups/
```

There is no test suite, linter, build step, or bundler. The public site is plain HTML + CSS + ES modules served statically — edit files under `public/` or `admin/` and refresh the browser. Node 18+ is required (`better-sqlite3` native binding).

### Local data reset

```bash
rm -rf data uploads
npm start   # re-runs migrations and reseeds Messier + Caldwell
```

`ADMIN_PASSWORD` must be set in `.env` for any `/admin` route or write endpoint to work; otherwise those routes return 503. Without it the server still boots and public read-only APIs still function.

## Architecture

Single-process Express 4 app (`server.js`) backed by a single SQLite file via `better-sqlite3` (synchronous, WAL mode). The entire HTTP surface, auth, upload pipeline, and error handler live in `server.js`; database open/migrate/seed logic lives in `db/`.

### Lifecycle on boot (`db/index.js` → `getDb()`)

1. Open SQLite at `DATABASE_PATH` (default `./data/deepskylog.sqlite`), enable WAL + foreign keys.
2. Run every pending entry in `db/schema.js`'s `MIGRATIONS` array inside a transaction and record it in the `migrations` table. **Migrations are append-only and idempotent — to change the schema, add a new numbered entry; never edit an existing one.**
3. Seed the `messier` and `caldwell` lists from `db/seed/*.js` if their `list_objects` row count is below the seed length (so re-seeding is safe on upgrades that add entries).
4. Backfill `observations.latitude`/`longitude` from any pre-existing `exif_json` blobs (one-shot fixup for old installs after migration 3 added those columns).

Once the server is listening, `server.js` also runs `repairJunkOptics()` (`lib/repair_optics.js`) in the background: observations saved before `lib/exif_sanity.js` existed carry the junk exposure / focal length / aperture (≈2.0000076) of recent Seestar EXIF. It backs the database up to `BACKUP_DIR` first (and changes nothing if that fails), re-reads the exposure from the image's watermark (divided by `stack_count` when frames are recorded, since `exposure_seconds` is then per-frame), clears the other two, and only touches columns still holding the exact junk value — plus the old form's browser-rounded 2 / 2.1 s exposure on otherwise unedited rows — so user edits survive and later boots are no-ops. Then, once, `repairWatermarkDates()` (`lib/repair_dates.js`) replaces `observed_at` values that are really upload times (the form's "now" fallback; created_at on the uploader's own whole-hour offset, ≤ 15 min later) with the watermark's capture time, cross-checked against — and falling back to — the capture time in Seestar EXIF (the app's `OwnerName` JSON note, raw `DateTimeOriginal` strings), and recomputes the moon phase. It backs up only when something will change, and records itself in the `maintenance_runs` table (migration 16) unless OCR was unavailable, so a later boot retries. Last, once, `repairNamedTargetTypes()` (`lib/repair_named_targets.js`) sets `object_type` on rows with no catalog and no type whose `object_name` is exactly a named target ("Milky Way" → `MW`).

The `db` instance is a module-level singleton — call `getDb()` from anywhere; do not open `better-sqlite3` directly.

### Upload pipeline (two-phase, see `server.js`)

Uploads are staged, reviewed, then finalized — this lets the admin see parsed EXIF before committing:

1. `POST /api/admin/stage` (multer) drops the raw file in `STAGE_DIR` (default `<db dir>/stage`, not web-exposed), parses EXIF with `exifr`, and runs `matchTelescope()` to guess Seestar S50 Pro/S50/S30 Pro/S30 from EXIF `Make`/`Model`/`Software` strings. When EXIF names a Seestar/ZWO device or has no camera `Make`/`Model` at all (exports shared from the Seestar app arrive stripped), `lib/seestar_band.js` reads the watermark band field by field (telescope, target, coordinates, date, integration, photographer), returning null for anything it can't read confidently. Milky Way exports print no target or integration time; instead a "Milky Way" label sits on the right, centred between the rows. The reader finds the rows on the left 60% of the width when the full-width profile disagrees, reads that label, and returns it as a named target (`NAMED_TARGETS` in `lib/seestar_meta.js`: no catalog id, `object_type: 'MW'`), which the form and the shortcut finalize path store as the object type. EXIF/FITS values win when present — but EXIF GPS counts only via `exifGps()` (finite, not 0,0) and exposure/f-number/focal length via `exifOptics()` (both in `lib/exif_sanity.js`), because recent Seestar app exports carry a zeroed GPS block (exifr: `NaN`) and junk optics values. Watermark coordinates are whole degrees, truncated; `watermarkCoords()` swaps in the precise default location when it falls in the same degree square. Whole-band OCR (`ocrBanner`) is only the fallback for band layouts the reader doesn't recognise. All OCR goes through the one serialised `recognize()` in `lib/seestar_ocr.js`. Returns a `stage_id` and parsed metadata.
2. `POST /api/admin/observations` (JSON referencing `stage_id`) fills any of telescope, `observed_at`, lat/lon, target and exposure whose key the request **omits** (the iOS shortcut / curl path) from EXIF and the watermark band (lat/lon last of all from the default location, as the form does); the upload form always sends every key, so its values — including deliberately cleared ones — are kept. It then renames the staged file to `UPLOAD_DIR/YYYY/MM/<object-slug>/<ts>-<rand>.<ext>`, generates a 640px JPEG thumbnail via `sharp`, re-parses EXIF, and in a single DB transaction inserts the `observations` row **and** one `list_completions` row for every `list_object` sharing that `catalog`+`catalog_number` (so a single M42 upload ticks both Messier and any future list M42 appears in).
3. `sweepStageDir()` runs at boot and hourly, deleting staged files older than `STAGE_TTL_MS` (24h).

On finalize failure, any moved file and written thumbnail are cleaned up before responding 500. Cross-device rename fallback (`EXDEV`) copies + unlinks instead.

### Auth (`basicAuth` middleware)

HTTP Basic Auth compares the submitted password to `ADMIN_PASSWORD` with `crypto.timingSafeEqual` on equal-length buffers. Per-IP sliding 15-minute window in `authFailures`: after 20 failures the middleware returns `429 Retry-After` instead of `401`. Mounted on `/admin` static and every `/api/admin/*` route — never skip it when adding new admin endpoints.

### Public vs admin surface

- Public (no auth): `/api/lists`, `/api/lists/:slug`, `/api/observations` (filters: `telescope`, `object_type`, `has_image=1`), `/api/observations/map`, `/api/observations.csv`, `/api/observations/:id/moonmap`, `/api/objects/:id`, `/api/filters`, `/api/tonight` (requires `lat`/`lon`, uses `lib/astro.js` to compute altitude + moon phase), `/api/astro-weather` (requires `lat`/`lon`).
- Admin (Basic Auth): `/api/admin/stats`, `/api/admin/config`, `/api/admin/objects` (autocomplete), `/api/admin/stage`, `/api/admin/stage/:id/preview`, `/api/admin/stage/:id` (DELETE), `/api/admin/observations`, `/api/admin/observations/bulk-platesolve`, `/api/admin/observations/:id/platesolve` (POST queue / GET status), `/api/admin/platesolve/activity`, `/api/admin/observations/:id/moonmap` (PUT `{ rotation, mirrored }` / DELETE), `/api/admin/seestar-planner`, `/api/admin/seestar/share` (POST), `/api/admin/seestar/shares` and `/shares/:id` (GET).

### Plate solving (`lib/solver.js`, `lib/astrometry.js`)

Needs `ASTROMETRY_API_KEY`. The solve endpoints only check the key and put observations in a local queue (`solver_status = 'queued'`, ordered by `solver_queued_at`), then return. A background worker uploads queued images to nova.astrometry.net one at a time (`pending` = uploaded, waiting for a job; `solving` = job running), and a poller checks every pending/solving observation every `SOLVER_POLL_MS` (30 s) until `success` (calibration in `solved_*`) or `failure`; a failed upload returns the observation to unsolved. Every step is written to `solver_events` (migration 17, pruned to the newest 2000), which `/api/admin/platesolve/activity?after=<id>` serves with per-state counts and the in-progress list; the admin observations page polls it for its Plate solving panel, live Solve cells and notifications. `solver.start()` resumes the queue and polling after a restart.

### Moon maps (`lib/moon_map.js`, `lib/moon_detect.js`, `lib/moon_ephem.js`)

A Moon observation (type `MOON`, the Solar System list's SOL 2, or `object_name` "Moon": `isMoonObservation()`) gets its named features drawn over the photo by `public/js/moon-map.js`, from `GET /api/observations/:id/moonmap`. Computing a map:

1. `captureInstant()` turns `observed_at` (zoneless wall clock) into UTC: in the server's `TZ` zone when one is set and it fits the longitude (within 3 h of local mean time, modulo a day — so DST and date-line zones come out right), else as local mean time at the longitude to the hour. The observation's coordinates, else the default location, supply that longitude and make the ephemeris topocentric.
2. `moonFace()` (Meeus ch. 47/48/53, checked against the book's worked examples in `test/moon_map.test.js`) gives libration, the axis position angle, the sub-solar point, bright-limb angle and phase.
3. `detectMoon()` thresholds the photo, keeps the largest blob, and RANSAC-fits a circle to its *sharp* edge points (the sunlit limb is a hard step; the terminator a soft ramp), then correlates the photo with `canonicalImage()` — `lib/moon_albedo.png` (NASA LRO mosaic, 1°/px) shaded for that face — at every rotation, plain and mirrored. `rotation` = where lunar north points, degrees clockwise from up, in the displayed (EXIF-oriented) image. A handedness the match can't settle stays unmirrored (Seestars never mirror).
4. `projectFeatures()` places `lib/moon_features.json` (IAU gazetteer: maria with outlines traced from the LRO mosaic, craters ≥ 20 km, mountains, rilles, landing sites) orthographically in photo pixels. Each feature also carries its gazetteer id (`g`), where its name comes from (`o`; for craters "Named after <person from Wikidata>, <gazetteer description>") and its English Wikipedia article (`w`, via Wikidata's gazetteer-id links) for the page's tooltips; every feature is a link to its article, else its gazetteer entry. On touch screens the first tap shows the tooltip and a second follows the link.

`createMoonMapStore()` caches results in `moon_maps` (migration 18) under a key of everything a map depends on (image path plus the file's size and mtime, capture instant, location, override, a fingerprint of the two data files, and `MOON_MAP_VERSION` — bump it when detection or projection code changes), sharing concurrent runs; a missing image file is never cached, and setting or clearing an override always recomputes. Finalize warms it for new Moon uploads. An admin override (`override_json`) pins the orientation; the admin Observations page has a "Moon map" button per Moon photo to check and turn the labels. The two data files are rebuilt by `scripts/build-moon-features.js` (gazetteer DBF + LRO mosaic + a Wikidata SPARQL export) and `scripts/build-moon-albedo.js` (sources, URLs and the query in their headers). Map responses are gzipped (`sendMoonMap()` in `server.js`; the app has no compression middleware).

### Seestar planner (admin only)

The Seestar planner is an admin page: `admin/seestar.html` with `admin/seestar-plan.js` and `admin/seestar-durations.js`, served behind `basicAuth` like the rest of `/admin`, and its API is `GET /api/admin/seestar-planner`. Nothing on the public site links to it; `/seestar.html` (its old public address) redirects to `/admin/seestar.html`. Its schedule is built on a 10-minute grid, because the Seestar app plans in 10-minute steps and imports a shared plan with other times as empty: the session opens on the first 10-minute mark at least 30 minutes after sunset (or at the requested start) and closes on the last mark an hour before sunrise, durations are whole 10-minute steps (defaults and `durations=` overrides are rounded, minimum 10), and an idle wait advances 10 minutes. The marks follow the local clock via the page's `tz_offset` (minutes east of UTC; UTC without it). It still imports the shared public modules (`/js/common.js`, the catalog and type filters, `/js/astro-weather.js`, `/js/default-location.js`) by absolute path. Keep it out of the public nav — `test/smoke.test.js` checks that.

### Share to Seestar (`lib/seestar_share.js`)

Each schedule on the Seestar planner page has a "Share to Seestar" button that turns it into a Seestar Share Plan: a link and QR code the official app imports into Local Plans. ZWO's share API is **undocumented** (reverse engineered, verified with `scripts/seestar-share-probe.js`); everything the app knows about it — URL, body shape (JSON strings nested three deep), link form, per-target defaults — lives in `lib/seestar_share.js`. The probe script is a standalone tool with its own copy of the request (it must run when the module is what's broken): after a change on ZWO's side, fix the module and bring the probe in line. `SEESTAR_API_BASE` overrides the host (tests point it at a fake; no test may call ZWO).

- The planner stores no plans, so `POST /api/admin/seestar/share` takes the slots from the page (`{ name, scope, tz_offset_minutes, slots: [{ object_id, slot_start, duration_minutes }] }`) and looks names and coordinates up itself (ephemeris bodies at the slot start; the Sun is refused).
- `buildTargets()` maps slots to the app's TargetItems: `start_min` (`planStartMinutes()`) is minutes after local midnight, in the browser's zone, of the first slot's day, running past 1440 after midnight; a plan wholly between midnight and noon counts from the previous midnight; starts and ends are then moved onto the app's 10-minute grid (`snapToGrid()`: nearest 10 minutes, never under 10 minutes, never overlapping), because a plan with off-grid times imports with no targets — a safety net, since the planner already schedules on that grid; `target_id` is a 31-bit hash of catalog + number, bumped on a clash; only M / C / NGC / IC / Sh2 numbers are used as names (the site's own list numbers aren't designations). `validateTargets()` refuses the whole plan for anything the app would silently drop.
- `postShare()` has a 15 s timeout and retries once only when no response arrived; any response is final. Success needs HTTP 2xx **and** body `code === 200` **and** a share id — ZWO reports errors in the body, and its code and message go to the page verbatim (HTTP 502 from our route; 400 for a plan we refused).
- The QR is drawn locally (`qrcode`) from the link: ZWO's `/v1/share/plan/qrcode` would create a second, different share.
- Each share is recorded in `seestar_shares` (migration 19); the page's "Plans shared to Seestar" list reads it.

### Sky forecast (`lib/astro_weather.js`, `public/js/astro-weather.js`)

`GET /api/astro-weather?lat=&lon=` is weather for astronomy: about a week of hours, each with cloud by layer, wind and gusts, temperature and dew point, the Sun's altitude (`darkness`: day above −6°, twilight to −18°, dark) and the Moon. Three free, keyless sources, fetched together:

| Source | Env override | Gives | Required |
| --- | --- | --- | --- |
| Open-Meteo forecast (8-day request) | `OPEN_METEO_BASE` | cloud, wind, humidity, temperature, visibility, 250 hPa wind | yes |
| Open-Meteo air quality (CAMS, ~5 days) | `OPEN_METEO_AIR_BASE` | aerosol optical depth, PM2.5, dust | no |
| 7Timer ASTRO (3 days, 3-hourly) | `SEVENTIMER_BASE` | seeing class 1–8 (arcseconds) | no |

An optional source that is down, slow (8 s) or answers nonsense costs only its own figures — never an error. Tests point all three overrides at a fake; no test may call the real services.

- `seeing`, 1–5 (5 best): 7Timer's class where it has one (`seeing_source: '7timer'`, `seeing_arcsec`; each 3-hourly point covers the hour before, of and after), else an **estimate** from the 250 hPa (jet stream) wind, less a point for gusts ≥ 35 km/h (`seeing_source: 'estimate'`).
- `haze`: clear / slight / hazy / heavy from aerosol optical depth (0.1 / 0.2 / 0.4), raised by PM2.5 ≥ 35 / 55 µg/m³. It is smoke, haze and dust together — the data can't tell them apart.
- `transparency`, 1–5: always an **estimate**, from humidity, visibility and haze. The page marks every estimate with `~`.
- `dew`: low / likely / high / frost, from the temperature − dew point gap.
- `verdict` + `reasons`: no-go at ≥ 70% cloud, ≥ 50% precipitation chance or gusts ≥ 45 km/h; marginal above 25% cloud, at ≥ 20% precipitation chance, gusts ≥ 30 km/h, with heavy haze or with transparency ≤ 2; else go. Darkness is not part of it. Gusts and precipitation chance are Open-Meteo's "preceding hour" figures, so each hour takes them from the next timestamp.
- `nights`: each run of non-day hours with its go / marginal hours, longest run of go hours (`best`) and one verdict (go = that run ≥ 2 h). A night with under 2 h left, or one the forecast ends partway through, is left out; polar night is cut every 24 h.

The endpoint is public, so the module protects the upstream services: forecasts are cached per 0.1° square for an hour (concurrent requests share one fetch; after a failed fetch the square isn't retried for 5 minutes and a forecast up to 6 h old stands in), upstream fetches are capped at 120 an hour, and the route allows each IP 40 requests per 10 minutes (429 beyond either). All values, including the `reasons` text, are metric; the page converts to mph / °F for US browsers (`localReason()` for the reasons). `mountAstroWeather()` draws the panel on Tonight and the (admin) Seestar planner, whose `fillSkyCells()` gives each slot the worst verdict of the hours it touches, ignoring an hour it clips by under 10 minutes (`verdictFor()`). The older `/api/admin/weather` is a different thing: past weather for the upload form.

### Default location on the planning pages (`public/js/default-location.js`)

Tonight, the planner and the Seestar planner keep the visitor's last coordinates in `localStorage` (`deepskylog.location`). With nothing saved — or the 0, 0 older versions saved from empty inputs — `applyDefaultLocation()` fills the inputs from the site's default location (`/api/settings`, public) before the first load, and adds a "Default location" button beside "Use my location".

### Frontend conventions

No framework, no build step. Each page (`public/*.html`, `admin/*.html`) loads one ES module via `<script type="module">`. Shared helpers live in `public/js/common.js`:

- `fetchJson(url)` — all API calls go through this.
- `el(tag, attrs, ...children)` — tiny DOM builder used instead of templating; attrs `class`, `text`, `html`, and `on<Event>` have special handling.
- `formatRA`/`formatDec` — RA in decimal hours, Dec in decimal degrees (matches DB columns `ra_hours`/`dec_degrees`).
- `OBJECT_TYPES` / `typeLabel` — the canonical mapping of object-type codes (GC, OC, PN, SNR, DN, GAL, MW = Milky Way, AST, DS) to labels. Use this rather than hardcoding strings.

### Astronomy helpers (`lib/astro.js`)

`altAz({ raHours, decDeg, lat, lon, date })` and `moonPhase(date)` are used by `/api/tonight` and also saved into `observations.moon_phase` / `moon_phase_name` at upload time. Accuracy is planning-grade, not surveying — do not expect arc-second precision. RA input is **decimal hours**, declination is **decimal degrees**.

## Conventions worth respecting

- **CommonJS**, not ESM, on the server (`"type": "commonjs"` in `package.json`). The public/admin browser JS is ESM via `<script type="module">`. Do not mix.
- **Use `better-sqlite3` named parameters** (`@name`) consistently; the existing SQL relies on `ESCAPE '\\'` with `escapeLike()` for user-supplied LIKE patterns — follow the same pattern for new search endpoints.
- **Path safety**: any endpoint that touches `STAGE_DIR` or `UPLOAD_DIR` must `path.basename()` user input and verify the resolved path still starts with `<dir> + path.sep` before reading/writing. See `/api/admin/stage/:id/preview` and the stage DELETE handler for the pattern.
- **Telescope list** is hardcoded in `TELESCOPE_OPTIONS` in `server.js` and exposed via `/api/admin/config`. `matchTelescope()` only auto-detects Seestars (test the Pro patterns before their base models — "Seestar S50 Pro" contains "Seestar S50"); everything else is picked manually in the UI. The planner's `SEESTAR_SCOPES` map is append-only (never rename or reorder keys) and its `wide_field: true` flag is what admits a scope to the Milky Way wide-field list.
- **Catalog seed data** (`db/seed/messier.js`, `caldwell.js`) uses `{ catalog, catalogNumber, name, type, ra, dec, mag, constellation }`. Adding a new built-in list means a new seed file + a `seedList()` call in `seedCatalogs()`; existing entries must keep their `catalog`+`catalogNumber` stable because `list_completions` joins on them.
