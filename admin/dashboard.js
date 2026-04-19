const STAT_ORDER = [
  ['observations', 'Observations'],
  ['photos', 'Photos'],
  ['distinct_objects', 'Objects observed'],
  ['distinct_telescopes', 'Telescopes used'],
  ['avg_rating', 'Average rating'],
];

function fmtStat(key, value) {
  if (value == null) return '—';
  if (key === 'avg_rating') return Number(value).toFixed(2);
  return String(value);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function renderStats(totals) {
  const grid = document.getElementById('stats');
  grid.innerHTML = '';
  for (const [key, label] of STAT_ORDER) {
    grid.appendChild(el('div', { class: 'stat' },
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: fmtStat(key, totals[key]) }),
    ));
  }
}

function renderCatalogs(lists) {
  const wrap = document.getElementById('catalog-progress');
  wrap.innerHTML = '';
  for (const list of lists) {
    const pct = list.object_count
      ? Math.round((list.completed_count / list.object_count) * 100)
      : 0;
    wrap.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-title' },
        el('h3', { text: list.name }),
        el('span', { class: 'badge' + (pct === 100 ? ' badge-success' : ''), text: `${pct}%` }),
      ),
      el('div', { class: 'progress' }, el('span', { style: `width: ${pct}%` })),
      el('div', { class: 'card-meta' },
        el('span', {}, el('strong', { text: String(list.completed_count) }), ` of ${list.object_count} observed`),
      ),
    ));
  }
}

function renderRecent(rows) {
  const tbody = document.getElementById('recent-rows');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.appendChild(el('tr', {},
      el('td', { colspan: '6' },
        el('div', { class: 'empty-state', text: 'No observations uploaded yet.' })),
    ));
    return;
  }
  for (const r of rows) {
    const thumb = r.thumbnail_path
      ? el('span', {
          class: 'thumb-chip',
          style: `background-image: url("/uploads/${r.thumbnail_path}")`,
        })
      : el('span', { class: 'thumb-chip empty', text: '—' });

    const objectId = r.catalog && r.catalog_number ? `${r.catalog}${r.catalog_number}` : '—';
    const stars = r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '—';

    tbody.appendChild(el('tr', {},
      el('td', {}, thumb),
      el('td', {}, el('a', { href: `/object.html?id=${r.id}`, text: objectId })),
      el('td', { text: r.title || r.object_name || '—' }),
      el('td', { text: r.telescope || '—' }),
      el('td', { text: r.observed_at || r.created_at || '—' }),
      el('td', { class: 'rating-cell', text: stars }),
    ));
  }
}

function renderTelescopes(telescopes) {
  const wrap = document.getElementById('telescopes');
  wrap.innerHTML = '';
  if (!telescopes.length) {
    wrap.appendChild(el('span', { class: 'dim', text: 'No telescopes logged yet.' }));
    return;
  }
  for (const t of telescopes) {
    wrap.appendChild(el('span', { class: 'chip', text: `${t.telescope} · ${t.count}` }));
  }
}

async function load() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStats(data.totals || {});
    renderCatalogs(data.lists || []);
    renderRecent(data.recent || []);
    renderTelescopes(data.telescopes || []);
  } catch (err) {
    document.getElementById('stats').textContent = `Failed to load: ${err.message}`;
  }
}

load();
