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
43. **Equipment usage stats per scope** — "Seestar S30 Pro: 47 nights,
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
49. **Seestar planner stalls bail after 1 h with no target.** The
    walk-forward loop advances by 15 min when nothing fits and gives
    up after 4 stalls in a row — fine for a sparse catalog filter on a
    short night, but on a narrow `types=` selection it can end the
    plan early instead of skipping over a dry hour and resuming when
    something rises again. Better: keep stepping forward until
    `sessionEnd`, only break on natural end.
50. ✅ **OpenNGC alias collisions.** `lib/ngc.js` indexes both primary
    name and every Common-name alias in a single `Map`, so when two
    catalog entries share a common name (e.g. "Veil Nebula" maps to
    multiple NGCs) only the first one wins. Symptom: typing a popular
    alias picks an unexpected NGC. Fix: keep aliases in a separate
    multimap and surface a "did you mean …?" picker when more than
    one match exists.

### Latent / security-adjacent

51. **No CSRF protection on `/api/admin/*` write endpoints.** Basic-auth
    is automatically attached by the browser, so any tab logged into
    the admin can be tricked into POSTing a delete from a hostile
    origin via `fetch(..., {credentials: 'include'})`. Fix: require
    a same-origin header, a CSRF token, or switch admin to a session
    cookie with `SameSite=Strict`.
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
55. **Open-Meteo proxy hammers upstream on every keystroke.** The
    upload form auto-fetches weather whenever `(date, lat, lon)`
    changes. While the client de-dupes consecutive identical
    tuples, fast typing of the GPS field triggers many distinct
    tuples in flight. Open-Meteo's free tier will 429 if you push
    too fast. Debounce the auto-fetch by ~750 ms.
56. **Tessdata cache is permanent on failure.** `lib/seestar_ocr.js`
    sets `permanentlyDisabled = true` if init fails once, and
    never retries even if the env recovers (e.g. CDN comes back up
    or a sysadmin drops `eng.traineddata` into `vendor/tessdata/`).
    Reset the flag on SIGHUP, or retry every N minutes.

### Cosmetic / UX nits

57. **`<tr class="dim">` only dims the text color.** Below-horizon
    Seestar / planner rows inherit the dim foreground colour, but
    anchor cells stay the regular accent orange so the visual
    difference is subtle. Either dim the row background instead
    or add an `tr.dim a { color: var(--muted); }` override.
58. **Site-name script flashes the placeholder.** `js/site-name.js`
    fetches `/api/settings` after the page parses, so the user sees
    "DeepSkyLog" briefly before the configured name swaps in. Inject
    the name server-side as a `<meta>` tag, or use a CSS variable
    set inline in the page head.
59. **The `_default: 60` in seestar planner response is unused.** Send
    it or drop it — currently it sits in the JSON for nobody.
60. **Free-form comet observation has no enforcement of RA/Dec.**
    Choosing `object_type=COMET` on the upload form makes the comet
    visible in the gallery, but if the user doesn't also enter
    RA/Dec the planner can't compute alt-az and the comet vanishes
    from `/api/planner` and `/api/seestar-planner`. Either flag the
    missing coords on save, or surface a "won't appear in planners"
    warning next to the comet option.
61. **No way to delete a custom list.** The future-ideas backlog
    item #19 (CSV list import) implies users can add lists — once
    that ships, they'll need to be able to remove them too. Add the
    delete path while doing #19.
62. **`linkish` class still uppercases its label text everywhere it's
    used.** Fixed for the "Use this device's location" link in PR #57,
    but the original "browse your files" link on the upload dropzone
    still uses it. Audit `.linkish` usages and either drop the class
    entirely or document that it expects short labels.
