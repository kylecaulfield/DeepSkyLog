# Backlog

## High value, not much work

1. **Tonight’s targets page** — objects not yet observed sorted by what’s
   actually up right now based on your location and current time. Huge
   practical value for planning sessions.
2. **Seeing / transparency log per session** — a 1–5 scale and a notes field.
   You’ll want this data six months from now when you’re trying to remember
   why a particular night’s images look rough.
3. **Weather-condition tags on observations** — moon phase and Bortle zone of
   the location stored alongside each session.

## Medium effort, high payoff

4. **Seestar-specific integration** — the S50 and S30 Pro generate JSON log
   files alongside the images. Parse those automatically on upload to pull
   exposure count, stacking info, and gain settings. Much better than manual
   entry.
5. **Multi-image support per object** — current spec is one image per
   observation, but you’ll want to track multiple attempts at M42 over
   different nights and compare them.
6. **Session planner** — pick a date and location, get a list of your
   unobserved targets sorted by altitude window for that night. Even a basic
   version is genuinely useful.
7. **FITS upload support** — Seestar S50 stores every stacked sub as a FITS
   file with all the useful metadata (`INSTRUME`, `OBJECT`, `DATE-OBS`,
   `EXPTIME`, `FILTER`, `CCD-TEMP`, RA/Dec) in the ASCII header. Today the
   pipeline rejects FITS three ways, verified against the files in
   `samples/`:
   1. `stageUpload` filter (`server.js:146-149`) only allows `image/*` mimes,
      so browsers sending `application/octet-stream` for `.fit` get a 500.
   2. `exifr.parse` returns all-null on FITS, so `matchTelescope` can't
      auto-detect the Seestar even though the header says so.
   3. `sharp(...).toFile(thumbPath)` (`server.js:614-618`) throws
      `Input file contains unsupported image format` → finalize 500s and the
      observation row is never written.

   Sketch: accept `image/fits` + `.fit`/`.fits` extensions in the filter, add
   a tiny FITS-header reader (plain 2880-byte ASCII blocks — no dep needed)
   that populates `captured_at`/`device`/`exposure_seconds` from
   `DATE-OBS`/`INSTRUME`/`EXPTIME`, and branch the thumbnailer: for FITS, use
   a small renderer (astropy via a subprocess, or `fitsjs` + `canvas`) to
   produce a JPEG preview, then hand that to `sharp` for the 640px thumb.
   Keep the original `.fit` as the canonical file so processing tools still
   work. `samples/` is a ready-made regression fixture.

## Longer term

7. **Astrometry.net integration** — submit an image, get back the exact
   RA/Dec, field of view, and orientation. Auto-identifies what you actually
   photographed even if you’re not sure. They have a free API.
8. **Image quality scoring** — use something like BHHW star FWHM measurement
   to automatically grade sharpness. Tells you which nights were actually good
   seeing vs. which just felt good.
9. **Comparison view** — stack two attempts at the same object side by side
   with metadata. Great for tracking improvement over time.
10. **Mobile upload** — a simple PWA wrapper so you can upload directly from
    your phone in the field without going through a laptop.
11. **Herschel 400 and SAC 110 completion tracking** — the seed data in the
    initial build covers Messier and Caldwell. Adding the rest of the major
    lists makes the completion dashboard much more satisfying.
