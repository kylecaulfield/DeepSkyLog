// One-time boot repair of observation dates that are really upload times
// (lib/repair_dates.js).
//
// The unit tests drive repairWatermarkDates() against a real migrated
// database with a stubbed watermark reader. The boot test starts the server
// on a database holding an upload-time row; with OCR it checks the date was
// replaced by the watermark's, without OCR that nothing changed and the pass
// is left to retry.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-dates-'));
process.env.DATABASE_PATH = path.join(tmp, 'unit.sqlite');
const { getDb } = require(path.join(ROOT, 'db'));
const { repairWatermarkDates, _parse: P } = require(path.join(ROOT, 'lib', 'repair_dates'));
const { moonPhase } = require(path.join(ROOT, 'lib', 'astro'));

const OCR_SKIP = process.env.DISABLE_OCR === '1'
  || !fs.existsSync(path.join(ROOT, 'vendor', 'tessdata', 'eng.traineddata.gz'));

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('date parsing and matching', async (t) => {
  await t.test('upload time: created_at on a whole-hour offset, up to 15 min after observed_at', () => {
    // Real rows: saved at 17:26:20 UTC with the form's "now" of 12:24 CDT.
    assert.deepEqual(P.uploadMatch('2026-10-03T12:24', '2026-10-03 17:26:20'),
      { upload: Date.UTC(2026, 9, 3, 12, 26), hours: -5 }); // seconds dropped
    assert.equal(P.uploadMatch('2026-10-03T12:34', '2026-10-03 17:41:09')?.hours, -5, '7 minutes in the form');
    // A date that was typed in (04:40, saved 15:08 UTC) is nowhere near.
    assert.equal(P.uploadMatch('2026-06-02T04:40', '2026-06-02 15:08:29'), null);
    assert.equal(P.uploadMatch('2026-10-03T12:00', '2026-10-03 17:43:00'), null, '43 minutes is not form-filling');
    // Zoned values are instants.
    assert.equal(P.uploadMatch('2026-10-03T12:43:00-05:00', '2026-10-03 17:43:27')?.hours, null);
    assert.ok(P.uploadMatch('2026-10-03T12:43:00-05:00', '2026-10-03 17:43:27'));
    assert.equal(P.uploadMatch('2026-10-02T22:39:00-05:00', '2026-10-03 17:43:27'), null);
    assert.equal(P.uploadMatch('last night', '2026-10-03 17:43:27'), null);
  });

  await t.test('EXIF capture time: the app note and raw DateTimeOriginal strings only', () => {
    assert.equal(P.exifCaptureTime(JSON.stringify({ OwnerName: '{"result":{"date":"2026-06-19 02:20:04","size_k":48}}' })), '2026-06-19T02:20');
    assert.equal(P.exifCaptureTime(JSON.stringify({ DateTimeOriginal: '2026.04.11 05:43:18' })), '2026-04-11T05:43');
    assert.equal(P.exifCaptureTime(JSON.stringify({ DateTimeOriginal: '2026:04:11 05:43:18' })), '2026-04-11T05:43');
    assert.equal(P.exifCaptureTime(JSON.stringify({ DateTimeOriginal: '2026-04-11T05:43:18.000Z' })), null, 'parsed at upload already');
    assert.equal(P.exifCaptureTime(JSON.stringify({ OwnerName: '\u0000\u0004junk' })), null);
    assert.equal(P.exifCaptureTime('not json'), null);
    // EXIF's empty-date placeholder and impossible dates are not capture times.
    assert.equal(P.exifCaptureTime(JSON.stringify({ DateTimeOriginal: '0000:00:00 00:00:00' })), null);
    assert.equal(P.exifCaptureTime(JSON.stringify({ DateTimeOriginal: '2026:02:30 10:00:00' })), null);
    assert.equal(P.parseWhen('2026-13-01T10:00'), null);
    assert.equal(P.parseWhen('2026-10-03T24:00'), null);
  });

  await t.test('watermark vs EXIF: minutes apart, or whole hours of time zone', () => {
    const at = (h, m) => Date.UTC(2026, 6, 12, h, m);
    assert.ok(P.sameCapture(at(2, 19), at(2, 20)));
    assert.ok(P.sameCapture(at(2, 22), at(3, 22)), 'an hour of time zone');
    assert.ok(!P.sameCapture(at(2, 22), at(2, 52)), 'half an hour is a misread');
    assert.ok(!P.sameCapture(at(2, 22), at(8, 22)), 'six hours is a misread');
  });

  await t.test('Seestar gate', () => {
    assert.ok(P.maybeSeestar(null));
    assert.ok(P.maybeSeestar(JSON.stringify({ Make: 'ZWO' })));
    assert.ok(P.maybeSeestar(JSON.stringify({ Software: 'iOS 18' })), 'no camera identity');
    assert.ok(!P.maybeSeestar(JSON.stringify({ Make: 'Canon', Model: 'EOS R6' })));
    assert.ok(!P.maybeSeestar(JSON.stringify({ fits: { DATE_OBS: '2026-01-01' } })));
    assert.ok(!P.maybeSeestar('[1,2]'));
  });
});

