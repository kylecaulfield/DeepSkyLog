// Seestar watermark band reader (lib/seestar_band.js).
//
// The parser tests always run. The fixture and end-to-end tests need real
// OCR (tesseract.js + vendor/tessdata), so they skip when DISABLE_OCR=1 —
// as in CI — or when the language data was not installed (SKIP_TESSDATA).
//
// Fixtures in test/fixtures/seestar-bands/ are the bottom 28% of real
// exports shared from the Seestar app: no EXIF Make/Model/GPS at all, so the
// band is the only source of the telescope, location and date.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'seestar-bands');
const { _parse: P } = require(path.join(ROOT, 'lib', 'seestar_band'));

const OCR_SKIP = process.env.DISABLE_OCR === '1'
  ? 'DISABLE_OCR=1'
  : (!fs.existsSync(path.join(ROOT, 'vendor', 'tessdata', 'eng.traineddata.gz'))
    ? 'vendor/tessdata/eng.traineddata.gz not installed'
    : false);

const EXPECTED = {
  's30pro-c2.jpg':      { telescope: 'Seestar S30 Pro', target: 'C2',      captured_at: '2026-10-03T03:46', exposure_seconds_total: 116 * 60 },
  's30pro-ngc6210.jpg': { telescope: 'Seestar S30 Pro', target: 'NGC6210', captured_at: '2026-10-03T20:19', exposure_seconds_total: 24 * 60 },
  's30pro-c18.jpg':     { telescope: 'Seestar S30 Pro', target: 'C18',     captured_at: '2026-10-03T20:59', exposure_seconds_total: 23 * 60 },
  's50pro-ngc7000.jpg': { telescope: 'Seestar S50 Pro', target: 'NGC7000', captured_at: '2026-10-04T02:08', exposure_seconds_total: 91 * 60 },
  's50pro-ngc6960.jpg': { telescope: 'Seestar S50 Pro', target: 'NGC6960', captured_at: '2026-10-03T22:43', exposure_seconds_total: 84 * 60 },
  // A dense star field: every row of the bottom strip has enough bright star
  // pixels to clear the fixed text-row bar, which used to hide the band.
  's30pro-ngc1023-dense.jpg': { telescope: 'Seestar S30 Pro', target: 'NGC1023', captured_at: '2026-10-04T00:49', exposure_seconds_total: 117 * 60 },
  // Milky Way exports: no target on the top row and no integration time;
  // one "Milky Way" label sits on the right, centred between the rows.
  's50pro-milkyway.jpg': {
    telescope: 'Seestar S50 Pro', target: 'Milky Way', object_type: 'MW', captured_at: '2026-10-10T02:29',
    exposure_seconds_total: null, photographer: null,
  },
  // Dense stars and a lit horizon along the bottom edge. A star touching the
  // "3" of "39° N" makes OCR read 89: the latitude bound turns that into no
  // position rather than the North Pole.
  's50pro-milkyway-horizon.jpg': {
    telescope: 'Seestar S50 Pro', target: 'Milky Way', object_type: 'MW', captured_at: '2026-10-03T05:59',
    exposure_seconds_total: null, latitude: null, longitude: null,
  },
};
// Every fixture band reads "Kyle Caulfield / 90° W, 39° N / …".
const COMMON = { latitude: 39, longitude: -90, photographer: 'Kyle Caulfield' };

