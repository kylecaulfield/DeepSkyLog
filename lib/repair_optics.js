// One-time repair of observations saved before lib/exif_sanity existed.
//
// Recent Seestar app exports point ExposureTime, FNumber and FocalLength at
// their GPS block, so all three decode to the same junk number (≈2.0000076),
// and finalize stored it as the observation's exposure, focal length and
// aperture. server.js runs this in the background on every boot:
//
//   - A row qualifies when its stored EXIF has the junk signature and one of
//     those columns still holds that exact value. A value the user has since
//     edited no longer matches and is left alone. The exception: the old
//     upload form's exposure input (step 0.1) refused 2.0000076, and the
//     browser offered 2 or 2.1 instead, so an exposure of exactly 2 or 2.1
//     counts as junk too while focal length and aperture still hold the junk
//     (i.e. nobody has edited the row).
//   - Exposure is re-read from the image's watermark band: total
//     integration, or total / stack_count when the row records frames, since
//     exposure_seconds is then read as the per-frame value. When the band
//     can't be read it is cleared. Focal length and aperture are cleared.
//   - Before the first change, the database is copied to BACKUP_DIR. If that
//     copy fails nothing is changed, and the next boot tries again.
//
// A repaired row no longer qualifies, so later boots find nothing to do.
'use strict';

const fs = require('fs');
const path = require('path');
const { junkOpticsValue } = require('./exif_sanity');

// Rows whose columns still hold their EXIF's junk optics value.
function findJunkRows(db) {
  const rows = db.prepare(
    `SELECT id, image_path, exposure_seconds, focal_length_mm, aperture, stack_count, exif_json
       FROM observations
      WHERE exif_json LIKE '%"ExposureTime"%'
        AND (exposure_seconds IS NOT NULL OR focal_length_mm IS NOT NULL OR aperture IS NOT NULL)`,
  ).all();
  const out = [];
  for (const row of rows) {
    let exif;
    try { exif = JSON.parse(row.exif_json); } catch { continue; }
    const junk = junkOpticsValue(exif);
    if (junk == null) continue;
    const focal = row.focal_length_mm === junk;
    const aperture = row.aperture === junk;
    const exposure = row.exposure_seconds === junk
      || (focal && aperture && (row.exposure_seconds === 2 || row.exposure_seconds === 2.1));
    if (exposure || focal || aperture) {
      out.push({
        id: row.id, imagePath: row.image_path, junk, exposure, focal, aperture,
        exposureWas: row.exposure_seconds, stackCount: row.stack_count,
      });
    }
  }
  return out;
}

// The stored image's absolute path, or null if it is missing or would
// resolve outside the upload directory.
function storedImagePath(uploadDir, relPath) {
  if (!relPath) return null;
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, relPath);
  if (!full.startsWith(root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
}

// Resolves to { repaired, restored, cleared, backup } — restored counts
// exposures re-read from the watermark, cleared those set to null. Never
// rejects: failures are logged and leave the rows for the next boot.
async function repairJunkOptics({ db, uploadDir, backupDir, readBand, log = console }) {
  const result = { repaired: 0, restored: 0, cleared: 0, backup: null };
  let rows;
  try {
    rows = findJunkRows(db);
  } catch (err) {
    log.warn(`Junk EXIF optics repair skipped: ${err.message}`);
    return result;
  }
  if (!rows.length) return result;

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const dest = path.join(backupDir, `deepskylog-before-optics-repair-${stamp(new Date())}.sqlite`);
    await db.backup(dest);
    result.backup = dest;
  } catch (err) {
    log.warn(`Junk EXIF optics repair skipped (${rows.length} observation(s) affected): `
      + `could not back up the database first: ${err.message}`);
    return result;
  }

  // Each column is only overwritten if it still holds the value read above,
  // in case it was edited while the watermark was being read.
  const setColumn = (col) => db.prepare(
    `UPDATE observations SET ${col} = @value, updated_at = datetime('now')
      WHERE id = @id AND ${col} = @was`,
  );
  const setExposure = setColumn('exposure_seconds');
  const setFocal = setColumn('focal_length_mm');
  const setAperture = setColumn('aperture');
  const apply = db.transaction((row, exposure) => {
    const args = { id: row.id, was: row.junk, value: null };
    const e = row.exposure ? setExposure.run({ ...args, was: row.exposureWas, value: exposure }).changes : 0;
    const f = row.focal ? setFocal.run(args).changes : 0;
    const a = row.aperture ? setAperture.run(args).changes : 0;
    return { e, any: e + f + a > 0 };
  });
  for (const row of rows) {
    try {
      let exposure = null;
      if (row.exposure) {
        const image = storedImagePath(uploadDir, row.imagePath);
        const band = image ? await readBand(image) : null;
        const total = band?.exposure_seconds_total ?? null;
        exposure = total != null && row.stackCount > 1
          ? Math.round((total / row.stackCount) * 10) / 10
          : total;
      }
      const { e, any } = apply(row, exposure);
      if (any) result.repaired++;
      if (e) {
        if (exposure != null) result.restored++;
        else result.cleared++;
      }
    } catch (err) {
      log.warn(`Junk EXIF optics repair failed for observation ${row.id}: ${err.message}`);
    }
  }
  log.log(`Repaired junk EXIF exposure / focal length / aperture on ${result.repaired} observation(s): `
    + `exposure restored from the watermark on ${result.restored}, cleared on ${result.cleared}. `
    + `Database backed up to ${result.backup} first.`);
  return result;
}

module.exports = { repairJunkOptics, _findJunkRows: findJunkRows };
