import { fetchJson, el, typeLabel, highlightNav } from './common.js';
import { mountCatalogFilter, selectionToParam } from './catalog-filter.js';
import { mountDurationPicker } from './seestar-durations.js';

highlightNav('seestar');

let getCatalogSelection = () => [];
mountCatalogFilter(document.getElementById('catalog-filter'), () => {
  load();
}).then((fn) => {
  getCatalogSelection = fn;
  if (rows.children.length) load();
});

let getDurationParam = () => '';
mountDurationPicker(document.getElementById('duration-filter'), () => {
  load();
}).then((fn) => {
  getDurationParam = fn;
  if (rows.children.length) load();
});

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
const rows = document.getElementById('rows');

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

async function load() {
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
  rows.innerHTML = '';
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon),
    min_alt: String(minAlt), max_alt: String(maxAlt),
    // Start is always "now" — that's the whole point of the page.
    start: new Date().toISOString(),
  });
  if (includeObserved.checked) params.set('include_observed', '1');
  const catParam = selectionToParam(getCatalogSelection());
  if (catParam) params.set('lists', catParam);
  const durParam = getDurationParam();
  if (durParam) params.set('durations', durParam);

  let data;
  try {
    data = await fetchJson(`/api/seestar-planner?${params}`);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    return;
  }

  const moonPct = (data.moon.illumination * 100).toFixed(0);
  moonLine.textContent = `Moon at start: ${data.moon.name} (${moonPct}% illuminated)`;

  const start = new Date(data.window.start);
  const end = new Date(data.window.end);
  const sunrise = data.sunrise ? new Date(data.sunrise) : null;
  windowLine.textContent = sunrise
    ? `Session: ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (sunrise ${sunrise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
    : `Session: ${start.toLocaleString()} → ${end.toLocaleString()} (sun never sets in this window)`;

  const filled = data.slots.filter((s) => s.target).length;
  status.textContent = `${filled} of ${data.slots.length} slot${data.slots.length === 1 ? '' : 's'} filled`;

  if (!data.slots.length) {
    rows.appendChild(el('tr', {}, el('td', { colspan: '11' },
      el('div', { class: 'empty-state', text: 'No imaging window — sunrise is within the next hour.' }))));
    return;
  }

  for (const slot of data.slots) {
    const slotLabel = `${fmtTime(slot.slot_start)} – ${fmtTime(slot.slot_end)}`;
    const dur = slot.duration_minutes != null ? `${slot.duration_minutes} min` : '—';
    if (!slot.target) {
      rows.appendChild(el('tr', { class: 'dim' },
        el('td', { text: slotLabel }),
        el('td', { text: dur }),
        el('td', { colspan: '9', class: 'empty-state', text: 'No target in altitude range that hasn\'t been used yet.' }),
      ));
      continue;
    }
    const t = slot.target;
    rows.appendChild(el('tr', { class: t.observed ? 'observed' : '' },
      el('td', { text: slotLabel }),
      el('td', { text: dur }),
      el('td', {}, el('a', { href: `/object.html?id=${t.id}`, text: `${t.catalog}${t.catalog_number}` })),
      el('td', { text: t.name || '—' }),
      el('td', { text: typeLabel(t.object_type) }),
      el('td', { text: t.constellation || '—' }),
      el('td', { text: t.magnitude != null ? Number(t.magnitude).toFixed(1) : '—' }),
      el('td', { text: fmtDeg(t.altitude_at_start) }),
      el('td', { text: fmtDeg(t.altitude_at_end) }),
      el('td', { text: fmtDeg(t.azimuth_at_start) }),
      el('td', { class: 'dim list-cell', text: t.list_name }),
    ));
  }
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