test('band parsers', async (t) => {
  await t.test('model: Pro needs both the text and the glyph count', () => {
    assert.equal(P.parseModel('Seestar S50 Pro', 13), 'Seestar S50 Pro');
    assert.equal(P.parseModel('Seestar S30 Pro', 13), 'Seestar S30 Pro');
    assert.equal(P.parseModel('Seestar S50', 10), 'Seestar S50');
    assert.equal(P.parseModel('Seestar S30', 10), 'Seestar S30');
    // Common OCR slips: the S of the size token read as 5, Pro read as P0.
    assert.equal(P.parseModel('Seestar 550 P0', 13), 'Seestar S50 Pro');
    // Text and geometry disagree on Pro → no guess rather than a wrong one.
    assert.equal(P.parseModel('Seestar S50 Pro', 10), null);
    assert.equal(P.parseModel('Seestar S50', 13), null);
    // Not a 3 or a 5, or trailing junk → null.
    assert.equal(P.parseModel('Seestar S80 Pro', 13), null);
    assert.equal(P.parseModel('Seestar S50 Max', 13), null);
    assert.equal(P.parseModel('', 13), null);
  });

  await t.test('coordinates: signs, decimals, and rejection of misreads', () => {
    assert.deepEqual(P.parseCoordsText('90° W, 39° N'), { latitude: 39, longitude: -90 });
    assert.deepEqual(P.parseCoordsText('3.7° E, 40.4° N'), { latitude: 40.4, longitude: 3.7 });
    assert.deepEqual(P.parseCoordsText('151.2° E, 33.9° S'), { latitude: -33.9, longitude: 151.2 });
    assert.equal(P.parseCoordsText('90° W, 39° W'), null, 'two longitudes');
    assert.equal(P.parseCoordsText('190° E, 10° N'), null, 'longitude out of range');
    assert.equal(P.parseCoordsText('9 0° W, 39° N'), null, 'a lost decimal point / split number');
    assert.equal(P.parseCoordsText('90° W, 89° N'), null, 'beyond ±75°: a star-touched 3 read as 8');
    assert.deepEqual(P.parseCoordsText('18.1° E, 69.6° N'), { latitude: 69.6, longitude: 18.1 }, 'Tromsø is fine');
  });

  await t.test('date: fixed-width YYYY.MM.DD HH:MM, tolerant separators', () => {
    assert.equal(P.parseDateText('2026.10.03 22:43'), '2026-10-03T22:43');
    assert.equal(P.parseDateText('2026,10.03 22.43'), '2026-10-03T22:43');
    assert.equal(P.parseDateText('202610032243'), '2026-10-03T22:43');
    assert.equal(P.parseDateText('2026.13.03 22:43'), null, 'month 13');
    assert.equal(P.parseDateText('2026.10.03 22:43 PM'), null, '12-hour clock');
    assert.equal(P.parseDateText('2019.10.03 22:43'), null, 'before Seestar existed');
  });

  await t.test('integration time', () => {
    assert.equal(P.parseExposure('84min'), 84 * 60);
    assert.equal(P.parseExposure('116min'), 116 * 60);
    assert.equal(P.parseExposure('1h 12min'), 72 * 60);
    assert.equal(P.parseExposure('2h'), 7200);
    assert.equal(P.parseExposure('1h75min'), null);
    assert.equal(P.parseExposure('min'), null);
  });

  await t.test('target', () => {
    assert.equal(P.parseTargetText('NGC 6960'), 'NGC6960');
    assert.equal(P.parseTargetText('C 18'), 'C18');
    assert.equal(P.parseTargetText('M 31'), 'M31');
    assert.equal(P.parseTargetText('1C 434'), 'IC434', 'I read as 1');
    assert.equal(P.parseTargetText('Moon'), null);
  });

  await t.test('named label: the whole crop must be the name', () => {
    assert.equal(P.parseNamedLabel('Milky Way'), 'Milky Way');
    assert.equal(P.parseNamedLabel('Milkv Wav'), 'Milky Way', 'the band font\'s usual OCR slips');
    assert.equal(P.parseNamedLabel('MilkyWay'), 'Milky Way');
    assert.equal(P.parseNamedLabel('Milky Way 42'), null);
    assert.equal(P.parseNamedLabel('Nillevz AA avs'), null);
    assert.equal(P.parseNamedLabel('M31'), null);
  });

  await t.test('whole info line (fallback when the "/" separators are not found)', () => {
    assert.deepEqual(P.parseInfo('Kyle Caulfield / 90° W, 39° N / 2026.10.03 22:43'),
      { photographer: 'Kyle Caulfield', latitude: 39, longitude: -90, captured_at: '2026-10-03T22:43' });
    // Bands where the app omits the name, or the location.
    assert.deepEqual(P.parseInfo('3.7° E, 40.4° N / 2025.12.24 01:05'),
      { photographer: null, latitude: 40.4, longitude: 3.7, captured_at: '2025-12-24T01:05' });
    assert.deepEqual(P.parseInfo('Ana Ruiz / 2025.12.24 01:05'),
      { photographer: 'Ana Ruiz', latitude: null, longitude: null, captured_at: '2025-12-24T01:05' });
    // No date at the end means the layout isn't understood: trust nothing.
    assert.deepEqual(P.parseInfo('garbage text with no date'),
      { photographer: null, latitude: null, longitude: null, captured_at: null });
  });

  await t.test('photographer: icon debris and stray star dots are stripped', () => {
    assert.equal(P.parseName(') Kyle Caulfield'), 'Kyle Caulfield');
    assert.equal(P.parseName('Kyle Caulfield.'), 'Kyle Caulfield');
    assert.equal(P.parseName('|'), null);
  });
});

