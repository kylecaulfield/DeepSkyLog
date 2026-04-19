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
const THUMB_DIR = path.join(UPLOAD_DIR, 'thumbnails');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(THUMB_DIR, { recursive: true });

const db = getDb();
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD not configured' });
  }
  const header = req.get('X-Admin-Password') || req.body?.password;
  if (header !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const id = crypto.randomBytes(8).toString('hex');
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${id}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

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

app.get('/api/observations', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT o.*, lo.catalog AS object_catalog, lo.catalog_number AS object_catalog_number,
              lo.name AS object_name
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
    )
    .all();
  res.json(rows);
});

app.get('/api/observations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Observation not found' });
  res.json(row);
});

app.post('/api/observations', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const body = req.body || {};
    let thumbPath = null;
    let exifJson = null;
    let imagePath = null;

    if (req.file) {
      imagePath = path.relative(UPLOAD_DIR, req.file.path);
      const thumbFile = path.join(THUMB_DIR, `thumb-${req.file.filename}.jpg`);
      await sharp(req.file.path)
        .rotate()
        .resize({ width: 480, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(thumbFile);
      thumbPath = path.relative(UPLOAD_DIR, thumbFile);

      try {
        const exif = await exifr.parse(req.file.path);
        if (exif) exifJson = JSON.stringify(exif);
      } catch {
        exifJson = null;
      }
    }

    const result = db
      .prepare(
        `INSERT INTO observations
           (object_id, catalog, catalog_number, title, description, observed_at,
            location, telescope, camera, exposure_seconds, iso, focal_length_mm,
            aperture, image_path, thumbnail_path, exif_json)
         VALUES (@object_id, @catalog, @catalog_number, @title, @description, @observed_at,
                 @location, @telescope, @camera, @exposure_seconds, @iso, @focal_length_mm,
                 @aperture, @image_path, @thumbnail_path, @exif_json)`,
      )
      .run({
        object_id: body.object_id ? Number(body.object_id) : null,
        catalog: body.catalog || null,
        catalog_number: body.catalog_number || null,
        title: body.title || null,
        description: body.description || null,
        observed_at: body.observed_at || null,
        location: body.location || null,
        telescope: body.telescope || null,
        camera: body.camera || null,
        exposure_seconds: body.exposure_seconds ? Number(body.exposure_seconds) : null,
        iso: body.iso ? Number(body.iso) : null,
        focal_length_mm: body.focal_length_mm ? Number(body.focal_length_mm) : null,
        aperture: body.aperture ? Number(body.aperture) : null,
        image_path: imagePath,
        thumbnail_path: thumbPath,
        exif_json: exifJson,
      });

    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create observation' });
  }
});

app.post('/api/lists/:slug/complete', requireAdmin, (req, res) => {
  const list = db.prepare('SELECT id FROM lists WHERE slug = ?').get(req.params.slug);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const { list_object_id, observation_id, notes } = req.body || {};
  if (!list_object_id) return res.status(400).json({ error: 'list_object_id required' });

  const result = db
    .prepare(
      `INSERT OR IGNORE INTO list_completions (list_object_id, observation_id, notes)
       VALUES (?, ?, ?)`,
    )
    .run(list_object_id, observation_id || null, notes || null);

  res.status(201).json({ id: result.lastInsertRowid });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DeepSkyLog listening on http://localhost:${PORT}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Upload dir: ${UPLOAD_DIR}`);
  if (!ADMIN_PASSWORD) {
    console.warn('WARNING: ADMIN_PASSWORD is not set — write endpoints are disabled.');
  }
});
