require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const exifr = require('exifr');

const { getDb, DB_PATH } = require('./db');
const { altAz, moonPhase, sunPosition, moonPosition, angularSeparationDeg } = require('./lib/astro');
const { bodyPosition } = require('./lib/ephemeris');
const { isFitsPath, readFitsHeader, renderFitsJpeg, fitsExif } = require('./lib/fits');
const { ocrBanner } = require('./lib/seestar_ocr');
const { parseAll: parseSeestarText, parseFilename: parseSeestarFilename } = require('./lib/seestar_meta');
const ngc = require('./lib/ngc');
const astrometry = require('./lib/astrometry');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const STAGE_DIR = path.resolve(
  process.env.STAGE_DIR || path.join(path.dirname(DB_PATH), 'stage'),
);
const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(STAGE_DIR, { recursive: true });

const db = getDb();
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const TELESCOPE_OPTIONS = ['Seestar S50', 'Seestar S30 Pro', 'Seestar S30', '12" Dobsonian'];

function matchTelescope(device) {
  if (!device) return null;
  const hay = String(device).toLowerCase();
  if (/seestar\s*s\s*30\s*pro/i.test(hay)) return 'Seestar S30 Pro';
  if (/seestar\s*s\s*50/i.test(hay)) return 'Seestar S50';
  if (/seestar\s*s\s*30/i.test(hay)) return 'Seestar S30';
  return null;
}

function deviceFromExif(exif) {
  if (!exif) return null;
  return [
    exif.Make, exif.Model, exif.CameraModel, exif.CameraModelName,
    exif.LensMake, exif.LensModel, exif.UniqueCameraModel, exif.Software,
  ].filter(Boolean).map(String).join(' ') || null;
}

function slugify(value) {
  const raw = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/["'`’]/g, '')
    .replace(/[^a-z0-9]+/g, '-');
  const trimmed = raw.slice(0, 80).replace(/^-+|-+$/g, '');
  return trimmed || 'misc';
}

function escapeLike(value) {
  return String(value).replace(/[\\_%]/g, (ch) => `\\${ch}`);
}

// Catalog-id matching is case-insensitive and ignores any whitespace inside
// the identifier so "NGC1976", "NGC 1976" and "ngc1976" all collide.
function normaliseToken(token) {
  return String(token || '').replace(/\s+/g, '').toUpperCase();
}

function parseAliases(json) {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

// Build a token-equivalence graph from every list_object's primary id and its
// declared aliases. Two ids are in the same group when any list_object lists
// them together. The result is a Map<token, Set<token>>; every token in a
// group points at the same Set instance, so look-ups are O(1).
function buildAliasGraph(db) {
  const rows = db
    .prepare('SELECT catalog, catalog_number, aliases FROM list_objects')
    .all();
  const groups = new Map();
  for (const row of rows) {
    const tokens = [
      normaliseToken(`${row.catalog}${row.catalog_number}`),
      ...parseAliases(row.aliases).map(normaliseToken),
    ].filter(Boolean);
    if (!tokens.length) continue;
    const merged = new Set();
    for (const t of tokens) {
      const existing = groups.get(t);
      if (existing) for (const x of existing) merged.add(x);
      else merged.add(t);
    }
    for (const t of merged) groups.set(t, merged);
  }
  return groups;
}

function tokensFor(graph, primaryId) {
  const t = normaliseToken(primaryId);
  if (!t) return [];
  return [...(graph.get(t) || new Set([t]))];
}

// Build an in-memory index of observations keyed by their normalised
// (catalog || catalog_number) token. Used to compute attempts_count /
// featured_thumbnail for list pages without a per-row SQL round-trip.
function buildObservationIndex(db) {
  const rows = db
    .prepare(
      `SELECT id, catalog, catalog_number, thumbnail_path, featured,
              observed_at, created_at
         FROM observations
         WHERE catalog IS NOT NULL AND catalog_number IS NOT NULL`,
    )
    .all();
  const idx = new Map();
  for (const o of rows) {
    const tok = normaliseToken(`${o.catalog}${o.catalog_number}`);
    if (!idx.has(tok)) idx.set(tok, []);
    idx.get(tok).push(o);
  }
  return idx;
}

function observationsForTokens(idx, tokens) {
  const out = [];
  for (const t of tokens) {
    const list = idx.get(t);
    if (list) out.push(...list);
  }
  return out;
}

function pickFeaturedThumbnail(observations) {
  const sorted = [...observations].sort((a, b) => {
    if (a.featured !== b.featured) return (b.featured || 0) - (a.featured || 0);
    return String(b.observed_at || b.created_at || '').localeCompare(
      String(a.observed_at || a.created_at || ''),
    );
  });
  return sorted.find((o) => o.thumbnail_path)?.thumbnail_path ?? null;
}

// Find every list_object whose primary id or any alias is in the supplied
// token set.
function peerListObjects(db, tokens) {
  if (!tokens.length) return [];
  const placeholders = tokens.map(() => '?').join(',');
  const direct = db
    .prepare(
      `SELECT id FROM list_objects
         WHERE UPPER(REPLACE(catalog || catalog_number, ' ', '')) IN (${placeholders})`,
    )
    .all(...tokens);
  const aliasMatches = db
    .prepare(
      `SELECT lo.id FROM list_objects lo, json_each(COALESCE(lo.aliases, '[]')) AS al
         WHERE UPPER(REPLACE(al.value, ' ', '')) IN (${placeholders})`,
    )
    .all(...tokens);
  const ids = new Set([...direct.map((r) => r.id), ...aliasMatches.map((r) => r.id)]);
  return [...ids].map((id) => ({ id }));
}

const AUTH_FAIL_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAIL_MAX = 20;
const authFailures = new Map();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function recentFailures(ip, now) {
  const fails = (authFailures.get(ip) || []).filter((t) => now - t < AUTH_FAIL_WINDOW_MS);
  authFailures.set(ip, fails);
  return fails;
}

function timingSafeCompare(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still touch timingSafeEqual to keep timing noise closer to the equal-length path.
    crypto.timingSafeEqual(bb, bb);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD not configured on server' });
  }

  const ip = clientIp(req);
  const now = Date.now();
  const fails = recentFailures(ip, now);
  if (fails.length >= AUTH_FAIL_MAX) {
    res.set('Retry-After', String(Math.ceil(AUTH_FAIL_WINDOW_MS / 1000)));
    return res.status(429).json({ error: 'Too many authentication attempts' });
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  let ok = false;
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const pass = colon >= 0 ? decoded.slice(colon + 1) : '';
    ok = timingSafeCompare(pass, ADMIN_PASSWORD);
  }

  if (ok) return next();

  fails.push(now);
  authFailures.set(ip, fails);
  res.set('WWW-Authenticate', 'Basic realm="DeepSkyLog admin", charset="UTF-8"');
  return res.status(401).json({ error: 'Unauthorized' });
}

function sweepStageDir() {
  try {
    const now = Date.now();
    for (const entry of fs.readdirSync(STAGE_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(STAGE_DIR, entry.name);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > STAGE_TTL_MS) fs.unlinkSync(full);
      } catch {}
    }
  } catch (err) {
    console.warn('stage sweep failed:', err.message);
  }
}

sweepStageDir();
setInterval(sweepStageDir, 60 * 60 * 1000).unref();

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
    if (isFitsPath(file.originalname || '')) return cb(null, true);
    cb(new Error('Only image or FITS uploads are supported'));
  },
});

app.use('/admin', basicAuth, express.static(path.join(__dirname, 'admin')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Version info — preferred source is the env vars baked in at Docker build
// time (workflow fills them from the triggering commit). For local `npm
// start` runs we fall back to running git in the source dir; if even that
// fails we degrade to "dev". Computed once at startup; never reread.
const VERSION = (() => {
  const repo = process.env.GITHUB_REPO || 'kylecaulfield/DeepSkyLog';
  const sha = (process.env.GIT_SHA || '').trim() || null;
  const ref = (process.env.GIT_REF || '').trim() || null;
  const buildTime = (process.env.BUILD_TIME || '').trim() || null;
  if (sha) return { sha, ref: ref || 'unknown', build_time: buildTime, source: 'env', repo };
  try {
    const { execFileSync } = require('child_process');
    const opts = { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] };
    const liveSha = execFileSync('git', ['rev-parse', 'HEAD'], opts).toString().trim();
    const liveRef = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).toString().trim();
    return { sha: liveSha, ref: liveRef, build_time: null, source: 'git', repo };
  } catch {
    return { sha: null, ref: 'dev', build_time: null, source: 'unknown', repo };
  }
})();

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: path.basename(DB_PATH) });
});

