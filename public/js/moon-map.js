// Moon map overlay for the observation page: named lunar features (from
// /api/observations/:id/moonmap, projected server-side by lib/moon_map.js)
// drawn as SVG over the photo — mare outlines, crater rims, mountains,
// rilles, landing sites — with layer toggles and labels placed so they
// don't collide. Coordinates arrive in the photo's own pixels; the SVG's
// viewBox matches them, so it scales with the image and only the label
// layout (done in screen pixels) is redone on resize.
//
// Every feature is a link (its Wikipedia article, else its IAU gazetteer
// entry) with a tooltip card: kind and size, where the name comes from,
// position, sunlit or not. On touch screens the first tap shows the card
// (with the link in it) and a second tap follows the link.

import { el } from './common.js';

const NS = 'http://www.w3.org/2000/svg';
const STORE_KEY = 'moonmap.layers';

const LAYERS = [
  { key: 'mare', label: 'Maria' },
  { key: 'crater', label: 'Craters' },
  { key: 'mons', label: 'Mountains' },
  { key: 'rima', label: 'Rilles & ridges' },
  { key: 'landing', label: 'Landing sites' },
  { key: 'labels', label: 'Labels' },
  { key: 'night', label: 'Night side' },
];
const DEFAULTS = { mare: true, crater: true, mons: true, rima: true, landing: true, labels: true, night: false };

const KIND_NAME = { mare: 'Mare', crater: 'Crater', mons: 'Mountain', rima: 'Rille', landing: 'Landing site' };

// What kind of feature, in plain words. The layers lump several gazetteer
// types together (seas, lakes, bays and marshes are all 'mare'; rilles,
// valleys, scarps and wrinkle ridges all 'rima'); the names say which.
const NAME_KINDS = [
  [/^Mare /, 'Sea (mare)'], [/^Oceanus /, 'Ocean'], [/^Lacus /, 'Lake (lacus)'],
  [/^Sinus /, 'Bay (sinus)'], [/^Palus /, 'Marsh (palus)'],
  [/^Montes /, 'Mountain range'], [/^Mons /, 'Mountain'], [/^Promontorium /, 'Promontory'],
  [/^Rimae /, 'Rilles'], [/^Rima /, 'Rille'], [/^Vall/, 'Valley'], [/^Rup/, 'Scarp'],
  [/^Dorsa /, 'Wrinkle ridges'], [/^Dorsum /, 'Wrinkle ridge'],
];
function kindName(f) {
  if (f.t !== 'crater' && f.t !== 'landing') {
    const hit = NAME_KINDS.find(([re]) => re.test(f.n));
    if (hit) return hit[1];
  }
  return KIND_NAME[f.t] || f.t;
}

// "96 km across" / "155 km long", or '' when the gazetteer gives no size.
function sizeText(f) {
  if (!(f.d > 0)) return '';
  const km = `${f.d >= 10 ? Math.round(f.d) : f.d} km`;
  return f.t === 'rima' || /^Montes /.test(f.n) ? `${km} long` : `${km} across`;
}

const latLon = (f) => `${Math.abs(f.lat).toFixed(1)}° ${f.lat >= 0 ? 'N' : 'S'}, ${Math.abs(f.lon).toFixed(1)}° ${f.lon >= 0 ? 'E' : 'W'}`;

// Where a feature links: its Wikipedia article, else its IAU entry.
function featureLink(f) {
  if (f.w) return { href: `https://en.wikipedia.org/wiki/${encodeURIComponent(f.w)}`, site: 'Wikipedia' };
  if (f.g) return { href: `https://planetarynames.wr.usgs.gov/Feature/${f.g}`, site: 'the IAU gazetteer' };
  return null;
}

