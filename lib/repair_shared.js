// Helpers shared by the boot-time data repairs (lib/repair_optics.js,
// lib/repair_dates.js).
'use strict';

const fs = require('fs');
const path = require('path');

// A stored image's absolute path, or null if it is missing or would resolve
// outside the upload directory.
function storedImagePath(uploadDir, relPath) {
  if (!relPath) return null;
  const root = path.resolve(uploadDir);
  const full = path.resolve(root, relPath);
  if (!full.startsWith(root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}

// Copy the live database to BACKUP_DIR/deepskylog-before-<label>-<UTC
// stamp>.sqlite with SQLite's online backup, before a repair changes rows.
// Resolves to the file's path; rejects if the copy can't be written.
async function snapshotDatabase(db, backupDir, label) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString()
    .replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  const dest = path.join(backupDir, `deepskylog-before-${label}-${stamp}.sqlite`);
  await db.backup(dest);
  return dest;
}

module.exports = { storedImagePath, snapshotDatabase };
