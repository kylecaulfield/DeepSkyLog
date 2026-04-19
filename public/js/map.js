import { fetchJson, highlightNav, el } from './common.js';

highlightNav('map');

const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

function popupNode(pin) {
  const objId = pin.object_catalog && pin.object_catalog_number
    ? `${pin.object_catalog}${pin.object_catalog_number}`
    : '';
  const heading = pin.title
    || [objId, pin.object_name].filter(Boolean).join(' · ')
    || `Observation #${pin.id}`;
  const meta = [pin.telescope, pin.observed_at, pin.location].filter(Boolean).join(' · ');
  const href = pin.object_id ? `/object.html?id=${encodeURIComponent(pin.object_id)}` : null;

  const children = [];
  if (pin.thumbnail_path) {
    children.push(el('img', {
      src: `/uploads/${encodeURI(pin.thumbnail_path)}`,
      alt: '',
      loading: 'lazy',
    }));
  }
  const titleNode = href
    ? el('a', { href }, heading)
    : document.createTextNode(heading);
  children.push(el('h4', {}, titleNode));
  children.push(el('small', { text: meta || '—' }));

  return el('div', { class: 'pin-popup' }, ...children);
}

async function render() {
  let pins = [];
  try {
    pins = await fetchJson('/api/observations/map');
  } catch {
    document.getElementById('count-line').textContent = 'Failed to load locations.';
    return;
  }

  document.getElementById('count-line').textContent =
    pins.length
      ? `${pins.length} observation${pins.length === 1 ? '' : 's'} with GPS data.`
      : 'No geotagged observations yet — upload a photo with EXIF GPS data to see a pin.';

  if (!pins.length) return;

  const bounds = [];
  for (const pin of pins) {
    const marker = L.marker([pin.latitude, pin.longitude]).addTo(map);
    marker.bindPopup(popupNode(pin));
    bounds.push([pin.latitude, pin.longitude]);
  }
  if (bounds.length === 1) map.setView(bounds[0], 10);
  else map.fitBounds(bounds, { padding: [40, 40] });
}

render();
