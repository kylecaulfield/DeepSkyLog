// One-time correction of observation dates that are really upload times.
//
// When an upload had no capture time to offer, the upload form pre-filled
// the date with "now" and the iOS shortcut sent the current time, so before
// the watermark band reader existed many Seestar exports were saved with the
// minute they were uploaded. The Seestar watermark prints when the image was
// taken. server.js runs this in the background after the optics repair:
//
//   - A candidate is a stored image that may be a Seestar export (its EXIF
//     names a Seestar / ZWO device, or there is no camera EXIF at all) whose
//     observed_at is its upload time: created_at (UTC) shifted by a
//     whole-hour time-zone offset, less at most 15 minutes spent in the form.
//     The offset must be the uploader's own: the most common one among the
//     candidates, give or take an hour for daylight saving — a date that
//     only lines up with some faraway zone (UTC−12) is a coincidence.
//   - Its watermark date replaces observed_at when the band reads one that is
//     no later than the upload. Seestar EXIF often records the capture time
//     too (the app's JSON note in OwnerName, or a DateTimeOriginal string the
//     upload pipeline couldn't parse): when it does, the two must agree to a
//     few minutes, give or take whole hours of time zone, or the row is left
//     alone; when the watermark has no usable date, the EXIF time is used.
//     The moon phase is recomputed the way the observation editor does.
//   - The database is copied to BACKUP_DIR before the first change; if that
//     fails nothing is changed.
//   - The pass is recorded in maintenance_runs and never runs again — unless
//     OCR was unavailable for some image, in which case the next boot retries.
'use strict';

const { moonPhase } = require('./astro');
const { storedImagePath, snapshotDatabase } = require('./repair_shared');

const RUN_NAME = 'watermark-dates-v1';
// Upload-time window: the form stamps "now" when staged, the row is created
// when saved, so observed_at trails created_at by 0–15 minutes (1 minute of
// slack for clocks and observed_at's truncated seconds).
const FORM_MINUTES = 15;
const SLACK_MINUTES = 1;
const MINUTE = 60_000;