// Label width in screen px, measured in the labels' own font (a fixed
// per-character guess under-reads wide names, and labels then collide).
let measurer = null;
function textWidth(text, fontPx) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * fontPx * 0.62;
  measurer.font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  return measurer.measureText(text).width;
}

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

  const overlay = svg('svg', {
    class: 'moon-map-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet',
    role: 'group', 'aria-label': 'Named features on this photo',
  });
  frame.appendChild(overlay);
  const tip = el('div', { class: 'moon-tip', role: 'tooltip', hidden: 'hidden' });
  frame.appendChild(tip);
  // The features drawn last, by the data-i on their elements.
  let shownFeatures = [];

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
  const note = el('p', { class: 'moon-map-caption dim' });
  frame.after(el('div', { class: 'moon-map-controls' }, toggles, note));

  function sync() {
    note.textContent = !uncertain ? caption(map)
      : visible ? `Low-confidence match, so some labels may be in the wrong place · ${caption(map)}`
      : "Couldn't confidently tell how this photo is turned, so the map is hidden — it may mislabel features.";
    master.setAttribute('aria-pressed', String(visible));
    for (const b of layerButtons) {
      b.setAttribute('aria-pressed', String(!!layers[b.dataset.layer]));
      b.disabled = !visible;
    }
    overlay.style.display = visible ? '' : 'none';
    hideTip();
    if (visible) draw();
  }

  // --- Tooltip ------------------------------------------------------------

  let tipFor = null; // index into shownFeatures, or null
  let pinned = false;
  let lastPointer = 'mouse';

  function fillTip(f, link, withLink) {
    const kind = [kindName(f), sizeText(f)].filter(Boolean).join(' · ');
    tip.replaceChildren(
      el('strong', { class: 'moon-tip-name', text: f.n }),
      el('span', { class: 'moon-tip-kind', text: kind }),
      f.o ? el('p', { class: 'moon-tip-origin', text: f.o }) : null,
      el('span', { class: 'moon-tip-meta', text: `${latLon(f)} · ${f.lit ? 'in sunlight' : 'on the night side'}` }),
      !link ? null
        : withLink
          ? el('a', { class: 'moon-tip-link', href: link.href, target: '_blank', rel: 'noopener', text: `Read more on ${link.site} ↗` })
          : el('span', { class: 'moon-tip-link', text: `Click for more on ${link.site} ↗` }),
    );
    tip.dataset.kind = f.t;
  }

  // Put the card near (x, y) in frame pixels: beside the point, within the
  // frame's width; below it unless it fits above, where it must stay clear
  // of the frame's top and of a sticky site header (it may run past the
  // photo's bottom edge, over the controls).
  function placeTip(x, y) {
    const fw = frame.clientWidth, fh = frame.clientHeight;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x + 14;
    if (left + tw > fw - 4) left = x - 14 - tw;
    const header = document.querySelector('.site-header');
    const headerBottom = header && /sticky|fixed/.test(getComputedStyle(header).position)
      ? header.getBoundingClientRect().bottom : 0;
    const clearTop = Math.max(4, headerBottom - frame.getBoundingClientRect().top + 4);
    let top = y + 14;
    if (top + th > fh - 4 && y - 14 - th >= clearTop) top = y - 14 - th;
    tip.style.left = `${Math.max(4, Math.min(left, fw - tw - 4))}px`;
    tip.style.top = `${Math.max(clearTop, top)}px`;
  }

  function highlight(i, on) {
    for (const node of overlay.querySelectorAll(`[data-i="${i}"]`)) node.classList.toggle('hot', on);
  }

  function showTip(i, x, y, { pin = false } = {}) {
    const f = shownFeatures[i];
    if (!f) return;
    if (tipFor !== null && tipFor !== i) highlight(tipFor, false);
    tipFor = i;
    pinned = pin;
    fillTip(f, featureLink(f), pin);
    tip.classList.toggle('pinned', pin);
    tip.hidden = false;
    placeTip(x, y);
    highlight(i, true);
  }

  function hideTip() {
    if (tipFor !== null) highlight(tipFor, false);
    tipFor = null;
    pinned = false;
    tip.hidden = true;
    tip.classList.remove('pinned');
  }

  const framePoint = (e) => {
    const r = frame.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const featureOf = (node) => node?.closest?.('[data-i]');

  overlay.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; });
  overlay.addEventListener('pointerover', (e) => {
    if (pinned || e.pointerType === 'touch') return;
    const node = featureOf(e.target);
    if (node) showTip(Number(node.dataset.i), ...framePoint(e));
  });
  overlay.addEventListener('pointermove', (e) => {
    if (pinned || e.pointerType === 'touch' || tipFor === null) return;
    const node = featureOf(e.target);
    if (!node) return hideTip();
    const i = Number(node.dataset.i);
    if (i !== tipFor) showTip(i, ...framePoint(e));
    else placeTip(...framePoint(e));
  });
  overlay.addEventListener('pointerleave', () => { if (!pinned) hideTip(); });
  // Touch: the first tap on a feature shows its card; a second follows the link.
  overlay.addEventListener('click', (e) => {
    const node = featureOf(e.target);
    if (!node || lastPointer !== 'touch') return;
    const i = Number(node.dataset.i);
    if (pinned && tipFor === i) return;
    e.preventDefault();
    showTip(i, ...framePoint(e), { pin: true });
  });
  // Keyboard: a focused label shows its card beside the feature (a click
  // focuses it too, but the card is already at the pointer).
  overlay.addEventListener('focusin', (e) => {
    const node = featureOf(e.target);
    const f = node && shownFeatures[Number(node.dataset.i)];
    let keyboard = true;
    try { keyboard = node.matches(':focus-visible'); } catch { /* old browser */ }
    if (!f || !keyboard) return;
    const scale = img.clientWidth / W;
    showTip(Number(node.dataset.i), f.x * scale, f.y * scale);
  });
  overlay.addEventListener('focusout', () => { if (!pinned) hideTip(); });
  // A pinned card closes on a tap elsewhere or Escape. These listen on the
  // document, so they let go once the overlay is gone (the admin modal
  // mounts a fresh one each time it redraws).
  const onDocPointer = (e) => {
    if (!frame.isConnected) return unlisten();
    if (pinned && !tip.contains(e.target) && !featureOf(e.target)) hideTip();
  };
  const onDocKey = (e) => {
    if (!frame.isConnected) return unlisten();
    if (e.key === 'Escape' && tipFor !== null) hideTip();
  };
  const unlisten = () => {
    document.removeEventListener('pointerdown', onDocPointer);
    document.removeEventListener('keydown', onDocKey);
  };
  document.addEventListener('pointerdown', onDocPointer);
  document.addEventListener('keydown', onDocKey);

  function draw() {
    const shown = img.clientWidth;
    if (!shown) return;
    const scale = shown / W; // screen px per photo px
    const px = (n) => n / scale; // screen px → photo px
    const fontPx = shown < 560 ? 11 : 13;
    overlay.replaceChildren();
    hideTip();
    shownFeatures = [];
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

    // A feature's marker and label are each wrapped in a link to it; only the
    // label is a tab stop (and named for screen readers), so the marker
    // doesn't double it.
    const linkFor = (f, i, labelled) => {
      const link = featureLink(f);
      const attrs = { class: 'moon-feature', 'data-i': i };
      if (link) Object.assign(attrs, { href: link.href, target: '_blank', rel: 'noopener' });
      if (labelled) attrs['aria-label'] = [f.n, [kindName(f), sizeText(f)].filter(Boolean).join(', '), f.o].filter(Boolean).join('. ');
      else Object.assign(attrs, { tabindex: '-1', 'aria-hidden': 'true' });
      return svg(link ? 'a' : 'g', attrs);
    };

    for (const f of features) {
      const dim = !f.lit;
      const sizePx = 2 * f.a * scale;
      const notable = f.t === 'crater' && NOTABLE.has(f.n);
      const parts = [];
      if (f.t === 'mare') {
        if (f.ring) parts.push(svg('polygon', { points: f.ring.map((p) => p.join(',')).join(' ') }));
      } else if (f.t === 'crater') {
        if (sizePx < MIN_RIM_PX && !notable) continue;
        const ry = Math.max(f.a, px(3));
        const rx = Math.max(f.a > 0 ? f.b * (ry / f.a) : ry, px(1));
        parts.push(svg('ellipse', { cx: f.x, cy: f.y, rx, ry, transform: `rotate(${f.rot} ${f.x} ${f.y})` }));
      } else {
        if (f.t !== 'landing' && sizePx < MIN_RIM_PX) continue;
        // A dot is small to point at: an invisible, bigger target round it.
        parts.push(svg('circle', { class: 'hit', cx: f.x, cy: f.y, r: px(9) }));
        parts.push(svg('circle', { cx: f.x, cy: f.y, r: px(f.t === 'landing' ? 3.5 : 2.5) }));
      }
      const i = shownFeatures.length;
      shownFeatures.push(f);
      if (parts.length) {
        const marker = linkFor(f, i, false);
        marker.append(...parts);
        if (dim) marker.classList.add('night');
        groups[f.t].appendChild(marker);
      }

      if (!layers.labels) continue;
      // +4 for the dark halo round the glyphs.
      const tw = textWidth(f.n, fontPx) + 4, th = fontPx * 1.15;
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
        const label = linkFor(f, i, true);
        label.appendChild(text);
        groups.labels.appendChild(label);
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
