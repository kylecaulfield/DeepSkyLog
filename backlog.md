# Backlog

Items prefixed with ✅ are shipped on `main`; the others are still open.

## High value, not much work

1. ✅ **Tonight's targets page** — `/tonight.html` + `/api/tonight`, alt-az
   per-object, `lib/astro.js`.
2. ✅ **Seeing / transparency log per session** — per-observation 1–5 scales
   in the upload form, surfaced on the object detail page.
3. ✅ **Weather-condition tags on observations** — Bortle 1–9 + auto-computed
   moon phase from `observed_at`.

## Medium effort, high payoff

4. ✅ **Seestar-specific integration** — sidecar `.json` parser
   (`lib/seestar_meta.js` + `public/js/seestar.js`) plus EXIF text mining
   (`Artist`, `ImageDescription`, `UserComment`, …) plus watermark OCR
   (`lib/seestar_ocr.js`, tesseract.js with bundled `eng.traineddata`).
5. ✅ **Multi-image support per object** — `featured` flag + auto-promotion;
   admin page lets you log "another attempt", promote, and compare.
6. ✅ **Session planner** — `/planner.html` + `/api/planner`, picks a date and
   sweeps altitude across the night.

## Longer term

7. ✅ **Astrometry.net integration** — `lib/astrometry.js` + admin
   `POST/GET /api/admin/observations/:id/platesolve` + a Plate-Solve button
   on each attempt. Stores RA/Dec/FOV/orientation back on the row. Requires
   `ASTROMETRY_API_KEY`.
8. **Image quality scoring** — use something like BHHW star FWHM measurement
   to automatically grade sharpness. Tells you which nights were actually good
   seeing vs. which just felt good. *Still open.*
9. ✅ **Comparison view** — "Compare two…" button on the object detail page
   opens a side-by-side modal with full metadata for any two attempts.
10. **Mobile upload** — a simple PWA wrapper so you can upload directly from
    your phone in the field without going through a laptop. *Still open
    (deliberately deferred — mobile Safari handles the existing form fine).*
11. **More catalog seeds** — Messier (110), Caldwell (109), Local Group (22),
    Finest NGC (119), AL Globulars (50), Open Clusters for Smart Scopes (40),
    Planetary Nebulae for Smart Scopes (30), Sharpless 2 Bright (29), Solar
    System (9) — 527 objects across 9 lists, with cross-list aliases so a
    single upload ticks every list the target appears on. **Still missing:**
    the full Herschel 400 and SAC 110 Best of NGC.

## Test coverage to add

12. **HTML wiring smoke checks** — boot the server in CI, `curl` every public
    and admin HTML page, grep for the IDs each page module expects
    (`#latitude-input`, `#site-name-input`, `#object-type-input`, the
    `/js/site-name.js` script tag, etc.). Catches typos in form-field IDs
    that today only fail in the browser. ~30 min to add as a new sub-test
    in `test/smoke.test.js`.
13. **Headless browser tests (Playwright)** — drive the actual upload flow:
    drop multiple files, fill the form, click "Use image GPS", change the
    site name and verify the brand label updates after a refresh, log a
    comet observation and confirm it appears under the COMET filter on the
    gallery page. Requires adding `@playwright/test` as a dev dependency,
    a `tests/e2e/` folder, and a CI job that installs the browser binaries.
    1–2 hours of scaffolding for the first test, then minutes per scenario.

## Bonus shipped (not in original backlog)

- ✅ **Edit observations** — PATCH endpoint + admin modal form.
- ✅ **Equipment library** — telescopes / cameras / filters / mounts as
  first-class entities, telescope dropdown auto-merges with the hardcoded
  list.
- ✅ **Backup management** — `./backup.sh` plus on-demand "Run backup now"
  and "Restore" buttons in the admin dashboard.
- ✅ **Calendar heatmap** — last 365 days of observation activity on the
  admin dashboard.
- ✅ **Aladin Lite finder charts** — embedded sky chart on every public
  object page with RA/Dec.
- ✅ **Smoke test suite** — `npm test` boots a throwaway server and
  exercises every endpoint; runs in ~1 s.
- ✅ **CI** — `.github/workflows/test.yml` runs the smoke suite on every
  push and PR.

## Future ideas

A scratchpad of features worth considering, grouped roughly by effort.
None of these have been started; pick the ones that fit your workflow.

### Quick wins (an afternoon each)

14. **Constellation index** — `/constellations.html` listing observations
    grouped by constellation with a progress bar per constellation. Pure
    SQL aggregation on `list_objects.constellation` joined with
    `list_completions`.
15. **RSS / Atom feed** — `/api/observations.rss` so friends can subscribe
    to your new captures. Reuses the same query as `/api/observations`,
    just renders XML instead of JSON.
16. **Twilight + moon-up bands on the planner** — overlay astronomical
    twilight start/end and moon-up window on the planner table so you can
    eyeball the real imaging window. `lib/astro.js` already does altAz;
    just need a "moon up?" computation per row.
