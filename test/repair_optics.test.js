// Boot-time repair of observations saved with the junk EXIF optics of recent
// Seestar exports (lib/repair_optics.js).
//
// The unit tests drive repairJunkOptics() against a real migrated database
// with a stubbed watermark reader. The boot test starts the server on a
// database that already holds a junk row and checks the repair ran; with
// OCR available it also checks the exposure was re-read from the watermark.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-repair-'));
process.env.DATABASE_PATH = path.join(tmp, 'unit.sqlite');
const { getDb } = require(path.join(ROOT, 'db'));
const { repairJunkOptics } = require(path.join(ROOT, 'lib', 'repair_optics'));
const { seestarExifJpeg } = require('./helpers/seestar-exif');

// What exifr reads ExposureTime / FNumber / FocalLength as on those exports.
const JUNK = 262145 / 131072;
const JUNK_EXIF = JSON.stringify({ Make: 'ZWO', ExposureTime: JUNK, FNumber: JUNK, FocalLength: JUNK, latitude: null, longitude: null });
const GOOD_EXIF = JSON.stringify({ Make: 'ZWO', Model: 'Seestar S50', ExposureTime: 980, FNumber: 5, FocalLength: 250 });

const OCR_SKIP = process.env.DISABLE_OCR === '1'
  || !fs.existsSync(path.join(ROOT, 'vendor', 'tessdata', 'eng.traineddata.gz'));

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('repairJunkOptics', async (t) => {
  const db = getDb();
  const uploadDir = path.join(tmp, 'uploads');
  const backupDir = path.join(tmp, 'backups');
  fs.mkdirSync(path.join(uploadDir, '2026', '10'), { recursive: true });
  const quiet = { log() {}, warn() {} };

  const insert = db.prepare(
    `INSERT INTO observations (image_path, exif_json, exposure_seconds, focal_length_mm, aperture)
     VALUES (@image_path, @exif_json, @exposure_seconds, @focal_length_mm, @aperture)`,
  );
  const add = (row) => {
    const image = row.image_path === undefined ? `2026/10/img-${Math.random().toString(36).slice(2)}.jpg` : row.image_path;
    if (image && !image.startsWith('..')) fs.writeFileSync(path.join(uploadDir, image), 'jpeg');
    return insert.run({
      image_path: image, exif_json: JUNK_EXIF,
      exposure_seconds: JUNK, focal_length_mm: JUNK, aperture: JUNK, ...row,
    }).lastInsertRowid;
  };
  const get = (id) => db.prepare('SELECT exposure_seconds, focal_length_mm, aperture FROM observations WHERE id = ?').get(id);
  const backups = () => (fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite')) : []);
  const reset = () => db.prepare('DELETE FROM observations').run();

  await t.test('restores exposure from the watermark and clears focal length / aperture', async () => {
    reset();
    const id = add({});
    const reads = [];
    const res = await repairJunkOptics({
      db, uploadDir, backupDir, log: quiet,
      readBand: async (p) => { reads.push(p); return { found: true, exposure_seconds_total: 91 * 60 }; },
    });
    assert.deepEqual(get(id), { exposure_seconds: 91 * 60, focal_length_mm: null, aperture: null });
    assert.equal(reads.length, 1);
    assert.ok(reads[0].startsWith(uploadDir + path.sep));
    assert.equal(res.repaired, 1);
    assert.equal(res.restored, 1);
    assert.equal(res.cleared, 0);
    assert.ok(res.backup && fs.existsSync(res.backup), 'backed up before changing anything');
    const Database = require('better-sqlite3');
    const snap = new Database(res.backup, { readonly: true });
    try {
      assert.equal(snap.prepare('SELECT exposure_seconds FROM observations WHERE id = ?').get(id).exposure_seconds, JUNK,
        'the backup holds the pre-repair values');
    } finally { snap.close(); }
  });

  await t.test('a second run finds nothing: no reads, no new backup', async () => {
    const before = backups().length;
    let reads = 0;
    const res = await repairJunkOptics({ db, uploadDir, backupDir, log: quiet, readBand: async () => { reads++; return null; } });
    assert.equal(res.repaired, 0);
    assert.equal(res.backup, null);
    assert.equal(reads, 0);
    assert.equal(backups().length, before);
  });

  await t.test('values the user corrected are kept; only junk columns change', async () => {
    reset();
    const edited = add({ exposure_seconds: 600 });
    const good = add({ exif_json: GOOD_EXIF, exposure_seconds: 980, focal_length_mm: 250, aperture: 5 });
    // Real EXIF that happens to share the junk number in one column is not the signature.
    const lookalike = add({ exif_json: GOOD_EXIF, exposure_seconds: JUNK, focal_length_mm: 250, aperture: 5 });
    const fits = add({ exif_json: JSON.stringify({ fits: { EXPTIME: 10 } }) });
    const broken = add({ exif_json: '{"ExposureTime": nope' });
    let reads = 0;
    const res = await repairJunkOptics({ db, uploadDir, backupDir, log: quiet, readBand: async () => { reads++; return null; } });
    assert.deepEqual(get(edited), { exposure_seconds: 600, focal_length_mm: null, aperture: null });
    assert.equal(reads, 0, 'no watermark read when the exposure is not junk');
    assert.deepEqual(get(good), { exposure_seconds: 980, focal_length_mm: 250, aperture: 5 });
    assert.deepEqual(get(lookalike), { exposure_seconds: JUNK, focal_length_mm: 250, aperture: 5 });
    assert.deepEqual(get(fits), { exposure_seconds: JUNK, focal_length_mm: JUNK, aperture: JUNK });
    assert.deepEqual(get(broken), { exposure_seconds: JUNK, focal_length_mm: JUNK, aperture: JUNK });
    assert.equal(res.repaired, 1);
  });

  await t.test('exposure is cleared when the watermark is unreadable or OCR is unavailable', async () => {
    reset();
    const noBand = add({});
    const noOcr = add({});
    const missingFile = add({ image_path: '2026/10/gone.jpg' });
    fs.rmSync(path.join(uploadDir, '2026/10/gone.jpg'));
    const pathOf = (id) => path.join(uploadDir, db.prepare('SELECT image_path FROM observations WHERE id = ?').get(id).image_path);
    // No band found in one image; OCR unavailable (null) for the other. The
    // missing file is never handed to the reader at all.
    const reads = [];
    const res = await repairJunkOptics({
      db, uploadDir, backupDir, log: quiet,
      readBand: async (p) => { reads.push(p); return p === pathOf(noBand) ? { found: false, exposure_seconds_total: null } : null; },
    });
    assert.deepEqual(reads.sort(), [pathOf(noBand), pathOf(noOcr)].sort());
    for (const id of [noBand, noOcr, missingFile]) {
      assert.deepEqual(get(id), { exposure_seconds: null, focal_length_mm: null, aperture: null });
    }
    assert.equal(res.repaired, 3);
    assert.equal(res.cleared, 3);
  });

  await t.test('an image path outside the upload dir is never read', async () => {
    reset();
    const id = add({ image_path: '../../etc/passwd' });
    const reads = [];
    await repairJunkOptics({ db, uploadDir, backupDir, log: quiet, readBand: async (p) => { reads.push(p); return null; } });
    assert.deepEqual(reads, []);
    assert.equal(get(id).exposure_seconds, null);
  });

  await t.test('an exposure edited while the watermark is read is not overwritten', async () => {
    reset();
    const id = add({});
    await repairJunkOptics({
      db, uploadDir, backupDir, log: quiet,
      readBand: async () => {
        db.prepare('UPDATE observations SET exposure_seconds = 1234 WHERE id = ?').run(id);
        return { found: true, exposure_seconds_total: 91 * 60 };
      },
    });
    assert.deepEqual(get(id), { exposure_seconds: 1234, focal_length_mm: null, aperture: null });
  });

  await t.test('nothing changes when the backup cannot be written', async () => {
    reset();
    const id = add({});
    const notADir = path.join(tmp, 'a-file');
    fs.writeFileSync(notADir, '');
    const warnings = [];
    let reads = 0;
    const res = await repairJunkOptics({
      db, uploadDir, backupDir: path.join(notADir, 'backups'),
      log: { log() {}, warn: (m) => warnings.push(m) },
      readBand: async () => { reads++; return { exposure_seconds_total: 60 }; },
    });
    assert.equal(res.repaired, 0);
    assert.equal(reads, 0);
    assert.deepEqual(get(id), { exposure_seconds: JUNK, focal_length_mm: JUNK, aperture: JUNK });
    assert.match(warnings.join('\n'), /could not back up/);
  });
});

test('the server repairs junk rows on boot', async (t) => {
  const dataDir = path.join(tmp, 'boot');
  const dbPath = path.join(dataDir, 'deepskylog.sqlite');
  const uploadDir = path.join(dataDir, 'uploads');
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(path.join(uploadDir, '2026', '10'), { recursive: true });

  // A row as finalize saved it before the fix: a real Seestar band with the
  // broken EXIF block, its junk optics, and that EXIF as exif_json.
  const exifr = require('exifr');
  const jpeg = seestarExifJpeg(fs.readFileSync(path.join(__dirname, 'fixtures', 'seestar-bands', 's50pro-ngc7000.jpg')));
  const rel = '2026/10/ngc7000.jpeg';
  fs.writeFileSync(path.join(uploadDir, rel), jpeg);
  const exif = await exifr.parse(jpeg, { gps: true });
  assert.equal(exif.ExposureTime, JUNK, 'the helper reproduces the junk EXIF');
  const init = spawnSync(process.execPath, ['-e', "require('./db').getDb()"], {
    cwd: ROOT, env: { ...process.env, DATABASE_PATH: dbPath },
  });
  assert.equal(init.status, 0, init.stderr?.toString());
  const Database = require('better-sqlite3');
  const seed = new Database(dbPath);
  const { lastInsertRowid: id } = seed.prepare(
    `INSERT INTO observations (image_path, exif_json, exposure_seconds, focal_length_mm, aperture, telescope)
     VALUES (?, ?, ?, ?, ?, 'Seestar S50 Pro')`,
  ).run(rel, JSON.stringify(exif), exif.ExposureTime, exif.FocalLength, exif.FNumber);
  seed.close();

  const port = 12000 + Math.floor(Math.random() * 4000);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), ADMIN_PASSWORD: 'repairtest', DATABASE_PATH: dbPath,
      UPLOAD_DIR: uploadDir, STAGE_DIR: path.join(dataDir, 'stage'), BACKUP_DIR: backupDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (b) => { output += b; });
  server.stderr.on('data', (b) => { output += b; });
  t.after(async () => {
    if (server.exitCode == null) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('close', r));
    }
  });

  const deadline = Date.now() + 90_000;
  while (!/Repaired junk EXIF/.test(output)) {
    if (server.exitCode != null) throw new Error(`server exited with ${server.exitCode}:\n${output}`);
    if (Date.now() > deadline) throw new Error(`no repair logged:\n${output}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const { observation: obs } = await (await fetch(`http://127.0.0.1:${port}/api/observations/${id}`)).json();
  assert.equal(obs.focal_length_mm, null);
  assert.equal(obs.aperture, null);
  // The band says 91min; without OCR the junk is cleared instead.
  assert.equal(obs.exposure_seconds, OCR_SKIP ? null : 91 * 60);
  assert.equal(fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite')).length, 1);
});