// 'YYYY-MM-DDTHH:MM[:SS]', optionally with Z or ±HH:MM, to
// { wall, abs }: wall is the wall-clock time as if it were UTC (ms, seconds
// dropped), abs the real instant when a zone was given, else null. Only real
// calendar dates from 2000 on: EXIF's "0000:00:00 00:00:00" placeholder (which
// Date.UTC would quietly turn into 1900) and Feb 30 are rejected, not rolled.
function parseWhen(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(text || '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(wall).getUTCDate() !== d) return null;
  const zone = m[6];
  if (!zone) return { wall, abs: null };
  if (zone === 'Z') return { wall, abs: wall };
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  return { wall, abs: wall - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * MINUTE };
}

// When observed_at is the upload time: { upload, hours }, the upload on
// observed_at's own wall clock (ms, wall-clock-as-UTC: what the watermark
// date is compared with) and the UTC offset that wall clock implies (null
// for a zoned observed_at, already an instant). Otherwise null.
function uploadMatch(observedAt, createdAt) {
  const obs = parseWhen(observedAt);
  const created = parseWhen(`${createdAt}Z`.replace(/ZZ$/, 'Z'));
  if (!obs || !created) return null;
  const isUploadLag = (lag) => lag >= -SLACK_MINUTES && lag <= FORM_MINUTES + SLACK_MINUTES;
  if (obs.abs != null) {
    const lag = (created.abs - obs.abs) / MINUTE;
    return isUploadLag(lag) ? { upload: obs.wall + lag * MINUTE, hours: null } : null;
  }
  for (let hours = -14; hours <= 14; hours++) {
    const upload = created.abs + hours * 60 * MINUTE;
    if (isUploadLag((upload - obs.wall) / MINUTE)) return { upload, hours };
  }
  return null;
}

// Capture time recorded in Seestar EXIF, as 'YYYY-MM-DDTHH:MM', or null:
// the app's JSON note in OwnerName ({"result":{"date":"YYYY-MM-DD HH:MM:SS"}})
// or a raw DateTimeOriginal string ('YYYY:MM:DD HH:MM:SS', or with dots). A
// DateTimeOriginal exifr already parsed is stored as an ISO instant and was
// used at upload, so it is not consulted.
function exifCaptureTime(exifJson) {
  let exif;
  try { exif = JSON.parse(exifJson); } catch { return null; }
  if (!exif || typeof exif !== 'object') return null;
  const candidates = [];
  try { candidates.push(JSON.parse(exif.OwnerName)?.result?.date); } catch {}
  if (typeof exif.DateTimeOriginal === 'string' && !/Z$/.test(exif.DateTimeOriginal)) {
    candidates.push(exif.DateTimeOriginal);
  }
  for (const c of candidates) {
    const m = /^(\d{4})[-:.](\d{2})[-:.](\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(String(c || '').trim());
    if (!m) continue;
    const text = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
    if (parseWhen(text)) return text;
  }
  return null;
}

// Watermark and EXIF capture times agree when they are within a few minutes
// of each other, allowing whole-hour time-zone differences of up to 2 h
// (seen on real exports: the watermark an hour behind the app's note).
function sameCapture(a, b) {
  const delta = (a - b) / MINUTE;
  for (let hours = -2; hours <= 2; hours++) {
    if (Math.abs(delta - hours * 60) <= 3) return true;
  }
  return false;
}

// Same gate as staging: EXIF names a Seestar / ZWO device, or carries no
// camera identity at all. FITS rows store their header, not EXIF: skip.
function maybeSeestar(exifJson) {
  if (exifJson == null) return true;
  let exif;
  try { exif = JSON.parse(exifJson); } catch { return false; }
  if (!exif || typeof exif !== 'object' || Array.isArray(exif) || exif.fits) return false;
  const camera = [exif.Make, exif.Model].filter(Boolean).map(String).join(' ').trim();
  const device = [exif.Make, exif.Model, exif.Software].filter(Boolean).map(String).join(' ');
  return /seestar|zwo/i.test(device) || !camera;
}

function findCandidates(db) {
  const rows = db.prepare(
    `SELECT id, image_path, observed_at, created_at, exif_json
       FROM observations
      WHERE image_path IS NOT NULL AND observed_at IS NOT NULL`,
  ).all();
  const out = [];
  const perOffset = new Map();
  for (const row of rows) {
    if (!maybeSeestar(row.exif_json)) continue;
    const match = uploadMatch(row.observed_at, row.created_at);
    if (!match) continue;
    if (match.hours != null) perOffset.set(match.hours, (perOffset.get(match.hours) || 0) + 1);
    out.push({
      id: row.id, imagePath: row.image_path, observedAt: row.observed_at,
      upload: match.upload, hours: match.hours,
      wall: parseWhen(row.observed_at).wall, exifTime: exifCaptureTime(row.exif_json),
    });
  }
  // The uploader's offset: the most common one (ties: nearest to UTC).
  let home = null;
  for (const [hours, n] of perOffset) {
    if (home == null || n > perOffset.get(home) || (n === perOffset.get(home) && Math.abs(hours) < Math.abs(home))) home = hours;
  }
  return out.filter((c) => c.hours == null || Math.abs(c.hours - home) <= 1);
}

// Resolves to { checked, corrected, fromExif, conflicting, unreadable,
// ocrUnavailable, backup, done }.
// Never rejects: failures are logged and the next boot tries again.
async function repairWatermarkDates({ db, uploadDir, backupDir, readBand, log = console }) {
  const result = {
    checked: 0, corrected: 0, fromExif: 0, conflicting: 0, unreadable: 0, ocrUnavailable: 0, backup: null, done: false,
  };
  try {
    if (db.prepare('SELECT 1 FROM maintenance_runs WHERE name = ?').get(RUN_NAME)) {
      result.done = true;
      return result;
    }
    const candidates = findCandidates(db);

    // Read every candidate's watermark first, so the backup is only taken
    // when something will actually change.
    const changes = [];
    // A capture time later than the upload is a misread.
    const usable = (text, row) => {
      const t = text ? parseWhen(text) : null;
      return t && t.wall <= row.upload + SLACK_MINUTES * MINUTE ? t : null;
    };
    for (const row of candidates) {
      const image = storedImagePath(uploadDir, row.imagePath);
      const band = image ? await readBand(image) : undefined;
      if (image) result.checked++;
      if (band === null) { result.ocrUnavailable++; continue; }
      const fromBand = usable(band?.captured_at, row);
      const fromExif = usable(row.exifTime, row);
      let value = null;
      if (fromBand && fromExif && !sameCapture(fromBand.wall, fromExif.wall)) {
        result.conflicting++;
        continue;
      }
      if (fromBand) value = band.captured_at;
      else if (fromExif) value = row.exifTime;
      if (!value) { result.unreadable++; continue; }
      if (parseWhen(value).wall === row.wall) continue;
      if (!fromBand) result.fromExif++;
      changes.push({ id: row.id, was: row.observedAt, value });
    }

    if (changes.length) {
      result.backup = await snapshotDatabase(db, backupDir, 'date-repair');
      const update = db.prepare(
        `UPDATE observations
            SET observed_at = @value, moon_phase = @phase, moon_phase_name = @name,
                updated_at = datetime('now')
          WHERE id = @id AND observed_at = @was`,
      );
      const apply = db.transaction((list) => {
        let n = 0;
        for (const c of list) {
          const mp = moonPhase(new Date(c.value));
          n += update.run({ ...c, phase: mp.phase, name: mp.name }).changes;
        }
        return n;
      });
      result.corrected = apply(changes);
    }

    const summary = `${result.corrected} corrected (${result.fromExif} from the EXIF capture time), `
      + `${candidates.length} checked, ${result.unreadable} without a readable date, `
      + `${result.conflicting} left alone because the watermark and EXIF disagree`;
    if (!result.ocrUnavailable) {
      db.prepare('INSERT OR REPLACE INTO maintenance_runs (name, summary) VALUES (?, ?)').run(RUN_NAME, summary);
      result.done = true;
    }
    if (candidates.length) {
      log.log(`Watermark date repair: ${summary}`
        + (result.backup ? `. Database backed up to ${result.backup} first.` : '.')
        + (result.ocrUnavailable ? ` OCR was unavailable for ${result.ocrUnavailable}; will retry next boot.` : ''));
    }
  } catch (err) {
    log.warn(`Watermark date repair failed: ${err.message}`);
  }
  return result;
}

module.exports = {
  repairWatermarkDates,
  _parse: { parseWhen, uploadMatch, maybeSeestar, exifCaptureTime, sameCapture },
  _findCandidates: findCandidates,
};
