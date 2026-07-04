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
- ✅ **Sky atlas** — `/atlas.html` renders an inside-out 3D celestial
  globe (Three.js) where every plate-solved observation is placed as a
  textured tile at its solved RA/Dec, sized by `solved_radius_deg` and
  rotated by `solved_orientation_deg`. RA/Dec grid + 50 brightest stars
  + procedural ambient star field for orientation. Hover for tooltip,
  click to open the observation detail page.
- ✅ **Catalog cross-reference** — `/admin/crossref.html` groups every
  catalog entry by the physical sky target it names (connected components
  of the alias graph), so one target shows all its designations across
  every list (M42 = NGC1976 = Sh2-275 …). Flags unlinked entries within a
  tunable arc-minute radius as "possible matches" with a one-click link
  action that adds the missing aliases. Backed by `GET /api/admin/crossref`
  and `POST /api/admin/crossref/link`.
- ✅ **Bulk plate solve on admin observations** — a "Bulk plate solve (N)"
  button submits up to 50 unsolved-with-image observations to astrometry.net
  in one click, plus a per-row Solve column with Solved/pending/Solve pill.
  Backed by `POST /api/admin/observations/bulk-platesolve` (single
  astrometry session, sequential uploads to stay polite to Nova's free
  queue; supports an optional `ids[]` payload).
- ✅ **Multi-scope Seestar planner** — declare how many of each model you
  own (e.g. 1× S30, 2× S30 Pro) and get a separate, non-overlapping
  schedule per scope for the night. Backend allocates most-restrictive cap
  first (shared assigned-target set) so a deep S50 keeps the faint targets
  only it can reach; `fleet=s30:1,s30pro:2` query param, with the single
  `telescope` path kept for back-compat. Sessions auto-start 30 minutes
  after sunset for the location (never before the requested start), and
  Milky Way wide-field (MWWF) mosaics are scheduled only on the S30 Pro.
- ✅ **Sortable table headers everywhere** — shared `makeTableSortable()`
  helper in `common.js` + auto-init `js/sortable.js` make every data table
  click-to-sort (list, tonight, seestar, admin observations / equipment /
  dashboard recent-uploads / telescope-usage / backups). Numeric, date,
  rating, size and catalog-id columns sort correctly via per-cell
  `data-sort` keys; blanks sink to the bottom; planner keeps its existing
  bespoke sorter.

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
16. ✅ **Twilight + moon-up bands on the planner** — astronomical-dark and
    moon-up windows alongside the targets list; uses
    `sunPosition`/`moonPosition` in `lib/astro.js`.
17. ✅ **Moon-distance filter on planner** — `min_moon_sep` query param +
    a "Min moon sep (°)" toolbar input; targets render their moon Δ.
18. ✅ **Object aliases editor** — `PATCH /api/admin/objects/:id` plus a
    chip-style editor on the admin object page. Aliases are stored
    normalised so the existing cross-list ticking picks them up.
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
22. ✅ **Lifetime stats panel** — block on the admin dashboard showing
    integration hours, distinct targets, observations this year, and
    longest + current streak (UTC-day basis).
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
34. ✅ **Catalog search beyond seeded lists** — bundled OpenNGC dataset
    (`db/seed/ngc.json`, ~7,500 objects ≤ mag 14) drives a
    `GET /api/admin/objects/lookup` endpoint; the upload form auto-fills
    catalog/RA/Dec/type when the user types an NGC/IC designation.
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

### Sky / weather data

40. ✅ **Weather auto-fill from Open-Meteo** — `GET /api/admin/weather`
    proxies the free Open-Meteo archive API for the date+lat/lon and
    returns cloud cover, temperature, dew point, humidity, plus a 1–5
    transparency hint that pre-fills the upload form.
41. ✅ **SQM-L sky quality reading per observation** — new `sqm` column
    (mag/arcsec²), input on the upload form, persisted alongside Bortle.
42. ✅ **iCalendar dark-moon weekend feed** — `/api/calendar/dark-moon.ics`
    serves Friday-Sunday windows around each new moon for the next year.
    Subscribe in any calendar app.
