// Labels a Moon photo: finds the disk and how it is turned
// (lib/moon_detect.js), works out the Moon's face at the capture time
// (lib/moon_ephem.js), and projects the named features (lib/moon_features.json,
// from the IAU gazetteer) onto the photo in its own pixels. The server caches
// the result per observation (moon_maps table); the public observation page
// draws it as an SVG overlay.
'use strict';

const FEATURES = require('./moon_features.json');
const { storedImagePath } = require('./repair_shared');
const { moonFace } = require('./moon_ephem');
const { detectMoon, screenFrame, globeAxes, surfaceVector } = require('./moon_detect');

// Bump when detection or projection changes so cached maps are redone.
const MOON_MAP_VERSION = 1;
const MOON_RADIUS_KM = 1737.4;
// Features this close to the limb are too foreshortened to place reliably.
const MIN_VIEW_Z = 0.06;
// Craters, mountains and rilles smaller than this on the photo are dropped
// (px, diameter); the page further thins labels to what fits its display.
const MIN_FEATURE_PX = 4;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const rev = (x) => ((x % 360) + 360) % 360;

// Is this observation of the Moon? Type MOON, the Solar System list's Moon
// (SOL 2), or a target named just "Moon".
function isMoonObservation(o) {
  if (!o) return false;
  if (o.object_type === 'MOON' || o.list_object_type === 'MOON') return true;
  if (String(o.catalog || '').toUpperCase() === 'SOL' && String(o.catalog_number || '').trim() === '2') return true;
  return /^\s*(the\s+)?moon\s*$/i.test(o.object_name || '');
}

// The capture instant for an observed_at string. Stored times are the
// photographer's wall clock with no zone (the upload form's datetime-local),
// so a zoneless time is read as local mean time at the longitude, to the
// nearest hour — within an hour of the truth almost everywhere, and an hour
// moves the Moon's face by far less than the labels can show.
function captureInstant(observedAt, lon) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/
    .exec(String(observedAt || '').trim());
  if (!m) {
    const t = Date.parse(observedAt);
    return Number.isFinite(t) ? new Date(t) : null;
  }
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!Number.isFinite(wall)) return null;
  const zone = m[7];
  if (zone === 'Z') return new Date(wall);
  if (zone) {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    return new Date(wall - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60000);
  }
  const hours = Number.isFinite(lon) ? Math.round(lon / 15) : 0;
  return new Date(wall - hours * 3600000);
}

// Screen angle (degrees clockwise from up) of a screen vector.
const screenAngle = ([x, y]) => rev(Math.atan2(x, -y) * 180 / Math.PI);

// Project every feature for `face` onto a photo with this disk/orientation.
// Returns [{ n, t, d, x, y, a, b, rot, lit }]: d the gazetteer size in km;
// centre in photo pixels; a / b the tangential / radial semi-axes of the
// feature's outline (foreshortened towards the limb), the radial one at
// `rot` degrees clockwise from the +x axis; lit = the Sun is up there. Mare
// outlines (`ring`) come back as a polygon in photo pixels.
function projectFeatures(face, disk, orientation) {
  const axes = globeAxes(face.libration.l, face.libration.b);
  const sunVec = surfaceVector(face.sun.b, face.sun.l);
  const { north, east } = screenFrame(orientation.rotation, orientation.mirrored);
  const toScreen = (x, y) => [
    disk.cx + disk.r * (x * east[0] + y * north[0]),
    disk.cy + disk.r * (x * east[1] + y * north[1]),
  ];
  const out = [];
  for (const f of FEATURES) {
    const p = surfaceVector(f.lat, f.lon);
    const z = dot(p, axes.view);
    if (z < MIN_VIEW_Z) continue;
    const [x, y] = toScreen(dot(p, axes.east), dot(p, axes.north));
    const a = disk.r * Math.sin(Math.min(Math.PI / 2, (f.d / 2) / MOON_RADIUS_KM));
    if (f.t !== 'mare' && f.t !== 'landing' && 2 * a < MIN_FEATURE_PX) continue;
    const item = {
      n: f.n,
      t: f.t,
      d: f.d,
      x: round1(x),
      y: round1(y),
      a: round1(a),
      b: round1(a * z),
      rot: round1(Math.atan2(y - disk.cy, x - disk.cx) * 180 / Math.PI),
      lit: dot(p, sunVec) > 0,
    };
    if (f.ring) {
      item.ring = f.ring.map(([lat, lon]) => {
        const q = surfaceVector(lat, lon);
        let qx = dot(q, axes.east), qy = dot(q, axes.north);
        if (dot(q, axes.view) < 0) {
          // Behind the limb: pin to the limb so the outline hugs the edge.
          const s = Math.hypot(qx, qy) || 1;
          qx /= s; qy /= s;
        }
        return toScreen(qx, qy).map(round1);
      });
    }
    out.push(item);
  }
  return out;
}

