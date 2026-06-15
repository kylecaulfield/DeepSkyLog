import { fetchJson, el, catalogSortKey } from '/js/common.js';

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

async function solveRow(id, button) {
  button.disabled = true;
  button.textContent = 'Queuing…';
  try {
    const res = await fetch(`/api/admin/observations/${id}/platesolve`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    button.textContent = 'Queued';
    await loadRows();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Solve';
    alert(`Solve failed: ${err.message}`);
  }
}

// One-shot status pill for the Solve column. "Solved" links to the atlas
// where solved frames are rendered on the sky sphere; pending/solving are
// inert; idle / failure / "no image" show a button that fires the existing
// per-observation solve endpoint.
function solveCell(o) {
  if (!o.image_path) {
    return el('span', { class: 'dim', text: 'no image' });
  }
  if (o.solver_status === 'success') {
    return el('a', {
      class: 'solve-pill solved',
      href: '/atlas.html', title: 'View on sky atlas',
      text: 'Solved',
    });
  }
  if (o.solver_status === 'pending' || o.solver_status === 'solving') {
    return el('span', { class: 'solve-pill pending', text: o.solver_status });
  }
  const btn = el('button', { type: 'button', class: 'edit-btn solve-btn', text: 'Solve' });
  btn.addEventListener('click', () => solveRow(o.id, btn));
  return btn;
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
    tbody.appendChild(el('tr', {}, el('td', { colspan: '9' },
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

    // Only build the link when we actually have an object_id; the old
    // condition also fired for free-form catalog rows (e.g. typed
    // 'C/2023 A3') and produced /admin/object.html?id=undefined.
    const objCell = o.object_id
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

    const captured = o.observed_at || o.created_at || '';
    const capturedMs = captured ? Date.parse(captured) : NaN;
    const captureSecs = (o.stack_count != null && o.exposure_seconds != null)
      ? o.stack_count * o.exposure_seconds
      : (o.exposure_seconds != null ? o.exposure_seconds : null);

    tbody.appendChild(el('tr', {},
      el('td', {}, thumb),
      el('td', { 'data-sort': catalogSortKey(o.object_catalog || o.catalog, o.object_catalog_number || o.catalog_number) }, objCell),
      el('td', { text: o.title || '—' }),
      el('td', { text: o.telescope || '—' }),
      el('td', { 'data-sort': Number.isFinite(capturedMs) ? String(capturedMs) : '', text: captured || '—' }),
      el('td', { class: 'dim', 'data-sort': captureSecs != null ? String(captureSecs) : '', text: captureSummary(o) }),
      el('td', { class: 'rating-cell', 'data-sort': o.rating != null ? String(o.rating) : '', text: stars(o.rating) }),
      el('td', { 'data-sort': o.solver_status || '' }, solveCell(o)),
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
    updateBulkButton();
  } catch (err) {
    tbody.innerHTML = '';
    tbody.appendChild(el('tr', {}, el('td', { colspan: '9', class: 'muted', text: `Failed to load: ${err.message}` })));
  }
}

const bulkBtn = document.getElementById('bulk-solve-btn');
const bulkStatus = document.getElementById('bulk-solve-status');

function unsolvedCount() {
  return state.rows.filter((o) =>
    o.image_path
    && o.solver_status !== 'success'
    && o.solver_status !== 'pending'
    && o.solver_status !== 'solving'
  ).length;
}

function updateBulkButton() {
  if (!bulkBtn) return;
  const n = unsolvedCount();
  bulkBtn.textContent = n > 0 ? `Bulk plate solve (${n})` : 'Bulk plate solve';
  bulkBtn.disabled = n === 0;
}

bulkBtn?.addEventListener('click', async () => {
  const n = unsolvedCount();
  if (!n) return;
  if (!confirm(
    `Submit ${n} unsolved image${n === 1 ? '' : 's'} to astrometry.net?\n\n`
    + `Up to 50 will be queued. Solves are processed in Nova's free queue and take`
    + ` minutes to land — refresh this page later to see results.`,
  )) return;
  bulkBtn.disabled = true;
  bulkStatus.textContent = `Submitting ${n}…`;
  try {
    const res = await fetch('/api/admin/observations/bulk-platesolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const bits = [`${data.queued} queued`];
    if (data.skipped) bits.push(`${data.skipped} skipped`);
    if (data.errors) bits.push(`${data.errors} error${data.errors === 1 ? '' : 's'}`);
    bulkStatus.textContent = `${bits.join(' · ')}. Solve results land in a few minutes.`;
    await loadRows();
  } catch (err) {
    bulkStatus.textContent = `Bulk solve failed: ${err.message}`;
    bulkBtn.disabled = false;
  }
});

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
