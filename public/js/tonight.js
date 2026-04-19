import { fetchJson, el, typeLabel, highlightNav } from './common.js';

highlightNav('tonight');

const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const altInput = document.getElementById('alt-input');
const includeObserved = document.getElementById('include-observed');
const locateBtn = document.getElementById('locate-btn');
const refreshBtn = document.getElementById('refresh-btn');
const status = document.getElementById('status');
const moonLine = document.getElementById('moon-line');
const rows = document.getElementById('rows');

const STORE_KEY = 'deepskylog.location';
const stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
if (stored) {
  latInput.value = stored.lat;
  lonInput.value = stored.lon;
}

function fmtDeg(value, suffix = '°') {
  if (value == null) return '—';
  return `${value.toFixed(1)}${suffix}`;
}

function compass(az) {
  if (az == null) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(az / 45) % 8];
}

async function load() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const minAlt = Number(altInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    status.textContent = 'Enter a latitude and longitude.';
    return;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify({ lat, lon }));

  status.textContent = 'Computing…';
  rows.innerHTML = '';
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    min_alt: String(minAlt),
  });
  if (includeObserved.checked) params.set('include_observed', '1');

  let data;
  try {
    data = await fetchJson(`/api/tonight?${params}`);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    return;
  }

  const moonPct = (data.moon.illumination * 100).toFixed(0);
  moonLine.textContent = `Moon: ${data.moon.name} · ${moonPct}% illuminated · computed ${new Date(data.computed_at).toLocaleTimeString()}`;

  status.textContent = `${data.targets.length} target${data.targets.length === 1 ? '' : 's'} above ${minAlt}°`;

  if (!data.targets.length) {
    rows.appendChild(el('tr', {}, el('td', { colspan: '8' },
      el('div', { class: 'empty-state', text: 'Nothing matching above the horizon right now.' }))));
    return;
  }

  for (const t of data.targets) {
    rows.appendChild(el('tr', { class: t.observed ? 'observed' : '' },
      el('td', {}, el('a', { href: `/object.html?id=${t.id}`, text: `${t.catalog}${t.catalog_number}` })),
      el('td', { text: t.name || '—' }),
      el('td', { text: typeLabel(t.object_type) }),
      el('td', { text: t.constellation || '—' }),
      el('td', { text: t.magnitude != null ? t.magnitude.toFixed(1) : '—' }),
      el('td', { text: fmtDeg(t.altitude) }),
      el('td', { text: `${fmtDeg(t.azimuth)} ${compass(t.azimuth)}` }),
      el('td', { class: 'dim', text: t.list_name }),
    ));
  }
}

locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    status.textContent = 'Geolocation is not available in this browser.';
    return;
  }
  status.textContent = 'Requesting location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latInput.value = pos.coords.latitude.toFixed(4);
      lonInput.value = pos.coords.longitude.toFixed(4);
      load();
    },
    (err) => {
      status.textContent = `Geolocation failed: ${err.message}`;
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
  );
});

refreshBtn.addEventListener('click', load);
[latInput, lonInput, altInput, includeObserved].forEach((c) =>
  c.addEventListener('change', load));

if (Number.isFinite(Number(latInput.value)) && Number.isFinite(Number(lonInput.value))) {
  load();
} else {
  status.textContent = 'Enter coordinates or click "Use my location".';
}
