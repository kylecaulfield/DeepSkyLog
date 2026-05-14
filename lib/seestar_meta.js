// Regex-based parsers for free-form Seestar metadata text — applied to both
// EXIF text fields (Artist / ImageDescription / UserComment / XP*) and OCR
// output from the watermark band. None of these throw; they just return null
// when the pattern doesn't match.

// Catalog prefix vocabulary kept aligned with the seeded lists. Match is
// case-insensitive and tolerates an optional space or dash between prefix
// and number ("M81", "M 81", "NGC-6960", "Sh2-275").
const TARGET_RE =
  /\b(M(?:essier)?|NGC|IC|Sh\s*2|Sh-?\s*\d|C(?:aldwell)?|Cr|Mel|Tr|Abell|LDN|LBN|LG|SOL|PN|OC|GC|Sol)\s*[-–—]?\s*(\d{1,4}[A-Za-z]?)\b/i;

const EXPOSURE_HM_RE =
  /(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in|ins?)?)?/i;

function parseTarget(text) {
  if (!text) return null;
  const m = text.match(TARGET_RE);
  if (!m) return null;
  let catalog = m[1].toUpperCase().replace(/\s+/g, '');
  if (catalog === 'MESSIER') catalog = 'M';
  if (catalog === 'CALDWELL') catalog = 'C';
  if (/^SH/.test(catalog)) catalog = 'Sh2';
  const number = m[2];
  return { catalog, number, raw: `${catalog}${number}` };
}

// Returns total exposure in seconds, or null. Recognises "52min", "1h30m",
// "2.5h", "1.5 hours", "120 min".
function parseExposureSeconds(text) {
  if (!text) return null;
  const m = text.match(/(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*)?(?:(\d+(?:\.\d+)?)\s*m(?:in|ins?)?)/i);
  if (m && (m[1] || m[2])) {
    const hours = m[1] ? parseFloat(m[1]) : 0;
    const minutes = m[2] ? parseFloat(m[2]) : 0;
    return Math.round(hours * 3600 + minutes * 60);
  }
  // Bare hours, e.g. "2.5h"
  const h = text.match(/\b(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/i);
  if (h) return Math.round(parseFloat(h[1]) * 3600);
  return null;
}

// "88° W, 42° N", "42°N 88°W", "42N / 87W", "42 N 87 W" — order and
// degree symbol are flexible. The degree glyph is optional because
// Tesseract often drops it on the low-contrast Seestar watermark band.
// We require a digit→letter token (NSEW) on a word boundary so a stray
// "5N" inside a name like "Kyle N." doesn't match.
function parseCoords(text) {
  if (!text) return null;
  const re = /(\d{1,3}(?:\.\d+)?)\s*[°˚⁰]?\s*([NSEW])\b/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length < 2) return null;
  let lat = null;
  let lon = null;
  // Walk the matches; the first N/S wins for lat, the first E/W for lon.
  for (const m of matches) {
    const v = parseFloat(m[1]);
    const dir = m[2].toUpperCase();
    if (lat == null && (dir === 'N' || dir === 'S')) lat = dir === 'N' ? v : -v;
    else if (lon == null && (dir === 'E' || dir === 'W')) lon = dir === 'E' ? v : -v;
  }
  if (lat == null || lon == null) return null;
  // Sanity-clamp: nonsense readings (e.g. "Bortle 4N" giving lat=4)
  // aren't worth keeping. Latitudes are ±90, longitudes ±180.
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: lat, longitude: lon };
}

// "2026.03.28 01:41" or "2026-03-28T01:41" — returns an ISO-ish local string
// (no timezone) compatible with <input type="datetime-local">.
function parseCaptureDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[\sT]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mn] = m;
  const pad = (s, n = 2) => String(s).padStart(n, '0');
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mn)}`;
}

// Pull a likely human name from the line containing "/" separators that
// Seestar prints under the telescope label, e.g. "Kyle Caulfield / 88° W, …".
function parsePhotographer(text) {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('/')) continue;
    const head = line.split('/')[0].trim();
    if (head && head.length <= 64 && !/seestar|°/i.test(head) && /[A-Za-z]/.test(head)) {
      return head;
    }
  }
  return null;
}

// Seestar export filenames are highly structured, e.g.
//   Stacked_206_C 4_10.0s_IRCUT_20241027-213334.jpg
//   Light_206_M 31_30.0s_LP_20240901-021500.fits
//   Stacked_570_mosaic_M 31_10.0s_IRCUT_20250927-234646.jpg  (mosaic prefix)
// Decoded:
//   <kind>_<count>_[mosaic_]<target>_<sub_exposure>s_<filter>_<YYYYMMDD>-<HHMMSS>
// Older firmware sometimes drops the count or the filter; we accept those.
function parseFilename(name) {
  if (!name) return null;
  const base = String(name).replace(/\.[a-z0-9]+$/i, '');
  const m = base.match(
    /^(?:Stacked|Light(?:\s*Frame)?)_(?:(\d+)_)?(.+?)_([\d.]+)s(?:_([A-Za-z0-9._-]+))?_(\d{8})-(\d{6})$/i,
  );
  if (!m) return null;
  const [, count, target, exp, filter, ymd, hms] = m;
  // The Seestar app prepends 'mosaic_' for mosaic stacks. Strip it so the
  // target reads as e.g. "M 31" (parseTarget'able) instead of "mosaic_M 31"
  // — there's no \b boundary between '_' and 'M', so the catalog regex
  // would otherwise never fire on a mosaic file.
  const cleanedTarget = target.replace(/^mosaic_/i, '').trim();
  const captured_at =
    `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T` +
    `${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
  return {
    stack_count: count ? Number(count) : null,
    target: parseTarget(cleanedTarget),
    target_raw: cleanedTarget,
    exposure_seconds: Number(exp),
    filter_name: filter || null,
    captured_at,
  };
}

// One-stop helper: run all parsers and return whatever we found.
function parseAll(text) {
  return {
    target: parseTarget(text),
    exposure_seconds_total: parseExposureSeconds(text),
    coords: parseCoords(text),
    captured_at: parseCaptureDate(text),
    photographer: parsePhotographer(text),
  };
}

module.exports = {
  parseTarget,
  parseExposureSeconds,
  parseCoords,
  parseCaptureDate,
  parsePhotographer,
  parseFilename,
  parseAll,
};
