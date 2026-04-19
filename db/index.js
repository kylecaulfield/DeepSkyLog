const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('./schema');
const { MESSIER } = require('./seed/messier');
const { CALDWELL } = require('./seed/caldwell');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'deepskylog.sqlite');

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

function openDatabase() {
  ensureDataDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM migrations').all().map((row) => row.id),
  );

  const insert = db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.up);
      insert.run(migration.id, migration.name);
    });
    apply();
  }
}

function seedList(db, { slug, name, description, entries }) {
  const existing = db.prepare('SELECT id FROM lists WHERE slug = ?').get(slug);
  let listId;
  if (existing) {
    listId = existing.id;
  } else {
    const result = db
      .prepare(
        'INSERT INTO lists (slug, name, description, builtin) VALUES (?, ?, ?, 1)',
      )
      .run(slug, name, description);
    listId = result.lastInsertRowid;
  }

  const count = db
    .prepare('SELECT COUNT(*) AS c FROM list_objects WHERE list_id = ?')
    .get(listId).c;
  if (count >= entries.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO list_objects
      (list_id, catalog, catalog_number, name, object_type, ra_hours, dec_degrees, magnitude, constellation)
    VALUES (@listId, @catalog, @catalogNumber, @name, @type, @ra, @dec, @mag, @constellation)
  `);

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insert.run({
        listId,
        catalog: row.catalog,
        catalogNumber: row.catalogNumber,
        name: row.name,
        type: row.type,
        ra: row.ra,
        dec: row.dec,
        mag: row.mag,
        constellation: row.constellation || null,
      });
    }
  });

  tx(entries);
}

function backfillCoordsFromExif(db) {
  const rows = db
    .prepare(
      `SELECT id, exif_json FROM observations
         WHERE latitude IS NULL AND longitude IS NULL AND exif_json IS NOT NULL`,
    )
    .all();
  if (!rows.length) return;

  const update = db.prepare(
    'UPDATE observations SET latitude = ?, longitude = ? WHERE id = ?',
  );
  const tx = db.transaction(() => {
    for (const row of rows) {
      try {
        const exif = JSON.parse(row.exif_json);
        const lat = typeof exif.latitude === 'number' ? exif.latitude : null;
        const lon = typeof exif.longitude === 'number' ? exif.longitude : null;
        if (lat != null && lon != null) update.run(lat, lon, row.id);
      } catch {}
    }
  });
  tx();
}

function seedCatalogs(db) {
  seedList(db, {
    slug: 'messier',
    name: 'Messier Catalog',
    description: "Charles Messier's 110 deep-sky objects.",
    entries: MESSIER,
  });
  seedList(db, {
    slug: 'caldwell',
    name: 'Caldwell Catalog',
    description: "Patrick Moore's 109 Caldwell objects.",
    entries: CALDWELL,
  });
}

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  const db = openDatabase();
  runMigrations(db);
  seedCatalogs(db);
  backfillCoordsFromExif(db);
  dbInstance = db;
  return db;
}

module.exports = { getDb, DB_PATH };
