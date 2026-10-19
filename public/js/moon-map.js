// Moon map overlay for the observation page: named lunar features (from
// /api/observations/:id/moonmap, projected server-side by lib/moon_map.js)
// drawn as SVG over the photo — mare outlines, crater rims, mountains,
// rilles, landing sites — with layer toggles and labels placed so they
// don't collide. Coordinates arrive in the photo's own pixels; the SVG's
// viewBox matches them, so it scales with the image and only the label
// layout (done in screen pixels) is redone on resize.

import { el } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const STORE_KEY = 'moonmap.layers';

const LAYERS = [
  { key: 'mare', label: 'Maria' },
  { key: 'crater', label: 'Craters' },
  { key: 'mons', label: 'Mountains' },
  { key: 'rima', label: 'Rilles' },
  { key: 'landing', label: 'Landing sites' },
  { key: 'labels', label: 'Labels' },
  { key: 'night', label: 'Night side' },
];
const DEFAULTS = { mare: true, crater: true, mons: true, rima: true, landing: true, labels: true, night: false };

const KIND_NAME = { mare: 'Mare', crater: 'Crater', mons: 'Mountain', rima: 'Rille / valley', landing: 'Landing site', albedo: 'Albedo feature' };

// Smallest on-screen sizes (px, diameter) worth drawing / labelling.
const MIN_RIM_PX = 7;
const MIN_LABEL_PX = 16;
// Well-known craters, labelled ahead of the rest and even when small.
const NOTABLE = new Set([
  'Copernicus', 'Tycho', 'Kepler', 'Aristarchus', 'Plato', 'Grimaldi', 'Clavius', 'Ptolemaeus',
  'Alphonsus', 'Arzachel', 'Archimedes', 'Eratosthenes', 'Langrenus', 'Petavius', 'Theophilus',
  'Gassendi', 'Posidonius', 'Proclus', 'Schickard', 'Hipparchus', 'Endymion', 'Atlas', 'Hercules',
  'Aristoteles', 'Eudoxus', 'Cassini', 'Manilius', 'Menelaus', 'Cleomedes', 'Maginus', 'Bullialdus',
]);

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}

function saveLayers(layers) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(layers)); } catch { /* ignore */ }
}

