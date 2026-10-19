// Moon map: the lunar ephemeris against Meeus's worked examples, disk and
// orientation detection on synthetic Moon photos (rendered from the same
// albedo map, turned and mirrored by known amounts), the projection's
// geometry, and the API end to end — upload, cached map, admin override.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const { moonFace } = require(path.join(ROOT, 'lib', 'moon_ephem'));
const { renderMoon, detectMoon } = require(path.join(ROOT, 'lib', 'moon_detect'));
const { projectFeatures, captureInstant, isMoonObservation, computeMoonMap } = require(path.join(ROOT, 'lib', 'moon_map'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-moon-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const close = (actual, expected, tol, what) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol} of ${expected}`);
const angleOff = (a, b) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };

// A synthetic Moon photo on disk; returns its path.
async function moonPhoto(name, { when, rotation = 0, mirrored = false, width = 520, height = 520, cx = 260, cy = 260, r = 200, format = 'png' }) {
  const face = moonFace(new Date(when));
  const size = Math.max(width, height);
  const raw = await renderMoon({ face, size, cx, cy, r, rotation, mirrored });
  const file = path.join(tmp, `${name}.${format}`);
  let img = sharp(raw, { raw: { width: size, height: size, channels: 1 } });
  if (width !== size || height !== size) img = sharp(await img.extract({ left: 0, top: 0, width, height }).png().toBuffer());
  await (format === 'jpg' ? img.jpeg({ quality: 92 }) : img.png()).toFile(file);
  return { file, face };
}

test('ephemeris matches Meeus, Astronomical Algorithms examples 47.a, 48.a and 53.a', () => {
  // 1992 April 12, 0h TD (JDE 2448724.5); moonFace adds TT − UTC itself.
  const date = new Date((2448724.5 - 2440587.5) * 86400000 - 69.2 * 1000);
  const f = moonFace(date);
  close(f.moon.lambda, 133.162655, 0.0005, 'geocentric longitude λ');
  close(f.moon.beta, -3.229126, 0.0005, 'geocentric latitude β');
  close(f.moon.distanceKm, 368409.7, 1, 'distance Δ');
  close(f.moon.ra, 134.688470, 0.002, 'apparent right ascension');
  close(f.moon.dec, 13.768368, 0.002, 'apparent declination');
  close(f.libration.l, -1.23, 0.01, 'libration in longitude');
  close(f.libration.b, 4.20, 0.01, 'libration in latitude');
  close(f.positionAngle, 15.08, 0.01, 'position angle of the axis');
  close(f.sun.l, 67.89, 0.01, 'selenographic longitude of the Sun');
  close(f.sun.b, 1.46, 0.01, 'selenographic latitude of the Sun');
  close(f.sun.colongitude, 22.11, 0.01, 'colongitude');
  close(f.brightLimb, 285.0, 0.1, 'bright limb position angle');
  close(f.illuminated, 0.6786, 0.0005, 'illuminated fraction');
  assert.equal(f.waxing, true);
  assert.equal(f.topocentric, false);

  // Seen from the ground the Moon shifts by up to ~1° (parallax).
  const topo = moonFace(date, { lat: 42.09, lon: -87.9 });
  assert.equal(topo.topocentric, true);
  const shift = Math.hypot(topo.libration.l - f.libration.l, topo.libration.b - f.libration.b);
  assert.ok(shift > 0.05 && shift < 1.1, `topocentric libration shift ${shift}°`);
});

test('captureInstant reads stored times as the photographer\'s clock', () => {
  // Zoneless: local mean time at the longitude, to the hour (−87.9° → UTC−6).
  assert.equal(captureInstant('2026-10-18T22:00', -87.9).toISOString(), '2026-10-19T04:00:00.000Z');
  assert.equal(captureInstant('2026-10-18 22:00:30', 135).toISOString(), '2026-10-18T13:00:30.000Z');
  assert.equal(captureInstant('2026-10-18T22:00', null).toISOString(), '2026-10-18T22:00:00.000Z');
  // An explicit zone wins.
  assert.equal(captureInstant('2026-10-18T22:00Z', -87.9).toISOString(), '2026-10-18T22:00:00.000Z');
  assert.equal(captureInstant('2026-10-18T22:00-05:00', 10).toISOString(), '2026-10-19T03:00:00.000Z');
  assert.equal(captureInstant('', 0), null);
  assert.equal(captureInstant('not a date', 0), null);
});

test('isMoonObservation', () => {
  assert.ok(isMoonObservation({ object_type: 'MOON' }));
  assert.ok(isMoonObservation({ list_object_type: 'MOON' }));
  assert.ok(isMoonObservation({ catalog: 'SOL', catalog_number: '2' }));
  assert.ok(isMoonObservation({ object_name: ' the Moon ' }));
  assert.ok(!isMoonObservation({ catalog: 'SOL', catalog_number: '3' }));
  assert.ok(!isMoonObservation({ object_name: 'Moon and Venus' }));
  assert.ok(!isMoonObservation(null));
});

test('projection: lunar east is right and north up when unturned', () => {
  // Sun overhead at 60°E: the eastern part lit, the far west dark.
  const face = { libration: { l: 0, b: 0 }, sun: { l: 60, b: 0 } };
  const disk = { cx: 500, cy: 500, r: 400 };
  const at = (fs, n) => fs.find((f) => f.n === n);
  const plain = projectFeatures(face, disk, { rotation: 0, mirrored: false });
  const crisium = at(plain, 'Mare Crisium'), plato = at(plain, 'Plato'), tycho = at(plain, 'Tycho');
  assert.ok(crisium.x > 750 && Math.abs(crisium.y - 500) < 150, 'Crisium (59°E) sits right of centre');
  assert.ok(plato.y < 250 && Math.abs(plato.x - 500) < 80, 'Plato (52°N) sits above centre');
  assert.ok(tycho.y > 700 && tycho.x < 500, 'Tycho (43°S, 11°W) sits below, left of centre');
  // Orthographic: Plato at (lat 51.62, lon −9.38) → y' = sin(lat).
  close(plato.y, 500 - 400 * Math.sin(51.619 * Math.PI / 180), 0.2, 'Plato height');
  assert.ok(plato.lit && !at(plain, 'Grimaldi').lit, 'Plato (9°W) lit, Grimaldi (68°W) dark');
  // Foreshortened towards the limb: Crisium's radial axis is the short one.
  assert.ok(crisium.b < crisium.a * 0.6);
  assert.ok(Array.isArray(crisium.ring) && crisium.ring.length > 6, 'Crisium carries its traced outline');

  // Turned 90° clockwise, north points right; mirrored, east points left.
  const turned = projectFeatures(face, disk, { rotation: 90, mirrored: false });
  assert.ok(at(turned, 'Plato').x > 750, 'turned: Plato right of centre');
  assert.ok(at(turned, 'Mare Crisium').y > 750, 'turned: Crisium below centre');
  const mirror = projectFeatures(face, disk, { rotation: 0, mirrored: true });
  assert.ok(at(mirror, 'Mare Crisium').x < 250, 'mirrored: Crisium left of centre');
  assert.ok(at(mirror, 'Plato').y < 250, 'mirrored: Plato still above');

  // Far-side features are left out.
  assert.equal(at(plain, 'Apollo 11') != null, true);
  assert.ok(plain.every((f) => (f.x - 500) ** 2 + (f.y - 500) ** 2 <= 400 ** 2 + 1));
});

test('detectMoon finds the disk and how the photo is turned', async () => {
  const cases = [
    { name: 'gibbous', when: '2026-03-10T12:00Z', rotation: 200 },
    { name: 'crescent', when: '2026-02-22T03:00Z', rotation: 300 },
    { name: 'full', when: '2026-03-03T12:00Z', rotation: 37 },
    { name: 'mirrored', when: '2026-02-25T03:00Z', rotation: 120, mirrored: true },
    // Off-centre in a portrait frame, saved as JPEG.
    { name: 'portrait', when: '2026-03-12T06:00Z', rotation: 33, width: 400, height: 640, cx: 210, cy: 330, r: 150, format: 'jpg' },
    // Cut off by the frame edge.
    { name: 'cut-off', when: '2026-03-05T12:00Z', rotation: 300, cx: 90 },
  ];
  for (const c of cases) {
    const { file, face } = await moonPhoto(c.name, c);
    const res = await detectMoon(file, face);
    const r = c.r || 200, cx = c.cx ?? 260, cy = c.cy ?? 260;
    assert.ok(res.disk, `${c.name}: disk found`);
    close(res.disk.cx, cx, 2, `${c.name} centre x`);
    close(res.disk.cy, cy, 2, `${c.name} centre y`);
    close(res.disk.r, r, 2, `${c.name} radius`);
    assert.ok(angleOff(res.orientation.rotation, c.rotation) <= 1, `${c.name}: rotation ${res.orientation.rotation} vs ${c.rotation}`);
    assert.equal(res.orientation.mirrored, !!c.mirrored, `${c.name}: mirrored`);
    assert.ok(res.orientation.score > 0.9, `${c.name}: score ${res.orientation.score}`);
  }
});

test('detectMoon gives up on photos without a Moon', async () => {
  const blank = path.join(tmp, 'blank.png');
  await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000' } }).png().toFile(blank);
  const res = await detectMoon(blank, moonFace(new Date('2026-03-10T12:00Z')));
  assert.equal(res.disk, null);
  assert.deepEqual([res.width, res.height], [300, 200]);
});

test('computeMoonMap: labels land on the rendered features', async () => {
  const when = '2026-03-08T09:00Z';
  const { file, face } = await moonPhoto('labels', { when, rotation: 70 });
  const map = await computeMoonMap({ imagePath: file, observedAt: when });
  assert.equal(map.status, 'ok');
  assert.equal(map.orientation.confidence, 'high');
  assert.equal(map.orientation.source, 'auto');
  assert.ok(angleOff(map.orientation.rotation, 70) <= 1);
  // Against the truth: project with the render's own disk and rotation.
  const truth = projectFeatures(face, { cx: 260, cy: 260, r: 200 }, { rotation: 70, mirrored: false });
  for (const name of ['Copernicus', 'Tycho', 'Mare Crisium', 'Plato', 'Apollo 11']) {
    const got = map.features.find((f) => f.n === name), want = truth.find((f) => f.n === name);
    assert.ok(got && want, `${name} projected`);
    assert.ok(Math.hypot(got.x - want.x, got.y - want.y) < 4, `${name} within 4 px (${got.x},${got.y} vs ${want.x},${want.y})`);
  }
  // Celestial north = lunar north turned back by the position angle.
  close(map.compass.north, (((70 + face.positionAngle) % 360) + 360) % 360, 1.5, 'compass north');

  // An override pins the orientation.
  const pinned = await computeMoonMap({ imagePath: file, observedAt: when, override: { rotation: 10, mirrored: true } });
  assert.equal(pinned.orientation.source, 'manual');
  assert.equal(pinned.orientation.confidence, 'manual');
  assert.equal(pinned.orientation.rotation, 10);
  assert.equal(pinned.orientation.mirrored, true);

  assert.equal((await computeMoonMap({ imagePath: file, observedAt: null })).status, 'no-date');
});

test('moon map API: upload, cache, override', async (t) => {
  const PASSWORD = 'moontest';
  const dataDir = path.join(tmp, 'app');
  const env = {
    ...process.env,
    PORT: String(24000 + Math.floor(Math.random() * 4000)),
    ADMIN_PASSWORD: PASSWORD,
    DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    STAGE_DIR: path.join(dataDir, 'stage'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    DISABLE_OCR: '1',
  };
  let server = null;
  let out = '';
  t.after(async () => {
    if (server && server.exitCode == null && server.signalCode == null) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('close', r));
    }
  });
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (b) => { out += b; });
  server.stderr.on('data', (b) => { out += b; });
  const base = `http://127.0.0.1:${env.PORT}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (server.exitCode != null || server.signalCode != null) throw new Error(`server exited:\n${out}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`server did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  const auth = { Authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}` };
  const api = async (p, { method = 'GET', body, admin = false } = {}) => {
    const headers = { ...(admin ? auth : {}) };
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${base}${p}`, { method, headers, body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const upload = async (file, fields) => {
    const fd = new FormData();
    fd.set('image', new Blob([fs.readFileSync(file)], { type: 'image/png' }), path.basename(file));
    const staged = await api('/api/admin/stage', { method: 'POST', body: fd, admin: true });
    assert.equal(staged.status, 201, JSON.stringify(staged.body));
    const saved = await api('/api/admin/observations', { method: 'POST', admin: true, body: { stage_id: staged.body.stage_id, ...fields } });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    return saved.body.id;
  };

  // 2026-03-08 03:00 at 87.9°W is 09:00 UTC.
  const { file } = await moonPhoto('api', { when: '2026-03-08T09:00Z', rotation: 250 });
  const moonId = await upload(file, {
    object_name: 'Moon', object_type: 'MOON', observed_at: '2026-03-08T03:00', latitude: 42.088682, longitude: -87.905189,
  });
  const otherId = await upload(file, { object_name: 'Not the Moon', object_type: 'GAL', latitude: null, longitude: null });

  const first = await api(`/api/observations/${moonId}/moonmap`);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'ok');
  assert.equal(first.body.captured_at, '2026-03-08T09:00:00.000Z');
  assert.equal(first.body.topocentric, true);
  assert.ok(angleOff(first.body.orientation.rotation, 250) <= 1.5, `rotation ${first.body.orientation.rotation}`);
  assert.ok(first.body.features.some((f) => f.n === 'Copernicus'));
  // Cached: same answer.
  assert.deepEqual((await api(`/api/observations/${moonId}/moonmap`)).body, first.body);

  assert.equal((await api(`/api/observations/${otherId}/moonmap`)).status, 404);
  assert.equal((await api('/api/observations/999999/moonmap')).status, 404);
  assert.equal((await api('/api/observations/abc/moonmap')).status, 400);

  // Override: admin only, validated, and it changes the map.
  assert.equal((await api(`/api/admin/observations/${moonId}/moonmap`, { method: 'PUT', body: { rotation: 10 } })).status, 401);
  assert.equal((await api(`/api/admin/observations/${moonId}/moonmap`, { method: 'PUT', admin: true, body: { rotation: 'x' } })).status, 400);
  const pinned = await api(`/api/admin/observations/${moonId}/moonmap`, { method: 'PUT', admin: true, body: { rotation: -20, mirrored: true } });
  assert.equal(pinned.status, 200);
  assert.equal(pinned.body.orientation.source, 'manual');
  assert.equal(pinned.body.orientation.rotation, 340);
  assert.equal(pinned.body.orientation.mirrored, true);
  assert.equal((await api(`/api/observations/${moonId}/moonmap`)).body.orientation.source, 'manual');
  const auto = await api(`/api/admin/observations/${moonId}/moonmap`, { method: 'DELETE', admin: true });
  assert.equal(auto.body.orientation.source, 'auto');
  assert.ok(angleOff(auto.body.orientation.rotation, 250) <= 1.5);

  // Editing the capture time redoes the map.
  const edited = await api(`/api/admin/observations/${moonId}`, { method: 'PATCH', admin: true, body: { observed_at: '2026-03-08T05:00' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal((await api(`/api/observations/${moonId}/moonmap`)).body.captured_at, '2026-03-08T11:00:00.000Z');

  // Deleting the observation drops its cached map with it.
  assert.equal((await api(`/api/admin/observations/${moonId}`, { method: 'DELETE', admin: true })).status, 204);
  const Database = require('better-sqlite3');
  const db = new Database(env.DATABASE_PATH, { readonly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM moon_maps WHERE observation_id = ?').get(moonId).c, 0);
  } finally {
    db.close();
  }
});