test('repairWatermarkDates', async (t) => {
  const db = getDb();
  const uploadDir = path.join(tmp, 'uploads');
  const backupDir = path.join(tmp, 'backups');
  fs.mkdirSync(path.join(uploadDir, '2026', '10'), { recursive: true });
  const quiet = { log() {}, warn() {} };

  const insert = db.prepare(
    `INSERT INTO observations (image_path, exif_json, observed_at, created_at, moon_phase, moon_phase_name)
     VALUES (@image_path, @exif_json, @observed_at, @created_at, 0.5, 'Full Moon')`,
  );
  let n = 0;
  const imageOf = new Map();
  // Defaults: a ZWO export saved at 17:43 UTC with the form's 12:41 CDT "now".
  const add = (row = {}) => {
    const image = row.image_path === undefined ? `2026/10/img-${++n}.jpg` : row.image_path;
    if (image && !image.startsWith('..')) fs.writeFileSync(path.join(uploadDir, image), 'jpeg');
    const id = insert.run({
      image_path: image, exif_json: JSON.stringify({ Make: 'ZWO' }),
      observed_at: '2026-10-03T12:41', created_at: '2026-10-03 17:43:00', ...row,
    }).lastInsertRowid;
    if (image) imageOf.set(String(id), path.join(uploadDir, image));
    return id;
  };
  const get = (id) => db.prepare('SELECT observed_at, moon_phase, moon_phase_name FROM observations WHERE id = ?').get(id);
  const reset = () => {
    db.prepare('DELETE FROM observations').run();
    db.prepare('DELETE FROM maintenance_runs').run();
  };
  const done = () => !!db.prepare("SELECT 1 FROM maintenance_runs WHERE name = 'watermark-dates-v1'").get();
  // Watermark reads by observation id; anything else has no band.
  const bandFor = (map) => async (p) => {
    const id = Object.keys(map).find((k) => imageOf.get(k) === p);
    return id ? map[id] : { found: false, captured_at: null };
  };

  await t.test('replaces an upload-time date with the watermark date and recomputes the moon', async () => {
    reset();
    const id = add();
    const res = await repairWatermarkDates({
      db, uploadDir, backupDir, log: quiet, readBand: async () => ({ found: true, captured_at: '2026-10-02T22:39' }),
    });
    const mp = moonPhase(new Date('2026-10-02T22:39'));
    assert.deepEqual(get(id), { observed_at: '2026-10-02T22:39', moon_phase: mp.phase, moon_phase_name: mp.name });
    assert.equal(res.corrected, 1);
    assert.ok(res.backup && fs.existsSync(res.backup), 'backed up before changing anything');
    assert.ok(done(), 'recorded so it never runs again');
  });

  await t.test('once recorded, later boots read nothing', async () => {
    const id = add();
    let reads = 0;
    const res = await repairWatermarkDates({ db, uploadDir, backupDir, log: quiet, readBand: async () => { reads++; return null; } });
    assert.equal(reads, 0);
    assert.equal(res.done, true);
    assert.equal(get(id).observed_at, '2026-10-03T12:41');
  });

  await t.test('typed dates, other cameras and FITS rows are not candidates', async () => {
    reset();
    const typed = add({ observed_at: '2026-10-02T21:00' });
    const dslr = add({ exif_json: JSON.stringify({ Make: 'Canon', Model: 'EOS R6' }) });
    const fits = add({ exif_json: JSON.stringify({ fits: { EXPTIME: 10 } }) });
    const noImage = add({ image_path: null });
    const reads = [];
    const res = await repairWatermarkDates({
      db, uploadDir, backupDir, log: quiet, readBand: async (p) => { reads.push(p); return { found: true, captured_at: '2026-10-02T22:39' }; },
    });
    assert.deepEqual(reads, []);
    for (const id of [typed, dslr, fits, noImage]) assert.notEqual(get(id).observed_at, '2026-10-02T22:39');
    assert.equal(res.backup, null, 'no backup when nothing changes');
    assert.ok(done());
  });

  await t.test('cross-checks the watermark against the EXIF capture time', async () => {
    reset();
    const note = (date) => JSON.stringify({ Make: 'ZWO', OwnerName: JSON.stringify({ result: { date } }) });
    const agree = add({ exif_json: note('2026-10-02 22:40:05') });        // watermark 22:39
    const zoneHour = add({ exif_json: note('2026-10-02 23:39:30') });     // an hour of time zone
    const conflict = add({ exif_json: note('2026-10-02 19:10:00') });     // a misread somewhere
    const misreadLate = add({ exif_json: note('2026-06-19 04:00:05') });  // watermark read as after the upload
    const exifOnly = add({ exif_json: JSON.stringify({ Make: 'ZWO', DateTimeOriginal: '2026.04.11 05:43:18' }) });
    const nothing = add();
    const res = await repairWatermarkDates({
      db, uploadDir, backupDir, log: quiet,
      readBand: bandFor({
        [agree]: { found: true, captured_at: '2026-10-02T22:39' },
        [zoneHour]: { found: true, captured_at: '2026-10-02T22:39' },
        [conflict]: { found: true, captured_at: '2026-10-02T22:39' },
        [misreadLate]: { found: true, captured_at: '2026-10-19T04:00' },
      }),
    });
    assert.equal(get(agree).observed_at, '2026-10-02T22:39');
    assert.equal(get(zoneHour).observed_at, '2026-10-02T22:39', 'the watermark wins a time-zone difference');
    assert.equal(get(conflict).observed_at, '2026-10-03T12:41', 'disagreement: left alone');
    assert.equal(get(misreadLate).observed_at, '2026-06-19T04:00', 'a later-than-upload watermark falls back to EXIF');
    assert.equal(get(exifOnly).observed_at, '2026-04-11T05:43', 'no watermark date: EXIF');
    assert.equal(get(nothing).observed_at, '2026-10-03T12:41');
    assert.equal(res.corrected, 4);
    assert.equal(res.fromExif, 2);
    assert.equal(res.conflicting, 1);
    assert.equal(res.unreadable, 1);
  });

  await t.test('only the uploader\'s own time zone counts as an upload time', async () => {
    reset();
    // Three uploads at UTC-5, and a date that only lines up with UTC-12.
    const home = [add(), add(), add()];
    const faraway = add({ observed_at: '2026-10-03T05:41' });
    const reads = [];
    await repairWatermarkDates({
      db, uploadDir, backupDir, log: quiet, readBand: async (p) => { reads.push(p); return { found: true, captured_at: '2026-10-02T22:39' }; },
    });
    for (const id of home) assert.equal(get(id).observed_at, '2026-10-02T22:39');
    assert.equal(get(faraway).observed_at, '2026-10-03T05:41');
    assert.equal(reads.length, 3);
  });

  await t.test('OCR unavailable: nothing changes and the next boot retries', async () => {
    reset();
    const id = add({ exif_json: JSON.stringify({ Make: 'ZWO', DateTimeOriginal: '2026.10.02 22:39:00' }) });
    const res = await repairWatermarkDates({ db, uploadDir, backupDir, log: quiet, readBand: async () => null });
    assert.equal(get(id).observed_at, '2026-10-03T12:41', 'waits for OCR to cross-check');
    assert.equal(res.ocrUnavailable, 1);
    assert.ok(!done());
    await repairWatermarkDates({ db, uploadDir, backupDir, log: quiet, readBand: async () => ({ found: true, captured_at: '2026-10-02T22:39' }) });
    assert.equal(get(id).observed_at, '2026-10-02T22:39');
    assert.ok(done());
  });

  await t.test('a date edited while the watermark is read is kept', async () => {
    reset();
    const id = add();
    await repairWatermarkDates({
      db, uploadDir, backupDir, log: quiet,
      readBand: async () => {
        db.prepare("UPDATE observations SET observed_at = '2026-10-01T20:00' WHERE id = ?").run(id);
        return { found: true, captured_at: '2026-10-02T22:39' };
      },
    });
    assert.equal(get(id).observed_at, '2026-10-01T20:00');
  });

  await t.test('an image path outside the upload dir is never read', async () => {
    reset();
    fs.writeFileSync(path.join(tmp, 'outside.jpg'), 'jpeg');
    const id = add({ image_path: '../outside.jpg' });
    const reads = [];
    await repairWatermarkDates({ db, uploadDir, backupDir, log: quiet, readBand: async (p) => { reads.push(p); return null; } });
    assert.deepEqual(reads, []);
    assert.equal(get(id).observed_at, '2026-10-03T12:41');
  });

  await t.test('nothing changes, and nothing is recorded, when the backup fails', async () => {
    reset();
    const id = add();
    const notADir = path.join(tmp, 'a-file');
    fs.writeFileSync(notADir, '');
    const warnings = [];
    await repairWatermarkDates({
      db, uploadDir, backupDir: path.join(notADir, 'backups'),
      log: { log() {}, warn: (m) => warnings.push(m) },
      readBand: async () => ({ found: true, captured_at: '2026-10-02T22:39' }),
    });
    assert.equal(get(id).observed_at, '2026-10-03T12:41');
    assert.ok(!done());
    assert.match(warnings.join('\n'), /date repair failed/);
  });
});

