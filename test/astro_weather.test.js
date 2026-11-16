// Weather for astronomy (lib/astro_weather.js): the per-hour estimates and
// verdicts, the per-night summary, caching and the upstream cap with fetch
// mocked, then /api/astro-weather against a local fake of Open-Meteo.
// Nothing here talks to Open-Meteo's servers.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const wx = require('../lib/astro_weather');

const ROOT = path.resolve(__dirname, '..');
// Mount Prospect, IL. 17 Nov 2026 23:00 UTC is 5 pm local, half an hour
// after sunset.
const LAT = 42.1;
const LON = -87.9;
const T0 = Date.UTC(2026, 10, 17, 23);

// An Open-Meteo "hourly" block of `n` hours from T0. `at(i)` returns the
// fields that differ from a clear, calm, dry hour.
function hourly(n, at = () => ({})) {
  const base = {
    cloud_cover: 0, cloud_cover_low: 0, cloud_cover_mid: 0, cloud_cover_high: 0,
    temperature_2m: 5, dew_point_2m: -5, relative_humidity_2m: 50,
    wind_speed_10m: 5, wind_gusts_10m: 10, visibility: 30000,
    precipitation_probability: 0, wind_speed_250hPa: 50,
  };
  const out = { time: [] };
  for (const k of Object.keys(base)) out[k] = [];
  for (let i = 0; i < n; i++) {
    out.time.push((T0 + i * 3_600_000) / 1000);
    const row = { ...base, ...at(i) };
    for (const k of Object.keys(base)) out[k].push(row[k]);
  }
  return out;
}
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('seeing follows the jet stream, less a point for strong gusts', () => {
  assert.equal(wx.seeingEstimate(40, 5), 5);
  assert.equal(wx.seeingEstimate(60, 5), 5);
  assert.equal(wx.seeingEstimate(90, 5), 4);
  assert.equal(wx.seeingEstimate(130, 5), 3);
  assert.equal(wx.seeingEstimate(170, 5), 2);
  assert.equal(wx.seeingEstimate(250, 5), 1);
  assert.equal(wx.seeingEstimate(90, 40), 3);
  assert.equal(wx.seeingEstimate(250, 60), 1, 'never below 1');
  assert.equal(wx.seeingEstimate(90, null), 4);
  assert.equal(wx.seeingEstimate(null, 5), null, 'no jet-stream wind, no estimate');
  // The band edges.
  assert.deepEqual([60, 61, 100, 101, 140, 141, 180, 181].map((jet) => wx.seeingEstimate(jet, 0)), [5, 4, 4, 3, 3, 2, 2, 1]);
  assert.deepEqual([34, 35].map((gust) => wx.seeingEstimate(50, gust)), [5, 4]);
});

test('transparency follows humidity and visibility', () => {
  assert.equal(wx.transparencyEstimate(50, 30000), 5);
  assert.equal(wx.transparencyEstimate(85, 30000), 4);
  assert.equal(wx.transparencyEstimate(97, 30000), 3);
  assert.equal(wx.transparencyEstimate(50, 15000), 4);
  assert.equal(wx.transparencyEstimate(50, 8000), 3);
  assert.equal(wx.transparencyEstimate(97, 3000), 1);
  assert.equal(wx.transparencyEstimate(null, 30000), 5);
  assert.equal(wx.transparencyEstimate(null, null), null);
  assert.deepEqual([79, 80, 94, 95].map((rh) => wx.transparencyEstimate(rh, 30000)), [5, 4, 4, 3]);
  assert.deepEqual([20000, 19999, 10000, 9999, 5000, 4999].map((vis) => wx.transparencyEstimate(50, vis)), [5, 4, 4, 3, 3, 2]);
});

