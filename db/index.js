const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { MIGRATIONS } = require('./schema');
const { MESSIER } = require('./seed/messier');
const { CALDWELL } = require('./seed/caldwell');
const { FINEST_NGC } = require('./seed/finest_ngc');
const { LOCAL_GROUP } = require('./seed/local_group');
const { AL_GLOBULARS } = require('./seed/al_globulars');
const { SEESTAR_PLANETARY_NEBULAE } = require('./seed/planetary_nebulae');
const { SEESTAR_OPEN_CLUSTERS } = require('./seed/open_clusters');
const { SHARPLESS_BRIGHT } = require('./seed/sharpless_bright');
const { SOLAR_SYSTEM } = require('./seed/solar_system');

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
      (list_id, catalog, catalog_number, name, object_type, ra_hours, dec_degrees, magnitude, constellation, aliases, ephemeris)
    VALUES (@listId, @catalog, @catalogNumber, @name, @type, @ra, @dec, @mag, @constellation, @aliases, @ephemeris)
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
        aliases: row.aliases && row.aliases.length
          ? JSON.stringify(row.aliases)
          : null,
        ephemeris: row.ephemeris || null,
      });
    }
  });

  tx(entries);
}

// On upgrades, the seed insert is OR IGNORE so existing rows keep whatever
// aliases were stored before. This pass refreshes alias data from the seed
// for any rows where it's currently NULL — useful when an older install
// gets new alias info added to the seed file.
function refreshAliases(db, listId, entries) {
  const update = db.prepare(`
    UPDATE list_objects SET aliases = @aliases
      WHERE list_id = @listId AND catalog = @catalog AND catalog_number = @catalogNumber
        AND aliases IS NULL
  `);
  const tx = db.transaction(() => {
    for (const row of entries) {
      if (!row.aliases || !row.aliases.length) continue;
      update.run({
        listId,
        catalog: row.catalog,
        catalogNumber: row.catalogNumber,
        aliases: JSON.stringify(row.aliases),
      });
    }
  });
  tx();
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
  const builtins = [
    { slug: 'messier',          name: 'Messier Catalog',          description: "Charles Messier's 110 deep-sky objects.",                                          entries: MESSIER },
    { slug: 'caldwell',         name: 'Caldwell Catalog',         description: "Patrick Moore's 109 Caldwell objects.",                                            entries: CALDWELL },
    { slug: 'finest-ngc',       name: 'Finest NGC',               description: 'A curated selection of bright non-Messier NGC objects, suited for small-aperture and smart-scope observers.', entries: FINEST_NGC },
    { slug: 'local-group',      name: 'Local Group Galaxies',     description: 'Members and bright satellites of our Local Group of galaxies.',                  entries: LOCAL_GROUP },
    { slug: 'al-globulars',     name: 'Astronomical League — Globular Clusters', description: 'The 50 brightest globular clusters from the AL observing program.', entries: AL_GLOBULARS },
    { slug: 'open-clusters-s50', name: 'Open Clusters for Smart Scopes', description: 'Bright open clusters that fit comfortably in a Seestar S50 / S30 field of view.', entries: SEESTAR_OPEN_CLUSTERS },
    { slug: 'planetary-nebulae-s50', name: 'Planetary Nebulae for Smart Scopes', description: 'Brighter planetary nebulae detectable with a Seestar S50 / S30.', entries: SEESTAR_PLANETARY_NEBULAE },
    { slug: 'sharpless-bright', name: 'Sharpless 2 (Bright Subset)', description: "S50-friendly large emission nebulae from Stewart Sharpless's 1959 catalog.",   entries: SHARPLESS_BRIGHT },
    { slug: 'solar-system',     name: 'Solar System',             description: 'The Sun, the Moon and the eight major planets — positions are computed live from a low-precision Schlyter ephemeris.', entries: SOLAR_SYSTEM },
  ];

  for (const list of builtins) {
    seedList(db, list);
    const id = db.prepare('SELECT id FROM lists WHERE slug = ?').get(list.slug)?.id;
    if (id) refreshAliases(db, id, list.entries);
  }
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
