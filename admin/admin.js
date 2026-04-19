const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const progress = document.getElementById('drop-progress');
const progressBar = progress.querySelector('span');

const formSection = document.getElementById('form-section');
const form = document.getElementById('observation-form');
const previewImg = document.getElementById('preview-img');
const exifSummary = document.getElementById('exif-summary');

const stageIdField = document.getElementById('stage-id');
const objectIdField = document.getElementById('object-id');
const objectInput = document.getElementById('object-input');
const objectSuggestions = document.getElementById('object-suggestions');
const objectHint = document.getElementById('object-hint');
const catalogInput = document.getElementById('catalog-input');
const catalogNumberInput = document.getElementById('catalog-number-input');
const dateInput = document.getElementById('date-input');
const locationInput = document.getElementById('location-input');
const titleInput = document.getElementById('title-input');
const telescopeSelect = document.getElementById('telescope-select');
const telescopeHint = document.getElementById('telescope-hint');
const notesInput = document.getElementById('notes-input');
const ratingEl = document.getElementById('rating');
const ratingValue = document.getElementById('rating-value');
const statusEl = document.getElementById('form-status');
const saveBtn = document.getElementById('save-btn');

const objectCache = new Map();
let currentStage = null;
let objectSearchSeq = 0;

async function loadTelescopes() {
  const res = await fetch('/api/admin/config');
  if (!res.ok) return;
  const { telescopes } = await res.json();
  for (const t of telescopes) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    telescopeSelect.appendChild(opt);
  }
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalDatetimeValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(value, unit = '') {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') {
    return unit ? `${value.toFixed(unit === 's' ? 2 : 2)} ${unit}`.trim() : value.toFixed(2);
  }
  return String(value);
}

function renderExif(data) {
  const { exif = {}, original_name, size, telescope_match } = data;
  const rows = [
    ['File', original_name],
    ['Size', `${(size / 1024).toFixed(0)} KB`],
    ['Captured', exif.captured_at ? new Date(exif.captured_at).toLocaleString() : '—'],
    ['Device', exif.device || '—'],
    ['GPS', (exif.latitude != null && exif.longitude != null)
      ? `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`
      : '—'],
    ['Exposure', fmt(exif.exposure_seconds, 's')],
    ['ISO', fmt(exif.iso)],
    ['Focal length', fmt(exif.focal_length_mm, 'mm')],
    ['Aperture', exif.aperture != null ? `f/${Number(exif.aperture).toFixed(1)}` : '—'],
    ['Telescope match', telescope_match || 'No match — pick manually'],
  ];
  exifSummary.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.className = 'k'; dt.textContent = k;
    const dd = document.createElement('dd'); dd.className = 'v'; dd.textContent = v;
    exifSummary.append(dt, dd);
  }
}

function setStatus(text, kind = '') {
  statusEl.textContent = text || '';
  statusEl.className = `dim ${kind}`.trim();
}

function setRating(value) {
  ratingValue.value = value || '';
  ratingEl.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.value) <= Number(value));
  });
}

ratingEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const v = Number(btn.dataset.value);
  setRating(v === Number(ratingValue.value) ? '' : v);
});

browseBtn.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('click', (e) => {
  if (e.target === dropzone || e.target.closest('.dropzone-inner')) fileInput.click();
});
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropzone.classList.add('drag');
  }),
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation();
    if (ev === 'dragleave' && e.target !== dropzone) return;
    dropzone.classList.remove('drag');
  }),
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    setStatus('Only image files are supported.', 'error');
    return;
  }
  previewImg.src = URL.createObjectURL(file);
  uploadStaged(file);
}

function uploadStaged(file) {
  progress.hidden = false;
  progressBar.style.width = '0%';
  setStatus('Uploading…');

  const data = new FormData();
  data.append('image', file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/admin/stage');
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) progressBar.style.width = `${(e.loaded / e.total) * 100}%`;
  });
  xhr.addEventListener('load', () => {
    progress.hidden = true;
    if (xhr.status < 200 || xhr.status >= 300) {
      setStatus(`Upload failed (${xhr.status}).`, 'error');
      return;
    }
    const res = JSON.parse(xhr.responseText);
    onStaged(res);
  });
  xhr.addEventListener('error', () => {
    progress.hidden = true;
    setStatus('Upload failed.', 'error');
  });
  xhr.send(data);
}