test('dew risk is the temperature / dew point gap', () => {
  assert.equal(wx.dewRisk(10, 2), 'low');
  assert.equal(wx.dewRisk(10, 7.5), 'likely');
  assert.equal(wx.dewRisk(10, 9.5), 'high');
  assert.equal(wx.dewRisk(-2, -2.5), 'frost');
  assert.equal(wx.dewRisk(null, 3), null);
  assert.deepEqual([[10, 6.9], [10, 7], [10, 8.9], [10, 9], [0, -1], [0.1, -0.9]].map(([t, d]) => wx.dewRisk(t, d)),
    ['low', 'likely', 'likely', 'high', 'frost', 'high']);
});

test('darkness bands', () => {
  assert.equal(wx.darkness(10), 'day');
  assert.equal(wx.darkness(-5.9), 'day');
  assert.equal(wx.darkness(-6), 'twilight');
  assert.equal(wx.darkness(-17.9), 'twilight');
  assert.equal(wx.darkness(-18), 'dark');
});

test('the hourly verdict and its reasons', () => {
  const clear = { cloud: 5, precipitation_probability: 0, gusts: 10, transparency: 5 };
  assert.deepEqual(wx.verdict(clear), { verdict: 'go', reasons: [] });
  assert.equal(wx.verdict({ ...clear, cloud: 25 }).verdict, 'go');
  assert.deepEqual(wx.verdict({ ...clear, cloud: 40 }), { verdict: 'marginal', reasons: ['40% cloud'] });
  assert.deepEqual(wx.verdict({ ...clear, cloud: 70 }), { verdict: 'no-go', reasons: ['70% cloud'] });
  assert.equal(wx.verdict({ ...clear, precipitation_probability: 30 }).verdict, 'marginal');
  assert.equal(wx.verdict({ ...clear, precipitation_probability: 60 }).verdict, 'no-go');
  assert.deepEqual(wx.verdict({ ...clear, gusts: 32 }), { verdict: 'marginal', reasons: ['gusts 32 km/h'] });
  assert.equal(wx.verdict({ ...clear, gusts: 50 }).verdict, 'no-go');
  assert.deepEqual(wx.verdict({ ...clear, transparency: 2 }), { verdict: 'marginal', reasons: ['poor transparency'] });
  // Everything that is wrong is listed, the blockers first.
  assert.deepEqual(wx.verdict({ cloud: 90, precipitation_probability: 30, gusts: 50, transparency: 1 }).reasons,
    ['90% cloud', 'gusts 50 km/h', '30% chance of rain or snow', 'poor transparency']);
  // The cut-offs themselves.
  const v = (over) => wx.verdict({ ...clear, ...over }).verdict;
  assert.deepEqual([25, 26, 69, 70].map((cloud) => v({ cloud })), ['go', 'marginal', 'marginal', 'no-go']);
  assert.deepEqual([19, 20, 49, 50].map((p) => v({ precipitation_probability: p })), ['go', 'marginal', 'marginal', 'no-go']);
  assert.deepEqual([29, 30, 44, 45].map((gusts) => v({ gusts })), ['go', 'marginal', 'marginal', 'no-go']);
  assert.deepEqual([3, 2].map((transparency) => v({ transparency })), ['go', 'marginal']);
  // No cloud figure, no verdict — unless rain or a gale settles it anyway.
  assert.deepEqual(wx.verdict({ ...clear, cloud: null }), { verdict: null, reasons: [] });
  assert.deepEqual(wx.verdict({ ...clear, cloud: null, gusts: 90 }), { verdict: 'no-go', reasons: ['gusts 90 km/h'] });
});