app.get('/api/version', (_req, res) => {
  res.json({
    sha: VERSION.sha,
    short_sha: VERSION.sha ? VERSION.sha.slice(0, 7) : null,
    ref: VERSION.ref,
    build_time: VERSION.build_time,
    source: VERSION.source,
    repo: VERSION.repo,
  });
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
      `SELECT lo.*,
              EXISTS(SELECT 1 FROM list_completions lc
                       WHERE lc.list_object_id = lo.id) AS completed
         FROM list_objects lo
         WHERE lo.list_id = ?
         ORDER BY CAST(lo.catalog_number AS INTEGER)`,
    )
    .all(list.id);

  // Enrich attempts_count and featured_thumbnail in JS so they follow alias
  // links — if M42 has been observed the RASC NGC 1976 row should still
  // surface that thumbnail and count.
  const graph = buildAliasGraph(db);
  const obsIndex = buildObservationIndex(db);
  for (const o of objects) {
    const tokens = tokensFor(graph, `${o.catalog}${o.catalog_number}`);
    const obs = observationsForTokens(obsIndex, tokens);
    o.attempts_count = obs.length;
    o.featured_thumbnail = pickFeaturedThumbnail(obs);
  }

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
    // Match against the catalog row's type when linked, otherwise the
    // free-form type stored on the observation itself (used for comets).
    clauses.push('COALESCE(lo.object_type, o.object_type) = @object_type');
    params.object_type = objectType;
  }
  if (hasImage) {
    clauses.push('o.image_path IS NOT NULL');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT o.*, lo.catalog AS object_catalog, lo.catalog_number AS object_catalog_number,
              lo.name AS object_name,
              COALESCE(lo.object_type, o.object_type) AS object_type,
              lo.constellation AS constellation
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ${where}
         ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
    )
    .all(params);
  res.json(rows);
});

// Session planner — like /api/tonight but for an arbitrary date/range. The
// caller supplies start/end ISO strings (or a `date` plus night-window
// defaults of local sunset-to-sunrise approximated as 18:00–06:00 local).
// For each target we sample altitude across the window and return:
//   max_altitude / max_altitude_at — the apex
//   above_min_minutes — minutes the target is above min_alt
//   rises_at / sets_at / window_start / window_end (relative to query)
app.get('/api/planner', (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required' });
  }
  const minAlt = Number.isFinite(Number(req.query.min_alt)) ? Number(req.query.min_alt) : 30;
  const includeObserved = req.query.include_observed === '1';
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  // Optional minimum great-circle separation from the moon (degrees). 0 or
  // unset = no filter. Pairs with the moon-up bands the response surfaces.
  const minMoonSep = Number.isFinite(Number(req.query.min_moon_sep))
    ? Math.max(0, Number(req.query.min_moon_sep)) : 0;

  let start, end;
  if (req.query.start && req.query.end) {
    start = new Date(req.query.start);
    end = new Date(req.query.end);
  } else if (req.query.date) {
    // Treat date as local sunset-to-sunrise: 18:00 of the chosen day → 06:00
    // of the next day in the supplied location's local time. We approximate
    // local time as UTC + lon/15 (about right within the hour for planning).
    const localOffsetHours = lon / 15;
    const d = new Date(`${req.query.date}T18:00:00Z`);
    start = new Date(d.getTime() - localOffsetHours * 3_600_000);
    end = new Date(start.getTime() + 12 * 3_600_000);
  } else {
    return res.status(400).json({ error: 'either date= or start= and end= are required' });
  }
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) ||
      !(end instanceof Date) || Number.isNaN(end.getTime()) ||
      end <= start) {
    return res.status(400).json({ error: 'invalid date range' });
  }
  const stepMinutes = Math.max(1, Math.min(60, Number(req.query.step_minutes) || 10));
  const stepMs = stepMinutes * 60_000;

  const rows = db
    .prepare(
      `SELECT lo.id, lo.catalog, lo.catalog_number, lo.name, lo.object_type,
              lo.constellation, lo.ra_hours, lo.dec_degrees, lo.magnitude,
              lo.ephemeris,
              l.slug AS list_slug, l.name AS list_name,
              EXISTS(SELECT 1 FROM list_completions lc
                       WHERE lc.list_object_id = lo.id) AS observed
         FROM list_objects lo
         JOIN lists l ON l.id = lo.list_id
         WHERE lo.ra_hours IS NOT NULL OR lo.dec_degrees IS NOT NULL
            OR lo.ephemeris IS NOT NULL`,
    )
    .all();

  // Pre-compute sun and moon position+altitude across the window. Used for
  // both target-vs-moon separation and the twilight/moon-up bands surfaced
  // alongside the targets.
  const samples = [];
  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    const sunEq = sunPosition(date);
    const moonEq = moonPosition(date);
    samples.push({
      date,
      sunAlt: altAz({ raHours: sunEq.raHours, decDeg: sunEq.decDeg, lat, lon, date })?.altitude ?? null,
      moonAlt: altAz({ raHours: moonEq.raHours, decDeg: moonEq.decDeg, lat, lon, date })?.altitude ?? null,
      moonEq,
    });
  }
  // Astronomical twilight = sun below -18°. We collapse the window into
  // contiguous bands where this holds, which is what an imager actually
  // wants ("when is it really dark?").
  const astroDarkBands = [];
  let bandStart = null;
  for (const s of samples) {
    const dark = s.sunAlt != null && s.sunAlt < -18;
    if (dark && !bandStart) bandStart = s.date;
    if ((!dark || s === samples[samples.length - 1]) && bandStart) {
      astroDarkBands.push({ start: bandStart.toISOString(), end: s.date.toISOString() });
      bandStart = null;
    }
  }
  // Moon-up bands: moon above 0° altitude. Same collapsing logic.
  const moonUpBands = [];
  bandStart = null;
  for (const s of samples) {
    const up = s.moonAlt != null && s.moonAlt > 0;
    if (up && !bandStart) bandStart = s.date;
    if ((!up || s === samples[samples.length - 1]) && bandStart) {
      moonUpBands.push({ start: bandStart.toISOString(), end: s.date.toISOString() });
      bandStart = null;
    }
  }

  const enriched = [];
  for (const row of rows) {
    if (!includeObserved && row.observed) continue;

    let maxAlt = -90;
    let maxAt = null;
    let samplesAbove = 0;        // count of samples strictly above min
    let firstAbove = null;
    let lastAbove = null;
    let moonSepAtMax = null;

    for (let i = 0; i < samples.length; i++) {
      const { date, moonEq } = samples[i];
      let raHours = row.ra_hours;
      let decDeg = row.dec_degrees;
      if (row.ephemeris) {
        const eph = bodyPosition(row.ephemeris, date);
        if (!eph) continue;
        raHours = eph.raHours;
        decDeg = eph.decDeg;
      }
      if (raHours == null || decDeg == null) continue;
      const pos = altAz({ raHours, decDeg, lat, lon, date });
      if (!pos) continue;
      if (pos.altitude > maxAlt) {
        maxAlt = pos.altitude;
        maxAt = date.toISOString();
        moonSepAtMax = angularSeparationDeg({ raHours, decDeg }, moonEq);
      }
      if (pos.altitude >= minAlt) {
        samplesAbove += 1;
        if (!firstAbove) firstAbove = date.toISOString();
        lastAbove = date.toISOString();
      }
    }

    if (maxAlt < minAlt) continue;
    if (minMoonSep > 0 && moonSepAtMax != null && moonSepAtMax < minMoonSep) continue;
    // Each sample represents an interval of stepMinutes. N samples cover
    // (N-1) intervals, so minutes-above is (samplesAbove - 1) × stepMinutes
    // when there's at least one above-min sample; the previous version was
    // off by one full step on every target.
    const minutesAbove = samplesAbove > 0 ? (samplesAbove - 1) * stepMinutes : 0;
    enriched.push({
      ...row,
      max_altitude: maxAlt,
      max_altitude_at: maxAt,
      first_above_at: firstAbove,
      last_above_at: lastAbove,
      minutes_above_min: minutesAbove,
      moon_separation_deg: moonSepAtMax != null ? Math.round(moonSepAtMax * 10) / 10 : null,
    });
  }

  enriched.sort((a, b) => b.max_altitude - a.max_altitude);

  res.json({
    location: { lat, lon },
    window: { start: start.toISOString(), end: end.toISOString(), step_minutes: stepMinutes },
    min_altitude: minAlt,
    min_moon_sep: minMoonSep || null,
    moon: moonPhase(start),
    astro_dark_bands: astroDarkBands,
    moon_up_bands: moonUpBands,
    targets: enriched.slice(0, limit),
  });
});

