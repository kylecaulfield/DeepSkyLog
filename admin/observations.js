import { fetchJson, el, catalogSortKey } from '/js/common.js';
import { mountMoonMap, isMoonObservation } from '/js/moon-map.js';

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

// Check a Moon photo's feature labels and, if the automatic match turned
// them the wrong way, set the orientation by hand. Each adjustment is saved
// straight away (PUT /api/admin/observations/:id/moonmap); Automatic
// forgets it.
function openMoonMap(o) {
  const overlay = el('div', { class: 'modal-overlay' });
  const card = el('div', { class: 'modal moon-modal' });
  const stage = el('div', { class: 'moon-modal-stage' });
  const status = el('p', { class: 'dim moon-modal-status', text: 'Working out the map…' });
  let map = null;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  const show = (m) => {
    map = m;
    stage.replaceChildren();
    const img = el('img', { src: `/uploads/${o.image_path}`, alt: o.title || `Observation #${o.id}` });
    const frame = el('div', { class: 'photo-frame' }, img);
    stage.appendChild(frame);
    mountMoonMap(frame, img, m, { showUncertain: true });
    const or = m.orientation;
    status.textContent = or
      ? `${or.source === 'manual' ? 'Set by hand' : `Matched automatically (${or.confidence} confidence)`}`
        + ` · lunar north ${or.rotation}° clockwise from up${or.mirrored ? ' · mirror image' : ''}`
      : (m.disk ? 'Not matched automatically — turn the labels into place.' : 'No Moon disk found, so there is nothing to adjust.');
    for (const b of buttons) b.disabled = !m.disk;
  };

  const send = async (method, body) => {
    for (const b of buttons) b.disabled = true;
    status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/admin/observations/${o.id}/moonmap`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      show(await res.json());
    } catch (err) {
      status.textContent = `Save failed: ${err.message}`;
      for (const b of buttons) b.disabled = !map?.disk;
    }
  };
  const current = () => ({ rotation: map?.orientation?.rotation ?? 0, mirrored: !!map?.orientation?.mirrored });
  const turn = (delta) => send('PUT', { ...current(), rotation: current().rotation + delta });
  const button = (text, title, onClick) => {
    const b = el('button', { type: 'button', class: 'moon-adjust', text, title, disabled: 'disabled' });
    b.addEventListener('click', onClick);
    return b;
  };
  const buttons = [
    button('↺ 10°', 'Turn the labels 10° anticlockwise', () => turn(-10)),
    button('↺ 1°', 'Turn the labels 1° anticlockwise', () => turn(-1)),
    button('↻ 1°', 'Turn the labels 1° clockwise', () => turn(1)),
    button('↻ 10°', 'Turn the labels 10° clockwise', () => turn(10)),
    button('Mirror', 'Swap east and west (a photo taken through a star diagonal)',
      () => send('PUT', { ...current(), mirrored: !current().mirrored })),
    button('Automatic', 'Forget the manual setting and match the photo again', () => send('DELETE')),
  ];
  const closeBtn = el('button', { type: 'button', class: 'ghost', text: 'Close' });
  closeBtn.addEventListener('click', close);

  card.append(
    el('h3', { text: `Moon map · ${o.title || `observation #${o.id}`}` }),
    stage,
    el('div', { class: 'moon-adjust-row' }, ...buttons),
    status,
    el('div', { class: 'actions' }, closeBtn),
  );
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  fetchJson(`/api/observations/${encodeURIComponent(o.id)}/moonmap`)
    .then(show)
    .catch((err) => { status.textContent = `Couldn't load the map: ${err.message}`; });
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
    const data = await res.json().catch(() => ({}));
    setRowStatus(id, data.status || 'queued');
    pollActivitySoon();
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Solve';
    alert(`Solve failed: ${err.message}`);
  }
}