// 'high' / 'medium' / 'low' from the match quality (see findOrientation in
// lib/moon_detect.js); 'manual' for an admin override. An ambiguous
// handedness is at most 'medium': the photo is then taken as unmirrored,
// which a Seestar's always are.
function confidenceOf(o) {
  if (o.score == null) return 'manual';
  if (o.score < 0.35 || o.margin < 0.03) return 'low';
  if (o.score >= 0.5 && o.margin >= 0.05 && o.mirrorMargin >= 0.05) return 'high';
  return 'medium';
}

// The whole map for one photo. `observer` = { lat, lon } (optional, makes
// libration topocentric); `override` = { rotation, mirrored } from an admin.
// Always resolves; `status` says what happened: 'ok', 'no-date', 'no-disk'
// or 'no-orientation' (a disk, but too flat to match — e.g. overexposed).
async function computeMoonMap({ imagePath, observedAt, observer = null, override = null }) {
  const lon = observer && Number.isFinite(observer.lon) ? observer.lon : null;
  const when = captureInstant(observedAt, lon);
  if (!when) return { version: MOON_MAP_VERSION, status: 'no-date' };
  const topo = observer && Number.isFinite(observer.lat) && Number.isFinite(observer.lon) ? observer : null;
  const face = moonFace(when, topo);
  const fixed = override && Number.isFinite(Number(override.rotation)) ? override : null;
  const found = await detectMoon(imagePath, face, { fixed });
  const base = {
    version: MOON_MAP_VERSION,
    image: { width: found.width, height: found.height },
    captured_at: when.toISOString(),
    topocentric: !!topo,
    face: {
      libration: { l: round2(face.libration.l), b: round2(face.libration.b) },
      position_angle: round2(face.positionAngle),
      colongitude: round2(face.sun.colongitude),
      illuminated: Math.round(face.illuminated * 1000) / 1000,
      waxing: face.waxing,
    },
  };
  if (!found.disk) return { ...base, status: 'no-disk' };
  const disk = { cx: round1(found.disk.cx), cy: round1(found.disk.cy), r: round1(found.disk.r) };
  if (!found.orientation) return { ...base, status: 'no-orientation', disk };
  const o = found.orientation;
  const { north } = screenFrame(o.rotation, o.mirrored);
  // Celestial north is the lunar pole turned back by the position angle
  // (counter-clockwise on the sky from north to east, reversed in a mirror).
  const sense = o.mirrored ? -1 : 1;
  const celestialNorth = rev(screenAngle(north) + sense * face.positionAngle);
  return {
    ...base,
    status: 'ok',
    disk,
    orientation: {
      rotation: round1(o.rotation),
      mirrored: o.mirrored,
      source: fixed ? 'manual' : 'auto',
      confidence: confidenceOf(o),
      score: o.score == null ? null : Math.round(o.score * 1000) / 1000,
      margin: o.margin == null ? null : Math.round(o.margin * 1000) / 1000,
    },
    compass: { north: round1(celestialNorth), east: round1(rev(celestialNorth - sense * 90)) },
    features: projectFeatures(face, disk, o),
  };
}

