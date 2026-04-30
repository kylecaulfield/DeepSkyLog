import { fetchJson, el, formatRA, formatDec, typeLabel, highlightNav, qs } from './common.js';

highlightNav('home');

const root = document.getElementById('root');
const id = qs('id');

function meta(label, value) {
  return [
    el('dt', { class: 'k', text: label }),
    el('dd', { class: 'v' }, value instanceof Node ? value : document.createTextNode(value == null ? '—' : String(value))),
  ];
}

function heroPhoto(observations, featuredId) {
  const featured = observations.find((o) => o.id === featuredId && o.image_path)
    || observations.find((o) => o.image_path);
  if (featured) {
    return el('div', { class: 'object-photo' },
      el('img', {
        src: `/uploads/${featured.image_path}`,
        alt: `Observation of object ${id}`,
        loading: 'lazy',
      }),
    );
  }
  return el('div', { class: 'object-photo' },
    el('div', { class: 'empty', text: 'No photo uploaded for this object yet.' }),
  );
}

async function render() {
  if (!id) {
    root.innerHTML = '<p class="muted">Missing object id.</p>';
    return;
  }
  let data;
  try {
    data = await fetchJson(`/api/objects/${encodeURIComponent(id)}`);
  } catch {
    root.innerHTML = '<p class="muted">Object not found.</p>';
    return;
  }
  document.title = `DeepSkyLog — ${data.catalog}${data.catalog_number}`;

  root.innerHTML = '';
  root.appendChild(el('p', { class: 'dim' },
    el('a', { href: `/list.html?slug=${encodeURIComponent(data.list_slug)}`,
              text: `← ${data.list_name}` })));

  root.appendChild(el('h1', { class: 'page-title',
    text: `${data.catalog}${data.catalog_number}${data.name ? ' — ' + data.name : ''}` }));

  const subtitleBits = [typeLabel(data.object_type), data.constellation].filter(Boolean);
  if (data.attempts_count > 0) {
    subtitleBits.push(`${data.attempts_count} attempt${data.attempts_count === 1 ? '' : 's'}`);
  }
  if (data.live_coords) {
    subtitleBits.push(`live coords from low-precision ephemeris`);
  }
  root.appendChild(el('p', { class: 'page-subtitle', text: subtitleBits.join(' · ') }));

  const metaList = el('dl', { class: 'meta-list' },
    ...meta('Catalog', `${data.catalog}${data.catalog_number}`),
    ...meta('Type', typeLabel(data.object_type)),
    ...meta('Constellation', data.constellation || '—'),
    ...meta('Right ascension', formatRA(data.ra_hours)),
    ...meta('Declination', formatDec(data.dec_degrees)),
    ...meta('Magnitude', data.magnitude != null ? Number(data.magnitude).toFixed(1) : '—'),
    ...meta('Attempts', String(data.attempts_count)),
  );

  const memberships = el('div', { class: 'chip-row' },
    ...data.memberships.map((m) =>
      el('a', { class: 'chip', href: `/list.html?slug=${encodeURIComponent(m.slug)}`, text: m.list_name })),
  );

  root.appendChild(el('section', { class: 'object-hero' },
    heroPhoto(data.observations, data.featured_observation_id),
    el('div', {},
      metaList,
      el('h3', { style: 'margin-top:1.25rem;', text: 'List memberships' }),
      memberships,
    ),
  ));

  // Finder chart via Aladin Lite — only when we have coordinates.
  if (data.ra_hours != null && data.dec_degrees != null && typeof A !== 'undefined') {
    const chartSection = el('section', { class: 'section' },
      el('h2', { text: 'Finder chart' }),
      el('p', { class: 'dim',
        text: 'Sky around this target on a 1° field. Drag to pan, scroll to zoom. Survey: DSS coloured.' }),
      el('div', { id: 'aladin-lite-div', class: 'finder-chart' }),
    );
    root.appendChild(chartSection);
    queueMicrotask(() => {
      try {
        A.init.then(() => {
          const aladin = A.aladin('#aladin-lite-div', {
            survey: 'P/DSS2/color',
            fov: 1.0,
            target: `${data.ra_hours * 15} ${data.dec_degrees}`,
            cooFrame: 'J2000',
            showReticle: true,
            showZoomControl: true,
            showFullscreenControl: true,
            showLayersControl: false,
            showGotoControl: false,
            showShareControl: false,
            showFrame: false,
          });
        });
      } catch (err) {
        console.warn('Aladin init failed:', err);
      }
    });
  }

  const obsSection = el('section', { class: 'section' });
  const obsHeader = el('div', { class: 'section-header' },
    el('h2', { text: data.attempts_count > 1 ? 'Attempts' : 'Observations' }));
  if (data.observations.filter((o) => o.image_path).length >= 2) {
    const compareBtn = el('button', { type: 'button', class: 'button-link ghost-link', text: 'Compare two…' });
    compareBtn.addEventListener('click', () => openCompareModal(data.observations.filter((o) => o.image_path)));
    obsHeader.appendChild(compareBtn);
  }
  obsSection.appendChild(obsHeader);

  if (!data.observations.length) {
    obsSection.appendChild(el('div', { class: 'empty-state',
      text: 'No observations logged yet for this object.' }));
  } else {
    const grid = el('div', { class: 'gallery' });
    for (const o of data.observations) {
      const isFeatured = o.id === data.featured_observation_id;
      const thumb = o.thumbnail_path
        ? el('span', { class: 'thumb',
            style: `background-image: url("/uploads/${o.thumbnail_path}")` })
        : el('span', { class: 'thumb empty', text: 'no image' });

      const captureBits = [];
      if (o.stack_count != null && o.exposure_seconds != null) {
        captureBits.push(`${o.stack_count}×${o.exposure_seconds}s`);
        const totalMin = (o.stack_count * o.exposure_seconds) / 60;
        captureBits.push(`${totalMin.toFixed(1)} min total`);
      } else if (o.exposure_seconds != null) {
        captureBits.push(`${o.exposure_seconds}s exposure`);
      }
      if (o.gain != null) captureBits.push(`gain ${o.gain}`);
      if (o.filter_name) captureBits.push(o.filter_name);

      const conditionBits = [];
      if (o.seeing != null) conditionBits.push(`Seeing ${o.seeing}/5`);
      if (o.transparency != null) conditionBits.push(`Transparency ${o.transparency}/5`);
      if (o.bortle != null) conditionBits.push(`Bortle ${o.bortle}`);
      if (o.moon_phase_name) {
        const illum = o.moon_phase != null
          ? Math.round((1 - Math.cos(2 * Math.PI * o.moon_phase)) / 2 * 100)
          : null;
        conditionBits.push(illum != null ? `Moon: ${o.moon_phase_name} (${illum}%)` : `Moon: ${o.moon_phase_name}`);
      }
      const headingChildren = [
        document.createTextNode(o.title || (o.observed_at || o.created_at || 'Observation')),
      ];
      if (isFeatured) {
        headingChildren.push(' ');
        headingChildren.push(el('span', { class: 'badge badge-success', title: 'Featured', text: 'Featured' }));
      }
      const captionChildren = [
        el('h4', {}, ...headingChildren),
        el('small', { text: [o.telescope, o.camera].filter(Boolean).join(' · ') || '—' }),
      ];
      if (captureBits.length) {
        captionChildren.push(el('small', { class: 'dim', text: captureBits.join(' · ') }));
      }
      if (conditionBits.length) {
        captionChildren.push(el('small', { class: 'dim', text: conditionBits.join(' · ') }));
      }
      grid.appendChild(el('div', { class: 'gallery-item' + (isFeatured ? ' is-featured' : '') },
        thumb,
        el('div', { class: 'caption' }, ...captionChildren),
      ));
    }
    obsSection.appendChild(grid);
  }
  root.appendChild(obsSection);
}

