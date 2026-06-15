export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatRA(hours) {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const mFloat = (hours - h) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s}s`;
}

export function formatDec(degrees) {
  if (degrees == null) return '—';
  const sign = degrees < 0 ? '-' : '+';
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(0);
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

export const OBJECT_TYPES = {
  GC: 'Globular Cluster',
  OC: 'Open Cluster',
  PN: 'Planetary Nebula',
  SNR: 'Supernova Remnant',
  DN: 'Diffuse Nebula',
  GAL: 'Galaxy',
  MW: 'Star Cloud',
  AST: 'Asterism',
  DS: 'Double Star',
  STAR: 'Star',
  MOON: 'Moon',
  PLAN: 'Planet',
  COMET: 'Comet',
};

export function typeLabel(code) {
  if (!code) return '—';
  return OBJECT_TYPES[code] || code;
}

export function highlightNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

// Build a sort key for a catalog designation so "M1, M2, M10" order by their
// numeric part instead of lexically ("M1, M10, M2"). Groups by catalog first,
// then by the leading number zero-padded, keeping any non-numeric suffix
// ("275b"). Feed the result into a cell's data-sort attribute.
export function catalogSortKey(catalog, number) {
  const cat = String(catalog || '').toUpperCase();
  const num = String(number ?? '');
  const m = num.match(/^(\d+)(.*)$/);
  const padded = m ? m[1].padStart(7, '0') + m[2] : num;
  return `${cat} ${padded}`;
}

// Make a <table>'s header cells click-to-sort. Each header cell (skipping
// empty ones and any marked data-nosort) becomes a toggle: first click sorts
// ascending, second descending. A row's value for a column comes from that
// <td>'s data-sort attribute when present, otherwise it's inferred from the
// cell text — numeric when the text parses as a number (after stripping
// °, %, × and commas), else a case-insensitive string. Blank/"—" cells and
// ragged rows (colspan placeholders) always sink to the bottom. The active
// sort is re-applied automatically when the page rebuilds the <tbody>.
export function makeTableSortable(table) {
  if (!table || table._sortableInit) return;
  const headRow = table.tHead && table.tHead.rows[0];
  const tbody = table.tBodies[0];
  if (!headRow || !tbody) return;
  table._sortableInit = true;

  const ths = [...headRow.cells];
  const colCount = ths.length;
  let activeIndex = -1;
  let dir = 'asc';

  function valueOf(row, idx) {
    if (row.cells.length !== colCount) return null; // placeholder / colspan row
    const cell = row.cells[idx];
    if (!cell) return null;
    const ds = cell.getAttribute('data-sort');
    if (ds != null) {
      if (ds === '') return null;
      const n = Number(ds);
      return Number.isFinite(n) ? n : ds.toLowerCase();
    }
    const text = (cell.textContent || '').trim();
    if (text === '' || text === '—') return null;
    const cleaned = text.replace(/[,%°×]/g, '').replace(/\s+/g, '');
    if (cleaned !== '' && Number.isFinite(Number(cleaned))) return Number(cleaned);
    return text.toLowerCase();
  }

  const mo = new MutationObserver(() => {
    if (activeIndex >= 0) applySort();
  });

  function applySort() {
    const rows = [...tbody.rows];
    if (rows.length >= 2) {
      const factor = dir === 'asc' ? 1 : -1;
      const decorated = rows.map((row, i) => ({ row, i, val: valueOf(row, activeIndex) }));
      decorated.sort((a, b) => {
        if (a.val == null && b.val == null) return a.i - b.i;
        if (a.val == null) return 1;   // nulls sink regardless of direction
        if (b.val == null) return -1;
        if (a.val < b.val) return -1 * factor;
        if (a.val > b.val) return 1 * factor;
        return a.i - b.i;              // stable
      });
      // Reorder without retriggering our own observer.
      mo.disconnect();
      for (const d of decorated) tbody.appendChild(d.row);
      mo.takeRecords();
      mo.observe(tbody, { childList: true });
    }
    ths.forEach((th, i) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (i === activeIndex) {
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  ths.forEach((th, idx) => {
    if (th.hasAttribute('data-nosort') || !th.textContent.trim()) return;
    th.classList.add('sortable');
    th.setAttribute('role', 'button');
    th.setAttribute('tabindex', '0');
    const trigger = () => {
      if (activeIndex === idx) dir = dir === 'asc' ? 'desc' : 'asc';
      else { activeIndex = idx; dir = 'asc'; }
      applySort();
    };
    th.addEventListener('click', trigger);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
    });
  });

  mo.observe(tbody, { childList: true });
}

// Star-Trek-flavoured stardate, using the popular post-2000 calendar formula:
//   stardate = (year - 2000) * 1000 + day_of_year / days_in_year * 1000
// Lands in the TNG-ish 26000s for 2026, climbs about 1000 per Earth year.
export function stardate(date = new Date()) {
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const fraction = (date.getTime() - yearStart) / (yearEnd - yearStart);
  return ((year - 2000) * 1000 + fraction * 1000).toFixed(1);
}