app.get('/api/tonight', (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat and lon query params are required (decimal degrees)' });
  }
  const minAlt = Number.isFinite(Number(req.query.min_alt))
    ? Number(req.query.min_alt) : 20;
  const includeObserved = req.query.include_observed === '1';
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const date = new Date();

  const rows = db
    .prepare(
      `SELECT lo.id, lo.catalog, lo.catalog_number, lo.name, lo.object_type,
              lo.constellation, lo.ra_hours, lo.dec_degrees, lo.magnitude,
              lo.ephemeris,
              l.slug AS list_slug, l.name AS list_name,
              EXISTS(SELECT 1 FROM list_completions lc
                       WHERE lc.list_object_id = lo.id) AS observed
         FROM list_objects lo
         JOIN lists l ON l.id = lo.list_id
         WHERE lo.ra_hours IS NOT NULL OR lo.dec_degrees IS NOT NULL
            OR lo.ephemeris IS NOT NULL`,
    )
    .all();

  const enriched = [];
  for (const row of rows) {
    if (!includeObserved && row.observed) continue;
    let raHours = row.ra_hours;
    let decDeg = row.dec_degrees;
    let magnitude = row.magnitude;
    if (row.ephemeris) {
      const eph = bodyPosition(row.ephemeris, date);
      if (!eph) continue;
      raHours = eph.raHours;
      decDeg = eph.decDeg;
      if (eph.magnitude != null) magnitude = eph.magnitude;
    }
    if (raHours == null || decDeg == null) continue;
    const pos = altAz({ raHours, decDeg, lat, lon, date });
    if (!pos || pos.altitude < minAlt) continue;
    enriched.push({
      ...row,
      ra_hours: raHours,
      dec_degrees: decDeg,
      magnitude,
      altitude: pos.altitude,
      azimuth: pos.azimuth,
    });
  }

  enriched.sort((a, b) => b.altitude - a.altitude);
  const moon = moonPhase(date);

  res.json({
    computed_at: date.toISOString(),
    location: { lat, lon },
    min_altitude: minAlt,
    moon: {
      phase: moon.phase,
      illumination: moon.illumination,
      name: moon.name,
    },
    targets: enriched.slice(0, limit),
  });
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
              o.exposure_seconds, o.iso, o.gain, o.stack_count, o.filter_name,
              o.focal_length_mm, o.aperture,
              o.rating, o.seeing, o.transparency, o.bortle,
              o.moon_phase, o.moon_phase_name,
              o.description, o.image_path
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         ORDER BY COALESCE(o.observed_at, o.created_at) DESC`,
    )
    .all();

  const columns = [
    'id', 'observed_at', 'created_at', 'title', 'catalog', 'catalog_number',
    'object_name', 'object_type', 'constellation', 'telescope', 'camera',
    'location', 'latitude', 'longitude', 'exposure_seconds', 'iso', 'gain',
    'stack_count', 'filter_name', 'focal_length_mm', 'aperture',
    'rating', 'seeing', 'transparency', 'bortle',
    'moon_phase', 'moon_phase_name', 'description', 'image_path',
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

// Public per-observation detail endpoint. Joins to the catalog row when the
// observation is list-backed and finds the previous / next siblings under
// the same target (matched on the same catalog+number tokens used by the
// cross-list ticking) so the public page can offer prev/next nav.
app.get('/api/observations/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const row = db
    .prepare(
      `SELECT o.*,
              lo.id            AS list_object_id,
              lo.name          AS list_object_name,
              lo.object_type   AS list_object_type,
              lo.constellation AS list_object_constellation,
              lo.ra_hours      AS list_object_ra_hours,
              lo.dec_degrees   AS list_object_dec_degrees,
              lo.magnitude     AS list_object_magnitude,
              l.slug           AS list_slug,
              l.name           AS list_name
         FROM observations o
         LEFT JOIN list_objects lo ON lo.id = o.object_id
         LEFT JOIN lists l ON l.id = lo.list_id
         WHERE o.id = ?`,
    )
    .get(id);
  if (!row) return res.status(404).json({ error: 'Observation not found' });

  // Siblings: every observation that shares the same catalog+number
  // (case- and whitespace-insensitive). Same predicate as the object
  // detail page uses, so results agree.
  const token = `${row.catalog || ''}${row.catalog_number || ''}`.toUpperCase().replace(/\s+/g, '');
  const siblings = token
    ? db
        .prepare(
          `SELECT id, observed_at, created_at, thumbnail_path
             FROM observations
             WHERE UPPER(REPLACE(catalog || catalog_number, ' ', '')) = ?
             ORDER BY COALESCE(observed_at, created_at) ASC, id ASC`,
        )
        .all(token)
    : [{ id: row.id, observed_at: row.observed_at, created_at: row.created_at, thumbnail_path: row.thumbnail_path }];

  const idx = siblings.findIndex((s) => s.id === row.id);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  res.json({
    observation: row,
    siblings,
    prev_id: prev?.id ?? null,
    next_id: next?.id ?? null,
    sibling_index: idx >= 0 ? idx : 0,
    sibling_count: siblings.length,
  });
});

// iCalendar feed of dark-sky weekends (Fri–Sun) over the next 12 months,
// anchored on each new moon. Subscribe in any calendar app for a one-glance
// view of the best imaging windows.
app.get('/api/calendar/dark-moon.ics', (_req, res) => {
  const now = new Date();
  const ICS_DT = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const SYNODIC_MS = 29.530588853 * 86_400_000;

  // Find each new moon in the next year by stepping ~one synodic month and
  // refining via local search. moonPhase().phase is 0 at new moon, so we
  // minimise that against zero, accounting for the 0/1 wraparound.
  const events = [];
  for (let i = 0; i < 13; i++) {
    let centre = new Date(now.getTime() + i * SYNODIC_MS);
    // Refine ±2 days at hour granularity.
    let best = centre;
    let bestPhase = 1;
    for (let h = -48; h <= 48; h++) {
      const t = new Date(centre.getTime() + h * 3_600_000);
      const p = moonPhase(t).phase;
      const dist = Math.min(p, 1 - p);
      if (dist < bestPhase) { bestPhase = dist; best = t; }
    }
    if (best.getTime() < now.getTime() - 86_400_000) continue;

    // Pick the Saturday closest to the new moon as the centre of the weekend.
    const day = best.getUTCDay();           // 0=Sun..6=Sat
    const offsetToSat = day <= 3 ? (6 - day) : -(day - 6);
    const sat = new Date(Date.UTC(best.getUTCFullYear(), best.getUTCMonth(), best.getUTCDate() + offsetToSat));
    const fri = new Date(sat.getTime() - 86_400_000);
    const monAfter = new Date(sat.getTime() + 2 * 86_400_000);   // exclusive end

    const uid = `dark-moon-${ICS_DT(fri)}@deepskylog`;
    events.push([
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART;VALUE=DATE:${ICS_DT(fri)}`,
      `DTEND;VALUE=DATE:${ICS_DT(monAfter)}`,
      'SUMMARY:Dark sky weekend (new moon)',
      `DESCRIPTION:New moon near ${best.toISOString().slice(0, 10)}. Weekend Friday–Sunday window of darkest skies.`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ].join('\r\n'));
  }

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DeepSkyLog//Dark-moon weekends//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:DeepSkyLog dark-moon weekends',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'inline; filename="deepskylog-dark-moon.ics"');
  res.send(ics);
});

