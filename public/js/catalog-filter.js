// Shared catalog-filter UI used by /planner.html, /seestar.html and
// /tonight.html. Renders a <details> drop-down of checkboxes for each
// seeded list; the selection persists in localStorage so picking
// Messier + Caldwell on the planner page carries over to the Seestar
// planner. Empty selection (all unchecked) means "no filter — show
// every list", matching the server's default behaviour.

import { fetchJson, el } from './common.js';

const STORE_KEY = 'deepskylog.catalog_filter';

function loadStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

function storeSelection(slugs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(slugs));
  } catch { /* private mode, ignore */ }
}

// Render the filter into `container`. Calls `onChange()` whenever the
// user toggles a checkbox. Returns a function that fetches the current
// selection as an array of slugs.
export async function mountCatalogFilter(container, onChange) {
  let lists;
  try {
    lists = await fetchJson('/api/lists');
  } catch {
    container.appendChild(el('span', { class: 'dim', text: 'Catalog filter unavailable.' }));
    return () => [];
  }
  const stored = loadStored();
  // First-time use: every catalog is checked, equivalent to "no filter".
  const startSelection = stored == null
    ? lists.map((l) => l.slug)
    : stored.filter((s) => lists.some((l) => l.slug === s));

  const summary = el('summary', { style: 'cursor:pointer; padding:0.1rem 0.3rem;' });
  const summaryLabel = document.createTextNode('');
  summary.appendChild(summaryLabel);

  const grid = el('div', {
    style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(11rem, 1fr)); gap:0.2rem 0.6rem; padding:0.4rem 0.6rem; background:#1a0f08; border:1px solid var(--accent); border-radius:6px; margin-top:0.25rem;',
  });

  const checkboxes = [];
  for (const l of lists) {
    const cb = el('input', { type: 'checkbox', value: l.slug });
    if (startSelection.includes(l.slug)) cb.checked = true;
    cb.addEventListener('change', () => {
      const selection = checkboxes.filter((c) => c.checked).map((c) => c.value);
      storeSelection(selection);
      updateSummary();
      if (onChange) onChange();
    });
    checkboxes.push(cb);
    const label = el('label', { style: 'display:flex; gap:0.4rem; align-items:center; font-size:0.85rem; color:var(--fg); text-transform:none; letter-spacing:0; font-weight:400;' });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${l.name}`));
    grid.appendChild(label);
  }

  function updateSummary() {
    const n = checkboxes.filter((c) => c.checked).length;
    const total = checkboxes.length;
    summaryLabel.data = `Catalogs (${n === total || n === 0 ? 'all' : `${n}/${total}`}) ▾`;
  }
  updateSummary();

  const details = el('details', { style: 'min-width:0;' });
  details.appendChild(summary);
  details.appendChild(grid);
  container.appendChild(details);

  return function getSelection() {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.value);
    // All-checked is the same query as no-filter; send no param to keep
    // the URL clean and the server fast-path.
    if (selected.length === 0 || selected.length === checkboxes.length) return [];
    return selected;
  };
}

export function selectionToParam(slugs) {
  return slugs.length ? slugs.join(',') : '';
}
