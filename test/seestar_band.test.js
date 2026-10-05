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
      assert.ok(got && got.found, 'band recognised');
      assert.equal(got.telescope, want.telescope);
      assert.equal(got.target?.raw, want.target);
      assert.equal(got.latitude, COMMON.latitude);
      assert.equal(got.longitude, COMMON.longitude);
      assert.equal(got.captured_at, want.captured_at);
      assert.equal(got.exposure_seconds_total, want.exposure_seconds_total);
      assert.equal(got.photographer, COMMON.photographer);
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

test('staging an EXIF-less export fills telescope, location and date', { skip: OCR_SKIP }, async (t) => {
  // The original bug: staging only ran watermark OCR when EXIF said
  // "Seestar", so these exports came back with every field empty.
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
  const fd = new FormData();
  fd.set('image', new Blob([fs.readFileSync(path.join(FIXTURES, 's50pro-ngc6960.jpg'))], { type: 'image/jpeg' }), 'IMG_0412.jpg');
  const res = await fetch(`${base}/api/admin/stage`, { method: 'POST', headers: auth, body: fd });
  assert.equal(res.status, 201);
  const staged = await res.json();
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
