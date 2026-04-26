import { fetchJson, el, highlightNav, stardate } from './common.js';

highlightNav('home');

const stardateEl = document.getElementById('stardate');
if (stardateEl) {
  const tick = () => { stardateEl.textContent = `Stardate ${stardate()}`; };
  tick();
  setInterval(tick, 60_000);
}

function listCard(list) {
  const pct = list.object_count > 0
    ? Math.round((list.completed_count / list.object_count) * 100)
    : 0;

  return el(
    'a',
    { class: 'card', href: `/list.html?slug=${encodeURIComponent(list.slug)}` },
    el('div', { class: 'card-title' },
      el('h3', { text: list.name }),
      el('span', { class: 'badge' + (pct === 100 ? ' badge-success' : ''), text: `${pct}%` }),
    ),
    el('p', { class: 'card-description', text: list.description || '' }),
    el('div', { class: 'progress' }, el('span', { style: `width: ${pct}%` })),
    el('div', { class: 'card-meta' },
      el('span', {}, el('strong', { text: String(list.completed_count) }), ` of ${list.object_count} observed`),
      el('span', { class: 'dim', text: list.builtin ? 'Built-in' : 'Custom' }),
    ),
  );
}

function galleryItem(obs) {
  const thumb = obs.thumbnail_path
    ? el('span', {
        class: 'thumb',
        style: `background-image: url("/uploads/${obs.thumbnail_path}")`,
      })
    : el('span', { class: 'thumb empty', text: 'no image' });

  const label = obs.title
    || (obs.object_catalog && obs.object_catalog_number
      ? `${obs.object_catalog}${obs.object_catalog_number}${obs.object_name ? ' · ' + obs.object_name : ''}`
      : `Observation #${obs.id}`);

  return el(
    'a',
    { class: 'gallery-item', href: obs.object_id ? `/object.html?id=${obs.object_id}` : '#' },
    thumb,
    el('div', { class: 'caption' },
      el('h4', { text: label }),
      el('small', { text: obs.observed_at || obs.created_at || '' }),
    ),
  );
}

async function render() {
  const cards = document.getElementById('list-cards');
  const recent = document.getElementById('recent');

  try {
    const lists = await fetchJson('/api/lists');
    cards.innerHTML = '';
    if (!lists.length) {
      cards.appendChild(el('p', { class: 'muted', text: 'No lists yet.' }));
    } else {
      for (const list of lists) cards.appendChild(listCard(list));
    }
  } catch (e) {
    cards.innerHTML = '';
    cards.appendChild(el('p', { class: 'muted', text: 'Failed to load lists.' }));
  }

  try {
    const obs = await fetchJson('/api/observations');
    recent.innerHTML = '';
    const recentObs = obs.slice(0, 8);
    if (!recentObs.length) {
      recent.appendChild(el('div', { class: 'empty-state', text: 'No observations logged yet.' }));
    } else {
      for (const o of recentObs) recent.appendChild(galleryItem(o));
    }
  } catch (e) {
    recent.innerHTML = '';
    recent.appendChild(el('p', { class: 'muted', text: 'Failed to load observations.' }));
  }
}

render();
