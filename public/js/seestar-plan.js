import { fetchJson, el, typeLabel, highlightNav, catalogSortKey } from './common.js';
import { mountCatalogFilter, selectionToParam } from './catalog-filter.js';
import { mountTypeFilter, typesToParam } from './type-filter.js';
import { mountDurationPicker } from './seestar-durations.js';

highlightNav('seestar');

let getCatalogSelection = () => [];
mountCatalogFilter(document.getElementById('catalog-filter'), () => {
  load();
}).then((fn) => {
  getCatalogSelection = fn;
  if (schedules.children.length) load();
});
const getTypeSelection = mountTypeFilter(document.getElementById('type-filter'), () => load());

let getDurationParam = () => '';
mountDurationPicker(document.getElementById('duration-filter'), () => {
  load();
}).then((fn) => {
  getDurationParam = fn;
  if (schedules.children.length) load();
});

const dateInput = document.getElementById('date-input');
const timeInput = document.getElementById('time-input');
const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const minAltInput = document.getElementById('min-alt-input');
const maxAltInput = document.getElementById('max-alt-input');
const includeObserved = document.getElementById('include-observed');
const locateBtn = document.getElementById('locate-btn');
const runBtn = document.getElementById('run-btn');
const status = document.getElementById('status');
const moonLine = document.getElementById('moon-line');
const windowLine = document.getElementById('window-line');
const schedules = document.getElementById('schedules');

// Per-model fleet counts. Keys match the SEESTAR_SCOPES keys on the server.
const FLEET_MODELS = [
  ['s50', 'count-s50'],
  ['s30', 'count-s30'],
  ['s30pro', 'count-s30pro'],
  ['any', 'count-any'],
];
const countInputs = Object.fromEntries(
  FLEET_MODELS.map(([key, id]) => [key, document.getElementById(id)]),
);

function readFleet() {
  const out = {};
  for (const [key] of FLEET_MODELS) {
    const n = Math.max(0, Math.min(8, parseInt(countInputs[key].value, 10) || 0));
    if (n > 0) out[key] = n;
  }
  return out;
}
function fleetToParam(fleet) {
  return Object.entries(fleet).map(([k, n]) => `${k}:${n}`).join(',');
}

// Default date / time to "now" in the user's local timezone — same
// pattern the regular planner uses so 11pm-local doesn't roll into
// the next UTC day. Persist telescope choice in localStorage so it
// carries between visits.
const pad = (n) => String(n).padStart(2, '0');
const nowLocal = new Date();
dateInput.value = `${nowLocal.getFullYear()}-${pad(nowLocal.getMonth() + 1)}-${pad(nowLocal.getDate())}`;
timeInput.value = `${pad(nowLocal.getHours())}:${pad(nowLocal.getMinutes())}`;
// Restore the saved fleet, falling back to a single "Any" scope so the page
// behaves like the old single-scope planner on a first visit.
try {
  const saved = JSON.parse(localStorage.getItem('deepskylog.seestar_fleet') || 'null');
  if (saved && typeof saved === 'object') {
    for (const [key] of FLEET_MODELS) {
      if (Number.isFinite(Number(saved[key]))) countInputs[key].value = String(saved[key]);
    }
  } else {
    countInputs.any.value = '1';
  }
} catch { countInputs.any.value = '1'; }

for (const [, id] of FLEET_MODELS) {
  document.getElementById(id).addEventListener('change', () => {
    try { localStorage.setItem('deepskylog.seestar_fleet', JSON.stringify(readFleet())); } catch {}
    load();
  });
}
dateInput.addEventListener('change', () => load());
timeInput.addEventListener('change', () => load());

const STORE_KEY = 'deepskylog.location';
let stored = null;
try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); }
catch { /* corrupt — ignore */ }
if (stored && Number.isFinite(Number(stored.lat)) && Number.isFinite(Number(stored.lon))) {
  latInput.value = stored.lat;
  lonInput.value = stored.lon;
}

function fmtDeg(v) { return v == null ? '—' : `${v.toFixed(1)}°`; }
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Generation token used to discard stale fetch responses. Multiple load()s
// can run concurrently (auto-load on init + filter-mount Promises resolving
// + count change events all fire one each); without this, each call's
// post-fetch append would stack on top of earlier calls' appends, producing
// duplicate schedule sections.
let loadGen = 0;

