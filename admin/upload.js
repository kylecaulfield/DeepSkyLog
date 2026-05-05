import { parseSeestarJson } from '/js/seestar.js';

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
const objectTypeInput = document.getElementById('object-type-input');
const raHoursInput = document.getElementById('ra-hours-input');
const decDegreesInput = document.getElementById('dec-degrees-input');
const latitudeInput = document.getElementById('latitude-input');
const longitudeInput = document.getElementById('longitude-input');
const useImageGpsBtn = document.getElementById('use-image-gps');
const titleInput = document.getElementById('title-input');
const telescopeSelect = document.getElementById('telescope-select');
const telescopeHint = document.getElementById('telescope-hint');
const notesInput = document.getElementById('notes-input');
const ratingEl = document.getElementById('rating');
const ratingValue = document.getElementById('rating-value');
const seeingInput = document.getElementById('seeing-input');
const transparencyInput = document.getElementById('transparency-input');
const bortleInput = document.getElementById('bortle-input');
const sqmInput = document.getElementById('sqm-input');
const fetchWeatherBtn = document.getElementById('fetch-weather-btn');
const weatherSummary = document.getElementById('weather-summary');
const moonDisplay = document.getElementById('moon-display');
const sidecarInput = document.getElementById('sidecar-input');
const sidecarSummary = document.getElementById('sidecar-summary');
const seestarJsonField = document.getElementById('seestar-json');
const stackCountInput = document.getElementById('stack-count-input');
const exposureInput = document.getElementById('exposure-input');
const gainInput = document.getElementById('gain-input');
const filterInput = document.getElementById('filter-input');
const statusEl = document.getElementById('form-status');
const saveBtn = document.getElementById('save-btn');


const SYNODIC = 29.530588853;
function moonPreview(date) {
  if (!date || Number.isNaN(date.getTime())) return '—';
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const phase = (((jd - 2_451_550.1) / SYNODIC) % 1 + 1) % 1;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  let name;
  if (phase < 0.03 || phase >= 0.97) name = 'New';
  else if (phase < 0.22) name = 'Waxing Crescent';
  else if (phase < 0.28) name = 'First Quarter';
  else if (phase < 0.47) name = 'Waxing Gibbous';
  else if (phase < 0.53) name = 'Full';
  else if (phase < 0.72) name = 'Waning Gibbous';
  else if (phase < 0.78) name = 'Last Quarter';
  else name = 'Waning Crescent';
  return `${name} · ${(illum * 100).toFixed(0)}% illuminated`;
}

function updateMoonPreview() {
  moonDisplay.value = dateInput.value
    ? moonPreview(new Date(dateInput.value))
    : '';
}

const objectCache = new Map();
let currentStage = null;
let objectSearchSeq = 0;
const stageQueue = [];               // staged items waiting for review/save
const queuePanel = document.getElementById('queue-panel');

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
  const files = e.dataTransfer.files;
  if (files?.length) handleFiles(files);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) handleFiles(fileInput.files);
});
sidecarInput.addEventListener('change', () => {
  const file = sidecarInput.files?.[0];
  if (file) applySidecar(file);
});

function isJsonFile(file) {
  return /\.json$/i.test(file.name) || file.type === 'application/json';
}

function isImageFile(file) {
  return file.type?.startsWith('image/');
}

function isFitsFile(file) {
  return /\.fits?$/i.test(file.name || '');
}

async function applySidecar(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    sidecarSummary.textContent = `Failed to read sidecar: ${err.message}`;
    return;
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    sidecarSummary.textContent = 'Sidecar is not valid JSON.';
    return;
  }
  const parsed = parseSeestarJson(obj);
  seestarJsonField.value = text;
  if (parsed.stack_count != null) stackCountInput.value = parsed.stack_count;
  if (parsed.exposure_seconds != null) exposureInput.value = parsed.exposure_seconds;
  if (parsed.gain != null) gainInput.value = parsed.gain;
  if (parsed.filter_name) filterInput.value = parsed.filter_name;
  if (parsed.target && !objectInput.value) {
    objectInput.value = parsed.target;
    resolveObjectFromInput();
    if (objectInput.value) searchObjects(parsed.target);
  }
  if (parsed.observed_at && !dateInput.value) {
    dateInput.value = toLocalDatetimeValue(parsed.observed_at);
    updateMoonPreview();
  }
  if (parsed.summary) sidecarSummary.textContent = `Parsed: ${parsed.summary}`;
  else sidecarSummary.textContent = 'Sidecar parsed but no recognised fields found.';
}

