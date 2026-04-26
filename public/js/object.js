import { fetchJson, el, formatRA, formatDec, typeLabel, highlightNav, qs } from './common.js';

highlightNav('home');

const root = document.getElementById('root');
const id = qs('id');

let isAdmin = false;

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

async function checkAdmin() {
  try {
    const res = await fetch('/api/admin/config');
    isAdmin = res.ok;
  } catch {
    isAdmin = false;
  }
}

async function makeFeatured(observationId, button) {
  if (!confirm('Make this the featured image for this object?')) return;
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/observations/${observationId}/feature`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render();
  } catch (err) {
    button.disabled = false;
    alert(`Failed to feature: ${err.message}`);
  }
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
  root.appendChild(el('p', { class: 'page-subtitle', text: subtitleBits.join(' · ') }));

  // Action row: log another attempt at this object.
  const actions = el('div', { class: 'object-actions' },
    el('a', {
      class: 'button-link',
      href: `/admin/upload.html?object_id=${encodeURIComponent(data.id)}`,
      text: data.attempts_count > 0 ? '+ Log another attempt' : '+ Log first attempt',
    }),
  );
  root.appendChild(actions);

  const metaList = el('dl', { class: 'meta-list' },
    ...meta('Catalog', `${data.catalog}${data.catalog_number}`),
    ...meta('Type', typeLabel(data.object_type)),
    ...meta('Constellation', data.constellation),
    ...meta('Right ascension', formatRA(data.ra_hours)),
    ...meta('Declination', formatDec(data.dec_degrees)),
    ...meta('Magnitude', data.magnitude != null ? data.magnitude.toFixed(1) : '—'),
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

  const obsSection = el('section', { class: 'section' },
    el('h2', { text: data.attempts_count > 1 ? 'Attempts' : 'Observations' }));

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
      if (conditionBits.length) {
        captionChildren.push(el('small', { class: 'dim', text: conditionBits.join(' · ') }));
      }
      if (isAdmin && !isFeatured && o.image_path) {
        const featureBtn = el('button', {
          type: 'button',
          class: 'feature-btn',
          title: 'Make this the featured image',
          text: '★ Make featured',
        });
        featureBtn.addEventListener('click', () => makeFeatured(o.id, featureBtn));
        captionChildren.push(featureBtn);
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

(async () => {
  await checkAdmin();
  await render();
})();
