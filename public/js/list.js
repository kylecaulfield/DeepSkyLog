import { fetchJson, el, formatRA, formatDec, typeLabel, highlightNav, qs } from './common.js';

highlightNav('home');

const slug = qs('slug');
const state = { objects: [], filters: { status: 'all', type: 'all', query: '' } };

async function load() {
  if (!slug) {
    document.getElementById('list-name').textContent = 'Not found';
    return;
  }
  try {
    const data = await fetchJson(`/api/lists/${encodeURIComponent(slug)}`);
    state.objects = data.objects;
    document.title = `DeepSkyLog — ${data.name}`;
    document.getElementById('list-name').textContent = data.name;
    document.getElementById('list-description').textContent = data.description || '';

    const types = [...new Set(data.objects.map((o) => o.object_type).filter(Boolean))].sort();
    const typeSelect = document.getElementById('filter-type');
    for (const t of types) typeSelect.appendChild(el('option', { value: t, text: typeLabel(t) }));

    render();
  } catch (e) {
    document.getElementById('list-name').textContent = 'List not found';
  }
}

function render() {
  const tbody = document.getElementById('rows');
  tbody.innerHTML = '';

  const { status, type, query } = state.filters;
  const q = query.trim().toLowerCase();

  const filtered = state.objects.filter((o) => {
    if (status === 'observed' && !o.completed) return false;
    if (status === 'pending' && o.completed) return false;
    if (type !== 'all' && o.object_type !== type) return false;
    if (q) {
      const hay = [
        o.name,
        `${o.catalog}${o.catalog_number}`,
        o.constellation,
        o.object_type,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const observed = filtered.filter((o) => o.completed).length;
  document.getElementById('count-summary').textContent =
    `${filtered.length} objects · ${observed} observed`;

  if (!filtered.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '8' },
      el('div', { class: 'empty-state', text: 'No objects match the current filters.' }))));
    return;
  }

  for (const o of filtered) {
    tbody.appendChild(el(
      'tr',
      { class: o.completed ? 'observed' : '' },
      el('td', {}, el('a', { href: `/object.html?id=${o.id}`, text: `${o.catalog}${o.catalog_number}` })),
      el('td', { text: o.name || '—' }),
      el('td', { text: typeLabel(o.object_type) }),
      el('td', { text: o.constellation || '—' }),
      el('td', { text: formatRA(o.ra_hours) }),
      el('td', { text: formatDec(o.dec_degrees) }),
      el('td', { text: o.magnitude != null ? o.magnitude.toFixed(1) : '—' }),
      el('td', { class: o.completed ? 'check' : 'check-empty', text: o.completed ? '✓' : '·' }),
    ));
  }
}

document.getElementById('filter-status').addEventListener('change', (e) => {
  state.filters.status = e.target.value; render();
});
document.getElementById('filter-type').addEventListener('change', (e) => {
  state.filters.type = e.target.value; render();
});
document.getElementById('filter-query').addEventListener('input', (e) => {
  state.filters.query = e.target.value; render();
});

load();