test('reads real EXIF-less Seestar exports', { skip: OCR_SKIP }, async (t) => {
  const { readBand } = require(path.join(ROOT, 'lib', 'seestar_band'));
  const { shutdown } = require(path.join(ROOT, 'lib', 'seestar_ocr'));
  t.after(shutdown);

  for (const [file, want] of Object.entries(EXPECTED)) {
    await t.test(file, async () => {
      const got = await readBand(path.join(FIXTURES, file));
      const exp = { ...COMMON, ...want };
      assert.ok(got && got.found, 'band recognised');
      assert.equal(got.telescope, exp.telescope);
      assert.equal(got.target?.raw, exp.target);
      assert.equal(got.target?.object_type ?? null, exp.object_type ?? null);
      assert.equal(got.latitude, exp.latitude);
      assert.equal(got.longitude, exp.longitude);
      assert.equal(got.captured_at, exp.captured_at);
      assert.equal(got.exposure_seconds_total, exp.exposure_seconds_total);
      assert.equal(got.photographer, exp.photographer);
    });
  }

  await t.test('an image with no band yields nothing, not a guess', async () => {
    const sharp = require('sharp');
    const src = path.join(FIXTURES, 's50pro-ngc6960.jpg');
    const { width, height } = await sharp(src).metadata();
    const sky = path.join(os.tmpdir(), `dsl-sky-${process.pid}.jpg`);
    await sharp(src).extract({ left: 0, top: 0, width, height: Math.round(height * 0.6) }).toFile(sky);
    try {
      const got = await readBand(sky);
      assert.equal(got.found, false);
      for (const k of ['telescope', 'target', 'latitude', 'longitude', 'captured_at', 'exposure_seconds_total', 'photographer']) {
        assert.equal(got[k], null, `${k} must be null`);
      }
    } finally {
      fs.rmSync(sky, { force: true });
    }
  });
});

