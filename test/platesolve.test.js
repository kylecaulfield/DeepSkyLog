// Background plate solving and its activity log (lib/solver.js), end to end
// against a fake astrometry.net API — no network needed, runs in CI.
//
// The fake walks each submission through Nova's real states: no job yet
// (pending) → a job running (solving) → success / failure. Uploads are
// numbered in order; the outcome of each is set by `plan` below.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'solvetest';
const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };

// ---- fake astrometry.net ------------------------------------------------
function fakeNova() {
  const state = {
    loginOk: true,
    uploads: 0,
    // per upload number: 'success' | 'failure' | 'upload-error' | 'hold'
    plan: {},
    subs: new Map(), // subid -> { outcome, polls, released }
  };
  const server = http.createServer((req, res) => {
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.replace(/^\/api/, '');
      if (req.method === 'POST' && url === '/login') {
        return state.loginOk ? send(200, { status: 'success', session: 'sess-1' }) : send(200, { status: 'error', errormessage: 'bad apikey' });
      }
      if (req.method === 'POST' && url === '/upload') {
        const n = ++state.uploads;
        const outcome = state.plan[n] || 'success';
        if (outcome === 'upload-error') return send(500, { status: 'error' });
        const subid = 1000 + n;
        state.subs.set(subid, { outcome, polls: 0, released: outcome !== 'hold' });
        return send(200, { status: 'success', subid });
      }
      let m = url.match(/^\/submissions\/(\d+)$/);
      if (m) {
        const sub = state.subs.get(Number(m[1]));
        if (!sub) return send(404, {});
        sub.polls++;
        // No job on the first poll (still in Nova's queue), or while held.
        const jobs = sub.polls >= 2 && sub.released ? [Number(m[1]) + 5000] : [];
        return send(200, { jobs });
      }
      m = url.match(/^\/jobs\/(\d+)(\/calibration|\/info)?$/);
      if (m) {
        const sub = state.subs.get(Number(m[1]) - 5000);
        if (!sub) return send(404, {});
        if (m[2] === '/calibration') return send(200, { ra: 314.69, dec: 44.32, radius: 1.61, orientation: 92.4, pixscale: 2.42, parity: 1 });
        if (m[2] === '/info') return send(200, { objects_in_field: ['NGC 7000', 'North America Nebula'] });
        sub.jobPolls = (sub.jobPolls || 0) + 1;
        if (sub.jobPolls < 2) return send(200, { status: 'solving' });
        return send(200, { status: sub.outcome === 'failure' ? 'failure' : 'success' });
      }
      send(404, {});
    });
  });
  return { server, state };
}

async function startApp(env) {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
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
  const stop = async () => {
    if (server.exitCode == null && server.signalCode == null) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('close', r));
    }
  };
  return { base, stop, output: () => out };
}

