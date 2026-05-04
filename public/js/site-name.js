// Fetches the configured site name and patches the brand label + document
// title on every page. Loaded as a side-effect from each HTML file.

(async () => {
  let name;
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return;
    const data = await res.json();
    name = data?.site_name;
  } catch { return; }
  if (!name || name === 'DeepSkyLog') return;
  for (const node of document.querySelectorAll('.brand-name')) {
    node.textContent = node.textContent.replace(/DeepSkyLog/g, name);
  }
  if (document.title) document.title = document.title.replace(/DeepSkyLog/g, name);
})();
