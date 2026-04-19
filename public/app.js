async function loadLists() {
  const res = await fetch('/api/lists');
  const lists = await res.json();
  const ul = document.getElementById('list-index');
  ul.innerHTML = '';
  for (const list of lists) {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${list.name}</strong> &mdash; ${list.completed_count}/${list.object_count} observed`;
    ul.appendChild(li);
  }
}

async function loadObservations() {
  const res = await fetch('/api/observations');
  const observations = await res.json();
  const ul = document.getElementById('observation-index');
  ul.innerHTML = '';
  if (!observations.length) {
    ul.innerHTML = '<li>No observations logged yet.</li>';
    return;
  }
  for (const obs of observations) {
    const li = document.createElement('li');
    const label = obs.title || `${obs.object_catalog || ''}${obs.object_catalog_number || ''}` || `#${obs.id}`;
    li.textContent = `${label} — ${obs.observed_at || obs.created_at}`;
    ul.appendChild(li);
  }
}

loadLists().catch(console.error);
loadObservations().catch(console.error);