43. ✅ **Equipment usage stats per scope** — "Seestar S30 Pro: 47 nights,
    1,200 frames, avg rating 3.8" panel under the existing telescope
    chips. Pure aggregation, no schema change.
44. **Slack/Discord webhook on new observation** — outbound POST to a
    configured URL on each finalised observation. One env var, ~30 lines.
45. ✅ **Bortle ↔ SQM converter** — typing into either the Bortle or SQM
    field updates the other on the upload form (centre-of-band mapping).

## Open bugs / hardening (audit, 2026-05)

A sweep of the codebase after the planner / Seestar planner / upload-flow
expansions. Listed roughly by user-visible impact, not effort.

### Should fix soon

46. ✅ **No cache-busting on `/js/*.js`.** Static page `<script type="module"
    src="/js/foo.js">` URLs never change, so when a Docker build ships
    new JS the browser keeps serving the old one until the user does a
    hard refresh. Several "it's still broken" reports in this session
    traced back to this. Fix: stamp `?v=<GIT_SHA>` into the script tags
    server-side at request time, using the `GIT_SHA` build-arg the
    docker workflow already passes.
47. ✅ **`/admin/object.html?id=undefined` link generated for free-form
    observations.** `admin/observations.js` lines ~93–98 wrap the
    object cell in an anchor whenever `o.object_id || (o.catalog &&
    o.catalog_number)` is truthy, but the href uses `o.object_id`
    only — so a free-form catalog row (e.g. a comet observation typed
    `C/2023 A3`) renders `<a href="/admin/object.html?id=undefined">`.
    Either drop the anchor when `o.object_id` is null, or send the
    user to `/admin/observations.html#row-N` instead.
48. ✅ **`clamp()` returns NaN for unparseable numbers.** The helper at
    line ~2031 reads `Math.max(lo, Math.min(hi, Number(v)))` — if
    `Number(v)` is NaN, the math propagates NaN and we hand it to
    `better-sqlite3`. Hard to hit through the UI (clients always send
    digits) but a crafted POST `{rating:"abc"}` either errors out or
    stores NULL silently. Fix: `Number.isFinite(n) ? clampedValue
    : null`.
49. ✅ **Seestar planner stalls bail after 1 h with no target.** The
    stall counter is gone; the walk now steps 15 min at a time all the
    way to `sessionEnd`, so a dry hour mid-night no longer truncates
    the rest of the plan.
50. ✅ **OpenNGC alias collisions.** `lib/ngc.js` indexes both primary
    name and every Common-name alias in a single `Map`, so when two
    catalog entries share a common name (e.g. "Veil Nebula" maps to
    multiple NGCs) only the first one wins. Symptom: typing a popular
    alias picks an unexpected NGC. Fix: keep aliases in a separate
    multimap and surface a "did you mean …?" picker when more than
    one match exists.

### Latent / security-adjacent

51. ✅ **No CSRF protection on `/api/admin/*` write endpoints.**
    `basicAuth` now rejects non-GET requests whose `Origin` header host
    doesn't match the request `Host` (403). Origin-less clients (curl,
    scripts) still pass; browsers always send Origin on cross-site
    fetch/XHR/form POSTs, which is the attack this blocks.
52. ✅ **No rate-limit on successful admin writes.** The per-IP sliding
    window in `basicAuth` only counts failures; once authed, a bot
    with the password can spam observations. Add a token bucket on
    write endpoints to make abuse noisy.
53. **Auth-failure window is in-memory only.** `authFailures` is a
    plain Map, wiped on every restart. An attacker that can crash
    the server (e.g. by stuffing an enormous FITS file through the
    50 MB cap — multer drops it but allocations could still spike
    on a tiny VPS) resets their lockout. Persist to SQLite or use
    a sliding window keyed by a stable identifier.
54. **No HTTPS redirect / HSTS.** Server speaks plain HTTP. If
    deployed behind a reverse proxy without TLS termination
    correctly configured, the admin password leaks in clear text.
    Add a check at boot that warns when `TRUST_PROXY=1` is set
    without `https://` being visible in `X-Forwarded-Proto`.
55. ✅ **Open-Meteo proxy hammers upstream on every keystroke.** The
    auto-fetch is now debounced by 750 ms on top of the existing
    tuple de-dupe.