test('buildHours adds the Sun, the Moon and a verdict to each hour', () => {
  const hours = wx.buildHours(hourly(24, (i) => (i === 3 ? { cloud_cover: 90, cloud_cover_high: 90 } : {})), LAT, LON, new Date(T0));
  assert.equal(hours.length, 24);
  assert.equal(hours[0].time, '2026-11-17T23:00:00.000Z');
  // 5 pm local in mid-November: the Sun is down but it isn't fully dark yet.
  assert.equal(hours[0].darkness, 'twilight');
  assert.equal(hours[7].darkness, 'dark'); // midnight local
  assert.equal(hours[19].darkness, 'day'); // noon local
  assert.ok(hours[19].sun_altitude > 20 && hours[7].sun_altitude < -40);
  assert.equal(hours[0].verdict, 'go');
  assert.equal(hours[3].verdict, 'no-go');
  assert.equal(hours[3].cloud_high, 90);
  assert.equal(hours[0].seeing, 5);
  assert.equal(hours[0].dew, 'low');
  assert.ok(hours.every((h) => h.moon_illumination >= 0 && h.moon_illumination <= 1 && Math.abs(h.moon_altitude) <= 90));

  // Gusts and precipitation chance are given for the hour before each
  // timestamp, so an hour takes them from the next entry.
  const shifted = wx.buildHours(hourly(3, (i) => (i === 1 ? { wind_gusts_10m: 60, precipitation_probability: 80, wind_speed_10m: 33 } : {})), LAT, LON, new Date(T0));
  assert.deepEqual(shifted.map((h) => h.gusts), [60, 10, 10]);
  assert.deepEqual(shifted.map((h) => h.precipitation_probability), [80, 0, 0]);
  assert.deepEqual(shifted.map((h) => h.wind), [5, 33, 5], 'wind speed is at the timestamp');
  assert.equal(shifted[0].verdict, 'no-go');

  // Hours already over are dropped; the one in progress is kept.
  const later = wx.buildHours(hourly(24), LAT, LON, new Date(T0 + 2.5 * 3_600_000));
  assert.equal(later[0].time, '2026-11-18T01:00:00.000Z');
  assert.equal(later.length, 22);

  // Gaps in the upstream data become nulls, not zeros.
  const gappy = hourly(2);
  gappy.cloud_cover[1] = null;
  delete gappy.wind_speed_250hPa;
  const [a, b] = wx.buildHours(gappy, LAT, LON, new Date(T0));
  assert.equal(a.seeing, null);
  assert.equal(b.cloud, null);
  assert.equal(b.verdict, null);
});

test('summariseNights finds each night, its usable hours and best run', () => {
  // Night 1 (hours 0-12): cloud for hours 4-5 splits it into runs of 4 and 7.
  // Night 2 (hours 24-36): clouded out except one marginal hour.
  const hours = wx.buildHours(hourly(48, (i) => {
    if (i === 4 || i === 5) return { cloud_cover: 95 };
    if (i === 30) return { cloud_cover: 50 };
    if (i >= 22) return { cloud_cover: 100 };
    return {};
  }), LAT, LON, new Date(T0));
  const nights = wx.summariseNights(hours);
  assert.equal(nights.length, 2);
  const [one, two] = nights;
  assert.equal(one.start, '2026-11-17T23:00:00.000Z');
  assert.ok(one.hours >= 12 && one.hours <= 13);
  assert.equal(one.go_hours, one.hours - 2);
  assert.equal(one.best.start, '2026-11-18T05:00:00.000Z');
  assert.equal(one.best.hours, one.hours - 6);
  assert.equal(new Date(one.best.end) - new Date(one.best.start), one.best.hours * 3_600_000);
  assert.equal(one.verdict, 'go');
  assert.equal(two.go_hours, 0);
  assert.equal(two.marginal_hours, 1);
  assert.equal(two.best, null);
  assert.equal(two.verdict, 'no-go');
  assert.ok(new Date(two.start) > new Date(one.end), 'daylight separates the nights');

  // A single clear hour is not a "go" night; two usable hours are marginal.
  const brief = wx.summariseNights(wx.buildHours(hourly(14, (i) => (i === 2 ? {} : i === 3 ? { cloud_cover: 40 } : { cloud_cover: 100 })), LAT, LON, new Date(T0)));
  assert.equal(brief[0].verdict, 'marginal');
  assert.equal(brief[0].best.hours, 1);
  assert.deepEqual(wx.summariseNights([]), []);

  // A night the forecast ends partway through is left out, not judged on
  // its first half; so is a night with under two hours to go.
  const cutOff = wx.summariseNights(wx.buildHours(hourly(30), LAT, LON, new Date(T0)));
  assert.equal(cutOff.length, 1);
  assert.equal(cutOff[0].start, '2026-11-17T23:00:00.000Z');
  const nearDawn = wx.summariseNights(wx.buildHours(hourly(48), LAT, LON, new Date(T0 + 12.5 * 3_600_000)));
  assert.equal(nearDawn.length, 1, 'the one hour left of the first night is not a night');
  assert.equal(nearDawn[0].start, '2026-11-18T23:00:00.000Z');

  // Polar night (Longyearbyen in December): no daylight to separate the
  // nights, so they are cut every 24 hours.
  const polarStart = Date.UTC(2026, 11, 16, 0);
  const polarHourly = hourly(100);
  polarHourly.time = polarHourly.time.map((_, i) => (polarStart + i * 3_600_000) / 1000);
  const polar = wx.summariseNights(wx.buildHours(polarHourly, 78.2, 15.6, new Date(polarStart)));
  assert.equal(polar.length, 4);
  assert.ok(polar.every((n) => n.hours === 24));
});

