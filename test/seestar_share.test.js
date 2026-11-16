// Share to Seestar (lib/seestar_share.js): the plan -> TargetItem mapping,
// validation, the request body and the HTTP rules (timeout, one retry, errors
// reported verbatim), then the routes end to end against a fake of ZWO's
// share API. Nothing here talks to ZWO's servers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const share = require('../lib/seestar_share');

const ROOT = path.resolve(__dirname, '..');

// A slot at a local wall-clock time in a UTC-6 zone (Chicago in winter).
const TZ = -360;
const at = (hhmm, day = 16) => new Date(`2026-11-${day}T${hhmm}:00-06:00`);
const slot = (over = {}) => ({
  start: at('23:00'),
  durationMinutes: 60,
  object: { catalog: 'M', catalog_number: '42', name: 'Orion Nebula' },
  raHours: 5.5881,
  decDeg: -5.391,
  ...over,
});
const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const okResponse = (id = 'abc12345') => jsonResponse(200, {
  code: 200, msg: 'OK', data: { shareId: id, shareLink: `https://app.zwoastro.com/Seestar/plan?id=${id}` },
});

test('startMinutes counts from local midnight, on past 1440 after midnight', () => {
  assert.equal(share.startMinutes(at('23:00'), TZ), 1380);
  assert.equal(share.startMinutes(at('18:05'), TZ), 1085);
  assert.equal(share.startMinutes(at('12:00'), TZ), 720);
  // The small hours belong to the night that started the evening before.
  assert.equal(share.startMinutes(at('00:00', 17), TZ), 1440);
  assert.equal(share.startMinutes(at('01:30', 17), TZ), 1530);
  assert.equal(share.startMinutes(at('05:45', 17), TZ), 1785);
  assert.equal(share.startMinutes(at('11:59', 17), TZ), 2159);
  // Seconds round to the nearest minute; zones east of UTC and half hours.
  assert.equal(share.startMinutes(new Date('2026-11-17T05:00:31Z'), TZ), 1381);
  assert.equal(share.startMinutes(new Date('2026-11-16T14:00:00Z'), 330), 1170); // 19:30 IST
});

test('a plan that starts before noon or runs across it stays in order', () => {
  const plan = (...times) => share.planStartMinutes(times.map(([hhmm, day]) => at(hhmm, day)), TZ);
  // An ordinary night: evening, then past midnight.
  assert.deepEqual(plan(['21:00', 16], ['23:30', 16], ['00:15', 17], ['04:00', 17]), [1260, 1410, 1455, 1680]);
  // Started after midnight, over before noon: the tail of the night before.
  assert.deepEqual(plan(['01:30', 17], ['03:00', 17]), [1530, 1620]);
  // Polar night: a session from 08:00 to the evening, and one from 02:00
  // across noon. Neither may put its morning after its afternoon.
  assert.deepEqual(plan(['08:00', 16], ['11:00', 16], ['12:30', 16], ['16:00', 16]), [480, 660, 750, 960]);
  assert.deepEqual(plan(['02:00', 16], ['11:45', 16], ['12:00', 16], ['13:30', 16]), [120, 705, 720, 810]);
  // Afternoon start running past the next noon keeps counting.
  assert.deepEqual(plan(['13:00', 16], ['12:30', 17]), [780, 2190]);

  const targets = share.buildTargets([
    slot({ start: at('08:00') }),
    slot({ start: at('12:30'), object: { catalog: 'M', catalog_number: '1', name: 'Crab Nebula' } }),
  ], TZ);
  assert.deepEqual(targets.map((x) => x.start_min), [480, 750]);
  assert.deepEqual(share.validateTargets(targets), []);
  // Out of order is refused rather than shared.
  const swapped = share.validateTargets([targets[1], targets[0]]);
  assert.equal(swapped.length, 1);
  assert.match(swapped[0], /Target 2 \(M 42\): starts before the target ahead of it/);
});