function handleFiles(files) {
  const list = Array.from(files);
  const json = list.find(isJsonFile);
  const captures = list.filter((f) => isImageFile(f) || isFitsFile(f));
  if (!captures.length && !json) {
    setStatus('Drop an image, a FITS file, a Seestar .json, or any combination.', 'error');
    return;
  }

  for (const file of captures) uploadStaged(file).catch(() => {});
  if (json) applySidecar(json);
}

function handleFile(file) {
  handleFiles([file]);
}

let activeUploads = 0;

function uploadStaged(file) {
  return new Promise((resolve, reject) => {
    progress.hidden = false;
    progressBar.style.width = '0%';
    activeUploads += 1;
    setStatus(`Uploading${activeUploads > 1 ? ` (${activeUploads} in flight)` : ''}…`);

    const data = new FormData();
    data.append('image', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/stage');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) progressBar.style.width = `${(e.loaded / e.total) * 100}%`;
    });
    xhr.addEventListener('load', () => {
      activeUploads -= 1;
      if (activeUploads === 0) progress.hidden = true;
      if (xhr.status < 200 || xhr.status >= 300) {
        setStatus(`Upload failed (${xhr.status}).`, 'error');
        reject(new Error(`HTTP ${xhr.status}`));
        return;
      }
      const res = JSON.parse(xhr.responseText);
      enqueueStaged(res);
      resolve(res);
    });
    xhr.addEventListener('error', () => {
      activeUploads -= 1;
      if (activeUploads === 0) progress.hidden = true;
      setStatus('Upload failed.', 'error');
      reject(new Error('network'));
    });
    xhr.send(data);
  });
}

function enqueueStaged(res) {
  stageQueue.push(res);
  renderQueue();
  // If nothing is loaded yet, activate this newly-staged item.
  if (!currentStage) setActiveStage(0);
}

function renderQueue() {
  queuePanel.innerHTML = '';
  queuePanel.hidden = stageQueue.length <= 1;
  if (stageQueue.length <= 1) return;
  for (let i = 0; i < stageQueue.length; i++) {
    const item = stageQueue[i];
    const active = currentStage && item.stage_id === currentStage.stage_id;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (active ? ' active' : '');
    chip.style.cssText = 'cursor:pointer; ' + (active ? 'outline:2px solid var(--accent, #4af);' : '');
    chip.textContent = `${i + 1}. ${item.original_name || item.stage_id}`;
    chip.title = active ? 'Currently reviewing' : 'Click to review this one';
    chip.addEventListener('click', () => setActiveStage(i));
    queuePanel.appendChild(chip);
  }
}

function setActiveStage(idx) {
  const item = stageQueue[idx];
  if (!item) return;
  // Reset only per-image fields; preserve user-typed shared fields like
  // telescope, target, location, rating, notes for the next item in batch.
  resetPerImageFields();
  onStaged(item);
  renderQueue();
}

function resetPerImageFields() {
  stageIdField.value = '';
  exifSummary.innerHTML = '';
  previewImg.removeAttribute('src');
  // Per-image: date, GPS, exposure/gain/stack/filter, sidecar JSON.
  dateInput.value = '';
  latitudeInput.value = '';
  longitudeInput.value = '';
  useImageGpsBtn.disabled = true;
  useImageGpsBtn.title = 'No GPS in image EXIF';
  exposureInput.value = '';
  gainInput.value = '';
  stackCountInput.value = '';
  filterInput.value = '';
  seestarJsonField.value = '';
  moonDisplay.value = '';
}