17. **Moon-distance filter on planner** — exclude targets within X° of the
    moon (slider in the toolbar). One extra column in `/api/planner` plus
    a client-side filter.
18. **Object aliases editor** — admin UI to add `aliases` to a
    `list_objects` row (the column already exists, no UI surfaces it).
    Fixes the "M42 ↔ NGC 1976" cross-list ticking gaps without editing
    the seed JS.
19. **Custom list import (CSV)** — admin form that ingests a CSV
    (`catalog,catalog_number,name,ra_hours,dec_degrees,magnitude,
    constellation`) into a new `lists` row. Lets users seed their own
    observing programs without touching `db/seed/*.js`.
20. **Watchlist / "wanted" flag on objects** — boolean column on
    `list_objects`, surfaced as a star toggle and a `priority` filter on
    the planner so you see your wanted-list-first.
21. **Tagging / freeform labels** — `observation_tags(observation_id, tag)`
    table; tag chips on the upload form; filterable on the gallery and
    observations admin page.
22. **Annual / lifetime stats panel** — block on the public dashboard
    showing observations this year, distinct objects, hours under the
    sky (sum of `exposure_seconds × stack_count` / 3600), longest single
    session, current streak. Aggregation only — no schema changes.
23. **Notes templates** — admin-managed list of notes presets
    ("first light", "rejected — clouds rolled in", "sketch session").
    Stored as `note_templates(id, name, body)`; dropdown above the notes
    field on the upload form.

### Medium effort (a day or two)

24. **Visual / sketch mode** — flag on the upload form that swaps the
    capture-details fieldset for visual fields (eyepiece, magnification,
    filter, sketch image). Sketches stored in `uploads/` like images,
    rendered with a different chip on the gallery.
25. **Per-session log** — group observations from the same date+location
    into a "session" with one set of conditions. Avoids repeating Bortle/
    seeing/transparency/location for every sub-image of the same night.
    `sessions(id, started_at, ended_at, location, lat, lon, bortle,
    seeing, transparency, notes)` + `observations.session_id`.
26. **Constellation chips on gallery** — colored chip per row indicating
    constellation; click to filter the gallery to that constellation.
27. **DSS preview overlay on object page** — show a Digital Sky Survey
    thumbnail next to the user's image at matching scale. SkyView (NASA)
    has a free image API; cache results to avoid repeated hits.
28. **Stretching presets** — client-side histogram stretch (linear /
    asinh / log) toggles on the object detail page so you can pop faint
    detail without re-uploading. Pure canvas/JS, no server change.
29. **Observation goals** — admin sets goals like "all Messiers by
    end of year", "100 unique objects in 2026"; dashboard renders a
    progress bar for each. `goals(id, name, target_count, scope_sql,
    deadline)` table.
30. **Conjunction tracker** — list upcoming planet–planet and
    planet–DSO close approaches over the next 60 days using the
    existing solar-system ephemeris. Pure math; no extra deps.
31. **Mosaic / panorama support** — group multiple uploads into one
    observation with a `panel` index and a thumbnail showing the
    composed mosaic. `observations.mosaic_id` + `observations.panel_index`.

### Bigger lifts

32. **Multi-user accounts** — replace single `ADMIN_PASSWORD` with
    `users(id, email, password_hash, role)`. Each observation gets a
    `user_id`. Public pages stay public; gallery can filter by observer.
    Adds session middleware, a login page, and "register" gated by an
    invite code or admin approval. Substantial change — only worth doing
    if you actually want to host other observers' logs.
33. **Mobile share-target PWA** — manifest + service worker so iOS /
    Android can "Share to DeepSkyLog" from the camera roll, opening
    directly into the upload form with the file pre-attached. Builds on
    backlog item 10.
34. **Catalog search beyond seeded lists** — fall back to a bundled
    NGC2000 / IC dataset (or a local SIMBAD mirror) when the user types
    an unknown target. Returns RA/Dec/type so the comet/free-form path
    works for any object, not just the seeded ones.
35. **PDF logbook export** — server-side renders a printable monthly or
    yearly observing log as PDF. Uses something like pdfkit; cleanest
    if scoped to a single user / session.
36. **Image quality scoring** — pull in a star-FWHM measurement library
    (or call a Python helper) to grade sharpness per upload. Already
    listed as #8; mentioned again here because it pairs naturally with
    the visual-mode and goals features.
37. **Time-zone-aware planner** — drop the `lon/15` TZ approximation in
    favour of a real IANA TZ lookup from coordinates (e.g. via the
    bundled `tz-lookup` data). Matters most at high latitudes and during
    DST transitions.
38. **EXIF privacy mode** — per-observation toggle to strip GPS / device
    info from the public `/api/observations` response. Useful if you
    want to publish gallery images without doxxing your back garden.
39. **Audit log** — `audit_log(at, actor, action, target_table,
    target_id, payload_json)` written by every admin mutation. Dashboard
    table to browse recent edits/deletes. Becomes essential the moment
    multi-user lands.