test('buildTargets maps planner slots onto TargetItems', () => {
  const targets = share.buildTargets([
    slot(),
    slot({ start: at('01:30', 17), durationMinutes: 30, object: { catalog: 'Sh2', catalog_number: '155', name: 'Cave Nebula' }, raHours: 22.955, decDeg: 62.6167 }),
    slot({ start: at('02:00', 17), durationMinutes: 15, object: { catalog: 'SOL', catalog_number: '2', name: 'Moon' }, raHours: 3.2, decDeg: 18.1 }),
  ], TZ);
  assert.deepEqual(targets[0], {
    ai_generated: false,
    alias_name: 'Orion Nebula',
    camera: { exp_ms: { stack_l: 10000 }, stack: { capt_type: 'stack' } },
    camera_mode: 'tele',
    duration_min: 60,
    lp_filter: false,
    mount: { tracking: false },
    start_min: 1380,
    target_id: targets[0].target_id,
    target_name: 'M 42',
    target_ra_dec: [5.5881, -5.391], // RA in hours, Dec in degrees
    second_camera: null,
  });
  assert.equal(targets[1].target_name, 'Sh2-155');
  assert.equal(targets[1].start_min, 1530);
  // The site's own list numbers ("SOL 2") mean nothing to anyone else.
  assert.equal(targets[2].target_name, 'Moon');
  assert.equal(targets[2].alias_name, '');
  assert.deepEqual(share.validateTargets(targets), []);
});

test('target ids are stable, positive, and unique within a plan', () => {
  const a = share.buildTargets([slot()], TZ)[0].target_id;
  const b = share.buildTargets([slot({ start: at('20:00') })], TZ)[0].target_id;
  assert.equal(a, b, 'same object, same id');
  assert.ok(Number.isInteger(a) && a > 0 && a <= 0x7fffffff);
  // The same object twice in one plan still gets two different ids.
  const twice = share.buildTargets([slot(), slot({ start: at('01:00', 17) })], TZ);
  assert.notEqual(twice[0].target_id, twice[1].target_id);
  assert.deepEqual(share.validateTargets(twice), []);
  // A clash moves on to the next free id.
  const first = share.targetId('M 42', new Set());
  assert.equal(share.targetId('M 42', new Set([first])), first + 1);
  const upTo = new Set();
  for (let id = first; id < first + 5; id++) upTo.add(id);
  assert.equal(share.targetId('M 42', upTo), first + 5);
  assert.ok(first + 5 <= 0x7fffffff);
});

test('validateTargets names everything the app would silently drop', () => {
  const good = () => share.buildTargets([slot()], TZ)[0];
  const problemsFor = (over) => share.validateTargets([{ ...good(), ...over }]);

  assert.deepEqual(share.validateTargets([]), ['The plan has no targets.']);
  assert.match(problemsFor({ target_ra_dec: [24.5, 0] })[0], /right ascension 24\.5 is not between 0 and 24/);
  assert.match(problemsFor({ target_ra_dec: [-0.1, 0] })[0], /right ascension/);
  // RA given in degrees by mistake is the classic one.
  assert.match(problemsFor({ target_ra_dec: [83.82, -5.39] })[0], /right ascension 83\.82/);
  assert.match(problemsFor({ target_ra_dec: [NaN, 0] })[0], /right ascension/);
  assert.match(problemsFor({ target_ra_dec: [5, -90.5] })[0], /declination -90\.5/);
  assert.match(problemsFor({ target_ra_dec: [5, 91] })[0], /declination 91/);
  assert.match(problemsFor({ target_id: 0 })[0], /id must be a positive whole number/);
  assert.match(problemsFor({ target_id: -4 })[0], /id must be/);
  assert.match(problemsFor({ target_name: '   ' })[0], /has no name/);
  assert.match(problemsFor({ start_min: -1 })[0], /start time -1/);
  assert.match(problemsFor({ duration_min: 0 })[0], /duration 0/);
  assert.match(problemsFor({ duration_min: NaN })[0], /duration NaN/);
  assert.deepEqual(problemsFor({ target_ra_dec: [0, 90] }), []);
  assert.deepEqual(problemsFor({ target_ra_dec: [24, -90] }), []);

  const dup = share.validateTargets([good(), { ...good(), target_name: 'M 43' }]);
  assert.equal(dup.length, 1);
  assert.match(dup[0], /Target 2 \(M 43\): id \d+ is used twice/);

  const many = Array.from({ length: share.MAX_TARGETS + 1 }, (_, i) => ({ ...good(), target_id: i + 1 }));
  assert.match(share.validateTargets(many)[0], /61 targets/);
});

