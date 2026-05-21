// Per-object-type duration picker for the Seestar planner. Defaults are
// based on community Seestar imaging recommendations; user overrides
// persist in localStorage. Returns a getter for the current selection in
// the comma-separated 'GAL:90,GC:20,...' format the API expects.

import { el } from './common.js';
import { OBJECT_TYPES } from './common.js';

const STORE_KEY = 'deepskylog.seestar_durations';

// These are the defaults the user can override. Kept in sync with the
// server's DEFAULT_DURATIONS map; if the server changes them and the
// user hasn't customised, the server-side default still wins because
// we only send the keys the user touched.
export const DEFAULT_DURATIONS = {
  GAL: 90, DN: 60, SNR: 90, PN: 45, MW: 30, COMET: 30,
  GC: 20, OC: 15, PLAN: 10, AST: 10,
  DS: 5, STAR: 5, MOON: 5,
};

// Order the inputs by length, then alpha, so the panel reads "long stuff
// at the top".
const DISPLAY_ORDER = Object.keys(DEFAULT_DURATIONS)
  .sort((a, b) => (DEFAULT_DURATIONS[b] - DEFAULT_DURATIONS[a]) || a.localeCompare(b));

function loadStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return typeof raw === 'object' && raw ? raw : {};
  } catch { return {}; }
}

function store(map) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(map)); } catch {}
}

export async function mountDurationPicker(container, onChange) {
  const stored = loadStored();

  const summary = el('summary', { style: 'cursor:pointer; padding:0.1rem 0.3rem;' });
  const summaryLabel = document.createTextNode('Durations ▾');
  summary.appendChild(summaryLabel);

  const grid = el('div', {
    style: 'display:grid; grid-template-columns:repeat(auto-fill, minmax(11rem, 1fr)); gap:0.25rem 0.6rem; padding:0.4rem 0.6rem; background:#1a0f08; border:1px solid var(--accent); border-radius:6px; margin-top:0.25rem;',
  });

  const inputs = {};
  for (const code of DISPLAY_ORDER) {
    const label = OBJECT_TYPES[code] || code;
    const row = el('label', {
      style: 'display:flex; justify-content:space-between; align-items:center; gap:0.4rem; font-size:0.85rem; color:var(--fg); text-transform:none; letter-spacing:0; font-weight:400;',
    });
    row.appendChild(document.createTextNode(label));
    const input = el('input', {
      type: 'number', min: '0', max: '360', step: '5',
      value: String(stored[code] ?? DEFAULT_DURATIONS[code]),
      style: 'width:5rem; padding:0.15rem 0.4rem; font-size:0.85rem;',
    });
    input.addEventListener('change', () => {
      const map = {};
      for (const [k, el] of Object.entries(inputs)) {
        const n = Number(el.value);
        // Only persist values that differ from the default — keeps
        // future default changes effective for untouched types.
        if (Number.isFinite(n) && n > 0 && n !== DEFAULT_DURATIONS[k]) map[k] = n;
      }
      store(map);
      if (onChange) onChange();
    });
    inputs[code] = input;
    row.appendChild(input);
    grid.appendChild(row);
  }

  const reset = el('button', {
    type: 'button',
    style: 'margin:0.5rem 0.6rem; padding:0.2rem 0.5rem; font-size:0.8rem;',
  }, 'Reset to defaults');
  reset.addEventListener('click', () => {
    for (const [code, input] of Object.entries(inputs)) {
      input.value = String(DEFAULT_DURATIONS[code]);
    }
    store({});
    if (onChange) onChange();
  });

  const details = el('details', { style: 'min-width:0;' });
  details.appendChild(summary);
  details.appendChild(grid);
  details.appendChild(reset);
  container.appendChild(details);

  return function getDurationParam() {
    const parts = [];
    for (const [code, input] of Object.entries(inputs)) {
      const n = Number(input.value);
      if (Number.isFinite(n) && n > 0 && n !== DEFAULT_DURATIONS[code]) {
        parts.push(`${code}:${n}`);
      }
    }
    return parts.join(',');
  };
}
