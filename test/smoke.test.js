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

async function waitForReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProc && serverProc.exitCode != null) {
      throw new Error(`server exited during boot with code ${serverProc.exitCode}`);
    }
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
  serverProc.stdout.on('data', (b) => process.stderr.write(`[server] ${b}`));
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

  await t.test('PATCH observation rejects out-of-range lat/lon and bad date', async () => {
    // Set up an observation we can poke.
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'm45.jpg');
    const stage = await fetch(`${baseUrl}/api/admin/stage`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
      body: fd,
    }).then((r) => r.json());
    const messier = await fetchJsonAuthed('/api/lists/messier');
    const m45 = messier.objects.find((o) => o.catalog_number === '45');
    const created = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stage_id: stage.stage_id,
        object_id: m45.id, catalog: 'M', catalog_number: '45',
        object_name: 'Pleiades',
        telescope: 'Test',
        observed_at: '2026-04-19T22:00',
      }),
    }).then((r) => r.json());

    // Out-of-range latitude is clamped (not rejected — clamp() saturates).
    const clamped = await fetch(`${baseUrl}/api/admin/observations/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ latitude: 999, longitude: -999 }),
    }).then((r) => r.json());
    assert.equal(clamped.latitude, 90);
    assert.equal(clamped.longitude, -180);

    // Garbage date is rejected, not stored.
    const bad = await fetch(`${baseUrl}/api/admin/observations/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ observed_at: 'not-a-date' }),
    });
    assert.equal(bad.status, 400);
  });

  await t.test('Equipment PATCH returns 409 on UNIQUE collision', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    const a = await fetch(`${baseUrl}/api/admin/equipment`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'camera', name: 'IMX585' }),
    }).then((r) => r.json());
    const b = await fetch(`${baseUrl}/api/admin/equipment`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'camera', name: 'IMX462' }),
    }).then((r) => r.json());
    // Try to rename b → a's name.
    const collision = await fetch(`${baseUrl}/api/admin/equipment/${b.id}`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'IMX585' }),
    });
    assert.equal(collision.status, 409);
    // Cleanup
    await fetch(`${baseUrl}/api/admin/equipment/${a.id}`, { method: 'DELETE', headers: auth });
    await fetch(`${baseUrl}/api/admin/equipment/${b.id}`, { method: 'DELETE', headers: auth });
  });

  await t.test('Planner minutes_above_min uses correct (N-1)*step formula', async () => {
    // We don't know what objects are above any given minimum, but we can
    // assert the structure. With step=10 minutes and many samples, an
    // object reported as "above for K minutes" must satisfy K % 10 === 0.
    const today = new Date().toISOString().slice(0, 10);
    const data = await fetchJsonAuthed(
      `/api/planner?lat=51.5&lon=0&date=${today}&min_alt=10&step_minutes=10`,
    );
    for (const t of data.targets) {
      assert.equal(t.minutes_above_min % 10, 0, `target #${t.id} minutes_above_min not a multiple of step`);
    }
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

  await t.test('site settings: default name, PUT updates, public GET reflects', async () => {
    const initial = await fetchJsonAuthed('/api/settings');
    assert.equal(initial.site_name, 'DeepSkyLog');

    const update = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ site_name: 'My Backyard Sky' }),
    });
    assert.equal(update.status, 200);

    const after = await (await fetch(`${baseUrl}/api/settings`)).json();
    assert.equal(after.site_name, 'My Backyard Sky');

    // Empty / oversized values are rejected.
    const empty = await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ site_name: '   ' }),
    });
    assert.equal(empty.status, 400);

    // Restore default so the rest of the suite isn't surprised.
    await fetch(`${baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ site_name: 'DeepSkyLog' }),
    });
  });

  await t.test('planner accepts explicit start/end window', async () => {
    const start = new Date();
    start.setUTCHours(20, 0, 0, 0);
    const end = new Date(start.getTime() + 6 * 3_600_000);
    const data = await fetchJsonAuthed(
      `/api/planner?lat=51.5&lon=0&min_alt=10&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    );
    assert.equal(data.window.start, start.toISOString());
    assert.equal(data.window.end, end.toISOString());

    // Reversed window is rejected.
    const bad = await fetch(
      `${baseUrl}/api/planner?lat=51.5&lon=0&start=${encodeURIComponent(end.toISOString())}&end=${encodeURIComponent(start.toISOString())}`,
    );
    assert.equal(bad.status, 400);
  });

  await t.test('upload: explicit form lat/lon override EXIF GPS', async () => {
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'm51.jpg');
    const stage = await fetch(`${baseUrl}/api/admin/stage`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
      body: fd,
    }).then((r) => r.json());

    const messier = await fetchJsonAuthed('/api/lists/messier');
    const m51 = messier.objects.find((o) => o.catalog_number === '51');
    assert.ok(m51);

    const created = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stage_id: stage.stage_id,
        object_id: m51.id, catalog: 'M', catalog_number: '51',
        object_name: 'Whirlpool', telescope: 'Seestar S30 Pro',
        observed_at: '2026-04-19T22:00',
        latitude: 51.4769, longitude: -0.0005,
      }),
    }).then((r) => r.json());

    // Finalize returns just {id, paths}; pull the full row to verify storage.
    const all = await (await fetch(`${baseUrl}/api/observations`)).json();
    const row = all.find((o) => o.id === created.id);
    assert.ok(row, 'created row visible from /api/observations');
    assert.equal(row.latitude, 51.4769);
    assert.equal(row.longitude, -0.0005);

    // Out-of-range form values are clamped, not rejected.
    const fd2 = new FormData();
    fd2.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'm51b.jpg');
    const stage2 = await fetch(`${baseUrl}/api/admin/stage`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
      body: fd2,
    }).then((r) => r.json());
    const clamped = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stage_id: stage2.stage_id,
        object_id: m51.id, catalog: 'M', catalog_number: '51',
        object_name: 'Whirlpool', telescope: 'Seestar S30 Pro',
        observed_at: '2026-04-19T22:00',
        latitude: 999, longitude: -999,
      }),
    }).then((r) => r.json());
    const all2 = await (await fetch(`${baseUrl}/api/observations`)).json();
    const clampedRow = all2.find((o) => o.id === clamped.id);
    assert.equal(clampedRow.latitude, 90);
    assert.equal(clampedRow.longitude, -180);
  });

  await t.test('comet observation: object_type + RA/Dec persist, filterable', async () => {
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'comet.jpg');
    const stage = await fetch(`${baseUrl}/api/admin/stage`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
      body: fd,
    }).then((r) => r.json());

    const created = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stage_id: stage.stage_id,
        object_name: 'C/2023 A3 Tsuchinshan-ATLAS',
        telescope: 'Seestar S30 Pro',
        observed_at: '2026-04-19T22:00',
        object_type: 'COMET',
        ra_hours: 14.25,
        dec_degrees: -2.5,
      }),
    }).then((r) => r.json());

    // /api/observations?object_type=COMET should pick it up via the
    // COALESCE(list_object.type, observation.type) filter, and the row
    // should carry the values we sent through.
    const filtered = await (await fetch(`${baseUrl}/api/observations?object_type=COMET`)).json();
    const row = filtered.find((o) => o.id === created.id);
    assert.ok(row, 'comet observation visible under object_type=COMET');
    assert.equal(row.object_type, 'COMET');
    assert.equal(row.ra_hours, 14.25);
    assert.equal(row.dec_degrees, -2.5);

    // /api/filters surfaces COMET as a valid type from observations.
    const filters = await (await fetch(`${baseUrl}/api/filters`)).json();
    assert.ok(filters.objectTypes.includes('COMET'), 'COMET present in filters');

    // Garbage object_type is silently dropped to null on PATCH (not 500).
    const patched = await fetch(`${baseUrl}/api/admin/observations/${created.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ object_type: 'BOGUS' }),
    }).then((r) => r.json());
    assert.equal(patched.object_type, null);
  });

  await t.test('Seestar filename parser fills gaps in stage response', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }),
      'Stacked_206_C 4_10.0s_IRCUT_20241027-213334.jpg');
    const res = await fetch(`${baseUrl}/api/admin/stage`, { method: 'POST', headers: auth, body: fd });
    assert.equal(res.status, 201);
    const staged = await res.json();
    assert.equal(staged.exif.stack_count, 206);
    assert.equal(staged.exif.filter_name, 'IRCUT');
    assert.equal(staged.exif.exposure_seconds, 10);
    assert.equal(staged.exif.captured_at, '2024-10-27T21:33:34');
    assert.equal(staged.exif.object_name, 'C4');
    assert.equal(staged.guesses.from_filename, true);
    await fetch(`${baseUrl}/api/admin/stage/${encodeURIComponent(staged.stage_id)}`, {
      method: 'DELETE', headers: auth,
    });
  });

  await t.test('public per-observation detail with prev/next siblings', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    // Stage two M81 observations so we can exercise sibling navigation.
    const messier = await fetchJsonAuthed('/api/lists/messier');
    const m81 = messier.objects.find((o) => o.catalog_number === '81');
    assert.ok(m81);
    const ids = [];
    for (const day of ['2026-04-10T22:00', '2026-04-12T22:00']) {
      const jpeg = await buildSyntheticJpeg();
      const fd = new FormData();
      fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'm81.jpg');
      const stage = await fetch(`${baseUrl}/api/admin/stage`, { method: 'POST', headers: auth, body: fd })
        .then((r) => r.json());
      const obs = await fetch(`${baseUrl}/api/admin/observations`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_id: stage.stage_id,
          object_id: m81.id, catalog: 'M', catalog_number: '81',
          object_name: "Bode's Galaxy", telescope: 'Seestar S30 Pro',
          observed_at: day,
        }),
      }).then((r) => r.json());
      ids.push(obs.id);
    }
    // First (earlier) observation: no prev, has next.
    const first = await (await fetch(`${baseUrl}/api/observations/${ids[0]}`)).json();
    assert.equal(first.observation.id, ids[0]);
    assert.equal(first.observation.list_object_id, m81.id);
    assert.equal(first.observation.list_object_name, "Bode's Galaxy");
    assert.equal(first.prev_id, null);
    assert.equal(first.next_id, ids[1]);
    assert.equal(first.sibling_count, 2);
    assert.equal(first.sibling_index, 0);
    // Last observation: has prev, no next.
    const second = await (await fetch(`${baseUrl}/api/observations/${ids[1]}`)).json();
    assert.equal(second.prev_id, ids[0]);
    assert.equal(second.next_id, null);
    assert.equal(second.sibling_index, 1);
    // Unknown id -> 404.
    const miss = await fetch(`${baseUrl}/api/observations/99999`);
    assert.equal(miss.status, 404);
  });

  await t.test('admin stats includes lifetime panel with streak data', async () => {
    const data = await fetchJsonAuthed('/api/admin/stats');
    assert.ok(data.lifetime, 'lifetime block present');
    assert.equal(typeof data.lifetime.observations_total, 'number');
    assert.equal(typeof data.lifetime.distinct_targets, 'number');
    assert.equal(typeof data.lifetime.observations_this_year, 'number');
    assert.equal(typeof data.lifetime.longest_streak_days, 'number');
    assert.equal(typeof data.lifetime.current_streak_days, 'number');
  });

  await t.test('SQM round-trips through upload + edit', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    const jpeg = await buildSyntheticJpeg();
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'sqm.jpg');
    const stage = await fetch(`${baseUrl}/api/admin/stage`, { method: 'POST', headers: auth, body: fd })
      .then((r) => r.json());

    const created = await fetch(`${baseUrl}/api/admin/observations`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage_id: stage.stage_id,
        object_name: 'M101', telescope: 'Seestar S30 Pro',
        observed_at: '2026-04-19T22:00',
        sqm: 21.4,
      }),
    }).then((r) => r.json());

    const all = await (await fetch(`${baseUrl}/api/observations`)).json();
    const row = all.find((o) => o.id === created.id);
    assert.equal(row.sqm, 21.4);

    // Out-of-range SQM clamps on PATCH (not rejected).
    const patched = await fetch(`${baseUrl}/api/admin/observations/${created.id}`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sqm: 99 }),
    }).then((r) => r.json());
    assert.equal(patched.sqm, 22.5);
  });

  await t.test('object aliases editor: PATCH stores normalised array', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    const messier = await fetchJsonAuthed('/api/lists/messier');
    const m42 = messier.objects.find((o) => o.catalog_number === '42');
    assert.ok(m42);

    const res = await fetch(`${baseUrl}/api/admin/objects/${m42.id}`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: ['ngc 1976', 'NGC1976', 'orion neb'] }),
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    // Normalised: uppercased, whitespace-stripped, deduped.
    assert.deepEqual(out.aliases.sort(), ['NGC1976', 'ORIONNEB']);

    // Non-array body rejected.
    const bad = await fetch(`${baseUrl}/api/admin/objects/${m42.id}`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: 'NGC1976' }),
    });
    assert.equal(bad.status, 400);

    // Restore so later tests aren't surprised.
    await fetch(`${baseUrl}/api/admin/objects/${m42.id}`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: [] }),
    });
  });

  await t.test('dark-moon iCalendar feed has VEVENTs over the next year', async () => {
    const res = await fetch(`${baseUrl}/api/calendar/dark-moon.ics`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('text/calendar'));
    const text = await res.text();
    assert.ok(text.startsWith('BEGIN:VCALENDAR'));
    assert.ok(text.trimEnd().endsWith('END:VCALENDAR'));
    const events = (text.match(/BEGIN:VEVENT/g) || []).length;
    assert.ok(events >= 10 && events <= 14, `expected ~12 monthly VEVENTs, got ${events}`);
  });

  await t.test('planner exposes twilight + moon bands and moon separation', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const data = await fetchJsonAuthed(
      `/api/planner?lat=51.5&lon=0&date=${today}&min_alt=10&step_minutes=30`,
    );
    assert.ok(Array.isArray(data.astro_dark_bands));
    assert.ok(Array.isArray(data.moon_up_bands));
    if (data.targets[0]) {
      // moon_separation_deg should be a number 0..180.
      const sep = data.targets[0].moon_separation_deg;
      assert.ok(sep == null || (sep >= 0 && sep <= 180));
    }
    // Filter knob is honoured: very large min_moon_sep prunes everything.
    const pruned = await fetchJsonAuthed(
      `/api/planner?lat=51.5&lon=0&date=${today}&min_alt=10&min_moon_sep=180`,
    );
    assert.equal(pruned.targets.length, 0);
  });

  await t.test('NGC fallback resolves common designations', async () => {
    const res = await fetch(`${baseUrl}/api/admin/objects/lookup?q=NGC7000`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
    });
    assert.equal(res.status, 200);
    const hit = await res.json();
    assert.equal(hit.catalog, 'NGC');
    assert.equal(hit.catalog_number, '7000');
    assert.equal(typeof hit.ra_hours, 'number');
    assert.equal(typeof hit.dec_degrees, 'number');
    // NGC 7000 is the North America Nebula in Cygnus.
    assert.equal(hit.constellation, 'Cyg');

    // Unknown query -> 404.
    const miss = await fetch(`${baseUrl}/api/admin/objects/lookup?q=NGC999999`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') },
    });
    assert.equal(miss.status, 404);
  });

  await t.test('batch staging: many parallel stages succeed independently', async () => {
    const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
    const stages = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const jpeg = await buildSyntheticJpeg();
        const fd = new FormData();
        fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), `batch-${i}.jpg`);
        const res = await fetch(`${baseUrl}/api/admin/stage`, { method: 'POST', headers: auth, body: fd });
        assert.equal(res.status, 201);
        return res.json();
      }),
    );
    const ids = new Set(stages.map((s) => s.stage_id));
    assert.equal(ids.size, 3, 'each stage got a distinct id');

    // Drop them — exercises the stage DELETE path used by the batch cancel.
    for (const s of stages) {
      const del = await fetch(`${baseUrl}/api/admin/stage/${encodeURIComponent(s.stage_id)}`, {
        method: 'DELETE', headers: auth,
      });
      assert.equal(del.status, 204);
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