56. ✅ **Tessdata cache is permanent on failure.** Init failure now
    disables OCR for a 10-minute cooldown (`OCR_RETRY_AFTER_MS` to
    tune) instead of forever, and the bundled-tessdata check runs
    per-init so dropping `eng.traineddata.gz` into `vendor/tessdata/`
    is picked up without a restart. `DISABLE_OCR=1` stays permanent.

### Cosmetic / UX nits

57. ✅ **`<tr class="dim">` only dims the text color.** Added a
    `tr.dim a { color: var(--fg-dim); }` override so below-horizon
    rows read as dimmed links too.
58. ✅ **Site-name script flashes the placeholder.** The configured
    name is cached in localStorage and applied synchronously on load;
    the `/api/settings` fetch confirms/corrects it and refreshes the
    cache, so the flash only happens on the very first visit.
59. ✅ **The `_default: 60` in seestar planner response is unused.**
    Kept deliberately: it documents the fallback duration in the API's
    self-description and the smoke test asserts it. Closing as
    "decided", not code-changed.
60. ✅ **Free-form comet observation has no enforcement of RA/Dec.**
    The upload form now shows a live "won't appear in the planners"
    warning under the RA/Dec inputs whenever a free-form object type
    is chosen without coordinates.
61. **No way to delete a custom list.** The future-ideas backlog
    item #19 (CSV list import) implies users can add lists — once
    that ships, they'll need to be able to remove them too. Add the
    delete path while doing #19.
62. ✅ **`linkish` class still uppercases its label text everywhere it's
    used.** Dropped `text-transform: uppercase` / `letter-spacing`
    from `.linkish`; its one remaining use ("browse your files") now
    reads as a normal mid-sentence link.

## Fixed in the 2026-07 audit

A full-codebase sweep (server, lib, db, public JS, admin JS). Everything
below shipped together; listed here so the change log has one home.

- **Dark-moon iCalendar feed was wrong ~93% of the time.** The new-moon
  search stepped `now + i × synodic`, so every candidate window shared
  *today's* phase and the ±48 h refine almost never contained a real new
  moon. Now anchored on the next actual new moon. Also the "closest
  Saturday" pick always went forward (both branches reduced to `6-day`),
  putting a Sunday new moon's "dark weekend" six days late — now picks
  the genuinely nearest Saturday. Covered by a new smoke test.
- **Catalog progress counts inflated by multi-attempt objects.**
  `COUNT(lo.id)` after the `LEFT JOIN list_completions` in `/api/lists`
  and `/api/admin/stats` double-counted objects with >1 completion, so
  Messier read "N of 111+". Both now `COUNT(DISTINCT lo.id)`; smoke test
  pins Messier at 110.
- **FITS `DATE-OBS` parsed as server-local time.** Zone-less FITS dates
  are UTC by spec; `Date.parse` treated them as local, shifting
  `observed_at` by the server's UTC offset. Now suffixed with `Z`.
- **FITS `APERTURE` (objective diameter, mm) rendered as a focal
  ratio.** A Seestar S50 FITS showed "Aperture f/50.0". `fitsExif` now
  converts FOCALLEN/APERTURE to a true f-number before storing.
- **FITS escaped quotes (`''`) truncated string cards** — `OBJECT =
  'O''Neill Cluster'` parsed as `O`.
- **Free-form `object_name` was silently discarded.** The upload form
  and the iOS shortcut both send it, but no column existed — a comet
  logged as "Comet Lemmon" had no record of the name. New migration 15
  adds `observations.object_name`; it's inserted, PATCH-editable, and
  surfaced through every public/admin query via
  `COALESCE(lo.name, o.object_name)`.
- **Clearing the default location planted uploads at Null Island.**
  `/api/settings` coerced the stored `''` with `Number('')` → `0`, so
  every EXIF-less upload auto-filled (0, 0). Cleared values now come
  back `null` (smoke-tested).
- **Upload form wiped NGC-fallback / manually-typed catalog ids at
  save.** The submit handler re-ran the resolver unconditionally, which
  clears catalog/number for any non-seeded value — so IC/comet
  designations saved as NULL and never ticked lists. Resolve now only
  re-runs when the input matches a seeded row.