test('the request body nests JSON strings three deep, as the app writes it', () => {
  const targets = share.buildTargets([slot(), slot({ start: at('01:30', 17), durationMinutes: 45, object: { catalog: 'M', catalog_number: '1', name: 'Crab Nebula' } })], TZ);
  const body = share.buildRequestBody('Tonight', targets, 1_700_000_000_123);
  assert.deepEqual(body.metadata, { planName: 'Tonight', targetCount: 2, shootingDurationMinutes: 105 });
  assert.equal(typeof body.payload, 'string');
  const plan = JSON.parse(body.payload);
  assert.equal(plan.name, 'Tonight');
  assert.equal(plan.createTime, 1_700_000_000); // seconds
  assert.equal(plan.operationTime, 1_700_000_000_123); // milliseconds
  assert.equal(plan.operation, 'update');
  assert.match(plan.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(plan.extra), { wideIncrementId: 0 });
  assert.deepEqual(JSON.parse(plan.payload), targets);
});

test('sharePlan posts once and returns the id, the link and a QR of that link', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return okResponse('rjxa4qmn'); };
  const out = await share.sharePlan({ name: '  DSL 16 Nov   S50 Pro ', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/share\/plan$/);
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'the request has a timeout');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.metadata.planName, 'DSL 16 Nov S50 Pro');
  assert.equal(JSON.parse(JSON.parse(sent.payload).payload)[0].target_name, 'M 42');
  assert.equal(out.shareId, 'rjxa4qmn');
  assert.equal(out.shareLink, 'https://app.zwoastro.com/Seestar/plan?id=rjxa4qmn');
  assert.equal(out.targetCount, 1);
  assert.equal(out.durationMinutes, 60);
  const png = Buffer.from(out.qrPngBase64, 'base64');
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('sharePlan refuses a bad plan without calling ZWO', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return okResponse(); };
  const bad = (input, pattern) => assert.rejects(
    share.sharePlan({ name: 'x', tzOffsetMinutes: TZ, ...input }, { fetchImpl }),
    (err) => err instanceof share.SeestarShareError && Array.isArray(err.problems) && pattern.test(err.message),
  );
  await bad({ slots: [slot({ raHours: 83.82 })] }, /right ascension 83\.82/);
  await bad({ slots: [slot({ raHours: NaN, decDeg: NaN })] }, /right ascension/);
  await bad({ slots: [] }, /no targets/);
  await bad({ slots: [slot({ durationMinutes: 0 })] }, /duration 0/);
  await bad({ slots: [slot()], name: '   ' }, /needs a name/);
  await bad({ slots: [slot()], tzOffsetMinutes: NaN }, /time zone/);
  assert.equal(called, 0);
});

test('an error in the body is reported verbatim, even with HTTP 200, and never retried', async () => {
  for (const status of [200, 400]) {
    let called = 0;
    const fetchImpl = async () => { called++; return jsonResponse(status, { code: 100002, msg: 'Parameter error' }); };
    await assert.rejects(
      share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl }),
      (err) => err.zwoCode === 100002 && err.zwoMessage === 'Parameter error' && err.httpStatus === status
        && /code 100002: Parameter error/.test(err.message),
    );
    assert.equal(called, 1, 'a POST that got a response is not repeated');
  }
});

test('a 5xx or non-JSON answer is an error and is not retried', async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return new Response('<html>Bad Gateway</html>', { status: 502 }); };
  await assert.rejects(
    share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl }),
    (err) => err.httpStatus === 502 && err.zwoCode === null && /HTTP 502/.test(err.message),
  );
  assert.equal(called, 1);

  // An answer whose body can't be read is final too.
  called = 0;
  const cutOff = async () => { called++; return { ok: true, status: 200, text: async () => { throw new Error('terminated'); } }; };
  await assert.rejects(
    share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl: cutOff }),
    /answered \(HTTP 200\) but its reply couldn't be read/,
  );
  assert.equal(called, 1);

  // "OK" with no usable share id is still a failure.
  const noId = async () => jsonResponse(200, { code: 200, msg: 'OK', data: {} });
  await assert.rejects(
    share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl: noId }),
    /refused the plan \(code 200: OK\)/,
  );
});

