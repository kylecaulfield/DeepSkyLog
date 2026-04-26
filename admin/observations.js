import { fetchJson, el } from '/js/common.js';

const queryInput = document.getElementById('filter-query');
const telescopeSelect = document.getElementById('filter-telescope');
const tbody = document.getElementById('rows');
const countEl = document.getElementById('count');

const state = { rows: [], filter: { q: '', telescope: '' } };

function captureSummary(o) {
  if (o.stack_count != null && o.exposure_seconds != null) {
    const total = (o.stack_count * o.exposure_seconds) / 60;
    return `${o.stack_count}×${o.exposure_seconds}s · ${total.toFixed(1)} min`;
  }
  if (o.exposure_seconds != null) return `${o.exposure_seconds}s`;
  return '—';
}

function stars(n) {
  return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—';
}

async function deleteRow(id, button) {
  if (!confirm('Delete this observation? Files and the catalog completion will be removed.')) return;
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/observations/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.rows = state.rows.filter((r) => r.id !== id);
    renderRows();
  } catch (err) {
    button.disabled = false;
    alert(`Delete failed: ${err.message}`);
  }
}

async function featureRow(id, button) {
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/observations/${id}/feature`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadRows();
  } catch (err) {
    button.disabled = false;
    alert(`Feature failed: ${err.message}`);
  }
}

function objectLabel(o) {
  if (o.object_catalog && o.object_catalog_number) {
    return `${o.object_catalog}${o.object_catalog_number}${o.object_name ? ' · ' + o.object_name : ''}`;
  }
  if (o.catalog && o.catalog_number) {
    return `${o.catalog}${o.catalog_number}`;
  }
  return o.title || `#${o.id}`;
}

function rowMatches(o) {
  const { q, telescope } = state.filter;
  if (telescope && o.telescope !== telescope) return false;
  if (q) {
    const hay = [
      o.title, o.telescope, o.location, o.object_name,
      o.catalog && o.catalog_number ? `${o.catalog}${o.catalog_number}` : '',
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

function renderRows() {
  tbody.innerHTML = '';
  const visible = state.rows.filter(rowMatches);
  countEl.textContent = `${visible.length} of ${state.rows.length} observation${state.rows.length === 1 ? '' : 's'}`;

  if (!visible.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '8' },
      el('div', { class: 'empty-state', text: state.rows.length
        ? 'No observations match the current filters.'
        : 'No observations logged yet — drop an image on the Upload page.' }))));
    return;
  }

  for (const o of visible) {
    const thumb = o.thumbnail_path
      ? el('span', {
          class: 'thumb-chip',
          style: `background-image: url("/uploads/${o.thumbnail_path}")`,
        })
      : el('span', { class: 'thumb-chip empty', text: '—' });

    const objCell = (o.object_id || (o.catalog && o.catalog_number))
      ? el('a', {
          href: `/admin/object.html?id=${encodeURIComponent(o.object_id)}`,
          text: objectLabel(o),
        })
      : document.createTextNode(objectLabel(o));

    const featureBtn = el('button', { type: 'button', class: 'feature-btn', text: '★' , title: 'Make featured' });
    featureBtn.addEventListener('click', () => featureRow(o.id, featureBtn));

    const deleteBtn = el('button', { type: 'button', class: 'delete-btn', text: 'Delete' });
    deleteBtn.addEventListener('click', () => deleteRow(o.id, deleteBtn));

    const actions = el('div', { class: 'tile-actions' }, featureBtn, deleteBtn);

    tbody.appendChild(el('tr', {},
      el('td', {}, thumb),
      el('td', {}, objCell),
      el('td', { text: o.title || '—' }),
      el('td', { text: o.telescope || '—' }),
      el('td', { text: o.observed_at || o.created_at || '—' }),
      el('td', { class: 'dim', text: captureSummary(o) }),
      el('td', { class: 'rating-cell', text: stars(o.rating) }),
      el('td', {}, actions),
    ));
  }
}

async function loadFilters() {
  try {
    const { telescopes } = await fetchJson('/api/filters');
    telescopeSelect.innerHTML = '<option value="">All</option>';
    for (const t of telescopes) telescopeSelect.appendChild(el('option', { value: t, text: t }));
  } catch {}
}

async function loadRows() {
  try {
    state.rows = await fetchJson('/api/observations');
    renderRows();
  } catch (err) {
    tbody.innerHTML = '';
    tbody.appendChild(el('tr', {}, el('td', { colspan: '8', class: 'muted', text: `Failed to load: ${err.message}` })));
  }
}

queryInput.addEventListener('input', () => {
  state.filter.q = queryInput.value;
  renderRows();
});
telescopeSelect.addEventListener('change', () => {
  state.filter.telescope = telescopeSelect.value;
  renderRows();
});

(async () => {
  await loadFilters();
  await loadRows();
})();