// Weather lookup. Calls the free Open-Meteo archive API for the hour that
// matches the supplied date/lat/lon and returns mean cloud cover, temperature,
// humidity, and a coarse "transparency hint" (good if cloud_cover < 30%,
// poor if > 70%). Used by the upload form to suggest values for the
// transparency dropdown when the user clicks "Fetch weather". Admin-only
// because it's a small outbound network call we don't want randos triggering.
app.get('/api/admin/weather', basicAuth, async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const at = req.query.at ? new Date(String(req.query.at)) : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !at || Number.isNaN(at.getTime())) {
    return res.status(400).json({ error: 'lat, lon and at (ISO datetime) required' });
  }
  const date = at.toISOString().slice(0, 10);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}`
    + `&start_date=${date}&end_date=${date}`
    + `&hourly=cloud_cover,temperature_2m,dew_point_2m,relative_humidity_2m`
    + `&timezone=UTC`;
  let data;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    data = await r.json();
  } catch (err) {
    return res.status(502).json({ error: `weather fetch failed: ${err.message}` });
  }
  const hour = at.getUTCHours();
  const cloud = data?.hourly?.cloud_cover?.[hour];
  const temp = data?.hourly?.temperature_2m?.[hour];
  const dew = data?.hourly?.dew_point_2m?.[hour];
  const hum = data?.hourly?.relative_humidity_2m?.[hour];
  let transparencyHint = null;       // map cloud cover -> 1..5 scale
  if (typeof cloud === 'number') {
    if (cloud < 10) transparencyHint = 5;
    else if (cloud < 30) transparencyHint = 4;
    else if (cloud < 60) transparencyHint = 3;
    else if (cloud < 85) transparencyHint = 2;
    else transparencyHint = 1;
  }
  res.json({
    cloud_cover_pct: typeof cloud === 'number' ? cloud : null,
    temperature_c: typeof temp === 'number' ? temp : null,
    dew_point_c: typeof dew === 'number' ? dew : null,
    relative_humidity_pct: typeof hum === 'number' ? hum : null,
    transparency_hint: transparencyHint,
    source: 'open-meteo archive',
    fetched_at: new Date().toISOString(),
  });
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

  // Object types come from both the catalog (list_objects) and the
  // free-form types stored directly on observations (e.g. comets), so
  // filtering picks up entries that aren't in any seeded list.
  const objectTypes = db
    .prepare(
      `SELECT DISTINCT object_type FROM (
         SELECT object_type FROM list_objects
         UNION
         SELECT object_type FROM observations
       )
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

  // Follow alias links across catalogs so an object that's known under
  // multiple ids surfaces all its memberships and observations together.
  const graph = buildAliasGraph(db);
  const tokens = tokensFor(graph, `${object.catalog}${object.catalog_number}`);
  const peerIds = peerListObjects(db, tokens).map((p) => p.id);
  const placeholders = peerIds.length ? peerIds.map(() => '?').join(',') : '0';
  const tokensPlaceholders = tokens.length ? tokens.map(() => '?').join(',') : '\'\'';

  const memberships = peerIds.length
    ? db
        .prepare(
          `SELECT lo.id, l.slug, l.name AS list_name, lo.catalog, lo.catalog_number
             FROM list_objects lo JOIN lists l ON l.id = lo.list_id
             WHERE lo.id IN (${placeholders})
             ORDER BY l.builtin DESC, l.name`,
        )
        .all(...peerIds)
    : [];

  const observations = tokens.length
    ? db
        .prepare(
          `SELECT * FROM observations
             WHERE UPPER(REPLACE(catalog || catalog_number, ' ', '')) IN (${tokensPlaceholders})
             ORDER BY featured DESC, COALESCE(observed_at, created_at) DESC`,
        )
        .all(...tokens)
    : [];

  const completions = peerIds.length
    ? db
        .prepare(
          `SELECT * FROM list_completions
             WHERE list_object_id IN (${placeholders})
             ORDER BY completed_at DESC`,
        )
        .all(...peerIds)
    : [];

  const featuredObservation =
    observations.find((o) => o.featured && o.image_path)
    || observations.find((o) => o.image_path)
    || null;

  let live = null;
  if (object.ephemeris) {
    const eph = bodyPosition(object.ephemeris, new Date());
    if (eph) {
      live = {
        ra_hours: eph.raHours,
        dec_degrees: eph.decDeg,
        magnitude: eph.magnitude ?? object.magnitude,
        computed_at: new Date().toISOString(),
      };
    }
  }

  res.json({
    ...object,
    ra_hours: live ? live.ra_hours : object.ra_hours,
    dec_degrees: live ? live.dec_degrees : object.dec_degrees,
    magnitude: live ? live.magnitude : object.magnitude,
    live_coords: live,
    memberships,
    observations,
    completions,
    attempts_count: observations.length,
    featured_observation_id: featuredObservation?.id ?? null,
  });
});

// Admin: edit a list_object's aliases. Body is { aliases: ["NGC1976", "M42", …] }.
// Aliases are normalised to uppercase + whitespace-stripped tokens; an empty
// array is allowed (clears the column). Stored as a JSON array in the
// `aliases` column so json_each() in the cross-list ticking query keeps
// working.
app.patch('/api/admin/objects/:id', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const existing = db.prepare('SELECT id FROM list_objects WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Object not found' });

  if (!Array.isArray(req.body?.aliases)) {
    return res.status(400).json({ error: 'aliases must be an array of strings' });
  }
  const cleaned = req.body.aliases
    .map((s) => String(s).trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);
  const unique = [...new Set(cleaned)];
  for (const a of unique) {
    if (a.length > 40) return res.status(400).json({ error: `alias too long: ${a}` });
  }

  db.prepare('UPDATE list_objects SET aliases = ? WHERE id = ?')
    .run(unique.length ? JSON.stringify(unique) : null, id);
  res.json({ id, aliases: unique });
});

app.get('/api/admin/config', basicAuth, (_req, res) => {
  // Merge hardcoded telescope options with user-managed equipment so the
  // upload form's dropdown stays unified.
  const userTelescopes = db
    .prepare(`SELECT name FROM equipment WHERE kind = 'telescope' AND retired = 0 ORDER BY name`)
    .all()
    .map((r) => r.name);
  const merged = [...new Set([...TELESCOPE_OPTIONS, ...userTelescopes])];
  res.json({ telescopes: merged });
});

// Public site settings — site name etc. Read-only, no auth, so every page can
// fetch it on load to render the configured branding.
app.get('/api/settings', (_req, res) => {
  const rows = db.prepare(`SELECT key, value FROM site_settings`).all();
  const out = { site_name: 'DeepSkyLog' };
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

app.put('/api/admin/settings', basicAuth, (req, res) => {
  const body = req.body || {};
  const updates = [];
  if (typeof body.site_name === 'string') {
    const trimmed = body.site_name.trim();
    if (!trimmed) return res.status(400).json({ error: 'site_name cannot be empty' });
    if (trimmed.length > 80) return res.status(400).json({ error: 'site_name max 80 chars' });
    updates.push(['site_name', trimmed]);
  }
  if (!updates.length) return res.status(400).json({ error: 'no settings to update' });
  const stmt = db.prepare(
    `INSERT INTO site_settings (key, value, updated_at) VALUES (@key, @value, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const tx = db.transaction((rows) => { for (const [key, value] of rows) stmt.run({ key, value }); });
  tx(updates);
  res.json({ ok: true });
});

app.get('/api/admin/equipment', basicAuth, (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM equipment ORDER BY retired ASC, kind, name`)
    .all();
  res.json(rows);
});

app.post('/api/admin/equipment', basicAuth, (req, res) => {
  const kind = String(req.body?.kind || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!kind || !name) return res.status(400).json({ error: 'kind and name are required' });
  if (!['telescope', 'camera', 'filter', 'mount', 'other'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be telescope|camera|filter|mount|other' });
  }
  const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;
  try {
    const result = db
      .prepare(`INSERT INTO equipment (kind, name, notes) VALUES (?, ?, ?)`)
      .run(kind, name, notes);
    const row = db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(result.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Equipment with that kind+name already exists' });
    }
    throw err;
  }
});

app.patch('/api/admin/equipment/:id', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const body = req.body || {};
  const existing = db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Equipment not found' });
  const sets = [];
  const params = { id };
  if ('name' in body) {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    sets.push('name = @name');
    params.name = name;
  }
  if ('notes' in body) {
    sets.push('notes = @notes');
    params.notes = body.notes ? String(body.notes).slice(0, 500) : null;
  }
  if ('retired' in body) {
    sets.push('retired = @retired');
    params.retired = body.retired ? 1 : 0;
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  try {
    db.prepare(`UPDATE equipment SET ${sets.join(', ')} WHERE id = @id`).run(params);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `another ${existing.kind} already uses that name` });
    }
    throw err;
  }
  res.json(db.prepare(`SELECT * FROM equipment WHERE id = ?`).get(id));
});

// --- Backup management ----------------------------------------------------

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || './backups');