test('forecasts are cached per 0.1° square for an hour', async () => {
  let clock = T0;
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return response({ hourly: hourly(48) }); };
  const weather = wx.createAstroWeather({ fetchImpl, now: () => clock });

  const first = await weather.forecast(42.06, -87.94);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/v1\/forecast\?latitude=42\.1&longitude=-87\.9&/);
  const asked = new URL(urls[0]).searchParams;
  assert.equal(asked.get('timeformat'), 'unixtime', 'times are parsed as unix seconds');
  assert.equal(asked.get('wind_speed_unit'), 'kmh', 'thresholds are in km/h');
  assert.equal(asked.get('forecast_days'), String(wx.FORECAST_DAYS));
  assert.equal(wx.FORECAST_DAYS, 8);
  assert.deepEqual(asked.get('hourly').split(','), wx.HOURLY);
  for (const name of ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'dew_point_2m',
    'relative_humidity_2m', 'wind_speed_10m', 'wind_gusts_10m', 'visibility', 'precipitation_probability', 'wind_speed_250hPa']) {
    assert.ok(wx.HOURLY.includes(name), name);
  }
  assert.deepEqual(first.location, { lat: 42.1, lon: -87.9 });
  assert.equal(first.hours.length, 48);
  assert.equal(first.nights.length, 2);
  assert.ok(urls[0].startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.equal(first.fetched_at, new Date(T0).toISOString());

  // Same square, within the hour: no new request.
  assert.equal(await weather.forecast(42.14, -87.86), first);
  clock += 59 * 60_000;
  await weather.forecast(42.1, -87.9);
  assert.equal(urls.length, 1);
  // Another square, or an hour later: fetched again.
  await weather.forecast(42.2, -87.9);
  assert.equal(urls.length, 2);
  clock += 2 * 60_000;
  const second = await weather.forecast(42.1, -87.9);
  assert.equal(urls.length, 3);
  assert.notEqual(second, first);
  assert.equal(second.hours.length, 47, 'the hour that ended is gone');
});

