// Unit test for the shared table-sort helper in public/js/common.js.
//
// common.js is browser ESM (loaded via <script type="module">), but the repo
// is "type": "commonjs", so Node can't import it directly. Instead we read the
// source, strip the `export` keywords, and run it in a vm context with a tiny
// DOM shim — enough to exercise the real sort algorithm (numeric detection,
// nulls sinking, data-sort precedence, direction toggle) without a browser or
// any extra dependency.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCommon() {
  const src = fs
    .readFileSync(path.resolve(__dirname, '..', 'public', 'js', 'common.js'), 'utf8')
    .replace(/^export /gm, '');
  // MutationObserver is the only global the helper touches at call time; a
  // no-op shim is fine because the test drives sorting through the click
  // handlers directly rather than through DOM mutations.
  class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  const context = { MutationObserver, Date, Number, Math, console };
  vm.createContext(context);
  vm.runInContext(src, context);
  return context;
}

// --- minimal DOM shim ----------------------------------------------------

class ClassList {
  constructor() { this._s = new Set(); }
  add(...c) { c.forEach((x) => this._s.add(x)); }
  remove(...c) { c.forEach((x) => this._s.delete(x)); }
  contains(c) { return this._s.has(c); }
}
class Cell {
  constructor(text, attrs = {}) {
    this.textContent = text;
    this._attrs = { ...attrs };
    this.classList = new ClassList();
    this._listeners = {};
  }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  removeAttribute(k) { delete this._attrs[k]; }
  hasAttribute(k) { return k in this._attrs; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  dispatch(type, ev = {}) { (this._listeners[type] || []).forEach((fn) => fn(ev)); }
}
class Row { constructor(cells) { this.cells = cells; } }
class TBody {
  constructor(rows) { this._rows = rows; }
  get rows() { return this._rows; }
  appendChild(row) {
    const i = this._rows.indexOf(row);
    if (i >= 0) this._rows.splice(i, 1);
    this._rows.push(row);
  }
}

function makeTable(headers, rowDefs) {
  const headerCells = headers.map((h) => new Cell(h));
  const rows = rowDefs.map((cells) => new Row(
    cells.map((c) => (Array.isArray(c) ? new Cell(c[0], c[1]) : new Cell(c))),
  ));
  const tbody = new TBody(rows);
  return {
    table: { tHead: { rows: [{ cells: headerCells }] }, tBodies: [tbody] },
    headerCells,
    tbody,
  };
}

const order = (tbody, col = 0) => tbody.rows.map((r) => r.cells[col].textContent);

test('catalogSortKey orders by catalog then numeric value', () => {
  const { catalogSortKey } = loadCommon();
  const ids = [['M', 1], ['M', 10], ['M', 2], ['M', 110], ['C', 9], ['Sh2', '275b'], ['Sh2', '275']];
  const sorted = ids
    .map(([c, n]) => [c + n, catalogSortKey(c, n)])
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map((x) => x[0]);
  assert.deepEqual(sorted, ['C9', 'M1', 'M2', 'M10', 'M110', 'Sh2275', 'Sh2275b']);
});

test('makeTableSortable sorts numeric column, nulls sink, direction toggles', () => {
  const { makeTableSortable } = loadCommon();
  const { table, headerCells, tbody } = makeTable(
    ['Name', 'Mag'],
    [
      ['Beta', '8.0'],
      ['alpha', '2.5'],
      ['Gamma', '—'],   // null magnitude
      ['delta', '12.0'],
    ],
  );
  makeTableSortable(table);

  // Ascending by Mag: 2.5, 8.0, 12.0, then the dash sinks to the bottom.
  headerCells[1].dispatch('click');
  assert.deepEqual(order(tbody, 1), ['2.5', '8.0', '12.0', '—']);
  assert.ok(headerCells[1].classList.contains('sort-asc'));

  // Second click flips to descending; the null still sinks to the bottom.
  headerCells[1].dispatch('click');
  assert.deepEqual(order(tbody, 1), ['12.0', '8.0', '2.5', '—']);
  assert.ok(headerCells[1].classList.contains('sort-desc'));
});

test('makeTableSortable sorts text case-insensitively and honours data-sort', () => {
  const { makeTableSortable } = loadCommon();
  const { table, headerCells, tbody } = makeTable(
    ['Object', 'Name'],
    [
      [['M10', { 'data-sort': 'M 0000010' }], 'Ten'],
      [['M2', { 'data-sort': 'M 0000002' }], 'Two'],
      [['M1', { 'data-sort': 'M 0000001' }], 'One'],
    ],
  );
  makeTableSortable(table);

  // data-sort drives the order even though the visible text would sort
  // M1, M10, M2 lexically.
  headerCells[0].dispatch('click');
  assert.deepEqual(order(tbody, 0), ['M1', 'M2', 'M10']);

  // Name column falls back to case-insensitive text sort.
  headerCells[1].dispatch('click');
  assert.deepEqual(order(tbody, 1), ['One', 'Ten', 'Two']);
});

test('makeTableSortable skips data-nosort and empty headers', () => {
  const { makeTableSortable } = loadCommon();
  const { table, headerCells } = makeTable(
    ['', 'Name', 'Actions'],
    [['x', 'b', 'edit'], ['y', 'a', 'edit']],
  );
  headerCells[2].setAttribute('data-nosort', '');
  makeTableSortable(table);
  // Empty header (col 0) and data-nosort header (col 2) are not enhanced.
  assert.ok(!headerCells[0].classList.contains('sortable'));
  assert.ok(headerCells[1].classList.contains('sortable'));
  assert.ok(!headerCells[2].classList.contains('sortable'));
});