app.get('/api/admin/backups', basicAuth, (_req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ dir: BACKUP_DIR, archives: [] });
    const entries = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tar\.gz$/.test(e.name))
      .map((e) => {
        const full = path.join(BACKUP_DIR, e.name);
        const st = fs.statSync(full);
        return { name: e.name, size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
    res.json({ dir: BACKUP_DIR, archives: entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/backups', basicAuth, (_req, res) => {
  // Run ./backup.sh in the project root and stream the output back. We use
  // the same script the user can run from a shell so behaviour stays
  // consistent. Fails fast if the script is missing.
  const script = path.join(__dirname, 'backup.sh');
  if (!fs.existsSync(script)) return res.status(500).json({ error: 'backup.sh not found' });
  const { spawnSync } = require('child_process');
  // Pass the canonical paths the server is actually using so backup.sh
  // doesn't fall back to its own defaults when DATABASE_PATH/UPLOAD_DIR
  // were overridden in the environment.
  const result = spawnSync('bash', [script], {
    cwd: __dirname,
    env: {
      ...process.env,
      DB_PATH: DB_PATH,
      DATABASE_PATH: DB_PATH,
      UPLOAD_DIR,
      BACKUP_DIR,
    },
    timeout: 5 * 60_000,
  });
  if (result.status !== 0) {
    return res.status(500).json({
      error: 'backup.sh exited non-zero',
      stdout: result.stdout?.toString(),
      stderr: result.stderr?.toString(),
    });
  }
  res.status(201).json({ ok: true, log: result.stdout?.toString() });
});

app.post('/api/admin/backups/:name/restore', basicAuth, async (req, res) => {
  const safe = path.basename(req.params.name);
  const archive = path.join(BACKUP_DIR, safe);
  if (!archive.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(archive)) {
    return res.status(404).json({ error: 'Archive not found' });
  }

  // Extract into a sibling temp dir, then atomically swap the live db file
  // and merge uploads. The server will exit afterwards so the next request
  // re-opens the new database; in Docker the supervisor restarts us.
  const { spawnSync } = require('child_process');
  const tmp = path.join(BACKUP_DIR, `.restore-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', archive, '-C', tmp], { timeout: 5 * 60_000 });
  if (tar.status !== 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return res.status(500).json({ error: 'tar extract failed', stderr: tar.stderr?.toString() });
  }

  const dbSrc = path.join(tmp, 'deepskylog.sqlite');
  if (!fs.existsSync(dbSrc)) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return res.status(400).json({ error: 'archive missing deepskylog.sqlite' });
  }

  // Atomic db swap with rollback. The flow is:
  //   1. copy archive db to <DB_PATH>.new                  (fail-safe)
  //   2. rename live <DB_PATH>          → <DB_PATH>.bak   (atomic)
  //   3. rename <DB_PATH>.new           → <DB_PATH>       (atomic)
  //   4. on any failure between 2 and 3: rename .bak back
  //   5. on success: best-effort remove .bak and stale -wal/-shm
  //
  // We deliberately rename rather than unlink: with better-sqlite3 holding
  // an fd, the rename is invisible to the running process (the kernel keeps
  // the unlinked-by-rename inode alive); the next process restart opens the
  // freshly-named file. Avoids the "live db permanently destroyed if copy
  // fails halfway" hole the old code had.
  const dbDir = path.dirname(DB_PATH);
  fs.mkdirSync(dbDir, { recursive: true });
  const dbNew = `${DB_PATH}.new`;
  const dbBak = `${DB_PATH}.bak`;
  let bakInPlace = false;
  let uploadsBak = null;
  try {
    fs.copyFileSync(dbSrc, dbNew);
    if (fs.existsSync(DB_PATH)) {
      fs.renameSync(DB_PATH, dbBak);
      bakInPlace = true;
    }
    fs.renameSync(dbNew, DB_PATH);

    const uploadsSrc = path.join(tmp, 'uploads');
    if (fs.existsSync(uploadsSrc)) {
      uploadsBak = `${UPLOAD_DIR}.bak-${Date.now()}`;
      if (fs.existsSync(UPLOAD_DIR)) {
        fs.renameSync(UPLOAD_DIR, uploadsBak);
      }
      fs.cpSync(uploadsSrc, UPLOAD_DIR, { recursive: true });
      fs.rmSync(uploadsBak, { recursive: true, force: true });
      uploadsBak = null;
    }
  } catch (err) {
    // Roll back any partial swap.
    try { fs.unlinkSync(dbNew); } catch {}
    if (bakInPlace) {
      try {
        if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
        fs.renameSync(dbBak, DB_PATH);
      } catch (rollbackErr) {
        console.error('Restore rollback failed:', rollbackErr.message);
      }
    }
    if (uploadsBak && fs.existsSync(uploadsBak)) {
      try {
        fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
        fs.renameSync(uploadsBak, UPLOAD_DIR);
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    return res.status(500).json({ error: `restore failed: ${err.message}` });
  }

  // Success — clean up bak files and any stale wal/shm sidecars (the new
  // db doesn't have matching ones until it's reopened).
  try { if (fs.existsSync(dbBak)) fs.unlinkSync(dbBak); } catch {}
  for (const ext of ['-wal', '-shm']) {
    try { fs.unlinkSync(`${DB_PATH}${ext}`); } catch {}
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  res.json({
    ok: true,
    archive: safe,
    note: 'Database and uploads restored. Restart the server to pick up the new database.',
  });

  // Schedule a graceful exit so a Docker restart picks up the fresh state.
  // Without an external supervisor (`npm start` directly) the user has to
  // restart by hand — the response message says so.
  setTimeout(() => { console.log('Restored backup; exiting for clean reopen'); process.exit(0); }, 250);
});

app.delete('/api/admin/equipment/:id', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = db.prepare(`DELETE FROM equipment WHERE id = ?`).run(id);
  if (!result.changes) return res.status(404).json({ error: 'Equipment not found' });
  res.status(204).end();
});

// --- Astrometry.net plate solving ----------------------------------------

function setSolverStatus(observationId, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE observations SET ${sets} WHERE id = @id`)
    .run({ ...fields, id: observationId });
}

app.post('/api/admin/observations/:id/platesolve', basicAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const obs = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!obs) return res.status(404).json({ error: 'Observation not found' });
  if (!obs.image_path) return res.status(400).json({ error: 'Observation has no image to solve' });

  let session;
  try { session = await astrometry.login(); }
  catch (err) {
    if (err.code === 'no_key') {
      return res.status(503).json({ error: 'ASTROMETRY_API_KEY is not set on the server' });
    }
    return res.status(502).json({ error: `astrometry login failed: ${err.message}` });
  }

  const full = path.resolve(UPLOAD_DIR, obs.image_path);
  if (!full.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'Image file not found on disk' });
  }

  let subid;
  try { subid = await astrometry.submitFile(session, full); }
  catch (err) {
    return res.status(502).json({ error: `astrometry upload failed: ${err.message}` });
  }

  setSolverStatus(id, { solver_status: 'pending', solver_job_id: String(subid) });
  res.status(202).json({ ok: true, status: 'pending', subid });
});

app.get('/api/admin/observations/:id/platesolve', basicAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const obs = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!obs) return res.status(404).json({ error: 'Observation not found' });
  if (!obs.solver_job_id) return res.json({ status: obs.solver_status || 'idle' });
  if (obs.solver_status === 'success' || obs.solver_status === 'failure') {
    return res.json({
      status: obs.solver_status,
      solved_ra_hours: obs.solved_ra_hours,
      solved_dec_degrees: obs.solved_dec_degrees,
      solved_radius_deg: obs.solved_radius_deg,
      solved_orientation_deg: obs.solved_orientation_deg,
      solved_pixscale: obs.solved_pixscale,
      solved_at: obs.solved_at,
    });
  }

  // Poll astrometry for a status update.
  let poll;
  try { poll = await astrometry.pollStatus(obs.solver_job_id); }
  catch (err) { return res.status(502).json({ error: err.message }); }

  if (poll.state === 'pending' || poll.state === 'solving') {
    setSolverStatus(id, { solver_status: poll.state });
    return res.json({ status: poll.state });
  }
  if (poll.state === 'failure') {
    setSolverStatus(id, {
      solver_status: 'failure',
      solved_at: new Date().toISOString(),
    });
    return res.json({ status: 'failure' });
  }
  // success
  const cal = poll.calibration || {};
  const updates = {
    solver_status: 'success',
    solved_ra_hours: cal.ra != null ? cal.ra / 15 : null,        // API returns RA in degrees
    solved_dec_degrees: cal.dec ?? null,
    solved_radius_deg: cal.radius ?? null,
    solved_orientation_deg: cal.orientation ?? null,
    solved_pixscale: cal.pixscale ?? null,
    solved_at: new Date().toISOString(),
    solved_json: JSON.stringify({ calibration: cal, info: poll.info || null }),
  };
  setSolverStatus(id, updates);
  res.json({ status: 'success', ...updates });
});