test('concurrent requests share one fetch', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetchImpl = async () => { calls++; await gate; return response({ hourly: hourly(24) }); };
  const weather = wx.createAstroWeather({ fetchImpl, now: () => T0 });
  const both = Promise.all([weather.forecast(LAT, LON), weather.forecast(LAT, LON)]);
  release();
  const [a, b] = await both;
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test('upstream failures: an error, a pause before retrying, and the last good forecast', async () => {
  let clock = T0;
  let mode = 'down';
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (mode === 'down') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (mode === 'bad') return response({ error: true, reason: 'Latitude must be in range of -90 to 90°.' }, 400);
    if (mode === 'html') return new Response('<html>oops</html>', { status: 502 });
    return response({ hourly: hourly(24) });
  };
  const weather = wx.createAstroWeather({ fetchImpl, now: () => clock });
  const unreachable = (err) => err instanceof wx.AstroWeatherError && err.status === 502
    && /Couldn't reach the weather service \(ENOTFOUND\)/.test(err.message);
  await assert.rejects(weather.forecast(LAT, LON), unreachable);
  // For the next few minutes the service isn't asked again for that square.
  mode = 'ok';
  await assert.rejects(weather.forecast(LAT, LON), unreachable);
  assert.equal(calls, 1);
  // Other squares are, and each kind of failure says what happened.
  mode = 'bad';
  await assert.rejects(weather.forecast(10, 10), /didn't return a forecast \(Latitude must be in range/);
  mode = 'html';
  await assert.rejects(weather.forecast(20, 20), /didn't return a forecast \(HTTP 502\)/);
  assert.equal(calls, 3);

  // After the pause it is tried again, and succeeds.
  clock += wx.RETRY_MS + 1000;
  mode = 'ok';
  const good = await weather.forecast(LAT, LON);
  assert.equal(good.hours.length, 24);
  assert.equal(calls, 4);

  // Once that is stale and the service is down, the old forecast stands —
  // for everyone waiting on the same fetch — and the service gets a rest.
  clock += 2 * 3_600_000;
  mode = 'down';
  const [a, b] = await Promise.all([weather.forecast(LAT, LON), weather.forecast(LAT, LON)]);
  assert.equal(a, good);
  assert.equal(b, good);
  assert.equal(calls, 5);
  assert.equal(await weather.forecast(LAT, LON), good);
  assert.equal(calls, 5, 'no retry inside the pause');

  // A forecast too old to be useful is not served: the failure shows.
  clock += wx.STALE_MAX_MS;
  await assert.rejects(weather.forecast(LAT, LON), unreachable);
  assert.equal(calls, 6);
});

test('both sides of the equator and meridian share the zero square', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return response({ hourly: hourly(24) }); };
  const weather = wx.createAstroWeather({ fetchImpl, now: () => T0 });
  const a = await weather.forecast(-0.01, -0.02);
  assert.equal(await weather.forecast(0.01, 0.02), a);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /latitude=0&longitude=0&/);
  assert.deepEqual(a.location, { lat: 0, lon: 0 });
});

test('upstream requests are capped per hour', async () => {
  let clock = T0;
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({ hourly: hourly(24) }); };
  const weather = wx.createAstroWeather({ fetchImpl, now: () => clock });
  for (let i = 0; i < wx.UPSTREAM_MAX_PER_HOUR; i++) await weather.forecast(10 + i * 0.1, 20);
  assert.equal(calls, wx.UPSTREAM_MAX_PER_HOUR);
  await assert.rejects(weather.forecast(-40, 20), (err) => err.status === 429);
  assert.equal(calls, wx.UPSTREAM_MAX_PER_HOUR, 'the capped request never left');
  // Squares already fetched are still served, and the cap lifts with time.
  await weather.forecast(10, 20);
  clock += 61 * 60_000;
  await weather.forecast(-40, 20);
  assert.equal(calls, wx.UPSTREAM_MAX_PER_HOUR + 1);
});

// ---- the route, against a fake Open-Meteo ---------------------------------

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

