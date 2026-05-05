const STAT_ORDER = [
  ['observations', 'Observations'],
  ['photos', 'Photos'],
  ['distinct_objects', 'Objects observed'],
  ['distinct_telescopes', 'Telescopes used'],
  ['avg_rating', 'Average rating'],
];

function fmtStat(key, value) {
  if (value == null) return '—';
  if (key === 'avg_rating') return Number(value).toFixed(2);
  return String(value);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

function renderStats(totals) {
  const grid = document.getElementById('stats');
  grid.innerHTML = '';
  for (const [key, label] of STAT_ORDER) {
    grid.appendChild(el('div', { class: 'stat' },
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: fmtStat(key, totals[key]) }),
    ));
  }
}

function renderCatalogs(lists) {
  const wrap = document.getElementById('catalog-progress');
  wrap.innerHTML = '';
  for (const list of lists) {
    const pct = list.object_count
      ? Math.round((list.completed_count / list.object_count) * 100)
      : 0;
    wrap.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-title' },
        el('h3', { text: list.name }),
        el('span', { class: 'badge' + (pct === 100 ? ' badge-success' : ''), text: `${pct}%` }),
      ),
      el('div', { class: 'progress' }, el('span', { style: `width: ${pct}%` })),
      el('div', { class: 'card-meta' },
        el('span', {}, el('strong', { text: String(list.completed_count) }), ` of ${list.object_count} observed`),
      ),
    ));
  }
}

function renderRecent(rows) {
  const tbody = document.getElementById('recent-rows');
  tbody.innerHTML = '';
  if (!rows.length) {
    tbody.appendChild(el('tr', {},
      el('td', { colspan: '6' },
        el('div', { class: 'empty-state', text: 'No observations uploaded yet.' })),
    ));
    return;
  }
  for (const r of rows) {
    const thumbInner = r.thumbnail_path
      ? el('span', {
          class: 'thumb-chip',
          style: `background-image: url("/uploads/${r.thumbnail_path}")`,
        })
      : el('span', { class: 'thumb-chip empty', text: '—' });
    // Link the thumbnail to the same destination as the catalog id cell so
    // clicking the image opens the object detail page (which lists all
    // attempts for that target). Free-form observations with no
    // list_object stay un-linked.
    const thumb = r.object_list_id
      ? el('a', { href: `/admin/object.html?id=${r.object_list_id}`, title: 'Open object detail' }, thumbInner)
      : thumbInner;

    const objectId = r.catalog && r.catalog_number ? `${r.catalog}${r.catalog_number}` : '—';
    const stars = r.rating ? '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating) : '—';

    const idCell = r.object_list_id
      ? el('a', { href: `/admin/object.html?id=${r.object_list_id}`, text: objectId })
      : document.createTextNode(objectId);

    tbody.appendChild(el('tr', {},
      el('td', {}, thumb),
      el('td', {}, idCell),
      el('td', { text: r.title || r.object_name || '—' }),
      el('td', { text: r.telescope || '—' }),
      el('td', { text: r.observed_at || r.created_at || '—' }),
      el('td', { class: 'rating-cell', text: stars }),
    ));
  }
}

function renderTelescopes(telescopes) {
  const wrap = document.getElementById('telescopes');
  wrap.innerHTML = '';
  if (!telescopes.length) {
    wrap.appendChild(el('span', { class: 'dim', text: 'No telescopes logged yet.' }));
    return;
  }
  for (const t of telescopes) {
    wrap.appendChild(el('span', { class: 'chip', text: `${t.telescope} · ${t.count}` }));
  }
}

function renderHeatmap(rows) {
  const wrap = document.getElementById('heatmap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const counts = new Map(rows.map((r) => [r.day, r.count]));
  const max = Math.max(1, ...rows.map((r) => r.count));

  // GitHub-style: anchor today in the last column, walk backwards to fill
  // 53 weeks of 7-day columns (rows by weekday, columns by week).
  // Working in UTC keeps the iso date strings aligned with the SQL output.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayDow = today.getUTCDay();           // 0=Sun … 6=Sat
  const lastColEnd = new Date(today);
  lastColEnd.setUTCDate(lastColEnd.getUTCDate() + (6 - todayDow)); // Saturday of this week
  const start = new Date(lastColEnd);
  start.setUTCDate(start.getUTCDate() - 53 * 7 + 1); // earliest Sunday in grid

  const weeks = 53;
  const grid = el('div', { class: 'heatmap' });

  for (let w = 0; w < weeks; w++) {
    const col = el('div', { class: 'hm-col' });
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + w * 7 + d);
      const iso = day.toISOString().slice(0, 10);
      const c = counts.get(iso) || 0;
      const future = day > today;
      const cell = el('span', {
        class: 'hm-cell' + (future ? ' future' : ''),
        title: future ? '' : `${iso} — ${c} observation${c === 1 ? '' : 's'}`,
      });
      if (future) {
        // Leave data-level off so .future styling alone applies.
      } else if (c > 0) {
        const intensity = Math.ceil((c / max) * 4);
        cell.dataset.level = String(Math.min(4, intensity));
      } else {
        cell.dataset.level = '0';
      }
      col.appendChild(cell);
    }
    grid.appendChild(col);
  }
  wrap.appendChild(grid);
  wrap.appendChild(el('div', { class: 'hm-legend dim' },
    el('span', { text: 'Less' }),
    el('span', { class: 'hm-cell', 'data-level': '0' }),
    el('span', { class: 'hm-cell', 'data-level': '1' }),
    el('span', { class: 'hm-cell', 'data-level': '2' }),
    el('span', { class: 'hm-cell', 'data-level': '3' }),
    el('span', { class: 'hm-cell', 'data-level': '4' }),
    el('span', { text: 'More' }),
  ));
}

async function loadBackups() {
  const tbody = document.getElementById('backup-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  let data;
  try {
    const res = await fetch('/api/admin/backups');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '4', class: 'muted', text: `Failed: ${err.message}` })));
    return;
  }
  if (!data.archives.length) {
    tbody.appendChild(el('tr', {}, el('td', { colspan: '4' },
      el('div', { class: 'empty-state', text: `No archives in ${data.dir} yet.` }))));
    return;
  }
  let restoreInFlight = false;
  for (const a of data.archives) {
    const restoreBtn = el('button', { type: 'button', class: 'edit-btn', text: 'Restore' });
    restoreBtn.addEventListener('click', async () => {
      if (restoreInFlight) return;
      if (!confirm(`Restore ${a.name}?\n\nThe live database and uploads will be REPLACED with what's in this archive. The server will then exit (your supervisor / Docker will restart it).`)) return;
      restoreInFlight = true;
      restoreBtn.disabled = true;
      const status = document.getElementById('backup-status');
      status.textContent = 'Restoring…';
      try {
        const res = await fetch(`/api/admin/backups/${encodeURIComponent(a.name)}/restore`, { method: 'POST' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        status.textContent = 'Restored. Server is exiting; refresh in a few seconds.';
      } catch (err) {
        status.textContent = `Restore failed: ${err.message}`;
        restoreBtn.disabled = false;
        restoreInFlight = false;
      }
    });
    tbody.appendChild(el('tr', {},
      el('td', { text: a.name }),
      el('td', { class: 'dim', text: `${(a.size / 1024 / 1024).toFixed(1)} MB` }),
      el('td', { class: 'dim', text: new Date(a.modified).toLocaleString() }),
      el('td', {}, restoreBtn),
    ));
  }
}

document.getElementById('backup-now')?.addEventListener('click', async () => {
  const status = document.getElementById('backup-status');
  status.textContent = 'Running backup.sh…';
  try {
    const res = await fetch('/api/admin/backups', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    status.textContent = 'Backup created.';
    loadBackups();
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
  }
});

function renderLifetime(life) {
  const wrap = document.getElementById('lifetime-stats');
  if (!wrap) return;
  wrap.innerHTML = '';
  const cells = [
    ['Integration hours', life.integration_hours != null ? `${life.integration_hours.toFixed(1)} h` : '—'],
    ['Distinct targets', life.distinct_targets ?? '—'],
    ['This year', life.observations_this_year ?? 0],
    ['Current streak', life.current_streak_days ? `${life.current_streak_days} d` : '—'],
    ['Longest streak', life.longest_streak_days ? `${life.longest_streak_days} d` : '—'],
  ];
  for (const [label, value] of cells) {
    wrap.appendChild(el('div', { class: 'stat' },
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: String(value) }),
    ));
  }
}

async function load() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderStats(data.totals || {});
    if (data.lifetime) renderLifetime(data.lifetime);
    renderCatalogs(data.lists || []);
    renderRecent(data.recent || []);
    renderTelescopes(data.telescopes || []);
    renderHeatmap(data.heatmap || []);
  } catch (err) {
    document.getElementById('stats').textContent = `Failed to load: ${err.message}`;
  }
  loadBackups();
  loadSiteSettings();
}

async function loadSiteSettings() {
  const input = document.getElementById('site-name-input');
  if (!input) return;
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    input.value = data.site_name || '';
  } catch { /* leave blank */ }
}

document.getElementById('settings-form')?.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = document.getElementById('site-name-input');
  const status = document.getElementById('settings-status');
  const value = input.value.trim();
  if (!value) { status.textContent = 'Site name cannot be empty.'; return; }
  status.textContent = 'Saving…';
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_name: value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    status.textContent = 'Saved. Refresh to see the new branding.';
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
  }
});

load();