app.get('/api/admin/stats', basicAuth, (_req, res) => {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS observations,
              COUNT(image_path) AS photos,
              COUNT(DISTINCT object_id) AS distinct_objects,
              COUNT(DISTINCT NULLIF(telescope, '')) AS distinct_telescopes,
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
      `SELECT o.id AS observation_id, o.object_id AS object_list_id,
              o.title, o.observed_at, o.created_at, o.telescope,
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

  // Calendar heatmap: counts of observations per UTC date for the last 365
  // days. Returned as a sparse array; the front-end fills in zero days.
  const heatmap = db
    .prepare(
      `SELECT substr(COALESCE(observed_at, created_at), 1, 10) AS day,
              COUNT(*) AS count
         FROM observations
         WHERE COALESCE(observed_at, created_at) >= date('now', '-365 day')
         GROUP BY day
         ORDER BY day`,
    )
    .all();

  // Lifetime panel — derived totals that motivate the daily user.
  // - integration_hours: SUM(stack_count * exposure_seconds) / 3600
  //   (stack_count defaults to 1 so single-frame observations still count).
  // - this_year: observations whose effective date falls in the current UTC
  //   year, judged from observed_at when set, falling back to created_at.
  // - longest/current streak: consecutive UTC days containing at least one
  //   observation, computed in JS off the same heatmap rows.
  const lifetime = db
    .prepare(
      `SELECT
         SUM(COALESCE(stack_count, 1) * COALESCE(exposure_seconds, 0)) / 3600.0
           AS integration_hours,
         COUNT(*) AS observations_total,
         COUNT(DISTINCT NULLIF(catalog || catalog_number, '')) AS distinct_targets,
         (SELECT COUNT(*) FROM observations
            WHERE substr(COALESCE(observed_at, created_at), 1, 4)
                  = strftime('%Y','now')) AS observations_this_year
       FROM observations`,
    )
    .get();

  const days = db
    .prepare(
      `SELECT DISTINCT substr(COALESCE(observed_at, created_at), 1, 10) AS day
         FROM observations
         WHERE COALESCE(observed_at, created_at) IS NOT NULL
         ORDER BY day`,
    )
    .all()
    .map((r) => r.day);

  const oneDay = 86_400_000;
  let longest = 0, current = 0, run = 0, prev = null;
  for (const d of days) {
    const t = Date.parse(d + 'T00:00:00Z');
    if (prev != null && t - prev === oneDay) run += 1; else run = 1;
    if (run > longest) longest = run;
    prev = t;
  }
  // current streak ends today (UTC) — count back from today.
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const dayset = new Set(days);
  for (let i = 0; ; i++) {
    const d = new Date(today.getTime() - i * oneDay).toISOString().slice(0, 10);
    if (dayset.has(d)) current += 1;
    else if (i === 0) continue;       // missing today still allowed; don't end yet
    else break;
  }

  lifetime.integration_hours = lifetime.integration_hours
    ? Number(lifetime.integration_hours.toFixed(1)) : 0;
  lifetime.longest_streak_days = longest;
  lifetime.current_streak_days = current;

  res.json({ totals, lifetime, lists, recent, telescopes, heatmap });
});

// Bundled NGC/IC fallback used by the upload form when the typed target
// isn't in any seeded list. Returns enough metadata to pre-fill catalog,
// catalog_number, ra/dec, type and constellation so a free-form NGC
// observation behaves like a list-backed one.
app.get('/api/admin/objects/lookup', basicAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  const hit = ngc.lookup(q);
  if (!hit) return res.status(404).json({ error: 'no NGC/IC match' });
  res.json(hit);
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

  const escaped = escapeLike(q);
  const like = `%${escaped}%`;
  const exact = `${escaped}%`;
  const rows = db
    .prepare(
      `SELECT lo.id, lo.catalog, lo.catalog_number, lo.name, lo.object_type, lo.constellation,
              l.slug AS list_slug, l.name AS list_name
         FROM list_objects lo JOIN lists l ON l.id = lo.list_id
         WHERE lo.name LIKE @like ESCAPE '\\' COLLATE NOCASE
            OR (lo.catalog || lo.catalog_number) LIKE @like ESCAPE '\\' COLLATE NOCASE
            OR lo.constellation LIKE @like ESCAPE '\\' COLLATE NOCASE
         ORDER BY CASE WHEN lo.name LIKE @exact ESCAPE '\\' THEN 0 ELSE 1 END,
                  l.builtin DESC, CAST(lo.catalog_number AS INTEGER)
         LIMIT @limit`,
    )
    .all({ like, exact, limit });
  res.json(rows);
});

app.post('/api/admin/stage', basicAuth, stageUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const isFits = isFitsPath(req.file.filename);
  let capturedIso = null;
  let device = null;
  let exposureSeconds = null;
  let latitude = null;
  let longitude = null;
  let iso = null;
  let focalLength = null;
  let aperture = null;
  let objectName = null;
  let exifTextBlob = '';

  if (isFits) {
    try {
      const header = readFitsHeader(req.file.path);
      const fx = fitsExif(header);
      if (fx) {
        capturedIso = fx.capturedAt;
        device = fx.device;
        exposureSeconds = fx.exposureSeconds;
        objectName = fx.object;
        latitude = fx.latitude;
        longitude = fx.longitude;
        focalLength = fx.focalLengthMm;
        aperture = fx.aperture;
      }
    } catch (err) {
      console.warn('FITS header parse failed:', err.message);
    }
  } else {
    let exif = null;
    try {
      exif = await exifr.parse(req.file.path, { gps: true, tiff: true, ifd0: true, exif: true });
    } catch {
      exif = null;
    }
    const captured = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null;
    capturedIso = captured instanceof Date ? captured.toISOString() : null;
    device = deviceFromExif(exif);
    latitude = typeof exif?.latitude === 'number' ? exif.latitude : null;
    longitude = typeof exif?.longitude === 'number' ? exif.longitude : null;
    iso = exif?.ISO ?? exif?.ISOSpeedRatings ?? null;
    exposureSeconds = exif?.ExposureTime ?? null;
    focalLength = exif?.FocalLength ?? null;
    aperture = exif?.FNumber ?? exif?.ApertureValue ?? null;
    exifTextBlob = [
      exif?.Artist, exif?.ImageDescription, exif?.UserComment,
      exif?.XPSubject, exif?.XPComment, exif?.XPAuthor, exif?.XPTitle,
      exif?.Software,
    ].filter(Boolean).map(String).join('\n');
  }

  // Mine the text we have (EXIF text fields plus the watermark band on
  // Seestar JPGs) for target / total exposure / coords / capture date.
  const telescopeMatch = matchTelescope(device);
  const isSeestar = !isFits && /seestar/i.test(device || '');
  let ocrText = null;
  let ocrError = null;
  if (isSeestar) {
    try {
      ocrText = await ocrBanner(req.file.path);
    } catch (err) {
      ocrError = err.message;
      console.warn('Seestar OCR failed:', err.message);
    }
  }
  const combinedText = [exifTextBlob || '', ocrText || ''].filter(Boolean).join('\n');
  const guesses = parseSeestarText(combinedText);

  // Seestar export filenames carry stack count, target, sub-exposure,
  // filter, and capture timestamp — fill any gaps left by EXIF/OCR.
  const fileGuess = parseSeestarFilename(req.file.originalname);
  let stackCount = null;
  let filterName = null;
  if (fileGuess) {
    if (!capturedIso && fileGuess.captured_at) capturedIso = fileGuess.captured_at;
    if (!objectName && fileGuess.target?.raw) objectName = fileGuess.target.raw;
    if (exposureSeconds == null && fileGuess.exposure_seconds != null) {
      exposureSeconds = fileGuess.exposure_seconds;
    }
    stackCount = fileGuess.stack_count;
    filterName = fileGuess.filter_name;
  }

  // Promote OCR/EXIF guesses into the exposed exif block where the form
  // currently has nothing (sub-second EXIF exposure shouldn't be clobbered
  // by a watermark "52min", which is total integration; we put that in a
  // separate field for the UI to interpret).
  if (latitude == null && guesses.coords?.latitude != null) latitude = guesses.coords.latitude;
  if (longitude == null && guesses.coords?.longitude != null) longitude = guesses.coords.longitude;
  if (!capturedIso && guesses.captured_at) capturedIso = guesses.captured_at;
  if (!objectName && guesses.target?.raw) objectName = guesses.target.raw;

  res.status(201).json({
    stage_id: req.file.filename,
    original_name: req.file.originalname,
    size: req.file.size,
    mime: req.file.mimetype,
    kind: isFits ? 'fits' : 'image',
    preview_url: `/api/admin/stage/${encodeURIComponent(req.file.filename)}/preview`,
    exif: {
      captured_at: capturedIso,
      device,
      latitude,
      longitude,
      iso,
      exposure_seconds: exposureSeconds,
      focal_length_mm: focalLength,
      aperture,
      object_name: objectName,
      stack_count: stackCount,
      filter_name: filterName,
    },
    guesses: {
      target: guesses.target || fileGuess?.target || null,
      total_exposure_seconds: guesses.exposure_seconds_total,
      photographer: guesses.photographer,
      from_ocr: !!ocrText,
      from_filename: !!fileGuess,
      ocr_error: ocrError,
    },
    telescope_match: telescopeMatch,
    telescope_options: TELESCOPE_OPTIONS,
  });
});

app.get('/api/admin/stage/:id/preview', basicAuth, async (req, res) => {
  const safe = path.basename(req.params.id);
  const full = path.join(STAGE_DIR, safe);
  if (!full.startsWith(STAGE_DIR + path.sep) || !fs.existsSync(full)) {
    return res.status(404).end();
  }
  if (!isFitsPath(safe)) return res.sendFile(full);

  const cached = path.join(STAGE_DIR, `${safe}.preview.jpg`);
  try {
    if (!fs.existsSync(cached)) {
      const buf = await renderFitsJpeg(full, sharp, { maxWidth: 1200 });
      fs.writeFileSync(cached, buf);
    }
    res.type('image/jpeg').sendFile(cached);
  } catch (err) {
    console.error('FITS preview render failed:', err.message);
    res.status(500).json({ error: 'Failed to render FITS preview' });
  }
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
  const clamp = (v, lo, hi) =>
    v == null || v === '' ? null : Math.max(lo, Math.min(hi, Number(v)));
  const rating = clamp(body.rating, 1, 5);
  const seeing = clamp(body.seeing, 1, 5);
  const transparency = clamp(body.transparency, 1, 5);
  const bortle = clamp(body.bortle, 1, 9);
  const sqm = clamp(body.sqm, 14, 22.5);

  const stackCount = body.stack_count != null && body.stack_count !== ''
    ? Math.max(0, Math.floor(Number(body.stack_count))) : null;
  const gain = body.gain != null && body.gain !== ''
    ? Math.max(0, Math.floor(Number(body.gain))) : null;
  const filterName = body.filter_name ? String(body.filter_name).trim().slice(0, 80) : null;

  // Validate sidecar JSON before storing it; reject the whole save if it's
  // syntactically broken so we don't pollute the column.
  let deviceJson = null;
  if (body.seestar_json) {
    try {
      JSON.parse(String(body.seestar_json));
      deviceJson = String(body.seestar_json);
    } catch {
      return res.status(400).json({ error: 'seestar_json is not valid JSON' });
    }
  }

  // Explicit form values override EXIF for these capture fields.
  const formExposure = body.exposure_seconds != null && body.exposure_seconds !== ''
    ? Number(body.exposure_seconds) : null;
  const formIso = body.iso != null && body.iso !== ''
    ? Number(body.iso) : null;

  // Free-form object metadata for observations not backed by a list row
  // (notably comets, which don't fit the static catalog model).
  const allowedTypes = ['GC','OC','PN','SNR','DN','GAL','MW','AST','DS','STAR','MOON','PLAN','COMET'];
  const observationObjectType = (typeof body.object_type === 'string' && allowedTypes.includes(body.object_type))
    ? body.object_type : null;
  const observationRaHours = body.ra_hours != null && body.ra_hours !== ''
    ? clamp(body.ra_hours, 0, 24) : null;
  const observationDecDegrees = body.dec_degrees != null && body.dec_degrees !== ''
    ? clamp(body.dec_degrees, -90, 90) : null;

  // Form lat/lon (clamped) take precedence over anything we mine from EXIF.
  const formLatitude = body.latitude != null && body.latitude !== ''
    ? clamp(body.latitude, -90, 90) : null;
  const formLongitude = body.longitude != null && body.longitude !== ''
    ? clamp(body.longitude, -180, 180) : null;

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
  const yyyy = String(dateForPath.getFullYear());
  const mm = String(dateForPath.getMonth() + 1).padStart(2, '0');

  const moon = moonPhase(dateForPath);

  const dirSlug = slugify(objectName
    || (catalog && catalogNumber ? `${catalog}${catalogNumber}` : 'misc'));
  const destDir = path.join(UPLOAD_DIR, yyyy, mm, dirSlug);
  fs.mkdirSync(destDir, { recursive: true });

  const ext = path.extname(stageId).toLowerCase() || '.jpg';
  const baseName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const isFits = isFitsPath(stageId);
  const rawPath = path.join(destDir, `${baseName}${ext}`);
  const heroPath = isFits ? path.join(destDir, `${baseName}.jpg`) : rawPath;
  const thumbPath = path.join(destDir, `thumb-${baseName}.jpg`);

  const written = [];
  let exif = null;
  let fitsHeader = null;
  let relImage;
  let relThumb;

  try {
    try {
      fs.renameSync(stagePath, rawPath);
    } catch (err) {
      if (err.code === 'EXDEV') {
        fs.copyFileSync(stagePath, rawPath);
        fs.unlinkSync(stagePath);
      } else {
        throw err;
      }
    }
    written.push(rawPath);

    if (isFits) {
      try { fitsHeader = readFitsHeader(rawPath); } catch {}
      const heroBuf = await renderFitsJpeg(rawPath, sharp, { maxWidth: 1600, quality: 88 });
      fs.writeFileSync(heroPath, heroBuf);
      written.push(heroPath);
      await sharp(heroBuf)
        .resize({ width: 640, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(thumbPath);
    } else {
      await sharp(rawPath)
        .rotate()
        .resize({ width: 640, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(thumbPath);
      try {
        exif = await exifr.parse(rawPath, { gps: true });
      } catch {
        exif = null;
      }
    }
    written.push(thumbPath);

    relImage = path.relative(UPLOAD_DIR, heroPath).split(path.sep).join('/');
    relThumb = path.relative(UPLOAD_DIR, thumbPath).split(path.sep).join('/');
  } catch (err) {
    for (const p of written) { try { fs.unlinkSync(p); } catch {} }
    console.error('Finalize failed:', err);
    return res.status(500).json({ error: 'Failed to process upload' });
  }

  const fx = fitsHeader ? fitsExif(fitsHeader) : null;
  const latitude = formLatitude
    ?? fx?.latitude
    ?? (typeof exif?.latitude === 'number' ? exif.latitude : null);
  const longitude = formLongitude
    ?? fx?.longitude
    ?? (typeof exif?.longitude === 'number' ? exif.longitude : null);

  const cameraField = fx?.device || (exif?.Model ? String(exif.Model) : null);
  const exposureField = exif?.ExposureTime ?? fx?.exposureSeconds ?? null;
  const focalLengthField = exif?.FocalLength ?? fx?.focalLengthMm ?? null;
  const apertureField = exif?.FNumber ?? exif?.ApertureValue ?? fx?.aperture ?? null;
  const metadataJson = fitsHeader ? JSON.stringify({ fits: fitsHeader }) : (exif ? JSON.stringify(exif) : null);

  const insert = db.prepare(
    `INSERT INTO observations
       (object_id, catalog, catalog_number, title, description, observed_at,
        location, telescope, camera, exposure_seconds, iso, focal_length_mm,
        aperture, image_path, thumbnail_path, exif_json, rating,
        latitude, longitude, seeing, transparency, moon_phase,
        moon_phase_name, bortle, stack_count, gain, filter_name, device_json,
        object_type, ra_hours, dec_degrees, sqm)
     VALUES (@object_id, @catalog, @catalog_number, @title, @description, @observed_at,
             @location, @telescope, @camera, @exposure_seconds, @iso, @focal_length_mm,
             @aperture, @image_path, @thumbnail_path, @exif_json, @rating,
             @latitude, @longitude, @seeing, @transparency, @moon_phase,
             @moon_phase_name, @bortle, @stack_count, @gain, @filter_name, @device_json,
             @object_type, @ra_hours, @dec_degrees, @sqm)`,
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
      camera: cameraField,
      // Explicit form values override EXIF/FITS-derived defaults.
      exposure_seconds: formExposure ?? exposureField,
      iso: formIso ?? exif?.ISO ?? exif?.ISOSpeedRatings ?? null,
      focal_length_mm: focalLengthField,
      aperture: apertureField,
      image_path: relImage,
      thumbnail_path: relThumb,
      exif_json: metadataJson,
      rating,
      latitude,
      longitude,
      seeing,
      transparency,
      moon_phase: moon.phase,
      moon_phase_name: moon.name,
      bortle,
      stack_count: stackCount,
      gain,
      filter_name: filterName,
      device_json: deviceJson,
      object_type: observationObjectType,
      ra_hours: observationRaHours,
      dec_degrees: observationDecDegrees,
      sqm,
    });

    const observationId = Number(result.lastInsertRowid);

    if (catalog && catalogNumber) {
      // Cross-list ticking: an upload of "M42" should also tick the row for
      // NGC 1976 in the RASC list, and any other list that aliases either.
      const seedToken = matchedObject
        ? `${matchedObject.catalog}${matchedObject.catalog_number}`
        : `${catalog}${catalogNumber}`;
      const graph = buildAliasGraph(db);
      const idTokens = tokensFor(graph, seedToken);
      const peers = peerListObjects(db, idTokens);
      for (const peer of peers) {
        completeList.run(peer.id, observationId, notes);
      }

      // Auto-feature the first attempt for this object — judged across every
      // alias token, not just the primary key — so the cover image is set
      // even when prior attempts lived under a different catalog id.
      if (relImage) {
        const placeholders = idTokens.map(() => '?').join(',');
        const prior = db
          .prepare(
            `SELECT COUNT(*) AS c FROM observations
               WHERE id != ? AND image_path IS NOT NULL
                 AND UPPER(REPLACE(catalog || catalog_number, ' ', '')) IN (${placeholders})`,
          )
          .get(observationId, ...idTokens).c;
        if (prior === 0) {
          db.prepare('UPDATE observations SET featured = 1 WHERE id = ?').run(observationId);
        }
      }
    }

    return observationId;
  });

  let observationId;
  try {
    observationId = tx();
  } catch (err) {
    // Roll back every file written during finalize. The previous version
    // referenced an undefined `finalPath` here and crashed the rollback
    // with a ReferenceError, leaving the response un-sent and the orphaned
    // files behind.
    for (const p of written) {
      try { fs.unlinkSync(p); } catch {}
    }
    console.error('Finalize DB write failed:', err);
    return res.status(500).json({ error: 'Failed to record observation' });
  }

  res.status(201).json({
    id: observationId,
    image_path: relImage,
    thumbnail_path: relThumb,
  });
});

app.patch('/api/admin/observations/:id', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const existing = db.prepare('SELECT id FROM observations WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Observation not found' });

  // Whitelist of editable columns plus per-column type-coercion / clamping.
  const body = req.body || {};
  const clamp = (v, lo, hi) =>
    v == null || v === '' ? null : Math.max(lo, Math.min(hi, Number(v)));
  const str = (v, max = 200) =>
    v == null ? null : String(v).trim().slice(0, max) || null;
  const num = (v) => (v == null || v === '' ? null : Number(v));

  const updates = {};
  if ('title' in body)            updates.title = str(body.title, 200);
  if ('description' in body)      updates.description = body.description == null ? null : String(body.description);
  if ('observed_at' in body)      updates.observed_at = str(body.observed_at, 40);
  if ('location' in body)         updates.location = str(body.location, 200);
  if ('telescope' in body)        updates.telescope = str(body.telescope, 80);
  if ('camera' in body)           updates.camera = str(body.camera, 80);
  if ('rating' in body)           updates.rating = clamp(body.rating, 1, 5);
  if ('seeing' in body)           updates.seeing = clamp(body.seeing, 1, 5);
  if ('transparency' in body)     updates.transparency = clamp(body.transparency, 1, 5);
  if ('bortle' in body)           updates.bortle = clamp(body.bortle, 1, 9);
  if ('sqm' in body)              updates.sqm = clamp(body.sqm, 14, 22.5);
  if ('stack_count' in body)      updates.stack_count = num(body.stack_count);
  if ('exposure_seconds' in body) updates.exposure_seconds = num(body.exposure_seconds);
  if ('iso' in body)              updates.iso = num(body.iso);
  if ('gain' in body)             updates.gain = num(body.gain);
  if ('filter_name' in body)      updates.filter_name = str(body.filter_name, 80);
  if ('focal_length_mm' in body)  updates.focal_length_mm = num(body.focal_length_mm);
  if ('aperture' in body)         updates.aperture = num(body.aperture);
  if ('latitude' in body)         updates.latitude  = clamp(body.latitude, -90, 90);
  if ('longitude' in body)        updates.longitude = clamp(body.longitude, -180, 180);
  if ('object_type' in body) {
    const allowed = ['GC','OC','PN','SNR','DN','GAL','MW','AST','DS','STAR','MOON','PLAN','COMET'];
    updates.object_type = (typeof body.object_type === 'string' && allowed.includes(body.object_type))
      ? body.object_type : null;
  }
  if ('ra_hours' in body)         updates.ra_hours = clamp(body.ra_hours, 0, 24);
  if ('dec_degrees' in body)      updates.dec_degrees = clamp(body.dec_degrees, -90, 90);

  // observed_at: accept null (clear) or a parseable date; reject obvious
  // garbage so the column doesn't fill up with whatever the client sent.
  if ('observed_at' in body && updates.observed_at !== null) {
    if (Number.isNaN(Date.parse(updates.observed_at))) {
      return res.status(400).json({ error: 'observed_at is not a parseable date' });
    }
    const mp = moonPhase(new Date(updates.observed_at));
    updates.moon_phase = mp.phase;
    updates.moon_phase_name = mp.name;
  }

  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'No editable fields supplied' });

  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(
    `UPDATE observations SET ${setClause}, updated_at = datetime('now') WHERE id = @id`,
  ).run({ ...updates, id });

  const fresh = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  res.json(fresh);
});

app.post('/api/admin/observations/:id/feature', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const target = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Observation not found' });
  if (!target.catalog || !target.catalog_number) {
    return res.status(400).json({ error: 'Observation has no catalog id to feature against' });
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE observations SET featured = 0
         WHERE catalog = ? AND catalog_number = ? AND id != ?`,
    ).run(target.catalog, target.catalog_number, id);
    db.prepare('UPDATE observations SET featured = 1 WHERE id = ?').run(id);
  });
  tx();
  res.json({ ok: true, id });
});

