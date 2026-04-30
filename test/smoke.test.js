// End-to-end smoke tests. Boots the app once on a random port against a
// throwaway data dir, then drives every endpoint we expect to keep working.
//
// The goal is regression detection — not exhaustive coverage. If everything
// here passes, basic upload/list/edit/delete and the Tonight + Planner +
// version paths are all wired up.
//
// Run with: `npm test`. Sets DISABLE_OCR=1 so a missing tessdata file
// doesn't slow boots; tests that depend on OCR can opt back in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'smoketest';

let serverProc;
let baseUrl;
let dataDir;
let uploadDir;

function fetchJsonAuthed(pathname, opts = {}) {
  return doFetch(pathname, { ...opts, auth: true, parse: 'json' });
}

function fetchAuthed(pathname, opts = {}) {
  return doFetch(pathname, { ...opts, auth: true });
}

async function doFetch(pathname, { method = 'GET', body, headers = {}, auth = false, parse } = {}) {
  const h = { ...headers };
  if (auth) h.Authorization = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64');
  if (body && !h['Content-Type'] && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: h,
    body: body && typeof body === 'object' && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  if (parse === 'json') {
    if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
    return res.json();
  }
  return res;
}

async function waitForReady(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready in time');
}

async function buildSyntheticJpeg() {
  // Keep test deps minimal — sharp is already a project dep so we lean on it.
  const sharp = require('sharp');
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Make: 'ZWO', Model: 'Seestar S30 Pro' } } })
    .toBuffer();
  return buf;
}