function onStaged(res) {
  currentStage = res;
  stageIdField.value = res.stage_id;
  previewImg.src = res.preview_url;
  renderExif(res);

  dateInput.value = res.exif?.captured_at
    ? toLocalDatetimeValue(res.exif.captured_at)
    : toLocalDatetimeValue(null);
  updateMoonPreview();

  // GPS: enable the "Use image GPS" button when EXIF has coords, and pre-fill
  // the lat/lon inputs only if the user hasn't typed something already.
  const hasGps = typeof res.exif?.latitude === 'number' && typeof res.exif?.longitude === 'number';
  useImageGpsBtn.disabled = !hasGps;
  if (hasGps) {
    useImageGpsBtn.title = `Use image GPS (${res.exif.latitude.toFixed(4)}, ${res.exif.longitude.toFixed(4)})`;
    if (!latitudeInput.value) latitudeInput.value = res.exif.latitude.toFixed(6);
    if (!longitudeInput.value) longitudeInput.value = res.exif.longitude.toFixed(6);
  } else {
    useImageGpsBtn.title = 'No GPS in image EXIF';
  }

  const metaSource = res.kind === 'fits' ? 'FITS header' : 'EXIF';
  if (res.telescope_match) {
    telescopeSelect.value = res.telescope_match;
    telescopeHint.textContent = `Auto-detected from ${metaSource}: ${res.exif.device || 'device'}`;
  } else {
    telescopeSelect.value = '';
    telescopeHint.textContent = res.exif?.device
      ? `No automatic match for device “${res.exif.device}”. Please pick one.`
      : `No device info in ${metaSource}. Please pick a telescope.`;
  }

  // Object: prefer the explicit EXIF/FITS object_name, fall back to whatever
  // we mined from EXIF text fields or OCR.
  const targetGuess = res.guesses?.target?.raw || res.exif?.object_name;
  if (targetGuess && !objectInput.value) {
    objectInput.value = targetGuess;
    searchObjects(targetGuess);
    setTimeout(resolveObjectFromInput, 150);
  }

  // Total integration time from the watermark ("52min") goes into the
  // exposure input only if the user hasn't filled it from EXIF or sidecar.
  const totalExposure = res.guesses?.total_exposure_seconds;
  if (totalExposure && !exposureInput.value) {
    exposureInput.value = totalExposure;
  }

  // Stack count and filter name come from the Seestar filename pattern
  // (Stacked_<count>_..._<filter>_..._<ts>) when EXIF/sidecar didn't
  // already provide them.
  if (res.exif?.stack_count != null && !stackCountInput.value) {
    stackCountInput.value = res.exif.stack_count;
  }
  if (res.exif?.filter_name && !filterInput.value) {
    filterInput.value = res.exif.filter_name;
  }

  // Photographer: not a form field today, so just surface it in the EXIF
  // table by appending a row.
  if (res.guesses?.photographer) {
    const dt = document.createElement('dt');
    dt.className = 'k';
    dt.textContent = 'Photographer';
    const dd = document.createElement('dd');
    dd.className = 'v';
    dd.textContent = res.guesses.photographer;
    exifSummary.append(dt, dd);
  }
  if (res.guesses?.from_ocr) {
    const dt = document.createElement('dt');
    dt.className = 'k';
    dt.textContent = 'Source';
    const dd = document.createElement('dd');
    dd.className = 'v';
    dd.textContent = 'EXIF + watermark OCR';
    exifSummary.append(dt, dd);
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

// When the user pauses typing on a name that wasn't matched by the seeded
// search, hit the bundled NGC/IC fallback. Pre-fills catalog/RA/Dec/type so
// a free-form NGC observation behaves like a list-backed one. We only run
// the lookup once per unique value to avoid hammering the endpoint.
let lookupSeq = 0;
const lookupCache = new Map();   // normalised query -> response or null
async function ngcLookup(value) {
  const key = value.toUpperCase().replace(/\s+/g, '');
  if (lookupCache.has(key)) return lookupCache.get(key);
  const seq = ++lookupSeq;
  try {
    const res = await fetch(`/api/admin/objects/lookup?q=${encodeURIComponent(value)}`);
    if (seq !== lookupSeq) return null;
    if (res.status === 404) { lookupCache.set(key, null); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    lookupCache.set(key, data);
    return data;
  } catch { return null; }
}
async function tryNgcFallback() {
  const v = objectInput.value.trim();
  if (!v || objectIdField.value || catalogInput.value) return;
  const hit = await ngcLookup(v);
  if (!hit) return;
  // Only fill if the user still hasn't matched a list_object and hasn't
  // typed something else in the meantime.
  if (objectInput.value.trim() !== v) return;
  catalogInput.value = hit.catalog;
  catalogNumberInput.value = hit.catalog_number;
  if (hit.object_type && !objectTypeInput.value) objectTypeInput.value = hit.object_type;
  if (hit.ra_hours != null && !raHoursInput.value) raHoursInput.value = hit.ra_hours.toFixed(4);
  if (hit.dec_degrees != null && !decDegreesInput.value) decDegreesInput.value = hit.dec_degrees.toFixed(4);
  objectHint.textContent = `${hit.source}: ${hit.name}${hit.constellation ? ' · ' + hit.constellation : ''}${hit.magnitude != null ? ' · mag ' + hit.magnitude : ''}`;
}

let typingTimer = null;
objectInput.addEventListener('input', () => {
  resolveObjectFromInput();
  const v = objectInput.value.trim();
  if (v.length >= 1) searchObjects(v);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(tryNgcFallback, 350);
});
objectInput.addEventListener('change', () => {
  resolveObjectFromInput();
  tryNgcFallback();
});

document.getElementById('cancel-btn').addEventListener('click', async () => {
  if (currentStage) {
    try {
      await fetch(`/api/admin/stage/${encodeURIComponent(currentStage.stage_id)}`, { method: 'DELETE' });
    } catch {}
  }
  // In batch mode, "cancel" discards just the active item and advances.
  if (stageQueue.length > 1) {
    advanceQueue();
  } else {
    stageQueue.length = 0;
    resetForm();
  }
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
  moonDisplay.value = '';
  latitudeInput.value = '';
  longitudeInput.value = '';
  if (sqmInput) sqmInput.value = '';
  useImageGpsBtn.disabled = true;
  useImageGpsBtn.title = 'No GPS in image EXIF';
  seestarJsonField.value = '';
  sidecarSummary.textContent = 'Optional. Drop the .json file Seestar saves alongside the image and stack count, exposure, gain and filter all auto-fill. Without it we read EXIF and OCR the watermark band.';
  setStatus('');
  renderQueue();
}

// After a successful save: drop the saved item from the queue and either
// advance to the next item (preserving shared fields like telescope/target)
// or fall back to the empty state if the queue is now empty.
function advanceQueue() {
  if (currentStage) {
    const idx = stageQueue.findIndex((s) => s.stage_id === currentStage.stage_id);
    if (idx >= 0) stageQueue.splice(idx, 1);
  }
  currentStage = null;
  if (stageQueue.length) {
    setActiveStage(0);
  } else {
    resetForm();
  }
}

dateInput.addEventListener('change', updateMoonPreview);
dateInput.addEventListener('input', updateMoonPreview);

// Fetch weather button: enabled when we have a date and GPS coords. Calls
// /api/admin/weather (Open-Meteo archive) and pre-fills the transparency
// dropdown if the user hasn't already set one.
function refreshWeatherBtn() {
  if (!fetchWeatherBtn) return;
  const hasGps = latitudeInput.value !== '' && longitudeInput.value !== '';
  fetchWeatherBtn.disabled = !(dateInput.value && hasGps);
  fetchWeatherBtn.title = fetchWeatherBtn.disabled
    ? 'Need a date and lat/lon to fetch weather.'
    : 'Fetch historical weather from Open-Meteo';
}
[dateInput, latitudeInput, longitudeInput].forEach((i) => {
  i.addEventListener('input', refreshWeatherBtn);
  i.addEventListener('change', refreshWeatherBtn);
});
refreshWeatherBtn();
fetchWeatherBtn?.addEventListener('click', async () => {
  if (fetchWeatherBtn.disabled) return;
  weatherSummary.textContent = 'Fetching…';
  try {
    const params = new URLSearchParams({
      lat: latitudeInput.value,
      lon: longitudeInput.value,
      at: new Date(dateInput.value).toISOString(),
    });
    const res = await fetch(`/api/admin/weather?${params}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const w = await res.json();
    const bits = [];
    if (w.cloud_cover_pct != null) bits.push(`☁ ${w.cloud_cover_pct}%`);
    if (w.temperature_c != null) bits.push(`${w.temperature_c}°C`);
    if (w.dew_point_c != null) bits.push(`dew ${w.dew_point_c}°C`);
    if (w.relative_humidity_pct != null) bits.push(`RH ${w.relative_humidity_pct}%`);
    weatherSummary.textContent = bits.length ? bits.join(' · ') : 'No data for that hour.';
    if (w.transparency_hint && !transparencyInput.value) {
      transparencyInput.value = String(w.transparency_hint);
    }
  } catch (err) {
    weatherSummary.textContent = `Failed: ${err.message}`;
  }
});

// Bortle ↔ SQM conversion. The mapping is the canonical Bortle/SQM scale
// used by darksitefinder.com / Sky Quality Meters; we pick the centre of
// each Bortle band when going Bortle→SQM, and pick the nearest band when
// going SQM→Bortle. Editing one updates the other unless the user has
// already typed a value into the target field.
const BORTLE_TO_SQM_CENTRE = { 1: 21.85, 2: 21.7, 3: 21.4, 4: 20.95, 5: 20.45, 6: 19.5, 7: 18.5, 8: 17.85, 9: 17.4 };
function sqmToBortle(sqm) {
  if (!Number.isFinite(sqm)) return '';
  if (sqm >= 21.8) return 1;
  if (sqm >= 21.6) return 2;
  if (sqm >= 21.2) return 3;
  if (sqm >= 20.7) return 4;
  if (sqm >= 20.0) return 5;
  if (sqm >= 19.0) return 6;
  if (sqm >= 18.0) return 7;
  if (sqm >= 17.7) return 8;
  return 9;
}
let suppressBortleSqmSync = false;
bortleInput.addEventListener('change', () => {
  if (suppressBortleSqmSync) return;
  const v = Number(bortleInput.value);
  if (!Number.isFinite(v) || !BORTLE_TO_SQM_CENTRE[v]) return;
  suppressBortleSqmSync = true;
  sqmInput.value = BORTLE_TO_SQM_CENTRE[v];
  suppressBortleSqmSync = false;
});
sqmInput.addEventListener('input', () => {
  if (suppressBortleSqmSync) return;
  const v = Number(sqmInput.value);
  const b = sqmToBortle(v);
  if (b === '') return;
  suppressBortleSqmSync = true;
  bortleInput.value = String(b);
  suppressBortleSqmSync = false;
});

useImageGpsBtn.addEventListener('click', () => {
  const lat = currentStage?.exif?.latitude;
  const lon = currentStage?.exif?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return;
  latitudeInput.value = lat.toFixed(6);
  longitudeInput.value = lon.toFixed(6);
});

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
    seeing: seeingInput.value || null,
    transparency: transparencyInput.value || null,
    bortle: bortleInput.value || null,
    sqm: sqmInput.value !== '' ? Number(sqmInput.value) : null,
    stack_count: stackCountInput.value || null,
    exposure_seconds: exposureInput.value || null,
    gain: gainInput.value || null,
    filter_name: filterInput.value.trim() || null,
    seestar_json: seestarJsonField.value || null,
    latitude: latitudeInput.value !== '' ? Number(latitudeInput.value) : null,
    longitude: longitudeInput.value !== '' ? Number(longitudeInput.value) : null,
    object_type: objectTypeInput.value || null,
    ra_hours: raHoursInput.value !== '' ? Number(raHoursInput.value) : null,
    dec_degrees: decDegreesInput.value !== '' ? Number(decDegreesInput.value) : null,
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
    advanceQueue();
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

async function preselectFromUrl() {
  const params = new URLSearchParams(location.search);
  const oid = params.get('object_id');
  if (!oid) return;
  try {
    const res = await fetch(`/api/objects/${encodeURIComponent(oid)}`);
    if (!res.ok) return;
    const obj = await res.json();
    const label = `${obj.catalog}${obj.catalog_number}${obj.name ? ' — ' + obj.name : ''}`;
    objectInput.value = label;
    objectIdField.value = obj.id;
    catalogInput.value = obj.catalog;
    catalogNumberInput.value = obj.catalog_number;
    objectHint.textContent = `${obj.list_name} · ${obj.object_type || ''} ${obj.constellation ? '· ' + obj.constellation : ''}`;
    // Cache it so later autocomplete edits round-trip cleanly.
    objectCache.set(label.toLowerCase(), {
      id: obj.id,
      catalog: obj.catalog,
      catalog_number: obj.catalog_number,
      name: obj.name,
      object_type: obj.object_type,
      constellation: obj.constellation,
      list_name: obj.list_name,
      list_slug: obj.list_slug,
    });
  } catch {}
}

loadTelescopes();
searchObjects('');
preselectFromUrl();
