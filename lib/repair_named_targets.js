// One-time classification of observations already named after a named target
// (lib/seestar_meta NAMED_TARGETS, e.g. "Milky Way") but saved without an
// object type, from before the watermark reader recognised the Milky Way
// layout. server.js runs it at boot after the date repair:
//
//   - A row qualifies when it has no catalog id, no object type, and its
//     object_name is exactly a named target (any case/spacing).
//   - Its object_type is set to that target's (Milky Way: MW). Nothing else
//     changes; a type someone already chose is never overwritten.
//   - The database is copied to BACKUP_DIR first; the run is recorded in
//     maintenance_runs and never repeats.
'use strict';

const { namedTargetExact } = require('./seestar_meta');
const { snapshotDatabase } = require('./repair_shared');

const RUN_NAME = 'named-target-types-v1';

// Resolves to { classified, backup, done }. Never rejects.
async function repairNamedTargetTypes({ db, backupDir, log = console }) {
  const result = { classified: 0, backup: null, done: false };
  try {
    if (db.prepare('SELECT 1 FROM maintenance_runs WHERE name = ?').get(RUN_NAME)) {
      result.done = true;
      return result;
    }
    const rows = db.prepare(
      `SELECT id, object_name FROM observations
        WHERE object_type IS NULL AND catalog IS NULL AND object_name IS NOT NULL`,
    ).all();
    const changes = [];
    for (const row of rows) {
      const hit = namedTargetExact(row.object_name);
      if (hit) changes.push({ id: row.id, type: hit.object_type });
    }
    if (changes.length) {
      result.backup = await snapshotDatabase(db, backupDir, 'type-repair');
      const update = db.prepare(
        `UPDATE observations SET object_type = @type, updated_at = datetime('now')
          WHERE id = @id AND object_type IS NULL`,
      );
      result.classified = db.transaction((list) => list.reduce((n, c) => n + update.run(c).changes, 0))(changes);
      log.log(`Named target repair: set the object type on ${result.classified} observation(s) `
        + `named after a named target (e.g. Milky Way). Database backed up to ${result.backup} first.`);
    }
    db.prepare('INSERT OR REPLACE INTO maintenance_runs (name, summary) VALUES (?, ?)')
      .run(RUN_NAME, `${result.classified} classified`);
    result.done = true;
  } catch (err) {
    log.warn(`Named target repair failed: ${err.message}`);
  }
  return result;
}

module.exports = { repairNamedTargetTypes };