function onStaged(res) {
  currentStage = res;
  stageIdField.value = res.stage_id;
  previewImg.src = res.preview_url;
  renderExif(res);

  dateInput.value = res.exif?.captured_at
    ? toLocalDatetimeValue(res.exif.captured_at)
    : toLocalDatetimeValue(null);

  if (res.telescope_match) {
    telescopeSelect.value = res.telescope_match;
    telescopeHint.textContent = `Auto-detected from EXIF: ${res.exif.device || 'device'}`;
  } else {
    telescopeSelect.value = '';
    telescopeHint.textContent = res.exif?.device
      ? `No automatic match for device “${res.exif.device}”. Please pick one.`
      : 'No device info in EXIF. Please pick a telescope.';
  }

  formSection.hidden = false;
  formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setStatus('');
}

async function searchObjects(q) {
  const seq = ++objectSearchSeq;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', '20');
  const res = await fetch(`/api/admin/objects?${params}`);
  if (!res.ok) return;
  const rows = await res.json();
  if (seq !== objectSearchSeq) return;

  objectCache.clear();
  objectSuggestions.innerHTML = '';
  for (const o of rows) {
    const label = `${o.catalog}${o.catalog_number}${o.name ? ' — ' + o.name : ''}`;
    objectCache.set(label.toLowerCase(), o);
    const opt = document.createElement('option');
    opt.value = label;
    opt.textContent = `${o.list_name}${o.constellation ? ' · ' + o.constellation : ''}`;
    objectSuggestions.appendChild(opt);
  }
}

function resolveObjectFromInput() {
  const v = objectInput.value.trim();
  const match = objectCache.get(v.toLowerCase());
  if (match) {
    objectIdField.value = match.id;
    catalogInput.value = match.catalog;
    catalogNumberInput.value = match.catalog_number;
    objectHint.textContent = `${match.list_name} · ${match.object_type || ''} ${match.constellation ? '· ' + match.constellation : ''}`;
    return;
  }
  objectIdField.value = '';
  objectHint.textContent = 'Not in a seeded list — will be logged as a free-form observation.';
}

objectInput.addEventListener('input', () => {
  resolveObjectFromInput();
  const v = objectInput.value.trim();
  if (v.length >= 1) searchObjects(v);
});
objectInput.addEventListener('change', resolveObjectFromInput);

document.getElementById('cancel-btn').addEventListener('click', async () => {
  if (currentStage) {
    try {
      await fetch(`/api/admin/stage/${encodeURIComponent(currentStage.stage_id)}`, { method: 'DELETE' });
    } catch {}
  }
  resetForm();
});

function resetForm() {
  currentStage = null;
  form.reset();
  setRating('');
  formSection.hidden = true;
  previewImg.removeAttribute('src');
  exifSummary.innerHTML = '';
  stageIdField.value = '';
  objectIdField.value = '';
  objectHint.textContent = '';
  telescopeHint.textContent = '';
  setStatus('');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentStage) return;

  resolveObjectFromInput();

  const payload = {
    stage_id: stageIdField.value,
    object_id: objectIdField.value || null,
    catalog: catalogInput.value.trim(),
    catalog_number: catalogNumberInput.value.trim(),
    object_name: objectInput.value.replace(/^.*?—\s*/, '').trim(),
    title: titleInput.value.trim(),
    observed_at: dateInput.value,
    location: locationInput.value.trim(),
    telescope: telescopeSelect.value,
    notes: notesInput.value.trim(),
    rating: ratingValue.value || null,
  };

  if (!payload.telescope) {
    setStatus('Please choose a telescope.', 'error');
    return;
  }

  saveBtn.disabled = true;
  setStatus('Saving…');

  try {
    const res = await fetch('/api/admin/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Save failed (${res.status}).`);
    }
    const out = await res.json();
    setStatus(`Saved observation #${out.id}.`, 'success');
    resetForm();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

loadTelescopes();
searchObjects('');
