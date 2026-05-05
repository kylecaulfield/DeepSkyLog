import { fetchJson, el, formatRA, formatDec, typeLabel, qs } from './common.js';

const root = document.getElementById('root');
const id = qs('id');

function meta(label, value) {
  return [
    el('dt', { class: 'k', text: label }),
    el('dd', { class: 'v' }, value instanceof Node
      ? value
      : document.createTextNode(value == null || value === '' ? '—' : String(value))),
  ];
}

// SVG moon — phase 0 = new, 0.5 = full, 1 = back to new. We render an
// illuminated disc plus a shadow ellipse whose width matches the
// terminator. Good enough for a small page chip; not for selenography.
function moonSvg(phase) {
  if (phase == null || Number.isNaN(Number(phase))) return null;
  const p = Number(phase);
  // Illuminated fraction 0..1; cosine of phase angle gives the lit width.
  const lit = (1 - Math.cos(2 * Math.PI * p)) / 2;
  // Direction of illumination: waxing (0..0.5) lit on the right; waning on left.
  const waxing = p < 0.5;
  const r = 24, cx = 28, cy = 28;
  // Shadow is an ellipse: rx scales from r (new) -> 0 (full) -> r (new again).
  const rx = Math.abs(1 - 2 * lit) * r;
  // Place shadow centre on the lit-or-unlit side based on direction.
  const shadowOffset = waxing ? -1 : 1;        // shadow on the unlit side
  const cxShadow = cx + (lit < 0.5 ? 0 : shadowOffset * rx);
  // For a waxing gibbous (lit > 0.5), the shadow curves inward from the
  // unlit limb; we draw the lit disc and overlay an ellipse to carve it.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.setAttribute('class', 'moon-svg');
  svg.setAttribute('aria-hidden', 'true');
  // Background disc (unlit)
  const back = document.createElementNS(svg.namespaceURI, 'circle');
  back.setAttribute('cx', cx); back.setAttribute('cy', cy); back.setAttribute('r', r);
  back.setAttribute('fill', '#222');
  back.setAttribute('stroke', '#888'); back.setAttribute('stroke-width', '1');
  svg.appendChild(back);
  // Lit half (always the half facing the sun): use a clip path to draw
  // only one semicircle, then carve the terminator with an ellipse.
  const clipId = `moon-clip-${Math.random().toString(36).slice(2)}`;
  const defs = document.createElementNS(svg.namespaceURI, 'defs');
  const clip = document.createElementNS(svg.namespaceURI, 'clipPath');
  clip.setAttribute('id', clipId);
  const halfRect = document.createElementNS(svg.namespaceURI, 'rect');
  halfRect.setAttribute('y', cy - r);
  halfRect.setAttribute('height', r * 2);
  if (waxing) {
    halfRect.setAttribute('x', cx); halfRect.setAttribute('width', r);     // right half lit
  } else {
    halfRect.setAttribute('x', cx - r); halfRect.setAttribute('width', r); // left half lit
  }
  clip.appendChild(halfRect);
  defs.appendChild(clip);
  svg.appendChild(defs);
  const lit_disc = document.createElementNS(svg.namespaceURI, 'circle');
  lit_disc.setAttribute('cx', cx); lit_disc.setAttribute('cy', cy); lit_disc.setAttribute('r', r);
  lit_disc.setAttribute('fill', '#f1e9c2');
  lit_disc.setAttribute('clip-path', `url(#${clipId})`);
  svg.appendChild(lit_disc);
  // Terminator ellipse: shifts the lit/unlit boundary along the x axis.
  // Lit fraction < 0.5 → terminator lies inside the lit half (carving lit
  // away). Lit fraction > 0.5 → terminator lies inside the unlit half
  // (extending lit into it). We draw lit-coloured for the >0.5 case and
  // unlit-coloured for the <0.5 case.
  const term = document.createElementNS(svg.namespaceURI, 'ellipse');
  term.setAttribute('cx', cx); term.setAttribute('cy', cy);
  term.setAttribute('rx', rx); term.setAttribute('ry', r);
  term.setAttribute('fill', lit < 0.5 ? '#222' : '#f1e9c2');
  svg.appendChild(term);
  return svg;
}

