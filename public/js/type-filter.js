// Shared object-type filter used by /planner.html, /seestar.html and
// /tonight.html — companion to catalog-filter.js. Lets the user
// uncheck e.g. "Open Cluster" to drop those types from the plans.
// Selection persists in localStorage so it carries across pages.

import { el, OBJECT_TYPES } from './common.js';

const STORE_KEY = 'deepskylog.type_filter';

// Default order — observers usually scan past brighter / smaller types
// first when pruning, so keep deep-sky stuff up top.
const DISPLAY_ORDER = [
  'GAL', 'DN', 'PN', 'SNR', 'GC', 'OC', 'MW', 'AST',
  'STAR', 'DS', 'COMET', 'PLAN', 'MOON',
];

function loadStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return Array.isArray(raw) ? raw : null;
  } catch { return null; }
}

function storeSelection(types) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(types)); } catch {}
}

export function mountTypeFilter(container, onChange) {
  const all = DISPLAY_ORDER.filter((t) => OBJECT_TYPES[t]);
  const stored = loadStored();
  const startSelection = stored == null ? [...all]
    : stored.filter((t) => all.includes(t));

  const summary = el('summary', { style: 'cursor:pointer; padding:0.1rem 0.3rem;' });
  const summaryLabel = document.createTextNode('');
  summary.appendChild(summaryLabel);

  const grid = el('div', {
    style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(11rem, 1fr)); gap:0.2rem 0.6rem; padding:0.4rem 0.6rem; background:#1a0f08; border:1px solid var(--accent); border-radius:6px; margin-top:0.25rem;',
  });

  const checkboxes = [];
  for (const code of all) {
    const cb = el('input', { type: 'checkbox', value: code });
    if (startSelection.includes(code)) cb.checked = true;
    cb.addEventListener('change', () => {
      const selection = checkboxes.filter((c) => c.checked).map((c) => c.value);
      storeSelection(selection);
      updateSummary();
      if (onChange) onChange();
    });
    checkboxes.push(cb);
    const label = el('label', { style: 'display:flex; gap:0.4rem; align-items:center; font-size:0.85rem; color:var(--fg); text-transform:none; letter-spacing:0; font-weight:400;' });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${OBJECT_TYPES[code]}`));
    grid.appendChild(label);
  }

  function updateSummary() {
    const n = checkboxes.filter((c) => c.checked).length;
    const total = checkboxes.length;
    summaryLabel.data = `Types (${n === total || n === 0 ? 'all' : `${n}/${total}`}) ▾`;
  }
  updateSummary();

  const details = el('details', { style: 'min-width:0;' });
  details.appendChild(summary);
  details.appendChild(grid);
  container.appendChild(details);

  return function getSelection() {
    const selected = checkboxes.filter((c) => c.checked).map((c) => c.value);
    if (selected.length === 0 || selected.length === checkboxes.length) return [];
    return selected;
  };
}

export function typesToParam(types) {
  return types.length ? types.join(',') : '';
}