test('a network error is retried once, and only once', async () => {
  let called = 0;
  const flaky = async () => {
    called++;
    if (called === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return okResponse('second1');
  };
  const out = await share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl: flaky });
  assert.equal(out.shareId, 'second1');
  assert.equal(called, 2);

  called = 0;
  const down = async () => { called++; throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(
    share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl: down }),
    (err) => err.network === true && /Couldn't reach the Seestar share service \(ENOTFOUND\)/.test(err.message),
  );
  assert.equal(called, 2);
});

test('a request that hangs times out', async () => {
  let called = 0;
  const hang = (_url, init) => new Promise((_resolve, reject) => {
    called++;
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  // AbortSignal.timeout doesn't hold the event loop open on its own.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(
      share.sharePlan({ name: 'x', slots: [slot()], tzOffsetMinutes: TZ }, { fetchImpl: hang, timeoutMs: 40 }),
      /timed out/,
    );
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(called, 2);
});

// ---- the routes, against a fake of ZWO's API ------------------------------

function fakeZwo() {
  const state = { requests: [], mode: 'ok' };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method !== 'POST' || req.url !== '/v1/share/plan') return send(404, { code: 404, msg: 'Not found' });
      state.requests.push(JSON.parse(raw));
      if (state.mode === 'error') return send(200, { code: 100002, msg: 'Parameter error' });
      const id = `fake${state.requests.length}`;
      send(200, { code: 200, msg: 'OK', data: { shareId: id, shareLink: `https://app.zwoastro.com/Seestar/plan?id=${id}` } });
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
  return { base, stop };
}