function locationCard(o) {
  const wrap = el('div', { class: 'meta-list', style: 'margin-top:0.5rem;' });
  if (!o.latitude || !o.longitude) {
    wrap.appendChild(el('p', { class: 'dim', text: o.location || 'No GPS recorded.' }));
    return wrap;
  }
  if (o.location) wrap.appendChild(el('p', { class: 'dim', style: 'margin:0;', text: o.location }));
  wrap.appendChild(el('p', { class: 'dim', style: 'margin:0;',
    text: `${o.latitude.toFixed(4)}, ${o.longitude.toFixed(4)}` }));
  const mapDiv = el('div', { id: 'obs-map' });
  wrap.appendChild(mapDiv);
  // Defer map init until the element is in the DOM.
  setTimeout(() => {
    if (typeof L === 'undefined') return;
    const map = L.map('obs-map', { zoomControl: true }).setView([o.latitude, o.longitude], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);
    L.marker([o.latitude, o.longitude]).addTo(map);
  }, 0);
  return wrap;
}

function fmtCondition(o) {
  const bits = [];
  if (o.bortle != null) bits.push(`Bortle ${o.bortle}`);
  if (o.sqm != null) bits.push(`SQM ${Number(o.sqm).toFixed(2)}`);
  if (o.seeing != null) bits.push(`seeing ${o.seeing}/5`);
  if (o.transparency != null) bits.push(`transparency ${o.transparency}/5`);
  return bits.length ? bits.join(' · ') : '—';
}

function fmtCapture(o) {
  const bits = [];
  if (o.stack_count != null && o.exposure_seconds != null) {
    bits.push(`${o.stack_count}×${o.exposure_seconds}s`);
    const totalMin = (o.stack_count * o.exposure_seconds) / 60;
    bits.push(`${totalMin.toFixed(1)} min total`);
  } else if (o.exposure_seconds != null) {
    bits.push(`${o.exposure_seconds}s`);
  }
  if (o.gain != null) bits.push(`gain ${o.gain}`);
  if (o.iso != null) bits.push(`ISO ${o.iso}`);
  if (o.filter_name) bits.push(`filter ${o.filter_name}`);
  return bits.length ? bits.join(' · ') : '—';
}