- **Sidecar JSON dropped with an image was discarded** — applied
  immediately, then wiped seconds later when the stage activated. Now
  held and applied after the per-image reset.
- **Telescope selection cleared on every batch-queue advance** despite
  being documented as shared; manual picks now survive images with no
  device metadata.
- **"+ Log another attempt" preselection wiped by the first drop** —
  the `?object_id=` preselect is now re-applied whenever the staged
  image carries no target guess of its own.
- **Edit modal rejected fractional exposures** (`step` mismatch on
  0.5 s EXIF values) — number fields now use `step="any"`.
- **★ Feature button 400'd on free-form rows** — hidden where there's
  no catalog id to feature against.
- **"Saved observation #N" confirmation erased instantly in batch
  mode**; the sticky dropzone drag-highlight; the stale sidecar file
  input; the browse picker refusing `.fits`/`.json` — all fixed.
- **Observation delete removed image files before the DB transaction**;
  a failed delete stranded a row with no files. Files now go only after
  commit. `observed_at` is validated on create (was PATCH-only).
- **Arrow-key nav on the observation page went the wrong way at either
  end** (`:first-of-type` matched by element type, not position).
- **Saved catalog filter silently dropped on planner/tonight/seestar
  auto-load** — the filter-mounted re-run checked a DOM state that the
  in-flight load had already cleared. Now tracked with a flag.
- **Planner "Object" column sorted lexically** (M1, M10, M100, M2…);
  `0` minutes-above rendered as "—"; `tonight.js` crashed outright on
  corrupt localStorage; observations at latitude/longitude 0 lost
  their map; data pages clobbered a configured site name back to
  "DeepSkyLog" in the tab title.
- **Atlas "scroll to zoom" was a no-op** (camera distance clamped) —
  replaced with FOV zoom.
- **Crossref match radius `0` silently became 6′** (`|| 0.1` on a
  falsy 0).
- **GPS hint credited "watermark OCR" for coordinates that came from
  EXIF GPS** — the stage response now flags the actual source
  (`coords_from_text`).
- **OCR hardening:** recognize-timeouts now terminate the stuck shared
  worker instead of queueing every later upload behind it; the
  uncaught-exception shim removes only its own listener rather than
  all of them; astrometry.net responses that are 200-but-HTML surface
  a readable error instead of a bare SyntaxError.

## Open bugs / hardening (still open after the 2026-07 audit)

63. **"Attempt 1 of 0" on free-form rows with a catalog but no
    number.** `catalog || catalog_number` is NULL in SQL when either
    side is NULL, so the sibling query matches nothing while the token
    is non-empty. Guard the token on *both* parts being present.
64. **Bulk plate solve accepts an unbounded explicit `ids[]` list.**
    The no-ids path caps at 50; a crafted payload can queue thousands
    of sequential Nova uploads. Clamp `ids.length` to the same 50.
65. **CSV export is vulnerable to spreadsheet formula injection.**
    A description starting with `=`/`+`/`-`/`@` executes when the CSV
    is opened in Excel. Prefix such cells with `'` (or a tab) in
    `/api/observations.csv`.
66. **`authFailures` / `writeHits` maps grow per-IP without pruning.**
    Entries for dead IPs are only rewritten when that IP returns.
    Sweep empty/expired entries on the hourly stage-dir timer.
67. **Weather/location-stats dedupe keys are global, not per-chip.**
    Two queued images with identical (date, lat, lon) leave the second
    chip's weather summary blank because the fetch is deduped away.
    Reset `lastAutoWeatherKey`/`lastLocationStatsKey` in
    `resetPerImageFields`.
68. **Seestar planner: `any` scope never gets Milky Way wide-field
    targets.** MWWF is gated to `s30pro` scopes only; a single-scope
    "Any" plan silently excludes them even though "any" may well be an
    S30 Pro. Consider letting `any` include them with a note.
69. **Atlas zoom is wheel-only.** The FOV zoom added in the 2026-07
    audit doesn't handle touch pinch; mobile users still can't zoom.
    Wire `touchmove` pinch distance to the same FOV clamp.