test('EXIF-less exports through the HTTP API', { skip: OCR_SKIP }, async (t) => {
  const PASSWORD = 'bandtest';
  const port = 8000 + Math.floor(Math.random() * 4000);
  const base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-band-'));
  const env = {
    ...process.env,
    PORT: String(port),
    ADMIN_PASSWORD: PASSWORD,
    DATABASE_PATH: path.join(dataDir, 'deepskylog.sqlite'),
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
    STAGE_DIR: path.join(dataDir, 'stage'),
    BACKUP_DIR: path.join(dataDir, 'backups'),
  };
  delete env.DISABLE_OCR;
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (b) => process.stderr.write(`[band-server] ${b}`));
  t.after(async () => {
    if (server.exitCode == null) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('close', r));
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.exitCode != null) throw new Error(`server exited with ${server.exitCode}`);
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 200));
  }

  const auth = { Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64') };
  const stage = async (file) => {
    const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(path.join(FIXTURES, file));
    const fd = new FormData();
    fd.set('image', new Blob([buf], { type: 'image/jpeg' }), 'IMG_0412.jpg');
    const res = await fetch(`${base}/api/admin/stage`, { method: 'POST', headers: auth, body: fd });
    assert.equal(res.status, 201);
    return res.json();
  };
  const finalize = async (body) => {
    const res = await fetch(`${base}/api/admin/observations`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(res.status, 201);
    const { id } = await res.json();
    return (await (await fetch(`${base}/api/observations/${id}`)).json()).observation;
  };

  await t.test('staging fills telescope, location and date', async () => {
  // The original bug: staging only ran watermark OCR when EXIF said
  // "Seestar", so these exports came back with every field empty.
  const staged = await stage('s50pro-ngc6960.jpg');
  assert.equal(staged.exif.device, null, 'fixture really has no EXIF device');
  assert.equal(staged.telescope_match, 'Seestar S50 Pro');
  assert.equal(staged.telescope_source, 'watermark');
  assert.equal(staged.exif.latitude, 39);
  assert.equal(staged.exif.longitude, -90);
  assert.equal(staged.guesses.coords_from_text, true);
  assert.equal(staged.exif.captured_at, '2026-10-03T22:43');
  assert.equal(staged.guesses.target?.raw, 'NGC6960');
  assert.equal(staged.guesses.total_exposure_seconds, 84 * 60);
  assert.equal(staged.guesses.photographer, 'Kyle Caulfield');
  assert.equal(staged.guesses.from_ocr, true);
  await fetch(`${base}/api/admin/stage/${staged.stage_id}`, { method: 'DELETE', headers: auth });
  });

  await t.test('finalize with only stage_id (iOS shortcut) fills the rest from the band', async () => {
    // Clients that finalize straight after staging never see the stage
    // response, so finalize has to read the band itself.
    const staged = await stage('s30pro-c18.jpg');
    const obs = await finalize({ stage_id: staged.stage_id });
    assert.equal(obs.telescope, 'Seestar S30 Pro');
    assert.equal(obs.latitude, 39);
    assert.equal(obs.longitude, -90);
    assert.equal(obs.observed_at, '2026-10-03T20:59');
    assert.equal(obs.catalog, 'C');
    assert.equal(obs.catalog_number, '18');
    assert.ok(obs.list_object_id, 'C18 resolved to its Caldwell list row');
    assert.equal(obs.exposure_seconds, 23 * 60);
  });

  await t.test('finalize keeps what the client sent, including deliberately cleared fields', async () => {
    // The upload form sends every key; null means the user cleared it.
    const staged = await stage('s30pro-ngc6210.jpg');
    const obs = await finalize({
      stage_id: staged.stage_id, telescope: '12" Dobsonian', observed_at: '2026-10-01T21:00',
      latitude: null, longitude: null, catalog: 'NGC', catalog_number: '6210', object_name: 'NGC 6210',
      exposure_seconds: null,
    });
    assert.equal(obs.telescope, '12" Dobsonian');
    assert.equal(obs.observed_at, '2026-10-01T21:00');
    assert.equal(obs.latitude, null, 'cleared latitude stays cleared');
    assert.equal(obs.longitude, null, 'cleared longitude stays cleared');
    assert.equal(obs.exposure_seconds, null);
  });

  await t.test('a Milky Way export is staged and saved as the Milky Way object type', async () => {
    const staged = await stage('s50pro-milkyway.jpg');
    assert.equal(staged.telescope_match, 'Seestar S50 Pro');
    assert.equal(staged.guesses.target?.raw, 'Milky Way');
    assert.equal(staged.guesses.target?.object_type, 'MW');
    assert.equal(staged.guesses.target?.catalog, null);
    assert.equal(staged.exif.object_name, 'Milky Way');
    assert.equal(staged.exif.captured_at, '2026-10-10T02:29');
    // The shortcut path: only stage_id, so finalize reads the band itself.
    const obs = await finalize({ stage_id: staged.stage_id });
    assert.equal(obs.object_type, 'MW');
    assert.equal(obs.object_name, 'Milky Way');
    assert.equal(obs.catalog, null);
    assert.equal(obs.observed_at, '2026-10-10T02:29');
    assert.equal(obs.telescope, 'Seestar S50 Pro');
  });

  await t.test('recent app EXIF (zeroed GPS, junk optics) no longer hides the watermark', async () => {
    // The live-server bug: newer Seestar app exports carry a GPS block of 0/0
    // rationals (exifr: NaN) and ExposureTime/FNumber/FocalLength ≈ 2.0000076.
    // NaN passed as "has GPS", so the band's coordinates were skipped and the
    // form said there was no location; the junk exposure beat the band's 91min.
    const { seestarExifJpeg } = require('./helpers/seestar-exif');
    const jpeg = seestarExifJpeg(fs.readFileSync(path.join(FIXTURES, 's50pro-ngc7000.jpg')));
    const staged = await stage(jpeg);
    assert.equal(staged.exif.device, 'ZWO');
    assert.equal(staged.telescope_match, 'Seestar S50 Pro');
    assert.equal(staged.exif.latitude, 39);
    assert.equal(staged.exif.longitude, -90);
    assert.equal(staged.guesses.coords_source, 'watermark');
    assert.equal(staged.exif.exposure_seconds, null);
    assert.equal(staged.guesses.total_exposure_seconds, 91 * 60);
    const obs = await finalize({ stage_id: staged.stage_id });
    assert.equal(obs.latitude, 39);
    assert.equal(obs.longitude, -90);
    assert.equal(obs.exposure_seconds, 91 * 60);
    assert.equal(obs.focal_length_mm, null);
  });

  await t.test('a default location in the watermark\'s degree square replaces its coarse reading', async () => {
    // The band prints whole degrees, truncated (42.0887, -87.9052 reads
    // "87° W, 42° N"), so a matching default location is the precise answer.
    const setDefault = async (lat, lon) => {
      const res = await fetch(`${base}/api/admin/settings`, {
        method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_latitude: lat, default_longitude: lon }),
      });
      assert.equal(res.status, 200);
    };
    await setDefault(39.985432, -90.068269);
    try {
      const staged = await stage('s50pro-ngc6960.jpg');
      assert.equal(staged.exif.latitude, 39.985432);
      assert.equal(staged.exif.longitude, -90.068269);
      assert.equal(staged.guesses.coords_source, 'watermark_default');
      assert.deepEqual(staged.guesses.watermark_coords, { latitude: 39, longitude: -90 });
      const obs = await finalize({ stage_id: staged.stage_id });
      assert.equal(obs.latitude, 39.985432);
      assert.equal(obs.longitude, -90.068269);

      // A default somewhere else never overrides what the watermark says.
      await setDefault(42.088682, -87.905189);
      const away = await stage('s30pro-c2.jpg');
      assert.equal(away.exif.latitude, 39);
      assert.equal(away.exif.longitude, -90);
      assert.equal(away.guesses.coords_source, 'watermark');
      const awayObs = await finalize({ stage_id: away.stage_id });
      assert.equal(awayObs.latitude, 39);
      assert.equal(awayObs.longitude, -90);
    } finally {
      await setDefault('', '');
    }
  });
});