app.delete('/api/admin/observations/:id', basicAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Observation not found' });

  // Best-effort file cleanup, scoped to UPLOAD_DIR.
  const tryUnlink = (rel) => {
    if (!rel) return;
    const full = path.resolve(UPLOAD_DIR, rel);
    if (!full.startsWith(UPLOAD_DIR + path.sep)) return;
    try { fs.unlinkSync(full); } catch {}
  };
  tryUnlink(row.image_path);
  tryUnlink(row.thumbnail_path);

  // Walk back up the YYYY/MM/<slug> tree, removing empty directories.
  if (row.image_path) {
    let dir = path.resolve(UPLOAD_DIR, path.dirname(row.image_path));
    while (
      dir.startsWith(UPLOAD_DIR + path.sep) &&
      dir !== UPLOAD_DIR
    ) {
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM list_completions WHERE observation_id = ?').run(id);
    db.prepare('DELETE FROM observations WHERE id = ?').run(id);

    // If the deleted row was featured, promote the most recent remaining
    // attempt with an image so the object still has a cover.
    if (row.featured && row.catalog && row.catalog_number) {
      const next = db
        .prepare(
          `SELECT id FROM observations
             WHERE catalog = ? AND catalog_number = ? AND image_path IS NOT NULL
             ORDER BY COALESCE(observed_at, created_at) DESC
             LIMIT 1`,
        )
        .get(row.catalog, row.catalog_number);
      if (next) {
        db.prepare('UPDATE observations SET featured = 1 WHERE id = ?').run(next.id);
      }
    }
  });
  tx();

  res.status(204).end();
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