function openCompareModal(observations) {
  const overlay = el('div', { class: 'modal-overlay' });
  const card = el('div', { class: 'modal compare-modal' });
  card.appendChild(el('h3', { text: 'Compare attempts' }));

  const pickerRow = el('div', { class: 'row' });
  const makeSelect = (which, defaultId) => {
    const sel = el('select', { 'data-which': which });
    for (const o of observations) {
      const label = `#${o.id} · ${o.observed_at || o.created_at || ''} · ${o.telescope || '—'}`
        + (o.rating ? ` · ${'★'.repeat(o.rating)}` : '');
      const opt = el('option', { value: String(o.id), text: label });
      if (o.id === defaultId) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('label', { class: 'field' }, el('span', { text: which === 'a' ? 'Left' : 'Right' }), sel);
  };
  pickerRow.appendChild(makeSelect('a', observations[0]?.id));
  pickerRow.appendChild(makeSelect('b', observations[1]?.id));
  card.appendChild(pickerRow);

  const grid = el('div', { class: 'compare-grid' });
  card.appendChild(grid);

  const close = el('div', { class: 'actions' });
  const closeBtn = el('button', { type: 'button', class: 'ghost', text: 'Close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  close.appendChild(closeBtn);
  card.appendChild(close);

  function render() {
    grid.innerHTML = '';
    for (const which of ['a', 'b']) {
      const sel = card.querySelector(`select[data-which="${which}"]`);
      const o = observations.find((x) => String(x.id) === sel.value);
      if (!o) continue;
      const meta = el('dl', { class: 'meta-list' });
      const add = (k, v) => {
        meta.appendChild(el('dt', { class: 'k', text: k }));
        meta.appendChild(el('dd', { class: 'v', text: v == null || v === '' ? '—' : String(v) }));
      };
      add('Captured', o.observed_at || o.created_at || '—');
      add('Telescope', o.telescope || '—');
      add('Rating', o.rating ? '★'.repeat(o.rating) : '—');
      const captureBits = [];
      if (o.stack_count != null && o.exposure_seconds != null) {
        const totalMin = (o.stack_count * o.exposure_seconds) / 60;
        captureBits.push(`${o.stack_count}×${o.exposure_seconds}s = ${totalMin.toFixed(1)} min`);
      } else if (o.exposure_seconds) {
        captureBits.push(`${o.exposure_seconds}s`);
      }
      if (o.gain != null) captureBits.push(`gain ${o.gain}`);
      if (o.filter_name) captureBits.push(o.filter_name);
      add('Capture', captureBits.join(' · '));
      const condBits = [];
      if (o.seeing != null) condBits.push(`See ${o.seeing}/5`);
      if (o.transparency != null) condBits.push(`Trans ${o.transparency}/5`);
      if (o.bortle != null) condBits.push(`Bortle ${o.bortle}`);
      if (o.moon_phase_name) condBits.push(`Moon ${o.moon_phase_name}`);
      add('Conditions', condBits.join(' · '));
      add('Location', o.location || '—');

      const card2 = el('div', { class: 'compare-card' },
        el('img', { src: `/uploads/${o.image_path}`, alt: `Observation ${o.id}`, loading: 'lazy' }),
        meta,
      );
      grid.appendChild(card2);
    }
  }

  card.querySelectorAll('select').forEach((s) => s.addEventListener('change', render));
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  render();
}

render();
