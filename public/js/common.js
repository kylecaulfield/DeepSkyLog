export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatRA(hours) {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const mFloat = (hours - h) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s}s`;
}

export function formatDec(degrees) {
  if (degrees == null) return '—';
  const sign = degrees < 0 ? '-' : '+';
  const abs = Math.abs(degrees);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(0);
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

export const OBJECT_TYPES = {
  GC: 'Globular Cluster',
  OC: 'Open Cluster',
  PN: 'Planetary Nebula',
  SNR: 'Supernova Remnant',
  DN: 'Diffuse Nebula',
  GAL: 'Galaxy',
  MW: 'Star Cloud',
  AST: 'Asterism',
  DS: 'Double Star',
};

export function typeLabel(code) {
  if (!code) return '—';
  return OBJECT_TYPES[code] || code;
}

export function highlightNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

// Star-Trek-flavoured stardate, using the popular post-2000 calendar formula:
//   stardate = (year - 2000) * 1000 + day_of_year / days_in_year * 1000
// Lands in the TNG-ish 26000s for 2026, climbs about 1000 per Earth year.
export function stardate(date = new Date()) {
  const year = date.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);
  const fraction = (date.getTime() - yearStart) / (yearEnd - yearStart);
  return ((year - 2000) * 1000 + fraction * 1000).toFixed(1);
}
