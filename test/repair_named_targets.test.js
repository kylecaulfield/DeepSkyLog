// Named targets ("Milky Way") in the metadata parsers, and the one-time boot
// repair that gives observations already named after one their object type
// (lib/repair_named_targets.js). No OCR needed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-named-'));
process.env.DATABASE_PATH = path.join(tmp, 'unit.sqlite');
const { getDb } = require(path.join(ROOT, 'db'));
const { repairNamedTargetTypes } = require(path.join(ROOT, 'lib', 'repair_named_targets'));
const { parseTarget, parseFilename, namedTargetExact } = require(path.join(ROOT, 'lib', 'seestar_meta'));

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('named targets in the metadata parsers', () => {
  const mw = { catalog: null, number: null, raw: 'Milky Way', name: 'Milky Way', object_type: 'MW' };
  assert.deepEqual(parseTarget('Milky Way'), mw);
  assert.deepEqual(parseTarget('Seestar S50 Pro  Milky Way\nKyle Caulfield / 90° W, 39° N / 2026.10.10 02:29'), mw,
    'whole-band OCR text');
  assert.deepEqual(parseFilename('Stacked_30_Milky Way_10.0s_IRCUT_20261010-023000.jpg').target, mw);
  // A catalog id still wins, and other words are not targets.
  assert.deepEqual(parseTarget('M 31'), { catalog: 'M', number: '31', raw: 'M31' });
  assert.equal(parseTarget('Moon'), null);
  assert.equal(namedTargetExact('Milky way')?.object_type, 'MW');
  assert.equal(namedTargetExact('The Milky Way'), null, 'exact names only');
});

test('repairNamedTargetTypes', async (t) => {
  const db = getDb();
  const backupDir = path.join(tmp, 'backups');
  const quiet = { log() {}, warn() {} };
  const add = (row) => db.prepare(
    `INSERT INTO observations (object_name, object_type, catalog, catalog_number)
     VALUES (@object_name, @object_type, @catalog, @catalog_number)`,
  ).run({ object_type: null, catalog: null, catalog_number: null, ...row }).lastInsertRowid;
  const typeOf = (id) => db.prepare('SELECT object_type FROM observations WHERE id = ?').get(id).object_type;

  await t.test('fills an empty type on rows named exactly after a named target', async () => {
    const plain = add({ object_name: 'Milky Way' });
    const lower = add({ object_name: '  milky way ' });
    const chosen = add({ object_name: 'Milky Way', object_type: 'DN' });
    const catalogued = add({ object_name: 'Milky Way', catalog: 'M', catalog_number: '24' });
    const sentence = add({ object_name: 'Milky Way over the barn' });
    const other = add({ object_name: 'Andromeda' });
    const res = await repairNamedTargetTypes({ db, backupDir, log: quiet });
    assert.equal(typeOf(plain), 'MW');
    assert.equal(typeOf(lower), 'MW');
    assert.equal(typeOf(chosen), 'DN', 'a type someone chose is kept');
    assert.equal(typeOf(catalogued), null, 'catalogued rows are left to their list');
    assert.equal(typeOf(sentence), null);
    assert.equal(typeOf(other), null);
    assert.equal(res.classified, 2);
    assert.ok(res.backup && fs.existsSync(res.backup), 'backed up first');
    assert.ok(res.done);
  });

  await t.test('runs once', async () => {
    const later = add({ object_name: 'Milky Way' });
    const res = await repairNamedTargetTypes({ db, backupDir, log: quiet });
    assert.equal(res.classified, 0);
    assert.equal(typeOf(later), null);
  });
});
