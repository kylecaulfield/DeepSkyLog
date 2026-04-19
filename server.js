require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const exifr = require('exifr');

const { getDb, DB_PATH } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const STAGE_DIR = path.join(UPLOAD_DIR, '.stage');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(STAGE_DIR, { recursive: true });

const db = getDb();
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const TELESCOPE_OPTIONS = ['Seestar S50', 'Seestar S30 Pro', 'Seestar S30', '12" Dobsonian'];

function matchTelescope(exif) {
  if (!exif) return null;
  const parts = [
    exif.Make, exif.Model, exif.CameraModel, exif.CameraModelName,
    exif.LensMake, exif.LensModel, exif.UniqueCameraModel, exif.Software,
  ].filter(Boolean).map(String);
  const hay = parts.join(' ').toLowerCase();
  if (!hay) return null;
  if (/seestar\s*s\s*30\s*pro/i.test(hay)) return 'Seestar S30 Pro';
  if (/seestar\s*s\s*50/i.test(hay)) return 'Seestar S50';
  if (/seestar\s*s\s*30/i.test(hay)) return 'Seestar S30';
  return null;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/["'`’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'misc';
}

function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD not configured on server' });
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
    if (pass === ADMIN_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="DeepSkyLog admin", charset="UTF-8"');
  return res.status(401).json({ error: 'Unauthorized' });
}

const stageUpload = multer({
  storage: multer.diskStorage({
    destination: STAGE_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(10).toString('hex');
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${id}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\//i.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image uploads are supported'));
  },
});

app.use('/admin', basicAuth, express.static(path.join(__dirname, 'admin')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: path.basename(DB_PATH) });
});

app.get('/api/lists', (_req, res) => {
  const lists = db
    .prepare(
      `SELECT l.id, l.slug, l.name, l.description, l.builtin,
              COUNT(lo.id) AS object_count,
              COUNT(DISTINCT lc.list_object_id) AS completed_count
         FROM lists l
         LEFT JOIN list_objects lo ON lo.list_id = l.id
         LEFT JOIN list_completions lc ON lc.list_object_id = lo.id
         GROUP BY l.id
         ORDER BY l.builtin DESC, l.name`,
    )
    .all();
  res.json(lists);
});

app.get('/api/lists/:slug', (req, res) => {
  const list = db.prepare('SELECT * FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'List not found' });

  const objects = db
    .prepare(
      `SELECT lo.*, EXISTS(
         SELECT 1 FROM list_completions lc WHERE lc.list_object_id = lo.id
       ) AS completed
         FROM list_objects lo
         WHERE lo.list_id = ?
         ORDER BY CAST(lo.catalog_number AS INTEGER)`,
    )
    .all(list.id);

  res.json({ ...list, objects });
});

app.get('/api/observations', (req, res) => {
  const telescope = (req.query.telescope || '').trim();
  const objectType = (req.query.object_type || '').trim();
  const hasImage = req.query.has_image === '1';

  const clauses = [];
  const params = {};
  if (telescope) {
    clauses.push('o.telescope = @telescope');
    params.telescope = telescope;
  }
  if (objectType) {
    clauses.push('lo.object_type = @object_type');
    params.object_type = objectType;
  }
  if (hasImage) {
    clauses.push('o.image_path IS NOT NULL');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT o.*, lo.catalog AS object_catalog, lo.catalog_number AS object_catalog_number,
              lo.name AS object_name, lo.object_type AS object_type, lo.constellation AS constellation
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ${where}
         ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
    )
    .all(params);
  res.json(rows);
});

app.get('/api/observations/map', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.title, o.observed_at, o.latitude, o.longitude, o.location,
              o.telescope, o.thumbnail_path, o.object_id,
              lo.catalog AS object_catalog, lo.catalog_number AS object_catalog_number,
              lo.name AS object_name
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         WHERE o.latitude IS NOT NULL AND o.longitude IS NOT NULL`,
    )
    .all();
  res.json(rows);
});

app.get('/api/observations.csv', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT o.id, o.observed_at, o.created_at, o.title, o.catalog, o.catalog_number,
              lo.name AS object_name, lo.object_type, lo.constellation,
              o.telescope, o.camera, o.location, o.latitude, o.longitude,
              o.exposure_seconds, o.iso, o.focal_length_mm, o.aperture,
              o.rating, o.description, o.image_path
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
    )
    .all();

  const columns = [
    'id', 'observed_at', 'created_at', 'title', 'catalog', 'catalog_number',
    'object_name', 'object_type', 'constellation', 'telescope', 'camera',
    'location', 'latitude', 'longitude', 'exposure_seconds', 'iso',
    'focal_length_mm', 'aperture', 'rating', 'description', 'image_path',
  ];

  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(','));

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set(
    'Content-Disposition',
    `attachment; filename="deepskylog-observations-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  res.send(lines.join('\n'));
});