async function render() {
  if (!id) {
    root.innerHTML = '<p class="muted">Missing observation id.</p>';
    return;
  }
  let data;
  try {
    data = await fetchJson(`/api/observations/${encodeURIComponent(id)}`);
  } catch {
    root.innerHTML = '<p class="muted">Observation not found.</p>';
    return;
  }
  const o = data.observation;
  const targetLabel = (o.catalog && o.catalog_number) ? `${o.catalog}${o.catalog_number}` : (o.title || `#${o.id}`);
  document.title = `DeepSkyLog — ${targetLabel}`;

  root.innerHTML = '';

  // Breadcrumb back to the object detail (when list-backed) or gallery.
  const back = o.list_object_id
    ? el('a', { href: `/object.html?id=${encodeURIComponent(o.list_object_id)}`,
                text: `← ${targetLabel} (${data.sibling_count} attempt${data.sibling_count === 1 ? '' : 's'})` })
    : el('a', { href: '/gallery.html', text: '← Gallery' });
  root.appendChild(el('p', { class: 'dim' }, back));

  // Title + subtitle
  const title = o.list_object_name || o.object_name || o.title || targetLabel;
  root.appendChild(el('h1', { class: 'page-title', text: title }));
  const subBits = [
    typeLabel(o.list_object_type || o.object_type),
    o.list_object_constellation,
    o.observed_at ? new Date(o.observed_at).toLocaleString() : (o.created_at ? new Date(o.created_at).toLocaleDateString() : null),
  ].filter(Boolean);
  root.appendChild(el('p', { class: 'page-subtitle', text: subBits.join(' · ') }));

  // Prev/next nav
  const navRow = el('div', { class: 'obs-nav' });
  const prev = data.prev_id
    ? el('a', { class: 'button-link ghost-link', href: `/observation.html?id=${data.prev_id}`, text: '← Previous' })
    : el('span', { class: 'button-link ghost-link', style: 'opacity:0.5; pointer-events:none;', text: '← Previous' });
  const next = data.next_id
    ? el('a', { class: 'button-link ghost-link', href: `/observation.html?id=${data.next_id}`, text: 'Next →' })
    : el('span', { class: 'button-link ghost-link', style: 'opacity:0.5; pointer-events:none;', text: 'Next →' });
  navRow.appendChild(prev);
  navRow.appendChild(el('span', { class: 'pos dim',
    text: `Attempt ${data.sibling_index + 1} of ${data.sibling_count}` }));
  navRow.appendChild(next);
  root.appendChild(navRow);

  // Hero: image left, sidebar metadata right
  const heroLeft = el('div', { class: 'obs-photo' });
  if (o.image_path) {
    heroLeft.appendChild(el('img', { src: `/uploads/${o.image_path}`, alt: title, loading: 'lazy' }));
  } else {
    heroLeft.appendChild(el('div', { class: 'empty', text: 'No image uploaded.' }));
  }

  // Object metadata block (catalog RA/Dec when list-backed; otherwise the
  // per-observation RA/Dec we store for free-form objects like comets).
  const ra = o.list_object_ra_hours ?? o.ra_hours;
  const dec = o.list_object_dec_degrees ?? o.dec_degrees;
  const objectMeta = el('dl', { class: 'meta-list' },
    ...meta('Catalog', (o.catalog && o.catalog_number) ? `${o.catalog}${o.catalog_number}` : '—'),
    ...meta('Type', typeLabel(o.list_object_type || o.object_type)),
    ...meta('Constellation', o.list_object_constellation || '—'),
    ...meta('Right ascension', formatRA(ra)),
    ...meta('Declination', formatDec(dec)),
    ...meta('Magnitude', (o.list_object_magnitude != null) ? Number(o.list_object_magnitude).toFixed(1) : '—'),
  );

  // Capture details
  const captureMeta = el('dl', { class: 'meta-list' },
    ...meta('Telescope', o.telescope),
    ...meta('Camera', o.camera),
    ...meta('Capture', fmtCapture(o)),
    ...meta('Focal length', o.focal_length_mm != null ? `${o.focal_length_mm} mm` : '—'),
    ...meta('Aperture', o.aperture != null ? `f/${Number(o.aperture).toFixed(1)}` : '—'),
    ...meta('Conditions', fmtCondition(o)),
    ...meta('Rating', o.rating ? '★'.repeat(o.rating) + '☆'.repeat(5 - o.rating) : '—'),
  );

  // Moon card
  const moonCard = el('div', { class: 'moon-card' });
  const moonSvgEl = moonSvg(o.moon_phase);
  if (moonSvgEl) moonCard.appendChild(moonSvgEl);
  moonCard.appendChild(el('div', {},
    el('div', { style: 'font-weight:600;', text: o.moon_phase_name || 'Moon' }),
    el('div', { class: 'dim', style: 'font-size:0.85em;',
      text: o.moon_phase != null
        ? `${(((1 - Math.cos(2 * Math.PI * Number(o.moon_phase))) / 2) * 100).toFixed(0)}% illuminated`
        : 'Phase not recorded.' }),
  ));

  // Location
  const locCard = locationCard(o);

  const sidebar = el('div', {},
    el('h3', { style: 'margin-top:0;', text: 'Object' }),
    objectMeta,
    el('h3', { text: 'Capture' }),
    captureMeta,
    el('h3', { text: 'Moon' }),
    moonCard,
    el('h3', { text: 'Location' }),
    locCard,
  );

  root.appendChild(el('section', { class: 'obs-hero' }, heroLeft, sidebar));

  // Notes
  if (o.description) {
    root.appendChild(el('section', { class: 'section' },
      el('h2', { text: 'Notes' }),
      el('p', { text: o.description, style: 'white-space:pre-wrap;' }),
    ));
  }

  // Bottom prev/next mirror
  root.appendChild(navRow.cloneNode(true));
}

// Arrow-key shortcuts for prev/next when the user isn't typing.
document.addEventListener('keydown', (e) => {
  if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const link = document.querySelector(
    e.key === 'ArrowLeft' ? '.obs-nav a[href*="/observation.html"]:first-of-type' : '.obs-nav a[href*="/observation.html"]:last-of-type',
  );
  if (link) link.click();
});

render();
