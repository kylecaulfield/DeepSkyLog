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

The `db` instance is a module-level singleton — call `getDb()` from anywhere; do not open `better-sqlite3` directly.

### Upload pipeline (two-phase, see `server.js`)

Uploads are staged, reviewed, then finalized — this lets the admin see parsed EXIF before committing:

1. `POST /api/admin/stage` (multer) drops the raw file in `STAGE_DIR` (default `<db dir>/stage`, not web-exposed), parses EXIF with `exifr`, and runs `matchTelescope()` to guess Seestar S50/S30/S30 Pro from EXIF `Make`/`Model`/`Software` strings. Returns a `stage_id` and parsed metadata.
2. `POST /api/admin/observations` (JSON referencing `stage_id`) renames the staged file to `UPLOAD_DIR/YYYY/MM/<object-slug>/<ts>-<rand>.<ext>`, generates a 640px JPEG thumbnail via `sharp`, re-parses EXIF, and in a single DB transaction inserts the `observations` row **and** one `list_completions` row for every `list_object` sharing that `catalog`+`catalog_number` (so a single M42 upload ticks both Messier and any future list M42 appears in).
3. `sweepStageDir()` runs at boot and hourly, deleting staged files older than `STAGE_TTL_MS` (24h).

On finalize failure, any moved file and written thumbnail are cleaned up before responding 500. Cross-device rename fallback (`EXDEV`) copies + unlinks instead.

### Auth (`basicAuth` middleware)

HTTP Basic Auth compares the submitted password to `ADMIN_PASSWORD` with `crypto.timingSafeEqual` on equal-length buffers. Per-IP sliding 15-minute window in `authFailures`: after 20 failures the middleware returns `429 Retry-After` instead of `401`. Mounted on `/admin` static and every `/api/admin/*` route — never skip it when adding new admin endpoints.

### Public vs admin surface

- Public (no auth): `/api/lists`, `/api/lists/:slug`, `/api/observations` (filters: `telescope`, `object_type`, `has_image=1`), `/api/observations/map`, `/api/observations.csv`, `/api/objects/:id`, `/api/filters`, `/api/tonight` (requires `lat`/`lon`, uses `lib/astro.js` to compute altitude + moon phase).
- Admin (Basic Auth): `/api/admin/stats`, `/api/admin/config`, `/api/admin/objects` (autocomplete), `/api/admin/stage`, `/api/admin/stage/:id/preview`, `/api/admin/stage/:id` (DELETE), `/api/admin/observations`.

### Frontend conventions

No framework, no build step. Each page (`public/*.html`, `admin/*.html`) loads one ES module via `<script type="module">`. Shared helpers live in `public/js/common.js`:

- `fetchJson(url)` — all API calls go through this.
- `el(tag, attrs, ...children)` — tiny DOM builder used instead of templating; attrs `class`, `text`, `html`, and `on<Event>` have special handling.
- `formatRA`/`formatDec` — RA in decimal hours, Dec in decimal degrees (matches DB columns `ra_hours`/`dec_degrees`).
- `OBJECT_TYPES` / `typeLabel` — the canonical mapping of object-type codes (GC, OC, PN, SNR, DN, GAL, MW, AST, DS) to labels. Use this rather than hardcoding strings.

### Astronomy helpers (`lib/astro.js`)

`altAz({ raHours, decDeg, lat, lon, date })` and `moonPhase(date)` are used by `/api/tonight` and also saved into `observations.moon_phase` / `moon_phase_name` at upload time. Accuracy is planning-grade, not surveying — do not expect arc-second precision. RA input is **decimal hours**, declination is **decimal degrees**.

## Conventions worth respecting

- **CommonJS**, not ESM, on the server (`"type": "commonjs"` in `package.json`). The public/admin browser JS is ESM via `<script type="module">`. Do not mix.
- **Use `better-sqlite3` named parameters** (`@name`) consistently; the existing SQL relies on `ESCAPE '\\'` with `escapeLike()` for user-supplied LIKE patterns — follow the same pattern for new search endpoints.
- **Path safety**: any endpoint that touches `STAGE_DIR` or `UPLOAD_DIR` must `path.basename()` user input and verify the resolved path still starts with `<dir> + path.sep` before reading/writing. See `/api/admin/stage/:id/preview` and the stage DELETE handler for the pattern.
- **Telescope list** is hardcoded in `TELESCOPE_OPTIONS` in `server.js` and exposed via `/api/admin/config`. `matchTelescope()` only auto-detects Seestars; everything else is picked manually in the UI.
- **Catalog seed data** (`db/seed/messier.js`, `caldwell.js`) uses `{ catalog, catalogNumber, name, type, ra, dec, mag, constellation }`. Adding a new built-in list means a new seed file + a `seedList()` call in `seedCatalogs()`; existing entries must keep their `catalog`+`catalogNumber` stable because `list_completions` joins on them.
