// Database schema and migration statements.
// Each migration is applied in order and tracked in the `migrations` table.

const MIGRATIONS = [
  {
    id: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER,
        catalog TEXT,
        catalog_number TEXT,
        title TEXT,
        description TEXT,
        observed_at TEXT,
        location TEXT,
        telescope TEXT,
        camera TEXT,
        exposure_seconds INTEGER,
        iso INTEGER,
        focal_length_mm INTEGER,
        aperture REAL,
        image_path TEXT,
        thumbnail_path TEXT,
        exif_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (object_id) REFERENCES list_objects(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_observations_object_id ON observations(object_id);
      CREATE INDEX IF NOT EXISTS idx_observations_observed_at ON observations(observed_at);

      CREATE TABLE IF NOT EXISTS lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS list_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        catalog TEXT NOT NULL,
        catalog_number TEXT NOT NULL,
        name TEXT,
        object_type TEXT,
        ra_hours REAL,
        dec_degrees REAL,
        magnitude REAL,
        constellation TEXT,
        notes TEXT,
        FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
        UNIQUE (list_id, catalog, catalog_number)
      );

      CREATE INDEX IF NOT EXISTS idx_list_objects_list_id ON list_objects(list_id);
      CREATE INDEX IF NOT EXISTS idx_list_objects_catalog ON list_objects(catalog, catalog_number);

      CREATE TABLE IF NOT EXISTS list_completions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_object_id INTEGER NOT NULL,
        observation_id INTEGER,
        completed_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT,
        FOREIGN KEY (list_object_id) REFERENCES list_objects(id) ON DELETE CASCADE,
        FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE SET NULL,
        UNIQUE (list_object_id, observation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_list_completions_object ON list_completions(list_object_id);
    `,
  },
  {
    id: 2,
    name: 'add_observation_rating',
    up: `
      ALTER TABLE observations ADD COLUMN rating INTEGER;
    `,
  },
  {
    id: 3,
    name: 'add_observation_coords',
    up: `
      ALTER TABLE observations ADD COLUMN latitude REAL;
      ALTER TABLE observations ADD COLUMN longitude REAL;
      CREATE INDEX IF NOT EXISTS idx_observations_coords
        ON observations(latitude, longitude);
    `,
  },
];

module.exports = { MIGRATIONS };
