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
