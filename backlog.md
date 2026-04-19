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