// Status pill for the Solve column, kept live by the activity poller.
// "Solved" links to the atlas where solved frames are rendered on the sky
// sphere; queued / pending / solving are inert; idle / failure show a button
// that queues the observation.
const PILL_TITLES = {
  queued: 'Waiting its turn to upload to astrometry.net',
  pending: 'Uploaded; waiting in astrometry.net\'s queue for a solver',
  solving: 'astrometry.net is solving it',
};
function solveCell(o) {
  if (!o.image_path) {
    return el('span', { class: 'dim', text: 'no image' });
  }
  if (o.solver_status === 'success') {
    return el('a', {
      class: 'solve-pill solved',
      href: '/atlas.html', title: 'View on sky atlas',
      text: o.solved_radius_deg ? `Solved · ${o.solved_radius_deg.toFixed(2)}°` : 'Solved',
    });
  }
  if (o.solver_status === 'queued') {
    return el('span', { class: 'solve-pill queued', title: PILL_TITLES.queued, text: 'queued' });
  }
  if (o.solver_status === 'pending' || o.solver_status === 'solving') {
    return el('span', { class: 'solve-pill pending', title: PILL_TITLES[o.solver_status], text: o.solver_status });
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

// Solve cells by observation id, so status changes from the activity log
// update a row in place (re-rendering would reset the table's sort order).
const solveCells = new Map();
function setRowStatus(id, status, radius) {
  const o = state.rows.find((r) => r.id === id);
  if (!o) return;
  o.solver_status = status;
  if (radius !== undefined) o.solved_radius_deg = radius;
  const td = solveCells.get(id);
  if (td) {
    td.replaceChildren(solveCell(o));
    td.dataset.sort = status || '';
  }
  updateBulkButton();
}

function renderRows() {
  tbody.innerHTML = '';
  solveCells.clear();
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

    // Featuring works per catalog id — the server 400s on rows without
    // one, so don't offer the button for free-form observations.
    const canFeature = o.catalog && o.catalog_number;
    const featureBtn = canFeature
      ? el('button', { type: 'button', class: 'feature-btn', text: '★', title: 'Make featured' })
      : null;
    if (featureBtn) featureBtn.addEventListener('click', () => featureRow(o.id, featureBtn));

    // Moon photos get their feature map checked / turned here.
    const moonBtn = o.image_path && isMoonObservation(o)
      ? el('button', { type: 'button', class: 'feature-btn moon-btn', text: 'Moon map', title: 'Check the feature labels' })
      : null;
    if (moonBtn) moonBtn.addEventListener('click', () => openMoonMap(o));

    const deleteBtn = el('button', { type: 'button', class: 'delete-btn', text: 'Delete' });
    deleteBtn.addEventListener('click', () => deleteRow(o.id, deleteBtn));

    const actions = el('div', { class: 'tile-actions' }, ...(featureBtn ? [featureBtn] : []), ...(moonBtn ? [moonBtn] : []), deleteBtn);

    const captured = o.observed_at || o.created_at || '';
    const capturedMs = captured ? Date.parse(captured) : NaN;
    const captureSecs = (o.stack_count != null && o.exposure_seconds != null)
      ? o.stack_count * o.exposure_seconds
      : (o.exposure_seconds != null ? o.exposure_seconds : null);

    const solveTd = el('td', { 'data-sort': o.solver_status || '' }, solveCell(o));
    solveCells.set(o.id, solveTd);
    tbody.appendChild(el('tr', {},
      el('td', {}, thumb),
      el('td', { 'data-sort': catalogSortKey(o.object_catalog || o.catalog, o.object_catalog_number || o.catalog_number) }, objCell),
      el('td', { text: o.title || '—' }),
      el('td', { text: o.telescope || '—' }),
      el('td', { 'data-sort': Number.isFinite(capturedMs) ? String(capturedMs) : '', text: captured || '—' }),
      el('td', { class: 'dim', 'data-sort': captureSecs != null ? String(captureSecs) : '', text: captureSummary(o) }),
      el('td', { class: 'rating-cell', 'data-sort': o.rating != null ? String(o.rating) : '', text: stars(o.rating) }),
      solveTd,
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
    o.image_path && !['success', 'queued', 'pending', 'solving'].includes(o.solver_status),
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
    `Plate solve ${n} unsolved image${n === 1 ? '' : 's'} with astrometry.net?\n\n`
    + 'They are uploaded one at a time and solved in astrometry.net\'s free queue, which'
    + ' takes minutes per image. Progress shows in the Plate solving panel on this page.',
  )) return;
  bulkBtn.disabled = true;
  bulkStatus.textContent = `Queuing ${n}…`;
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
    if (data.errors) bits.push(`${data.errors} with no image file`);
    bulkStatus.textContent = `${bits.join(' · ')}. Follow each upload and solve in the Plate solving panel below.`;
    for (const r of data.results || []) if (r.status === 'queued') setRowStatus(r.id, 'queued');
    pollActivitySoon();
  } catch (err) {
    bulkStatus.textContent = `Bulk solve failed: ${err.message}`;
    bulkBtn.disabled = false;
  }
});

// ---- Plate-solve activity: counts, what's in progress, a live log, and a
// notification when an image solves or fails. Polls every few seconds while
// anything is queued or at astrometry.net, every 30 s otherwise.
const solvePanel = document.getElementById('solve-panel');
const solveCountsEl = document.getElementById('solve-counts');
const solveActiveEl = document.getElementById('solve-active');
const solveLogEl = document.getElementById('solve-log');
const toastsEl = document.getElementById('toasts');
const solveState = { lastId: 0, loaded: false, timer: null };
const FAST_MS = 4000;
const SLOW_MS = 30000;
const KIND_LABELS = {
  batch: 'Batch', queued: 'Queued', uploading: 'Uploading', submitted: 'Uploaded',
  solving: 'Solving', solved: 'Solved', failed: 'Failed', error: 'Error',
};
const STATE_LABELS = {
  queued: 'waiting to upload',
  pending: 'in astrometry.net\'s queue',
  solving: 'solving',
};

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