test('the server repairs upload-time dates on boot', async (t) => {
  const dataDir = path.join(tmp, 'boot');
  const dbPath = path.join(dataDir, 'deepskylog.sqlite');
  const uploadDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(path.join(uploadDir, '2026', '10'), { recursive: true });
  const rel = '2026/10/ngc7000.jpg';
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'seestar-bands', 's50pro-ngc7000.jpg'), path.join(uploadDir, rel));

  const init = spawnSync(process.execPath, ['-e', "require('./db').getDb()"], {
    cwd: ROOT, env: { ...process.env, DATABASE_PATH: dbPath },
  });
  assert.equal(init.status, 0, init.stderr?.toString());
  const Database = require('better-sqlite3');
  const seed = new Database(dbPath);
  // An EXIF-less export saved through the shortcut on 2026-10-05 with the
  // phone's "now" (12:00 CDT); the band says 2026.10.04 02:08.
  const { lastInsertRowid: id } = seed.prepare(
    `INSERT INTO observations (image_path, observed_at, created_at, telescope)
     VALUES (?, '2026-10-05T12:00', '2026-10-05 17:01:00', 'Seestar S50 Pro')`,
  ).run(rel);
  seed.close();

  const port = 16000 + Math.floor(Math.random() * 4000);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(port), ADMIN_PASSWORD: 'datetest', DATABASE_PATH: dbPath,
      UPLOAD_DIR: uploadDir, STAGE_DIR: path.join(dataDir, 'stage'), BACKUP_DIR: path.join(dataDir, 'backups'),
      DISABLE_OCR: OCR_SKIP ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (b) => { output += b; });
  server.stderr.on('data', (b) => { output += b; });
  t.after(async () => {
    if (server.exitCode == null && server.signalCode == null) {
      server.kill('SIGTERM');
      await new Promise((r) => server.once('close', r));
    }
  });

  const deadline = Date.now() + 90_000;
  while (!/Watermark date repair/.test(output)) {
    if (server.exitCode != null || server.signalCode != null) {
      throw new Error(`server exited (${server.exitCode ?? server.signalCode}):\n${output}`);
    }
    if (Date.now() > deadline) throw new Error(`no date repair logged:\n${output}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const { observation: obs } = await (await fetch(`http://127.0.0.1:${port}/api/observations/${id}`)).json();
  const check = new Database(dbPath, { readonly: true });
  const recorded = check.prepare("SELECT 1 FROM maintenance_runs WHERE name = 'watermark-dates-v1'").get();
  check.close();
  if (OCR_SKIP) {
    assert.equal(obs.observed_at, '2026-10-05T12:00', 'no OCR: unchanged');
    assert.ok(!recorded, 'no OCR: retried next boot');
  } else {
    assert.equal(obs.observed_at, '2026-10-04T02:08');
    assert.equal(obs.moon_phase_name, moonPhase(new Date('2026-10-04T02:08')).name);
    assert.ok(recorded);
  }
});