test('smoke', async (t) => {
  // Each test sub-suite shares one server. Spawn it inside the suite so
  // setup failures surface as a single test failure rather than a process
  // crash, and clean up unconditionally afterwards.
  const port = 4000 + Math.floor(Math.random() * 4000);
  baseUrl = `http://127.0.0.1:${port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-test-'));
  uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });

  serverProc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_PASSWORD: PASSWORD,
      UPLOAD_DIR: uploadDir,
      DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
      STAGE_DIR: path.join(dataDir, 'stage'),
      BACKUP_DIR: path.join(dataDir, 'backups'),
      DISABLE_OCR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));

  t.after(async () => {
    if (serverProc && serverProc.exitCode == null) {
      serverProc.kill('SIGTERM');
      await new Promise((r) => serverProc.once('close', r));
    }
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  });

  await waitForReady();

  await t.test('GET /api/health', async () => {
    const data = await fetchJsonAuthed('/api/health');
    assert.equal(data.ok, true);
  });

  await t.test('GET /api/version', async () => {
    const data = await fetchJsonAuthed('/api/version');
    assert.ok(data.repo, 'repo present');
    // Either a baked-in sha or a git fallback or "dev".
    assert.ok(data.ref, 'ref present');
  });

  await t.test('catalog seeds present', async () => {
    const lists = await fetchJsonAuthed('/api/lists');
    const slugs = lists.map((l) => l.slug);
    assert.ok(slugs.includes('messier'), 'messier seeded');
    assert.ok(slugs.includes('caldwell'), 'caldwell seeded');
    assert.ok(slugs.includes('solar-system'), 'solar-system seeded');
    const total = lists.reduce((acc, l) => acc + l.object_count, 0);
    assert.ok(total > 400, `expected >400 objects total, got ${total}`);
  });

  await t.test('admin auth: 401 without creds, 200 with', async () => {
    const noAuth = await fetch(`${baseUrl}/api/admin/config`);
    assert.equal(noAuth.status, 401);
    const cfg = await fetchJsonAuthed('/api/admin/config');
    assert.ok(Array.isArray(cfg.telescopes));
  });

  await t.test('equipment CRUD round-trip', async () => {
    const created = await doFetch('/api/admin/equipment', {
      method: 'POST', auth: true, parse: 'json',
      body: { kind: 'telescope', name: 'Test Scope', notes: 'unit test' },
    });
    assert.equal(created.kind, 'telescope');
    assert.equal(created.name, 'Test Scope');

    const list = await fetchJsonAuthed('/api/admin/equipment');
    assert.ok(list.some((r) => r.id === created.id));

    const cfg = await fetchJsonAuthed('/api/admin/config');
    assert.ok(cfg.telescopes.includes('Test Scope'));

    const del = await fetchAuthed(`/api/admin/equipment/${created.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
  });

  await t.test('upload + edit + delete observation', async () => {
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'm42.jpg');
    const stageRes = await fetch(`${baseUrl}/api/admin/stage`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
      body: fd,
    });
    assert.equal(stageRes.status, 201);
    const staged = await stageRes.json();
    assert.equal(staged.telescope_match, 'Seestar S30 Pro');

    // Resolve M42's list_object id.
    const messier = await fetchJsonAuthed('/api/lists/messier');
    const m42 = messier.objects.find((o) => o.catalog_number === '42');
    assert.ok(m42);

    const finalRes = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stage_id: staged.stage_id,
        object_id: m42.id, catalog: 'M', catalog_number: '42',
        object_name: 'Orion Nebula',
        telescope: 'Seestar S30 Pro',
        observed_at: '2026-04-19T22:00',
        rating: 4,
      }),
    });
    assert.equal(finalRes.status, 201);
    const obs = await finalRes.json();
    assert.ok(obs.id);

    // Edit it
    const patchRes = await fetch(`${baseUrl}/api/admin/observations/${obs.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'edited', rating: 5 }),
    });
    assert.equal(patchRes.status, 200);
    const edited = await patchRes.json();
    assert.equal(edited.title, 'edited');
    assert.equal(edited.rating, 5);

    // Delete it
    const delRes = await fetchAuthed(`/api/admin/observations/${obs.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);
  });

  await t.test('GET /api/tonight requires lat/lon', async () => {
    const bad = await fetch(`${baseUrl}/api/tonight`);
    assert.equal(bad.status, 400);
    const ok = await fetchJsonAuthed('/api/tonight?lat=51.5&lon=0&min_alt=0');
    assert.ok(Array.isArray(ok.targets));
  });

  await t.test('GET /api/planner returns altitude windows', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const data = await fetchJsonAuthed(`/api/planner?lat=51.5&lon=0&date=${today}&min_alt=10`);
    assert.ok(Array.isArray(data.targets));
    assert.ok(data.window?.start, 'window start');
    assert.ok(data.moon?.name, 'moon at start');
  });

  await t.test('Solar System bodies have live coords', async () => {
    const sol = await fetchJsonAuthed('/api/lists/solar-system');
    const jupiter = sol.objects.find((o) => o.name === 'Jupiter');
    assert.ok(jupiter, 'Jupiter row exists');
    const detail = await fetchJsonAuthed(`/api/objects/${jupiter.id}`);
    assert.ok(detail.live_coords, 'live_coords present');
    assert.equal(typeof detail.live_coords.ra_hours, 'number');
  });

  await t.test('CSV export has the expected header', async () => {
    const res = await fetch(`${baseUrl}/api/observations.csv`);
    assert.equal(res.status, 200);
    const text = await res.text();
    const header = text.split('\n')[0];
    for (const col of ['id', 'observed_at', 'telescope', 'rating', 'stack_count', 'gain']) {
      assert.ok(header.includes(col), `csv header missing ${col}`);
    }
  });

  // Run last — consumes the per-IP failure budget, so any admin call after
  // this one gets a 429 until the 15-minute window rolls over.
  await t.test('rate limit triggers 429 after 20 failures', async () => {
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/admin/config`, {
        headers: { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') },
      });
      if (res.status === 429) { saw429 = true; break; }
    }
    assert.ok(saw429, 'expected a 429 within 25 wrong-auth attempts');
  });
});