test('sharing a planner schedule through the API', async (t) => {
  const zwo = fakeZwo();
  await new Promise((r) => zwo.server.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-share-'));
  const password = 'sharetest';
  const env = {
    ...process.env,
    PORT: String(28000 + Math.floor(Math.random() * 4000)),
    ADMIN_PASSWORD: password,
    DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    STAGE_DIR: path.join(dataDir, 'stage'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    SEESTAR_API_BASE: `http://127.0.0.1:${zwo.server.address().port}`,
    DISABLE_OCR: '1',
  };
  let app = null;
  t.after(async () => {
    if (app) await app.stop();
    zwo.server.closeAllConnections?.();
    zwo.server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  app = await startApp(env);

  const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64') };
  const api = async (p, opts = {}) => {
    const res = await fetch(`${app.base}${p}`, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const post = (body, headers) => api('/api/admin/seestar/share', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });

  // A real schedule from the planner, shared the way the page does it.
  const plan = await api('/api/admin/seestar-planner?lat=42.06&lon=-87.94&start=2026-11-17T00:30:00Z&fleet=s50pro:1&min_alt=30&max_alt=85');
  assert.equal(plan.status, 200);
  const scope = plan.body.scopes[0];
  assert.ok(scope.slots.length >= 2, 'the planner found targets');
  const solar = (await api('/api/lists/solar-system')).body?.objects || [];
  const moon = solar.find((o) => o.name === 'Moon');
  const sun = solar.find((o) => o.name === 'Sun');
  const slots = scope.slots.map((s) => ({ object_id: s.target.id, slot_start: s.slot_start, duration_minutes: s.duration_minutes }));
  const request = { name: 'DSL 16 Nov S50 Pro', scope: scope.label, tz_offset_minutes: -360, slots };

  // Without the password nothing is sent.
  const anon = await fetch(`${app.base}/api/admin/seestar/share`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  });
  assert.equal(anon.status, 401);
  assert.equal(zwo.state.requests.length, 0);

  const made = await post(request);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.shareId, 'fake1');
  assert.equal(made.body.shareLink, 'https://app.zwoastro.com/Seestar/plan?id=fake1');
  assert.equal(made.body.targetCount, slots.length);
  assert.ok(made.body.qrPngBase64.length > 500);
  assert.ok(!Number.isNaN(Date.parse(made.body.createdAt)));

  // What reached "ZWO": every slot, with coordinates looked up server-side.
  assert.equal(zwo.state.requests.length, 1);
  const sent = zwo.state.requests[0];
  assert.equal(sent.metadata.targetCount, slots.length);
  const targets = JSON.parse(JSON.parse(sent.payload).payload);
  assert.equal(targets.length, slots.length);
  assert.deepEqual(share.validateTargets(targets), []);
  targets.forEach((target, i) => {
    assert.equal(target.duration_min, slots[i].duration_minutes);
    assert.equal(target.start_min, share.startMinutes(new Date(slots[i].slot_start), -360));
    assert.equal(target.camera_mode, 'tele');
  });
  assert.ok(targets.every((x, i) => i === 0 || x.start_min > targets[i - 1].start_min), 'slots stay in order across midnight');

  // A Solar System body gets its position for the slot's start.
  assert.ok(moon, "the Solar System list has the Moon");
  {
    const moonShare = await post({ name: 'Moon', tz_offset_minutes: -360, slots: [{ object_id: moon.id, slot_start: '2026-11-17T01:00:00Z', duration_minutes: 15 }] });
    assert.equal(moonShare.status, 201, JSON.stringify(moonShare.body));
    const [m] = JSON.parse(JSON.parse(zwo.state.requests.at(-1).payload).payload);
    assert.equal(m.target_name, 'Moon');
    assert.ok(m.target_ra_dec[0] >= 0 && m.target_ra_dec[0] <= 24 && Math.abs(m.target_ra_dec[1]) < 30);
  }
  const sentSoFar = zwo.state.requests.length;

  // Bad plans are refused here, with reasons, and never reach ZWO.
  for (const [body, pattern] of [
    [{ ...request, slots: [] }, /no targets/],
    [{ ...request, slots: [{ ...slots[0], object_id: 99999999 }] }, /Slot 1 has no known target/],
    [{ ...request, slots: [{ ...slots[0], slot_start: 'tonight' }] }, /Slot 1/],
    [{ ...request, slots: [{ ...slots[0], object_id: sun.id }] }, /Slot 1 is the Sun/],
    [{ ...request, slots: [{ ...slots[0], duration_minutes: 0 }] }, /duration 0/],
    [{ ...request, tz_offset_minutes: undefined }, /time zone/],
    [{ ...request, tz_offset_minutes: null }, /time zone/],
    [{ ...request, tz_offset_minutes: '' }, /time zone/],
    [{ ...request, slots: [{ ...slots[0], duration_minutes: true }] }, /duration NaN/],
    [{ ...request, slots: [{ ...slots[0], slot_start: 0 }] }, /Slot 1/],
    [{ ...request, name: '' }, /needs a name/],
  ]) {
    const refused = await post(body);
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.match(refused.body.error, pattern);
  }
  assert.equal(zwo.state.requests.length, sentSoFar);

  // ZWO's own error comes back word for word, and nothing is recorded.
  zwo.state.mode = 'error';
  const failed = await post(request);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.zwo_code, 100002);
  assert.equal(failed.body.zwo_message, 'Parameter error');
  assert.match(failed.body.error, /code 100002: Parameter error/);
  assert.equal(zwo.state.requests.length, sentSoFar + 1, 'not retried');
  zwo.state.mode = 'ok';

  // Past shares, newest first, each with its QR on request.
  const list = await api('/api/admin/seestar/shares');
  assert.equal(list.status, 200);
  assert.equal(list.body.shares.length, 2);
  const first = list.body.shares.at(-1);
  assert.equal(first.shareId, 'fake1');
  assert.equal(first.planName, 'DSL 16 Nov S50 Pro');
  assert.equal(first.scope, scope.label);
  const one = await api(`/api/admin/seestar/shares/${first.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.shareLink, made.body.shareLink);
  assert.equal(one.body.qrPngBase64, made.body.qrPngBase64);
  assert.equal((await api('/api/admin/seestar/shares/424242')).status, 404);
  assert.equal((await fetch(`${app.base}/api/admin/seestar/shares`)).status, 401);
});