function observationLink(item) {
  const label = item.label || (item.observation_id ? `#${item.observation_id}` : '');
  if (!label) return document.createTextNode('');
  return item.object_id
    ? el('a', { href: `/admin/object.html?id=${encodeURIComponent(item.object_id)}`, text: label })
    : el('strong', { text: label });
}

function renderCounts(counts) {
  const items = [
    ['queued', 'waiting to upload'], ['pending', 'in astrometry.net queue'], ['solving', 'solving'],
    ['success', 'solved'], ['failure', 'failed'], ['unsolved', 'not yet submitted'],
  ];
  solveCountsEl.replaceChildren(...items
    .filter(([k]) => counts[k] || ['queued', 'pending', 'solving', 'success'].includes(k))
    .map(([k, label]) => el('span', { class: `solve-count ${k}` }, el('strong', { text: String(counts[k] || 0) }), ` ${label}`)));
}

function renderActive(active) {
  if (!active.length) {
    solveActiveEl.replaceChildren(el('span', { class: 'dim', text: 'Nothing in progress.' }));
    return;
  }
  const shown = active.slice(0, 12);
  const list = el('ul', {}, ...shown.map((a) => el('li', {},
    observationLink({ ...a, observation_id: a.id }),
    el('span', { text: `${STATE_LABELS[a.status] || a.status}${a.subid && a.status !== 'queued' ? ` · submission ${a.subid}` : ''}` }),
    a.since ? el('span', { class: 'when', text: fmtAgo(a.since) === 'just now' ? 'just now' : `for ${fmtAgo(a.since)}` }) : null,
  )));
  const more = active.length > shown.length
    ? el('div', { class: 'dim', text: `+ ${active.length - shown.length} more` })
    : null;
  solveActiveEl.replaceChildren(el('div', { class: 'dim', text: 'In progress' }), list, ...(more ? [more] : []));
}

function logItem(e) {
  return el('li', { 'data-kind': e.kind },
    el('time', { datetime: e.at, title: new Date(e.at).toLocaleString(), text: fmtWhen(e.at) }),
    el('span', { class: `solve-kind ${e.kind}`, text: KIND_LABELS[e.kind] || e.kind }),
    el('span', { class: 'what' }, observationLink(e), e.label ? ' — ' : '', e.message),
  );
}

function toast(title, message, tone) {
  const t = el('div', { class: `toast ${tone || ''}`, role: 'status' }, el('strong', { text: title }), message);
  t.addEventListener('click', () => t.remove());
  toastsEl.appendChild(t);
  setTimeout(() => t.remove(), 9000);
  while (toastsEl.children.length > 4) toastsEl.firstElementChild.remove();
}

// Toast the solves and failures that just arrived; a burst collapses into
// one summary per kind.
function notify(events) {
  for (const [kind, tone, verb] of [['solved', 'good', 'solved'], ['failed', 'bad', 'could not be solved'], ['error', 'bad', 'hit an error']]) {
    const hits = events.filter((e) => e.kind === kind);
    if (!hits.length) continue;
    if (hits.length <= 2) {
      for (const e of hits) toast(`${e.label || 'Plate solve'} ${verb}`, e.message, tone);
    } else {
      toast(`${hits.length} images ${verb}`, hits.map((e) => e.label).filter(Boolean).slice(0, 6).join(', '), tone);
    }
  }
}

function scheduleActivity(ms) {
  clearTimeout(solveState.timer);
  solveState.timer = setTimeout(pollActivity, ms);
}
function pollActivitySoon() { scheduleActivity(300); }

async function pollActivity() {
  try {
    const data = await fetchJson(`/api/admin/platesolve/activity?after=${solveState.lastId}`);
    const busy = (data.counts.queued || 0) + (data.counts.pending || 0) + (data.counts.solving || 0) > 0;
    // Shown once plate solving is set up (ASTROMETRY_API_KEY) or has history.
    const show = data.enabled || busy || data.last_event_id > 0;
    solvePanel.hidden = !show;
    if (show) {
      renderCounts(data.counts);
      renderActive(data.active);
      if (!solveLogEl.children.length && !data.events.length) {
        solveLogEl.appendChild(el('li', { class: 'empty dim', text: 'Nothing logged yet. Press Bulk plate solve or a row\'s Solve button.' }));
      }
      if (data.events.length) {
        const empty = solveLogEl.querySelector('.empty');
        if (empty) empty.remove();
        // Newest first.
        for (const e of data.events) solveLogEl.prepend(logItem(e));
        while (solveLogEl.children.length > 300) solveLogEl.lastElementChild.remove();
      }
      // The first load fills in history quietly; later events notify.
      if (solveState.loaded) notify(data.events);
      for (const o of data.observations || []) setRowStatus(o.id, o.solver_status, o.solved_radius_deg);
    }
    solveState.lastId = data.last_event_id;
    solveState.loaded = true;
    scheduleActivity(busy ? FAST_MS : SLOW_MS);
  } catch {
    scheduleActivity(SLOW_MS);
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
  pollActivity();
})();
