import { fetchJson, el, typeLabel, highlightNav } from './common.js';

highlightNav('planner');

const dateInput = document.getElementById('date-input');
const timeInput = document.getElementById('time-input');
const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const altInput = document.getElementById('alt-input');
const moonSepInput = document.getElementById('moon-sep-input');
const includeObserved = document.getElementById('include-observed');
const locateBtn = document.getElementById('locate-btn');
const runBtn = document.getElementById('run-btn');
const status = document.getElementById('status');
const moonLine = document.getElementById('moon-line');
const bandsLine = document.getElementById('bands-line');
const rows = document.getElementById('rows');

const STORE_KEY = 'deepskylog.location';
let stored = null;
try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); }
catch { /* corrupt — ignore */ }
if (stored && Number.isFinite(Number(stored.lat)) && Number.isFinite(Number(stored.lon))) {
  latInput.value = stored.lat;
  lonInput.value = stored.lon;
}

// Default to now in the user's *local* date and time, so a planner
// loaded at 11pm local doesn't jump to "tomorrow" because UTC has rolled
// over.
const nowLocal = new Date();
const pad = (n) => String(n).padStart(2, '0');
dateInput.value = `${nowLocal.getFullYear()}-${pad(nowLocal.getMonth() + 1)}-${pad(nowLocal.getDate())}`;
timeInput.value = `${pad(nowLocal.getHours())}:${pad(nowLocal.getMinutes())}`;

function fmtDeg(v) { return v == null ? '—' : `${v.toFixed(1)}°`; }
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtMinutes(m) {
  if (!m) return '—';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const minAlt = Number(altInput.value);
  const date = dateInput.value;
  const time = timeInput.value;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !date) {
    status.textContent = 'Enter date, latitude and longitude.';
    return;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify({ lat, lon }));

  status.textContent = 'Computing…';
  rows.innerHTML = '';
  const minMoonSep = Number(moonSepInput?.value) || 0;
  const params = new URLSearchParams({
    lat: String(lat), lon: String(lon),
    min_alt: String(minAlt),
  });
  if (minMoonSep > 0) params.set('min_moon_sep', String(minMoonSep));
  if (time) {
    // Combine date+time as local — the resulting Date is correct UTC instant.
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + 12 * 3_600_000);
    if (Number.isNaN(start.getTime())) {
      status.textContent = 'Invalid date or time.';
      return;
    }
    params.set('start', start.toISOString());
    params.set('end', end.toISOString());
  } else {
    params.set('date', date);
  }
  if (includeObserved.checked) params.set('include_observed', '1');

  let data;
  try {
    data = await fetchJson(`/api/planner?${params}`);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    return;
  }

  const moonPct = (data.moon.illumination * 100).toFixed(0);
  const start = new Date(data.window.start);
  const end = new Date(data.window.end);
  moonLine.textContent = `Window: ${start.toLocaleString()} → ${end.toLocaleString()} · Moon at start: ${data.moon.name} (${moonPct}%)`;

  // Twilight + moon-up bands let the user eyeball when it's actually dark
  // and when the moon is interfering — no DSO planner is useful without
  // those two facts.
  function fmtBand(b) {
    return `${fmtTime(b.start)}–${fmtTime(b.end)}`;
  }
  const bandsBits = [];
  if (data.astro_dark_bands?.length) {
    bandsBits.push(`Astro dark: ${data.astro_dark_bands.map(fmtBand).join(', ')}`);
  } else {
    bandsBits.push('No astronomical darkness in this window.');
  }
  if (data.moon_up_bands?.length) {
    bandsBits.push(`Moon up: ${data.moon_up_bands.map(fmtBand).join(', ')}`);
  } else {
    bandsBits.push('Moon stays below horizon — full window usable.');
  }
  bandsLine.textContent = bandsBits.join(' · ');

  status.textContent = `${data.targets.length} target${data.targets.length === 1 ? '' : 's'} reaching ≥${minAlt}°`;

  if (!data.targets.length) {
    rows.appendChild(el('tr', {}, el('td', { colspan: '10' },
      el('div', { class: 'empty-state', text: 'Nothing clears the minimum altitude during this window.' }))));
    return;
  }

  for (const t of data.targets) {
    rows.appendChild(el('tr', { class: t.observed ? 'observed' : '' },
      el('td', {}, el('a', { href: `/object.html?id=${t.id}`, text: `${t.catalog}${t.catalog_number}` })),
      el('td', { text: t.name || '—' }),
      el('td', { text: typeLabel(t.object_type) }),
      el('td', { text: t.constellation || '—' }),
      el('td', { text: t.magnitude != null ? Number(t.magnitude).toFixed(1) : '—' }),
      el('td', { text: fmtDeg(t.max_altitude) }),
      el('td', { text: fmtTime(t.max_altitude_at) }),
      el('td', { text: fmtMinutes(t.minutes_above_min) }),
      el('td', { text: t.moon_separation_deg != null ? `${t.moon_separation_deg.toFixed(0)}°` : '—' }),
      el('td', { class: 'dim', text: t.list_name }),
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
    { timeout: 10000 },
  );
});

runBtn.addEventListener('click', load);

if (Number.isFinite(Number(latInput.value)) && Number.isFinite(Number(lonInput.value))) {
  load();
}
