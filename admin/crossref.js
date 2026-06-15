import { fetchJson, el, typeLabel } from '/js/common.js';

const groupsEl = document.getElementById('groups');
const suggSection = document.getElementById('suggestions-section');
const suggEl = document.getElementById('suggestions');
const filterEl = document.getElementById('filter');
const tolEl = document.getElementById('tol');
const multiOnlyEl = document.getElementById('multi-only');

const state = { data: null };

function formatCoord(g) {
  if (g.ra_hours == null || g.dec_degrees == null) return '';
  const ra = Number(g.ra_hours).toFixed(2);
  const dec = (g.dec_degrees >= 0 ? '+' : '') + Number(g.dec_degrees).toFixed(2);
  return `RA ${ra}h · Dec ${dec}°`;
}

function memberLine(m) {
  const desig = `${m.catalog}${m.catalog_number}`;
  return el('div', { class: 'xref-member' },
    el('a', { href: `/admin/object.html?id=${encodeURIComponent(m.id)}`, text: desig }),
    el('span', { text: ` · ${m.list_name}` }),
    m.object_type ? el('span', { text: ` · ${typeLabel(m.object_type)}` }) : null,
    m.name ? el('span', { text: ` · ${m.name}` }) : null,
  );
}

function groupCard(g) {
  const card = el('div', { class: 'xref-group' });
  card.appendChild(el('h3', {},
    document.createTextNode(g.name || g.designations[0] || g.key),
    el('span', { class: 'coord', text: formatCoord(g) }),
  ));

  const desigRow = el('div', { class: 'desig-row' });
  for (const d of g.designations) desigRow.appendChild(el('span', { class: 'desig', text: d }));
  card.appendChild(desigRow);

  const badges = el('div', { class: 'list-badges' });
  for (const l of g.lists) badges.appendChild(el('span', { class: 'list-badge', text: l.name }));
  card.appendChild(badges);

  const members = el('div', { class: 'xref-members' });
  for (const m of g.members) members.appendChild(memberLine(m));
  card.appendChild(members);

  return card;
}

function matchesFilter(g, q) {
  if (!q) return true;
  const hay = [
    g.name || '', g.key,
    ...g.designations,
    ...g.members.map((m) => `${m.catalog}${m.catalog_number} ${m.name || ''}`),
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderGroups() {
  if (!state.data) return;
  const q = filterEl.value.trim().toLowerCase();
  const multiOnly = multiOnlyEl.checked;
  const shown = state.data.groups.filter(
    (g) => (!multiOnly || g.multi) && matchesFilter(g, q),
  );

  groupsEl.innerHTML = '';
  if (!shown.length) {
    groupsEl.appendChild(el('p', { class: 'empty-note', text: 'No targets match.' }));
    return;
  }
  for (const g of shown) groupsEl.appendChild(groupCard(g));
}

async function linkPair(sugg, button, statusEl) {
  const ids = [...new Set([...sugg.a.ids, ...sugg.b.ids])];
  button.disabled = true;
  statusEl.textContent = 'Linking…';
  try {
    const res = await fetch('/api/admin/crossref/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    statusEl.textContent = 'Linked — reloading…';
    await load();
  } catch (err) {
    button.disabled = false;
    statusEl.textContent = `Failed: ${err.message}`;
  }
}

function suggestionRow(sugg) {
  const row = el('div', { class: 'sugg' });
  const label = (side) => side.name
    ? `${side.name} (${side.designations.join(', ')})`
    : side.designations.join(', ');
  row.appendChild(el('div', { class: 'pair' },
    el('span', { text: label(sugg.a) }),
    el('span', { text: '  ⇄  ' }),
    el('span', { text: label(sugg.b) }),
    el('span', { text: '  ' }),
    el('span', { class: 'sep', text: `${sugg.separation_arcmin}′ apart` }),
  ));
  const status = el('span', { class: 'sugg-status' });
  const btn = el('button', { class: 'button-link', text: 'Link as same target' });
  btn.addEventListener('click', () => linkPair(sugg, btn, status));
  row.appendChild(el('div', { class: 'dash-actions', style: 'align-items:center;' }, status, btn));
  return row;
}

function renderSuggestions() {
  const list = state.data?.suggestions || [];
  if (!list.length) {
    suggSection.hidden = true;
    return;
  }
  suggSection.hidden = false;
  suggEl.innerHTML = '';
  for (const s of list) suggEl.appendChild(suggestionRow(s));
}

function renderCounts() {
  const c = state.data?.counts || {};
  document.getElementById('cnt-targets').textContent = c.targets ?? '—';
  document.getElementById('cnt-multi').textContent = c.multi ?? '—';
  document.getElementById('cnt-entries').textContent = c.entries ?? '—';
  document.getElementById('cnt-sugg').textContent = c.suggestions ?? '—';
}

async function load() {
  const arcmin = Math.max(0, Number(tolEl.value) || 0);
  const tolDeg = arcmin / 60;
  try {
    state.data = await fetchJson(`/api/admin/crossref?tol=${encodeURIComponent(tolDeg)}`);
  } catch (err) {
    groupsEl.innerHTML = '';
    groupsEl.appendChild(el('p', { class: 'empty-note', text: `Failed to load: ${err.message}` }));
    return;
  }
  renderCounts();
  renderSuggestions();
  renderGroups();
}

filterEl.addEventListener('input', renderGroups);
multiOnlyEl.addEventListener('change', renderGroups);
let tolTimer = null;
tolEl.addEventListener('input', () => {
  clearTimeout(tolTimer);
  tolTimer = setTimeout(load, 400);
});

load();
