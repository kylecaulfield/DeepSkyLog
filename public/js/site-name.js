// Fetches the configured site name and patches the brand label + document
// title on every page. Loaded as a side-effect from each HTML file.
//
// The API round-trip means the default "DeepSkyLog" is briefly visible on a
// cold load. To avoid that flash on every subsequent visit we cache the
// configured name in localStorage and apply it synchronously before the
// fetch; the fetch then confirms (or corrects) it and refreshes the cache.
//
// applyName transforms whatever is currently rendered (replacing the last
// applied name) rather than restoring a snapshot, so it composes with page
// modules that set their own "<brand> — <thing>" titles at any time.

const CACHE_KEY = 'dsl_site_name';
let lastApplied = 'DeepSkyLog';

function applyName(name) {
  if (!name || name === lastApplied) return;
  for (const node of document.querySelectorAll('.brand-name')) {
    node.textContent = node.textContent.split(lastApplied).join(name);
  }
  if (document.title) document.title = document.title.split(lastApplied).join(name);
  lastApplied = name;
}

(async () => {
  let cached = null;
  try { cached = localStorage.getItem(CACHE_KEY); } catch {}
  if (cached) applyName(cached);

  let name;
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    name = data?.site_name;
  } catch { return; }
  if (!name) return;
  try { localStorage.setItem(CACHE_KEY, name); } catch {}
  applyName(name); // no-op when the cache was already right
})();
