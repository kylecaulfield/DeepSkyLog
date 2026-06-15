// Auto-enhance every table marked `data-sortable` with click-to-sort headers.
// Drop this module onto any page with a table; it works for tables already in
// the HTML and for tables that page scripts build later (the observer catches
// them when they're appended). Each table is enhanced at most once.
import { makeTableSortable } from './common.js';

function enhance(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.matches && root.matches('table[data-sortable]')) makeTableSortable(root);
  for (const t of root.querySelectorAll('table[data-sortable]')) makeTableSortable(t);
}

enhance(document);

new MutationObserver((records) => {
  for (const rec of records) {
    for (const node of rec.addedNodes) {
      if (node.nodeType === 1) enhance(node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });
