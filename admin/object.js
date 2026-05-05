import { fetchJson, el, formatRA, formatDec, typeLabel, qs } from '/js/common.js';

const root = document.getElementById('root');
const id = qs('id');

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
        alt: `Observation ${featured.id}`,
        loading: 'lazy',
      }),
    );
  }
  return el('div', { class: 'object-photo' },
    el('div', { class: 'empty', text: 'No photo uploaded for this object yet.' }),
  );
}

async function makeFeatured(observationId) {
  if (!confirm('Make this the featured image for this object?')) return;
  const res = await fetch(`/api/admin/observations/${observationId}/feature`, { method: 'POST' });
  if (!res.ok) {
    alert(`Feature failed: HTTP ${res.status}`);
    return;
  }
  render();
}

async function triggerPlateSolve(o) {
  const status = o.solver_status;
  // Already finished or in progress: just poll for an update.
  const action = (status === 'pending' || status === 'solving' || status === 'success')
    ? { method: 'GET', label: 'Polling…' }
    : { method: 'POST', label: 'Submitting…' };
  try {
    const res = await fetch(`/api/admin/observations/${o.id}/platesolve`, { method: action.method });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    if (data.status === 'success') {
      alert(`Solved!  RA ${(data.solved_ra_hours || 0).toFixed(3)}h  Dec ${(data.solved_dec_degrees || 0).toFixed(2)}°  · radius ${(data.solved_radius_deg || 0).toFixed(2)}°`);
    } else if (data.status === 'failure') {
      alert('Astrometry could not solve this image.');
    } else {
      alert(`Status: ${data.status}. Click again in a minute to refresh.`);
    }
    render();
  } catch (err) {
    alert(`Plate solve failed: ${err.message}`);
  }
}

// Aliases editor — chip per alias with an X to remove, plus a small input
// to add a new one. Stays in sync with the server via PATCH /api/admin/objects/:id.
function buildAliasesEditor(data) {
  let aliases = [];
  try { aliases = data.aliases ? JSON.parse(data.aliases) : []; }
  catch { aliases = []; }
  if (!Array.isArray(aliases)) aliases = [];

  const wrap = el('div', { class: 'chip-row', style: 'gap:0.25rem; align-items:center; flex-wrap:wrap;' });
  const status = el('span', { class: 'dim', style: 'margin-left:0.5rem;' });

  function paint() {
    wrap.innerHTML = '';
    for (const a of aliases) {
      const x = el('button', {
        type: 'button',
        class: 'edit-btn',
        style: 'margin-left:0.25rem; padding:0 0.25rem;',
        text: '×',
      });
      x.addEventListener('click', async () => {
        aliases = aliases.filter((v) => v !== a);
        await save();
      });
      wrap.appendChild(el('span', { class: 'chip' }, a, x));
    }
    const input = el('input', {
      type: 'text', placeholder: 'add alias (e.g. NGC1976)',
      style: 'min-width:12rem;',
    });
    const add = el('button', { type: 'button', class: 'button-link ghost-link', text: 'Add' });
    const handleAdd = async () => {
      const v = input.value.trim().toUpperCase().replace(/\s+/g, '');
      if (!v) return;
      if (aliases.includes(v)) { status.textContent = 'Already present.'; return; }
      aliases = [...aliases, v];
      input.value = '';
      await save();
    };
    add.addEventListener('click', handleAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } });
    wrap.appendChild(input);
    wrap.appendChild(add);
    wrap.appendChild(status);
  }

  async function save() {
    status.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/admin/objects/${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const out = await res.json();
      aliases = out.aliases || [];
      status.textContent = 'Saved.';
      paint();
    } catch (err) {
      status.textContent = `Failed: ${err.message}`;
      paint();
    }
  }

  paint();
  return wrap;
}

async function deleteObservation(observationId) {
  if (!confirm(
    'Delete this observation? The image and thumbnail files will be removed and the catalog completion will be unticked if this was the only attempt.',
  )) return;
  const res = await fetch(`/api/admin/observations/${observationId}`, { method: 'DELETE' });
  if (!res.ok) {
    alert(`Delete failed: HTTP ${res.status}`);
    return;
  }
  render();
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
  document.title = `Admin — ${data.catalog}${data.catalog_number}`;

  root.innerHTML = '';
  root.appendChild(el('p', { class: 'dim' },
    el('a', { href: '/admin/observations.html', text: '← Observations' })));

  root.appendChild(el('h1', { class: 'page-title',
    text: `${data.catalog}${data.catalog_number}${data.name ? ' — ' + data.name : ''}` }));

  const subtitleBits = [typeLabel(data.object_type), data.constellation].filter(Boolean);
  if (data.attempts_count > 0) {
    subtitleBits.push(`${data.attempts_count} attempt${data.attempts_count === 1 ? '' : 's'}`);
  }
  root.appendChild(el('p', { class: 'page-subtitle', text: subtitleBits.join(' · ') }));

  root.appendChild(el('div', { class: 'object-actions' },
    el('a', {
      class: 'button-link',
      href: `/admin/upload.html?object_id=${encodeURIComponent(data.id)}`,
      text: data.attempts_count > 0 ? '+ Log another attempt' : '+ Log first attempt',
    }),
    el('a', {
      class: 'button-link ghost-link',
      href: `/object.html?id=${encodeURIComponent(data.id)}`,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: 'Open public view ↗',
    }),
  ));

  const metaList = el('dl', { class: 'meta-list' },
    ...meta('Catalog', `${data.catalog}${data.catalog_number}`),
    ...meta('Type', typeLabel(data.object_type)),
    ...meta('Constellation', data.constellation || '—'),
    ...meta('Right ascension', formatRA(data.ra_hours) + (data.live_coords ? ' (live)' : '')),
    ...meta('Declination', formatDec(data.dec_degrees) + (data.live_coords ? ' (live)' : '')),
    ...meta('Magnitude', data.magnitude != null ? data.magnitude.toFixed(1) : '—'),
    ...meta('Attempts', String(data.attempts_count)),
  );

  const memberships = el('div', { class: 'chip-row' },
    ...data.memberships.map((m) =>
      el('a', { class: 'chip', href: `/list.html?slug=${encodeURIComponent(m.slug)}`,
                target: '_blank', rel: 'noopener noreferrer', text: m.list_name })),
  );

  root.appendChild(el('section', { class: 'object-hero' },
    heroPhoto(data.observations, data.featured_observation_id),
    el('div', {},
      metaList,
      el('h3', { style: 'margin-top:1.25rem;', text: 'List memberships' }),
      memberships,
      el('h3', { style: 'margin-top:1.25rem;', text: 'Aliases' }),
      buildAliasesEditor(data),
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

      const captureBits = [];
      if (o.stack_count != null && o.exposure_seconds != null) {
        captureBits.push(`${o.stack_count}×${o.exposure_seconds}s`);
        const totalMin = (o.stack_count * o.exposure_seconds) / 60;
        captureBits.push(`${totalMin.toFixed(1)} min total`);
      } else if (o.exposure_seconds != null) {
        captureBits.push(`${o.exposure_seconds}s exposure`);
      }
      if (o.gain != null) captureBits.push(`gain ${o.gain}`);
      if (o.filter_name) captureBits.push(o.filter_name);

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

      const buttonRow = el('div', { class: 'tile-actions' });
      if (!isFeatured && o.image_path) {
        const featureBtn = el('button', { type: 'button', class: 'feature-btn', text: '★ Feature' });
        featureBtn.addEventListener('click', () => makeFeatured(o.id));
        buttonRow.appendChild(featureBtn);
      }
      const editBtn = el('button', { type: 'button', class: 'edit-btn', text: 'Edit' });
      editBtn.addEventListener('click', () => openEditModal(o));
      buttonRow.appendChild(editBtn);
      if (o.image_path) {
        const solveBtn = el('button', {
          type: 'button',
          class: 'edit-btn',
          text: o.solver_status === 'success' ? `Solved · ${o.solved_radius_deg ? o.solved_radius_deg.toFixed(2) + '°' : 'ok'}`
              : o.solver_status === 'failure' ? 'Solve failed (retry)'
              : o.solver_status === 'pending' || o.solver_status === 'solving' ? `Solving (refresh)`
              : 'Plate solve',
        });
        solveBtn.addEventListener('click', () => triggerPlateSolve(o));
        buttonRow.appendChild(solveBtn);
      }
      const deleteBtn = el('button', { type: 'button', class: 'delete-btn', text: 'Delete' });
      deleteBtn.addEventListener('click', () => deleteObservation(o.id));
      buttonRow.appendChild(deleteBtn);

      const captionChildren = [
        el('h4', {}, ...headingChildren),
        el('small', { text: [o.telescope, o.camera].filter(Boolean).join(' · ') || '—' }),
      ];
      if (captureBits.length) {
        captionChildren.push(el('small', { class: 'dim', text: captureBits.join(' · ') }));
      }
      if (conditionBits.length) {
        captionChildren.push(el('small', { class: 'dim', text: conditionBits.join(' · ') }));
      }
      captionChildren.push(buttonRow);

      grid.appendChild(el('div', { class: 'gallery-item' + (isFeatured ? ' is-featured' : '') },
        thumb,
        el('div', { class: 'caption' }, ...captionChildren),
      ));
    }
    obsSection.appendChild(grid);
  }
  root.appendChild(obsSection);
}

function toLocalDt(s) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openEditModal(o) {
  const overlay = el('div', { class: 'modal-overlay' });
  const card = el('div', { class: 'modal' });
  const fld = (label, name, type, value) =>
    el('label', { class: 'field' },
      el('span', { text: label }),
      el('input', { type, name, value: value == null ? '' : String(value) }),
    );
  const fldArea = (label, name, value) => {
    const ta = el('textarea', { name, rows: '3' });
    ta.value = value || '';
    return el('label', { class: 'field' }, el('span', { text: label }), ta);
  };
  const select = (label, name, value, options) => {
    const sel = el('select', { name });
    sel.appendChild(el('option', { value: '' }, '—'));
    for (const v of options) {
      const opt = el('option', { value: String(v) }, String(v));
      if (String(v) === String(value || '')) opt.selected = true;
      sel.appendChild(opt);
    }
    return el('label', { class: 'field' }, el('span', { text: label }), sel);
  };

  const form = el('form', { class: 'edit-form' },
    fld('Title', 'title', 'text', o.title),
    fld('Captured at', 'observed_at', 'datetime-local', toLocalDt(o.observed_at)),
    fld('Location', 'location', 'text', o.location),
    fld('Telescope', 'telescope', 'text', o.telescope),
    fld('Camera', 'camera', 'text', o.camera),
    el('div', { class: 'row' },
      select('Rating', 'rating', o.rating, [1,2,3,4,5]),
      select('Seeing', 'seeing', o.seeing, [1,2,3,4,5]),
    ),
    el('div', { class: 'row' },
      select('Transparency', 'transparency', o.transparency, [1,2,3,4,5]),
      select('Bortle', 'bortle', o.bortle, [1,2,3,4,5,6,7,8,9]),
    ),
    el('div', { class: 'row' },
      fld('Stack count', 'stack_count', 'number', o.stack_count),
      fld('Sub-exposure (s)', 'exposure_seconds', 'number', o.exposure_seconds),
    ),
    el('div', { class: 'row' },
      fld('Gain', 'gain', 'number', o.gain),
      fld('Filter', 'filter_name', 'text', o.filter_name),
    ),
    fldArea('Notes', 'description', o.description),
  );

  const status = el('p', { class: 'edit-status dim' });
  const actions = el('div', { class: 'actions' });
  const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  cancel.addEventListener('click', () => overlay.remove());
  actions.appendChild(cancel);
  actions.appendChild(el('button', { type: 'submit', text: 'Save' }));
  form.appendChild(actions);
  form.appendChild(status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = 'Saving…';
    status.className = 'edit-status dim';
    const fd = new FormData(form);
    const payload = {};
    for (const [k, v] of fd.entries()) payload[k] = v === '' ? null : v;
    try {
      const res = await fetch(`/api/admin/observations/${o.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      overlay.remove();
      render();
    } catch (err) {
      status.textContent = `Save failed: ${err.message}`;
      status.className = 'edit-status danger';
    }
  });

  card.appendChild(el('h3', { text: `Edit observation #${o.id}` }));
  card.appendChild(form);
  overlay.appendChild(card);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

render();