test('GET /api/astro-weather', async (t) => {
  const state = { requests: [], fail: false };
  const fake = http.createServer((req, res) => {
    state.requests.push(req.url);
    if (state.fail) { res.writeHead(500); return res.end('boom'); }
    // Like the real API, answer in what was asked for: without these two
    // the fake's seconds and km/h would be wrong.
    const asked = new URL(req.url, 'http://x').searchParams;
    if (asked.get('timeformat') !== 'unixtime' || asked.get('wind_speed_unit') !== 'kmh') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: true, reason: 'fake: unexpected units' }));
    }
    // A week of hours starting at the top of the current hour, as the real
    // API returns from midnight; hour 2 is clouded out.
    const start = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const body = hourly(72, (i) => (i === 2 ? { cloud_cover: 100, cloud_cover_low: 100 } : {}));
    body.time = body.time.map((_, i) => (start + i * 3_600_000) / 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ latitude: 42.1, longitude: -87.9, hourly: body }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-wx-'));
  const env = {
    ...process.env,
    PORT: String(32000 + Math.floor(Math.random() * 4000)),
    DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    STAGE_DIR: path.join(dataDir, 'stage'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
    OPEN_METEO_BASE: `http://127.0.0.1:${fake.address().port}`,
    DISABLE_OCR: '1',
  };
  delete env.ADMIN_PASSWORD; // public: works with no admin password set
  let app = null;
  t.after(async () => {
    if (app) await app.stop();
    fake.closeAllConnections?.();
    fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  app = await startApp(env);
  const get = async (q) => {
    const res = await fetch(`${app.base}/api/astro-weather${q}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  for (const q of ['', '?lat=42', '?lat=abc&lon=1', '?lat=91&lon=0', '?lat=0&lon=181', '?lat=&lon=', '?lat=%20&lon=%20', '?lat=1&lat=2&lon=3']) {
    const bad = await get(q);
    assert.equal(bad.status, 400, q);
    assert.match(bad.body.error, /lat and lon/);
  }
  assert.equal(state.requests.length, 0, 'bad requests never reach the weather service');

  const ok = await get('?lat=42.06&lon=-87.94');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(state.requests.length, 1);
  assert.match(state.requests[0], /latitude=42\.1&longitude=-87\.9/);
  assert.equal(ok.body.source, 'Open-Meteo');
  assert.deepEqual(ok.body.location, { lat: 42.1, lon: -87.9 });
  assert.equal(ok.body.hours.length, 72);
  assert.equal(ok.body.hours[0].verdict, 'go');
  assert.equal(ok.body.hours[2].verdict, 'no-go');
  assert.deepEqual(ok.body.hours[2].reasons, ['100% cloud']);
  for (const key of ['time', 'cloud', 'cloud_low', 'cloud_mid', 'cloud_high', 'seeing', 'transparency', 'dew', 'wind', 'gusts',
    'temperature', 'darkness', 'sun_altitude', 'moon_altitude', 'moon_illumination', 'verdict', 'reasons']) {
    assert.ok(key in ok.body.hours[0], key);
  }
  assert.ok(ok.body.nights.length >= 2 && ok.body.nights.length <= 4);
  assert.ok(ok.body.nights.every((n) => ['go', 'marginal', 'no-go'].includes(n.verdict)));

  // Cached: a nearby point in the same square makes no new request.
  const again = await get('?lat=42.1&lon=-87.9');
  assert.equal(again.body.fetched_at, ok.body.fetched_at);
  assert.equal(state.requests.length, 1);

  // The weather service failing is a 502 with a plain message.
  state.fail = true;
  const down = await get('?lat=10&lon=10');
  assert.equal(down.status, 502);
  assert.match(down.body.error, /didn't return a forecast \(HTTP 500\)/);

  // One visitor can't use up the server's allowance: after 40 requests in
  // ten minutes they get 429 and nothing more goes upstream.
  state.fail = false;
  const before = state.requests.length;
  let limited = null;
  for (let i = 0; i < 45 && !limited; i++) {
    const res = await fetch(`${app.base}/api/astro-weather?lat=42.06&lon=-87.94`);
    if (res.status === 429) limited = res;
    else assert.equal(res.status, 200);
  }
  assert.ok(limited, 'the per-visitor limit kicks in');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.match((await limited.json()).error, /Too many forecast requests/);
  assert.equal(state.requests.length, before, 'cached square: no upstream requests at all');
});