async function load() {
  const myGen = ++loadGen;
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const minAlt = Number(minAltInput.value);
  const maxAlt = Number(maxAltInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    status.textContent = 'Enter latitude and longitude (or tap Use my location).';
    return;
  }
  if (!Number.isFinite(minAlt) || !Number.isFinite(maxAlt) || minAlt >= maxAlt) {
    status.textContent = 'Min altitude must be less than max altitude.';
    return;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify({ lat, lon }));

  status.textContent = 'Planning…';
  schedules.innerHTML = '';
  // Combine date + time as local — the resulting Date is the correct
  // UTC instant. Falls back to "now" if either input is empty (e.g.
  // user cleared the date and tapped Plan).
  let startISO = new Date().toISOString();
  if (dateInput.value && timeInput.value) {
    const candidate = new Date(`${dateInput.value}T${timeInput.value}`);
    if (!Number.isNaN(candidate.getTime())) startISO = candidate.toISOString();
  }
  // No scopes entered → plan a single "Any" scope so the page isn't blank.
  const fleet = readFleet();
  const fleetParam = Object.keys(fleet).length ? fleetToParam(fleet) : 'any:1';
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon),
    min_alt: String(minAlt), max_alt: String(maxAlt),
    start: startISO,
    fleet: fleetParam,
  });
  if (includeObserved.checked) params.set('include_observed', '1');
  const catParam = selectionToParam(getCatalogSelection());
  if (catParam) params.set('lists', catParam);
  const typeParam = typesToParam(getTypeSelection());
  if (typeParam) params.set('types', typeParam);
  const durParam = getDurationParam();
  if (durParam) params.set('durations', durParam);

  let data;
  try {
    data = await fetchJson(`/api/seestar-planner?${params}`);
  } catch (err) {
    if (myGen !== loadGen) return;
    status.textContent = `Failed: ${err.message}`;
    return;
  }

  // Newer load() superseded us — let it do the painting.
  if (myGen !== loadGen) return;

  // Clear once more, in case an earlier (now-superseded) load() resolved
  // and appended before us. Belt-and-braces: the gen check above already
  // covers it, but this keeps the DOM authoritative even if a future edit
  // reintroduces the race.
  schedules.innerHTML = '';

  const moonPct = (data.moon.illumination * 100).toFixed(0);
  moonLine.textContent = `Moon at start: ${data.moon.name} (${moonPct}% illuminated)`;

  const hm = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const start = new Date(data.window.start);
  const end = new Date(data.window.end);
  const sunrise = data.sunrise ? new Date(data.sunrise) : null;
  const sunset = data.sunset ? new Date(data.sunset) : null;
  if (sunrise) {
    const sunsetBit = sunset ? `sunset ${hm(sunset)} · ` : '';
    windowLine.textContent =
      `Session: ${hm(start)} – ${hm(end)} · ${sunsetBit}starts 30 min after sunset · sunrise ${hm(sunrise)}`;
  } else {
    windowLine.textContent =
      `Session: ${start.toLocaleString()} → ${end.toLocaleString()} (sun never sets in this window)`;
  }

  const scopes = data.scopes || (data.scope ? [{ ...data.scope, label: data.scope.name, slots: data.slots }] : []);
  const totalTargets = scopes.reduce((acc, s) => acc + s.slots.length, 0);
  status.textContent = scopes.length > 1
    ? `${scopes.length} scopes · ${totalTargets} targets scheduled · no overlap`
    : `${totalTargets} target${totalTargets === 1 ? '' : 's'} scheduled`;

  for (const scope of scopes) schedules.appendChild(buildScheduleSection(scope));
}

function buildRow(slot) {
  const slotLabel = `${fmtTime(slot.slot_start)} – ${fmtTime(slot.slot_end)}`;
  const dur = slot.duration_minutes != null ? `${slot.duration_minutes} min` : '—';
  const t = slot.target;
  return el('tr', { class: t.observed ? 'observed' : '' },
    el('td', { 'data-sort': slot.slot_start ? String(Date.parse(slot.slot_start)) : '', text: slotLabel }),
    el('td', { 'data-sort': slot.duration_minutes != null ? String(slot.duration_minutes) : '', text: dur }),
    el('td', { 'data-sort': catalogSortKey(t.catalog, t.catalog_number) },
      el('a', { href: `/object.html?id=${t.id}`, text: `${t.catalog}${t.catalog_number}` })),
    el('td', { text: t.name || '—' }),
    el('td', { text: typeLabel(t.object_type) }),
    el('td', { text: t.constellation || '—' }),
    el('td', { text: t.magnitude != null ? Number(t.magnitude).toFixed(1) : '—' }),
    el('td', { text: fmtDeg(t.altitude_at_start) }),
    el('td', { text: fmtDeg(t.altitude_at_end) }),
    el('td', { text: fmtDeg(t.azimuth_at_start) }),
    el('td', { class: 'dim list-cell', text: t.list_name }),
  );
}

const COLUMNS = ['Slot', 'Duration', 'Object', 'Name', 'Type', 'Constellation',
  'Mag', 'Alt start', 'Alt end', 'Az start', 'List'];

function buildScheduleSection(scope) {
  const capBit = scope.max_magnitude != null
    ? `cap ≤ mag ${scope.max_magnitude.toFixed(1)}`
    : 'no magnitude filter';
  const n = scope.slots.length;
  const head = el('div', { class: 'schedule-head' },
    el('h2', { text: scope.label || scope.name }),
    el('span', { class: 'dim', text: `${capBit} · ${n} target${n === 1 ? '' : 's'}` }),
  );
  if (scope.notes) head.appendChild(el('div', { class: 'dim schedule-notes', text: scope.notes }));

  const tbody = el('tbody');
  if (!n) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: String(COLUMNS.length) },
      el('div', { class: 'empty-state', text: 'No targets fit this scope in the session window.' }))));
  } else {
    for (const slot of scope.slots) tbody.appendChild(buildRow(slot));
  }

  const table = el('table', { 'data-sortable': '' },
    el('thead', {}, el('tr', {}, ...COLUMNS.map((c) => el('th', { text: c })))),
    tbody,
  );
  return el('section', { class: 'schedule' }, head, el('div', { class: 'table-wrapper' }, table));
}

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    status.textContent = 'Geolocation is not available.';
    return;
  }
  status.textContent = 'Requesting location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latInput.value = pos.coords.latitude.toFixed(4);
      lonInput.value = pos.coords.longitude.toFixed(4);
      load();
    },
    (err) => { status.textContent = `Geolocation failed: ${err.message}`; },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

runBtn.addEventListener('click', load);

// Auto-run on page load if we already have coords cached. The user
// expects the page to "just work" given the goal — a one-tap Seestar
// session plan.
if (Number.isFinite(Number(latInput.value)) && Number.isFinite(Number(lonInput.value))) {
  load();
}
