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

function heroPhoto(observations) {
  const featured = observations.find((o) => o.image_path);
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
  root.appendChild(el('p', { class: 'page-subtitle',
    text: [typeLabel(data.object_type), data.constellation].filter(Boolean).join(' · ') }));

  const metaList = el('dl', { class: 'meta-list' },
    ...meta('Catalog', `${data.catalog}${data.catalog_number}`),
    ...meta('Type', typeLabel(data.object_type)),
    ...meta('Constellation', data.constellation),
    ...meta('Right ascension', formatRA(data.ra_hours)),
    ...meta('Declination', formatDec(data.dec_degrees)),
    ...meta('Magnitude', data.magnitude != null ? data.magnitude.toFixed(1) : '—'),
    ...meta('Observations', String(data.observations.length)),
  );

  const memberships = el('div', { class: 'chip-row' },
    ...data.memberships.map((m) =>
      el('a', { class: 'chip', href: `/list.html?slug=${encodeURIComponent(m.slug)}`, text: m.list_name })),
  );

  root.appendChild(el('section', { class: 'object-hero' },
    heroPhoto(data.observations),
    el('div', {},
      metaList,
      el('h3', { style: 'margin-top:1.25rem;', text: 'List memberships' }),
      memberships,
    ),
  ));

  const obsSection = el('section', { class: 'section' },
    el('h2', { text: 'Observations' }));

  if (!data.observations.length) {
    obsSection.appendChild(el('div', { class: 'empty-state',
      text: 'No observations logged yet for this object.' }));
  } else {
    const grid = el('div', { class: 'gallery' });
    for (const o of data.observations) {
      const thumb = o.thumbnail_path
        ? el('span', { class: 'thumb',
            style: `background-image: url("/uploads/${o.thumbnail_path}")` })
        : el('span', { class: 'thumb empty', text: 'no image' });
      grid.appendChild(el('div', { class: 'gallery-item' },
        thumb,
        el('div', { class: 'caption' },
          el('h4', { text: o.title || (o.observed_at || o.created_at || 'Observation') }),
          el('small', { text: [o.telescope, o.camera].filter(Boolean).join(' · ') || '—' }),
        ),
      ));
    }
    obsSection.appendChild(grid);
  }
  root.appendChild(obsSection);
}

render();