app.get('/api/filters', (_req, res) => {
  const telescopes = db
    .prepare(
      `SELECT DISTINCT telescope FROM observations
         WHERE telescope IS NOT NULL AND telescope != ''
         ORDER BY telescope COLLATE NOCASE`,
    )
    .all()
    .map((r) => r.telescope);

  const objectTypes = db
    .prepare(
      `SELECT DISTINCT object_type FROM list_objects
         WHERE object_type IS NOT NULL AND object_type != ''
         ORDER BY object_type`,
    )
    .all()
    .map((r) => r.object_type);

  res.json({ telescopes, objectTypes });
});

app.get('/api/objects/:id', (req, res) => {
  const object = db
    .prepare(
      `SELECT lo.*, l.slug AS list_slug, l.name AS list_name
         FROM list_objects lo
         JOIN lists l ON l.id = lo.list_id
         WHERE lo.id = ?`,
    )
    .get(req.params.id);
  if (!object) return res.status(404).json({ error: 'Object not found' });

  const memberships = db
    .prepare(
      `SELECT lo.id, l.slug, l.name AS list_name, lo.catalog, lo.catalog_number
         FROM list_objects lo
         JOIN lists l ON l.id = lo.list_id
         WHERE lo.catalog = ? AND lo.catalog_number = ?`,
    )
    .all(object.catalog, object.catalog_number);

  const observations = db
    .prepare(
      `SELECT * FROM observations
         WHERE object_id IN (SELECT id FROM list_objects WHERE catalog = ? AND catalog_number = ?)
         ORDER BY COALESCE(observed_at, created_at) DESC`,
    )
    .all(object.catalog, object.catalog_number);

  const completions = db
    .prepare(
      `SELECT * FROM list_completions WHERE list_object_id = ? ORDER BY completed_at DESC`,
    )
    .all(object.id);

  res.json({ ...object, memberships, observations, completions });
});

app.get('/api/admin/config', basicAuth, (_req, res) => {
  res.json({ telescopes: TELESCOPE_OPTIONS });
});