test('background plate solving with an activity log', async (t) => {
  const nova = fakeNova();
  await new Promise((r) => nova.server.listen(0, '127.0.0.1', r));
  const novaPort = nova.server.address().port;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-solve-'));
  const env = {
    ...process.env,
    PORT: String(20000 + Math.floor(Math.random() * 4000)),
    ADMIN_PASSWORD: PASSWORD,
    DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    STAGE_DIR: path.join(dataDir, 'stage'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    ASTROMETRY_API_KEY: 'test-key',
    ASTROMETRY_API_BASE: `http://127.0.0.1:${novaPort}/api`,
    SOLVER_POLL_MS: '150',
    SOLVER_UPLOAD_GAP_MS: '0',
    DISABLE_OCR: '1',
  };
  // Cleanup first, so a server that fails to start doesn't leave the fake
  // API listening and the test process hanging.
  let app = null;
  t.after(async () => {
    if (app) await app.stop();
    nova.server.closeAllConnections?.();
    nova.server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  app = await startApp(env);

  const api = async (p, opts = {}) => {
    const res = await fetch(`${app.base}${p}`, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const sharp = require('sharp');
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } } }).jpeg().toBuffer();
  const addObservation = async (name) => {
    const fd = new FormData();
    fd.set('image', new Blob([jpeg], { type: 'image/jpeg' }), `${name}.jpg`);
    const staged = (await api('/api/admin/stage', { method: 'POST', body: fd })).body;
    const saved = await api('/api/admin/observations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage_id: staged.stage_id, object_name: name, telescope: 'Seestar S50 Pro', latitude: null, longitude: null }),
    });
    assert.equal(saved.status, 201);
    return saved.body.id;
  };
  const activity = async (after = 0) => (await api(`/api/admin/platesolve/activity?after=${after}`)).body;
  const until = async (what, check, ms = 20_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const a = await activity();
      if (check(a)) return a;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}:\n${JSON.stringify(a, null, 1)}\n${app.output()}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const kindsFor = (a, id) => a.events.filter((e) => e.observation_id === id).map((e) => e.kind);

  // Uploads happen in id order: #1 solves, #2 can't be solved, #3's upload errors.
  const solves = await addObservation('Solves');
  const fails = await addObservation('Fails');
  const breaks = await addObservation('Breaks');
  nova.state.plan = { 1: 'success', 2: 'failure', 3: 'upload-error' };

  await t.test('before anything: enabled, nothing in progress, all unsolved', async () => {
    const a = await activity();
    assert.equal(a.enabled, true);
    assert.deepEqual(a.active, []);
    assert.equal(a.counts.unsolved, 3);
    assert.equal(a.last_event_id, 0);
  });

  await t.test('bulk plate solve queues and returns at once; every step is logged', async () => {
    const res = await api('/api/admin/observations/bulk-platesolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 202);
    assert.equal(res.body.queued, 3);

    const a = await until('all three to finish', (x) => x.active.length === 0 && x.counts.success === 1 && x.counts.failure === 1);
    assert.deepEqual(kindsFor(a, solves), ['queued', 'uploading', 'submitted', 'solving', 'solved']);
    assert.deepEqual(kindsFor(a, fails), ['queued', 'uploading', 'submitted', 'solving', 'failed']);
    assert.deepEqual(kindsFor(a, breaks), ['queued', 'uploading', 'error']);

    const solved = a.events.find((e) => e.kind === 'solved');
    assert.equal(solved.label, 'Solves');
    assert.match(solved.message, /RA 20h 58m 46s, Dec \+44° 19′ 12″/);
    assert.match(solved.message, /field radius 1\.61°/);
    assert.match(solved.message, /2\.42″\/px/);
    assert.match(solved.message, /in field: NGC 7000, North America Nebula/);
    assert.deepEqual(solved.details.objects_in_field, ['NGC 7000', 'North America Nebula']);
    const submitted = a.events.find((e) => e.kind === 'submitted' && e.observation_id === solves);
    assert.equal(submitted.details.subid, '1001');
    assert.match(a.events.find((e) => e.kind === 'error').message, /Upload failed: .*HTTP 500/);
    const batch = a.events.find((e) => e.kind === 'batch');
    assert.equal(batch.observation_id, null);
    assert.match(batch.message, /3 queued/);

    // Rows: solved values stored, the failed upload back to unsolved.
    const obs = async (id) => (await (await fetch(`${app.base}/api/observations/${id}`)).json()).observation;
    const s = await obs(solves);
    assert.equal(s.solver_status, 'success');
    assert.ok(Math.abs(s.solved_ra_hours - 314.69 / 15) < 1e-9);
    assert.equal(s.solved_radius_deg, 1.61);
    assert.equal((await obs(fails)).solver_status, 'failure');
    assert.equal((await obs(breaks)).solver_status, null);
    assert.equal(a.counts.unsolved, 1, 'the failed upload can be retried');

    // The page asks only for what it hasn't seen, and learns those rows' state.
    const later = await activity(submitted.id);
    assert.ok(later.events.every((e) => e.id > submitted.id));
    const touched = Object.fromEntries(later.observations.map((o) => [o.id, o.solver_status]));
    assert.equal(touched[solves], 'success');

    // A burst bigger than one page arrives over several calls, none skipped.
    const all = (await api('/api/admin/platesolve/activity?limit=500')).body.events.map((e) => e.id);
    // (after=0 means "first load: the newest page", so start from event 1.)
    const seen = [all[0]];
    let cursor = all[0];
    for (let i = 0; i < all.length; i++) {
      const page = (await api(`/api/admin/platesolve/activity?after=${cursor}&limit=2`)).body;
      if (!page.events.length) break;
      assert.ok(page.events.length <= 2);
      seen.push(...page.events.map((e) => e.id));
      cursor = page.last_event_id;
    }
    assert.deepEqual(seen, all);
    // A cursor from a different database (restored backup) starts over.
    const reset = (await api('/api/admin/platesolve/activity?after=999999')).body;
    assert.equal(reset.events.length, Math.min(all.length, 200));
  });

  await t.test('the single Solve button queues one; a bad login is reported, not queued', async () => {
    nova.state.loginOk = false;
    const refused = await api(`/api/admin/observations/${breaks}/platesolve`, { method: 'POST' });
    assert.equal(refused.status, 502);
    assert.match(refused.body.error, /login failed/);
    assert.equal((await activity()).counts.queued, 0);

    nova.state.loginOk = true;
    const ok = await api(`/api/admin/observations/${breaks}/platesolve`, { method: 'POST' });
    assert.equal(ok.status, 202);
    assert.equal(ok.body.status, 'queued');
    const a = await until('the retry to solve', (x) => x.counts.success === 2);
    assert.ok(kindsFor(a, breaks).includes('solved'));
  });

  await t.test('a solve still at astrometry.net when the server restarts is picked up again', async () => {
    const held = await addObservation('Held');
    nova.state.plan[nova.state.uploads + 1] = 'hold';
    await api(`/api/admin/observations/${held}/platesolve`, { method: 'POST' });
    await until('the held upload', (x) => kindsFor(x, held).includes('submitted'));
    await app.stop();
    for (const sub of nova.state.subs.values()) sub.released = true;
    app = await startApp(env);
    const a = await until('the held solve after restart', (x) => kindsFor(x, held).includes('solved'));
    assert.equal(a.active.length, 0);
  });
});
