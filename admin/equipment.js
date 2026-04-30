import { fetchJson, el } from '/js/common.js';

const tbody = document.getElementById('rows');
const form = document.getElementById('add-form');
const status = document.getElementById('add-status');

async function load() {
  let rows;
  try {
    rows = await fetchJson('/api/admin/equipment');
  } catch (err) {
    tbody.innerHTML = '';
    tbody.appendChild(el('tr', {}, el('td', { colspan: '5', class: 'muted', text: `Failed: ${err.message}` })));
    return;
  }
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '5' },
      el('div', { class: 'empty-state', text: 'No equipment yet — add your first scope above.' }))));
    return;
  }
  for (const r of rows) {
    const retireBtn = el('button', {
      type: 'button',
      class: r.retired ? 'feature-btn' : 'edit-btn',
      text: r.retired ? 'Unretire' : 'Retire',
    });
    retireBtn.addEventListener('click', async () => {
      retireBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/equipment/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retired: r.retired ? 0 : 1 }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        load();
      } catch (err) {
        alert(err.message);
        retireBtn.disabled = false;
      }
    });
    const deleteBtn = el('button', { type: 'button', class: 'delete-btn', text: 'Delete' });
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Delete ${r.kind} "${r.name}"? Existing observations keep the name as plain text.`)) return;
      deleteBtn.disabled = true;
      try {
        const res = await fetch(`/api/admin/equipment/${r.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        load();
      } catch (err) {
        alert(err.message);
        deleteBtn.disabled = false;
      }
    });
    tbody.appendChild(el('tr', { class: r.retired ? 'observed' : '' },
      el('td', { class: 'dim', text: r.kind.toUpperCase() }),
      el('td', { text: r.name }),
      el('td', { text: r.notes || '—' }),
      el('td', { class: 'dim', text: r.retired ? 'retired' : 'active' }),
      el('td', {}, el('div', { class: 'tile-actions' }, retireBtn, deleteBtn)),
    ));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Adding…';
  const fd = new FormData(form);
  const payload = Object.fromEntries(fd.entries());
  try {
    const res = await fetch('/api/admin/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    form.reset();
    status.textContent = 'Added.';
    load();
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
  }
});

load();