// The moon_maps cache (migration 18). A map is recomputed whenever anything
// it depends on changes — photo, capture time, location, override, or
// MOON_MAP_VERSION — and concurrent requests for one observation share a
// single run. `defaultLocation()` stands in for observations without
// coordinates (as the upload form does). `o` needs id, image_path,
// observed_at, created_at, latitude, longitude.
function createMoonMapStore({ db, uploadDir, defaultLocation = () => null, log = console }) {
  const inflight = new Map();
  const select = db.prepare('SELECT cache_key, result_json, override_json FROM moon_maps WHERE observation_id = ?');
  const save = db.prepare(
    `INSERT INTO moon_maps (observation_id, cache_key, result_json, updated_at)
     VALUES (@id, @key, @json, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(observation_id) DO UPDATE SET
       cache_key = excluded.cache_key, result_json = excluded.result_json, updated_at = excluded.updated_at`,
  );
  const setOverride = db.prepare(
    `INSERT INTO moon_maps (observation_id, override_json, updated_at)
     VALUES (@id, @override, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(observation_id) DO UPDATE SET
       override_json = excluded.override_json, updated_at = excluded.updated_at`,
  );

  function inputsFor(o, row) {
    const hasCoords = Number.isFinite(o.latitude) && Number.isFinite(o.longitude);
    const home = hasCoords ? null : defaultLocation();
    const observer = hasCoords ? { lat: o.latitude, lon: o.longitude }
      : (home ? { lat: home.latitude, lon: home.longitude } : null);
    // created_at is SQLite's UTC datetime('now'): say so, or it would be read
    // as the photographer's local time.
    const observedAt = o.observed_at || (o.created_at ? `${String(o.created_at).replace(' ', 'T')}Z` : null);
    let override = null;
    try { override = row?.override_json ? JSON.parse(row.override_json) : null; } catch { override = null; }
    const key = JSON.stringify([MOON_MAP_VERSION, o.image_path, observedAt, observer, override]);
    return { observer, observedAt, override, key };
  }

  async function run(o) {
    const row = select.get(o.id);
    const inputs = inputsFor(o, row);
    if (row?.cache_key === inputs.key && row.result_json) {
      try { return JSON.parse(row.result_json); } catch { /* recompute */ }
    }
    const imagePath = storedImagePath(uploadDir, o.image_path);
    let result;
    if (!imagePath) {
      result = { version: MOON_MAP_VERSION, status: 'no-image' };
    } else {
      try {
        result = await computeMoonMap({ imagePath, observedAt: inputs.observedAt, observer: inputs.observer, override: inputs.override });
      } catch (err) {
        log.warn?.(`moon map for observation ${o.id} failed: ${err.message}`);
        result = { version: MOON_MAP_VERSION, status: 'error' };
      }
    }
    // Store only if the observation still exists (it may have been deleted
    // while the photo was being analysed).
    try {
      save.run({ id: o.id, key: inputs.key, json: JSON.stringify(result) });
    } catch (err) {
      if (!/FOREIGN KEY/i.test(err.message)) throw err;
    }
    return result;
  }

  function get(o) {
    if (inflight.has(o.id)) return inflight.get(o.id);
    const p = run(o).finally(() => inflight.delete(o.id));
    inflight.set(o.id, p);
    return p;
  }

  // Like get(), but never hands back a run that started before now (after
  // an override changes, say).
  async function fresh(o) {
    if (inflight.has(o.id)) await inflight.get(o.id).catch(() => {});
    return get(o);
  }

  // { rotation, mirrored } to pin the orientation, or null for automatic.
  function override(id, value) {
    setOverride.run({ id, override: value ? JSON.stringify({ rotation: value.rotation, mirrored: !!value.mirrored }) : null });
  }

  return { get, fresh, override };
}

module.exports = {
  computeMoonMap, projectFeatures, captureInstant, isMoonObservation, createMoonMapStore, MOON_MAP_VERSION,
};