app.get('/api/admin/stats', basicAuth, (_req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS observations,
              COUNT(image_path) AS photos,
              COUNT(DISTINCT object_id) AS distinct_objects,
              COUNT(DISTINCT telescope) AS distinct_telescopes,
              ROUND(AVG(rating), 2) AS avg_rating
         FROM observations`,
    )
    .get();

  const lists = db
    .prepare(
      `SELECT l.slug, l.name,
              COUNT(lo.id) AS object_count,
              COUNT(DISTINCT lc.list_object_id) AS completed_count
         FROM lists l
         LEFT JOIN list_objects lo ON lo.list_id = l.id
         LEFT JOIN list_completions lc ON lc.list_object_id = lo.id
         GROUP BY l.id
         ORDER BY l.builtin DESC, l.name`,
    )
    .all();

  const recent = db
    .prepare(
      `SELECT o.id, o.title, o.observed_at, o.created_at, o.telescope,
              o.rating, o.thumbnail_path, o.image_path, o.catalog, o.catalog_number,
              lo.name AS object_name
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ORDER BY o.created_at DESC
         LIMIT 10`,
    )
    .all();

  const telescopes = db
    .prepare(
      `SELECT telescope, COUNT(*) AS count
         FROM observations
         WHERE telescope IS NOT NULL AND telescope != ''
         GROUP BY telescope
         ORDER BY count DESC`,
    )
    .all();

  res.json({ totals, lists, recent, telescopes });
});

app.get('/api/admin/objects', basicAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 25, 200);

  if (!q) {
    const rows = db
      .prepare(
        `SELECT lo.id, lo.catalog, lo.catalog_number, lo.name, lo.object_type, lo.constellation,
                l.slug AS list_slug, l.name AS list_name
           FROM list_objects lo JOIN lists l ON l.id = lo.list_id
           ORDER BY l.builtin DESC, lo.catalog, CAST(lo.catalog_number AS INTEGER)
           LIMIT ?`,
      )
      .all(limit);
    return res.json(rows);
  }

  const like = `%${q}%`;
  const rows = db
    .prepare(
      `SELECT lo.id, lo.catalog, lo.catalog_number, lo.name, lo.object_type, lo.constellation,
              l.slug AS list_slug, l.name AS list_name
         FROM list_objects lo JOIN lists l ON l.id = lo.list_id
         WHERE lo.name LIKE @like COLLATE NOCASE
            OR (lo.catalog || lo.catalog_number) LIKE @like COLLATE NOCASE
            OR lo.constellation LIKE @like COLLATE NOCASE
         ORDER BY CASE WHEN lo.name LIKE @exact THEN 0 ELSE 1 END,
                  l.builtin DESC, CAST(lo.catalog_number AS INTEGER)
         LIMIT @limit`,
    )
    .all({ like, exact: `${q}%`, limit });
  res.json(rows);
});

app.post('/api/admin/stage', basicAuth, stageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  let exif = null;
  try {
    exif = await exifr.parse(req.file.path, { gps: true, tiff: true, ifd0: true, exif: true });
  } catch {
    exif = null;
  }

  const captured =
    exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null;
  const capturedIso = captured instanceof Date ? captured.toISOString() : null;

  const telescopeGuess = matchTelescope(exif);
  const device = [exif?.Make, exif?.Model].filter(Boolean).join(' ') || null;

  res.status(201).json({
    stage_id: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    preview_url: `/api/admin/stage/${encodeURIComponent(req.file.filename)}/preview`,
    exif: {
      captured_at: capturedIso,
      device,
      latitude: typeof exif?.latitude === 'number' ? exif.latitude : null,
      longitude: typeof exif?.longitude === 'number' ? exif.longitude : null,
      iso: exif?.ISO ?? exif?.ISOSpeedRatings ?? null,
      exposure_seconds: exif?.ExposureTime ?? null,
      focal_length_mm: exif?.FocalLength ?? null,
      aperture: exif?.FNumber ?? exif?.ApertureValue ?? null,
    },
    telescope_match: telescopeGuess,
    telescope_options: TELESCOPE_OPTIONS,
  });
});

app.get('/api/admin/stage/:id/preview', basicAuth, (req, res) => {
  const safe = path.basename(req.params.id);
  const full = path.join(STAGE_DIR, safe);
  if (!full.startsWith(STAGE_DIR + path.sep) || !fs.existsSync(full)) {
    return res.status(404).end();
  }
  res.sendFile(full);
});

app.post('/api/admin/observations', basicAuth, async (req, res) => {
  const body = req.body || {};
  const stageId = body.stage_id ? path.basename(String(body.stage_id)) : null;
  if (!stageId) return res.status(400).json({ error: 'stage_id required' });

  const stagePath = path.join(STAGE_DIR, stageId);
  if (!stagePath.startsWith(STAGE_DIR + path.sep) || !fs.existsSync(stagePath)) {
    return res.status(404).json({ error: 'Staged file not found' });
  }

  const telescope = String(body.telescope || '').trim() || null;
  const location = body.location ? String(body.location).trim() : null;
  const notes = body.notes ? String(body.notes).trim() : null;
  const observedAt = body.observed_at ? String(body.observed_at).trim() : null;
  const title = body.title ? String(body.title).trim() : null;
  const rating = body.rating != null && body.rating !== ''
    ? Math.max(1, Math.min(5, Number(body.rating)))
    : null;

  const rawObjectId = body.object_id ? Number(body.object_id) : null;
  let matchedObject = null;
  if (rawObjectId) {
    matchedObject = db
      .prepare('SELECT * FROM list_objects WHERE id = ?')
      .get(rawObjectId);
  }

  const catalog = matchedObject?.catalog
    || (body.catalog ? String(body.catalog).trim() : null);
  const catalogNumber = matchedObject?.catalog_number
    || (body.catalog_number ? String(body.catalog_number).trim() : null);
  const objectName = matchedObject?.name
    || (body.object_name ? String(body.object_name).trim() : null);

  const dateForPath = observedAt && !Number.isNaN(Date.parse(observedAt))
    ? new Date(observedAt)
    : new Date();
  const yyyy = String(dateForPath.getUTCFullYear());
  const mm = String(dateForPath.getUTCMonth() + 1).padStart(2, '0');

  const dirSlug = slugify(objectName
    || (catalog && catalogNumber ? `${catalog}${catalogNumber}` : 'misc'));
  const destDir = path.join(UPLOAD_DIR, yyyy, mm, dirSlug);
  fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(stageId).toLowerCase() || '.jpg';
  const baseName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const finalName = `${baseName}${ext}`;
  const finalPath = path.join(destDir, finalName);
  const thumbPath = path.join(destDir, `thumb-${baseName}.jpg`);

  try {
    fs.renameSync(stagePath, finalPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      fs.copyFileSync(stagePath, finalPath);
      fs.unlinkSync(stagePath);
    } else {
      throw err;
    }
  }

  await sharp(finalPath)
    .rotate()
    .resize({ width: 640, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(thumbPath);

  let exif = null;
  try {
    exif = await exifr.parse(finalPath, { gps: true });
  } catch {
    exif = null;
  }

  const relImage = path.relative(UPLOAD_DIR, finalPath).split(path.sep).join('/');
  const relThumb = path.relative(UPLOAD_DIR, thumbPath).split(path.sep).join('/');

  const latitude = typeof exif?.latitude === 'number' ? exif.latitude : null;
  const longitude = typeof exif?.longitude === 'number' ? exif.longitude : null;

  const insert = db.prepare(
    `INSERT INTO observations
       (object_id, catalog, catalog_number, title, description, observed_at,
        location, telescope, camera, exposure_seconds, iso, focal_length_mm,
        aperture, image_path, thumbnail_path, exif_json, rating,
        latitude, longitude)
     VALUES (@object_id, @catalog, @catalog_number, @title, @description, @observed_at,
             @location, @telescope, @camera, @exposure_seconds, @iso, @focal_length_mm,
             @aperture, @image_path, @thumbnail_path, @exif_json, @rating,
             @latitude, @longitude)`,
  );

  const completeList = db.prepare(
    `INSERT OR IGNORE INTO list_completions (list_object_id, observation_id, notes)
     VALUES (?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    const result = insert.run({
      object_id: matchedObject ? matchedObject.id : null,
      catalog,
      catalog_number: catalogNumber,
      title,
      description: notes,
      observed_at: observedAt,
      location,
      telescope,
      camera: exif?.Model ? String(exif.Model) : null,
      exposure_seconds: exif?.ExposureTime ?? null,
      iso: exif?.ISO ?? exif?.ISOSpeedRatings ?? null,
      focal_length_mm: exif?.FocalLength ?? null,
      aperture: exif?.FNumber ?? exif?.ApertureValue ?? null,
      image_path: relImage,
      thumbnail_path: relThumb,
      exif_json: exif ? JSON.stringify(exif) : null,
      rating,
      latitude,
      longitude,
    });

    const observationId = Number(result.lastInsertRowid);

    if (catalog && catalogNumber) {
      const peers = db
        .prepare('SELECT id FROM list_objects WHERE catalog = ? AND catalog_number = ?')
        .all(catalog, catalogNumber);
      for (const peer of peers) {
        completeList.run(peer.id, observationId, notes);
      }
    }

    return observationId;
  });

  const observationId = tx();

  res.status(201).json({
    id: observationId,
    image_path: relImage,
    thumbnail_path: relThumb,
  });
});

app.delete('/api/admin/stage/:id', basicAuth, (req, res) => {
  const safe = path.basename(req.params.id);
  const full = path.join(STAGE_DIR, safe);
  if (full.startsWith(STAGE_DIR + path.sep) && fs.existsSync(full)) {
    fs.unlinkSync(full);
  }
  res.status(204).end();
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DeepSkyLog listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Upload dir: ${UPLOAD_DIR}`);
  if (!ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD is not set — /admin is disabled.');
  }
});