const fmt = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}°`;

function caption(map) {
  const o = map.orientation;
  const how = o.source === 'manual'
    ? 'orientation set by hand'
    : `orientation matched automatically (${o.confidence} confidence)`;
  const lib = map.face?.libration;
  return [
    'Features from the IAU Gazetteer of Planetary Nomenclature',
    how,
    lib ? `libration ${fmt(lib.l)} / ${fmt(lib.b)}` : null,
    map.face ? `${Math.round(map.face.illuminated * 100)}% lit` : null,
  ].filter(Boolean).join(' · ');
}

const UNAVAILABLE = {
  'no-disk': "Moon map unavailable: couldn't find the Moon's edge in this photo.",
  'no-orientation': "Moon map unavailable: couldn't tell how this photo is turned (too little detail on the disk).",
  'no-date': 'Moon map unavailable: the photo needs a capture date.',
  'no-image': 'Moon map unavailable: the image file is missing.',
  error: "Moon map unavailable: the photo couldn't be read.",
};

// Wrap `img` (already in `frame`) with the overlay and append the controls
// after `frame`. Low-confidence matches start hidden unless `showUncertain`.
export function mountMoonMap(frame, img, map, { showUncertain = false } = {}) {
  if (!map || map.status !== 'ok') {
    const note = UNAVAILABLE[map?.status];
    if (note) frame.after(el('p', { class: 'moon-map-note dim', text: note }));
    return;
  }
  const W = map.image.width, H = map.image.height;
  const layers = loadLayers();
  const uncertain = map.orientation.confidence === 'low';
  let visible = !uncertain || showUncertain;

  const overlay = svg('svg', { class: 'moon-map-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
  frame.appendChild(overlay);

  const toggles = el('div', { class: 'moon-map-toggles', role: 'group', 'aria-label': 'Moon map layers' });
  const master = el('button', { type: 'button', class: 'moon-toggle master', text: 'Moon map' });
  const layerButtons = LAYERS.map((l) => {
    const b = el('button', { type: 'button', class: 'moon-toggle', text: l.label, 'data-layer': l.key });
    b.addEventListener('click', () => {
      layers[l.key] = !layers[l.key];
      saveLayers(layers);
      sync();
    });
    return b;
  });
  master.addEventListener('click', () => { visible = !visible; sync(); });
  toggles.append(master, ...layerButtons);
  const note = el('p', { class: 'moon-map-caption dim', text: uncertain
    ? "Couldn't confidently tell how this photo is turned, so the map is hidden — it may mislabel features."
    : caption(map) });
  frame.after(el('div', { class: 'moon-map-controls' }, toggles, note));

  function sync() {
    master.setAttribute('aria-pressed', String(visible));
    for (const b of layerButtons) {
      b.setAttribute('aria-pressed', String(!!layers[b.dataset.layer]));
      b.disabled = !visible;
    }
    overlay.style.display = visible ? '' : 'none';
    if (visible) draw();
  }

  function draw() {
    const shown = img.clientWidth;
    if (!shown) return;
    const scale = shown / W; // screen px per photo px
    const px = (n) => n / scale; // screen px → photo px
    const fontPx = shown < 560 ? 11 : 13;
    overlay.replaceChildren();
    overlay.style.setProperty('--moon-stroke', `${px(1.25)}px`);
    overlay.style.setProperty('--moon-halo', `${px(3)}px`);
    overlay.style.fontSize = `${px(fontPx)}px`;

    const groups = {};
    for (const k of ['mare', 'rima', 'mons', 'crater', 'landing', 'labels']) {
      groups[k] = svg('g', { class: `moon-layer moon-${k}` });
      overlay.appendChild(groups[k]);
    }
    const boxes = [];
    const fits = (b) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= shown && b.y1 <= img.clientHeight
      && !boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

    // Important names win the space: maria, landing sites, the well-known
    // craters, then everything else by size.
    const rankOf = (f) => (f.t === 'mare' ? 0 : f.t === 'landing' ? 1 : NOTABLE.has(f.n) ? 2 : 3);
    const features = map.features
      .filter((f) => layers[f.t] && (f.lit || layers.night || f.t === 'mare'))
      .sort((a, b) => (rankOf(a) - rankOf(b)) || (b.a - a.a));

    for (const f of features) {
      const dim = !f.lit;
      const sizePx = 2 * f.a * scale;
      const notable = f.t === 'crater' && NOTABLE.has(f.n);
      const tip = svg('title');
      tip.textContent = `${f.n} — ${KIND_NAME[f.t] || f.t}${f.d > 0 ? `, ${Math.round(f.d)} km` : ''}`;
      let marker = null;
      if (f.t === 'mare') {
        if (f.ring) marker = svg('polygon', { points: f.ring.map((p) => p.join(',')).join(' ') });
      } else if (f.t === 'crater') {
        if (sizePx < MIN_RIM_PX && !notable) continue;
        const ry = Math.max(f.a, px(3));
        const rx = Math.max(f.a > 0 ? f.b * (ry / f.a) : ry, px(1));
        marker = svg('ellipse', { cx: f.x, cy: f.y, rx, ry, transform: `rotate(${f.rot} ${f.x} ${f.y})` });
      } else if (f.t === 'landing') {
        marker = svg('circle', { cx: f.x, cy: f.y, r: px(3.5) });
      } else {
        if (sizePx < MIN_RIM_PX) continue;
        marker = svg('circle', { cx: f.x, cy: f.y, r: px(2.5) });
      }
      if (marker) {
        marker.appendChild(tip);
        if (dim) marker.classList.add('night');
        groups[f.t].appendChild(marker);
      }

      if (!layers.labels) continue;
      const tw = f.n.length * fontPx * 0.55, th = fontPx * 1.15;
      // A plain gets its name once it is at least half as wide as the name.
      const big = f.t === 'landing' || notable || (f.t === 'mare' ? sizePx >= tw / 2 : sizePx >= MIN_LABEL_PX);
      if (!big) continue;
      const sx = f.x * scale, sy = f.y * scale;
      const gap = f.t === 'crater' ? Math.max(f.a * scale, 3) + 3 : 6;
      const spots = f.t === 'mare'
        ? [[sx - tw / 2, sy - th / 2], [sx - tw / 2, sy - th * 1.6], [sx - tw / 2, sy + th * 0.6]]
        : [[sx + gap, sy - th / 2], [sx - gap - tw, sy - th / 2], [sx - tw / 2, sy - gap - th], [sx - tw / 2, sy + gap]];
      for (const [x0, y0] of spots) {
        const box = { x0, y0, x1: x0 + tw, y1: y0 + th };
        if (!fits(box)) continue;
        boxes.push(box);
        const text = svg('text', { x: px(x0), y: px(y0 + th * 0.8), class: `moon-label moon-label-${f.t}${dim ? ' night' : ''}` });
        text.textContent = f.n;
        groups.labels.appendChild(text);
        break;
      }
    }
    drawCompass(overlay, map.compass, W, px);
  }

  let pending = false;
  const redraw = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; if (visible) draw(); });
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(img);
  else window.addEventListener('resize', redraw);
  sync();
  if (!img.complete) img.addEventListener('load', sync, { once: true });
}

// Celestial N / E arrows in the top-right corner.
function drawCompass(overlay, compass, W, px) {
  if (!compass) return;
  const len = px(26), cx = W - px(40), cy = px(40);
  const g = svg('g', { class: 'moon-compass' });
  for (const [label, angle] of [['N', compass.north], ['E', compass.east]]) {
    const t = (angle * Math.PI) / 180;
    const x = cx + Math.sin(t) * len, y = cy - Math.cos(t) * len;
    g.appendChild(svg('line', { x1: cx, y1: cy, x2: x, y2: y }));
    const text = svg('text', { x: cx + Math.sin(t) * (len + px(9)), y: cy - Math.cos(t) * (len + px(9)) + px(4), 'text-anchor': 'middle' });
    text.textContent = label;
    g.appendChild(text);
  }
  overlay.appendChild(g);
}

// Same test as the server's isMoonObservation (lib/moon_map.js).
export function isMoonObservation(o) {
  if (!o) return false;
  if (o.object_type === 'MOON' || o.list_object_type === 'MOON') return true;
  if (String(o.catalog || '').toUpperCase() === 'SOL' && String(o.catalog_number || '').trim() === '2') return true;
  return /^\s*(the\s+)?moon\s*$/i.test(o.object_name || '');
}
