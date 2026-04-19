import { fetchJson, el, typeLabel, highlightNav } from './common.js';

highlightNav('gallery');

const telescopeSel = document.getElementById('filter-telescope');
const typeSel = document.getElementById('filter-type');
const imgChk = document.getElementById('filter-image');
const gallery = document.getElementById('gallery');
const countEl = document.getElementById('count');

async function loadFilters() {
  try {
    const { telescopes, objectTypes } = await fetchJson('/api/filters');
    for (const t of telescopes) telescopeSel.appendChild(el('option', { value: t, text: t }));
    for (const t of objectTypes) typeSel.appendChild(el('option', { value: t, text: typeLabel(t) }));
  } catch {}
}

function item(obs) {
  const thumb = obs.thumbnail_path
    ? el('span', {
        class: 'thumb',
        style: `background-image: url("/uploads/${obs.thumbnail_path}")`,
      })
    : el('span', { class: 'thumb empty', text: 'no image' });

  const id = obs.object_catalog && obs.object_catalog_number
    ? `${obs.object_catalog}${obs.object_catalog_number}`
    : '';
  const label = obs.title || [id, obs.object_name].filter(Boolean).join(' · ') || `Observation #${obs.id}`;
  const meta = [obs.telescope, typeLabel(obs.object_type)].filter(Boolean).join(' · ');
  const href = obs.object_id ? `/object.html?id=${obs.object_id}` : '#';

  return el('a', { class: 'gallery-item', href },
    thumb,
    el('div', { class: 'caption' },
      el('h4', { text: label }),
      el('small', { text: [obs.observed_at || obs.created_at, meta].filter(Boolean).join(' · ') }),
    ),
  );
}

async function load() {
  const params = new URLSearchParams();
  if (telescopeSel.value) params.set('telescope', telescopeSel.value);
  if (typeSel.value) params.set('object_type', typeSel.value);
  if (imgChk.checked) params.set('has_image', '1');

  gallery.innerHTML = '<p class="muted">Loading&hellip;</p>';
  try {
    const rows = await fetchJson(`/api/observations?${params}`);
    gallery.innerHTML = '';
    countEl.textContent = `${rows.length} observation${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      gallery.appendChild(el('div', { class: 'empty-state', text: 'No observations match these filters yet.' }));
      return;
    }
    for (const r of rows) gallery.appendChild(item(r));
  } catch {
    gallery.innerHTML = '';
    gallery.appendChild(el('p', { class: 'muted', text: 'Failed to load observations.' }));
  }
}

for (const ctrl of [telescopeSel, typeSel, imgChk]) {
  ctrl.addEventListener('change', load);
}

loadFilters().then(load);
