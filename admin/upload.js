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
const gpsHint = document.getElementById('gps-hint');
const useDeviceLocationBtn = document.getElementById('use-device-location');

// Fetched once on load from /api/settings. Used as a last-resort fallback
// when EXIF and watermark OCR both fail.
let defaultLatitude = null;
let defaultLongitude = null;
fetch('/api/settings').then((r) => r.ok ? r.json() : null).then((s) => {
  if (typeof s?.default_latitude === 'number') defaultLatitude = s.default_latitude;
  if (typeof s?.default_longitude === 'number') defaultLongitude = s.default_longitude;
}).catch(() => {});
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
  if (!fileInput.files?.length) return;
  // Snapshot synchronously — iOS revokes the FileList entries quickly
  // when the picker closes — and reset the input so re-picking the same
  // image fires change again.
  const snapshot = Array.from(fileInput.files);
  fileInput.value = '';
  handleFiles(snapshot);
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

async function handleFiles(files) {
  // Snapshot eagerly: iOS Safari's Photos picker delivers FileList entries
  // lazily, and firing N parallel uploads against that lazy list dropped
  // most of them on the floor with no error visible to the user.
  const list = Array.from(files);
  const json = list.find(isJsonFile);
  const captures = list.filter((f) => isImageFile(f) || isFitsFile(f));
  if (!captures.length && !json) {
    setStatus('Drop an image, a FITS file, a Seestar .json, or any combination.', 'error');
    return;
  }
  // Sidecar JSON applies to whatever's currently active — apply it first so
  // the form has its values before the first stage finishes.
  if (json) applySidecar(json);
  // Stage one at a time. Slower than the old parallel fan-out, but it's the
  // only pattern that works reliably with iOS multi-pick. setStatus errors
  // are surfaced individually instead of silently swallowed.
  for (const file of captures) {
    try {
      await uploadStaged(file);
    } catch (err) {
      setStatus(`Upload of ${file.name || 'a file'} failed: ${err.message || err}`, 'error');
    }
  }
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
  // resetPerImageFields() clears every per-frame field including the
  // object block; onStaged() then re-fills from the new item's EXIF /
  // filename guess. Shared-across-batch fields (telescope, location,
  // rating, conditions, notes) are intentionally preserved.
  resetPerImageFields();
  onStaged(item);
  renderQueue();
}

function resetPerImageFields() {
  stageIdField.value = '';
  exifSummary.innerHTML = '';
  previewImg.removeAttribute('src');
  // Per-image: date, GPS, exposure/gain/stack/filter, sidecar JSON, and
  // the object/catalog/RA-Dec block. Each Seestar filename embeds its own
  // target, so it's wrong to carry the first chip's value (e.g. C4) over
  // a queue of mixed targets — every chip's onStaged() refills these from
  // its own EXIF/filename guess.
  dateInput.value = '';
  latitudeInput.value = '';
  longitudeInput.value = '';
  if (gpsHint) gpsHint.textContent = '';
  if (weatherSummary) weatherSummary.textContent = '';
  exposureInput.value = '';
  gainInput.value = '';
  stackCountInput.value = '';
  filterInput.value = '';
  seestarJsonField.value = '';
  moonDisplay.value = '';
  objectInput.value = '';
  objectIdField.value = '';
  catalogInput.value = '';
  catalogNumberInput.value = '';
  objectTypeInput.value = '';
  raHoursInput.value = '';
  decDegreesInput.value = '';
  objectHint.textContent = '';
}

async function onStaged(res) {
  currentStage = res;
  stageIdField.value = res.stage_id;
  previewImg.src = res.preview_url;
  renderExif(res);

  dateInput.value = res.exif?.captured_at
    ? toLocalDatetimeValue(res.exif.captured_at)
    : toLocalDatetimeValue(null);
  updateMoonPreview();

  // GPS: pre-fill lat/lon directly from EXIF — no button click required.
  // Setting .value programmatically doesn't fire input/change events, so
  // the location-history lookup and weather fetch are kicked manually.
  const hasGps = typeof res.exif?.latitude === 'number' && typeof res.exif?.longitude === 'number';
  if (hasGps) {
    latitudeInput.value = res.exif.latitude.toFixed(6);
    longitudeInput.value = res.exif.longitude.toFixed(6);
    if (gpsHint) {
      const source = res.guesses?.from_ocr ? 'watermark OCR' : 'image EXIF';
      gpsHint.textContent = `Auto-filled from ${source} (${res.exif.latitude.toFixed(4)}, ${res.exif.longitude.toFixed(4)}).`;
    }
  } else if (defaultLatitude != null && defaultLongitude != null) {
    // Admin-configured default home location wins over leaving the field
    // empty. The user can still overwrite manually for one-off remote sites.
    latitudeInput.value = defaultLatitude.toFixed(6);
    longitudeInput.value = defaultLongitude.toFixed(6);
    if (gpsHint) {
      gpsHint.textContent = `Auto-filled from saved default location (${defaultLatitude.toFixed(4)}, ${defaultLongitude.toFixed(4)}). Override above if you're imaging from somewhere else.`;
    }
  } else if (gpsHint) {
    // Be specific about why we couldn't fill — helps the user know whether
    // to retry, switch firmware, or just type the coords by hand.
    let reason = 'No GPS in image EXIF';
    if (res.guesses?.from_ocr) reason += ' and the watermark OCR text didn\'t include readable coordinates';
    else if (res.guesses?.ocr_error) reason += ` and watermark OCR failed (${res.guesses.ocr_error})`;
    gpsHint.textContent = `${reason} — tap "Use this device's location" or enter coordinates manually.`;
  }
  if (latitudeInput.value && longitudeInput.value) {
    maybeAutoFillFromLocationHistory();
    if (dateInput.value) maybeAutoFetchWeather();
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
    // Wait for the seeded search so the cache is populated before we
    // resolve. The previous setTimeout(150) raced the fetch on slow
    // networks — by the time it fired, objectCache was still empty,
    // resolveObjectFromInput cleared catalog/number, and the NGC
    // fallback then 404'd for Messier IDs that aren't in OpenNGC.
    await searchObjects(targetGuess);
    resolveObjectFromInput();
    if (!objectIdField.value) await tryNgcFallback();
  }

  // Sub-exposure (per frame): prefer the EXIF / filename value the server
  // already extracted; fall back to the OCR'd total integration so legacy
  // behaviour is preserved if no per-frame value is known. The user can
  // override either way.
  if (res.exif?.exposure_seconds != null && !exposureInput.value) {
    exposureInput.value = res.exif.exposure_seconds;
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
    // Also key by the bare catalog id (e.g. "m31") and the bare object
    // name ("andromeda galaxy") so a guess that comes from EXIF or a
    // filename — which is just "M31", not the full datalist label —
    // still resolves to the catalog row and pre-fills catalog +
    // catalog_number.
    objectCache.set(`${o.catalog}${o.catalog_number}`.toLowerCase(), o);
    if (o.name) objectCache.set(o.name.toLowerCase(), o);
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
  // No seeded match. Clear any catalog/number/object-type that came from a
  // previous match so a stale "M / 42" doesn't block the NGC fallback for
  // the new value. The user can still type catalog/number manually after
  // they're done editing the object field; we only clobber here when the
  // object input is what's actively driving the form.
  objectIdField.value = '';
  catalogInput.value = '';
  catalogNumberInput.value = '';
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
  // Only skip when there's a real seeded match (object_id set). The
  // catalog/catalog_number guards from the previous version blocked the
  // lookup whenever a previous match left those fields populated, even
  // when the user had since changed the object — so e.g. typing IC410
  // after editing M42 silently failed to auto-fill.
  if (!v || objectIdField.value) return;
  const hit = await ngcLookup(v);
  if (!hit) return;
  // Only fill if the user hasn't typed something else in the meantime.
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
  if (gpsHint) gpsHint.textContent = '';
  if (weatherSummary) weatherSummary.textContent = '';
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
// /api/admin/weather (Open-Meteo archive). Auto-runs whenever date + GPS
// are populated; pre-fills the transparency dropdown if the user hasn't
// set one. No button — the user just sees the summary appear.
async function runWeatherFetch() {
  const hasGps = latitudeInput.value !== '' && longitudeInput.value !== '';
  if (!dateInput.value || !hasGps) return;
  weatherSummary.textContent = 'Fetching weather…';
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
    weatherSummary.textContent = `Weather fetch failed: ${err.message}`;
  }
}
let lastAutoWeatherKey = '';
async function maybeAutoFetchWeather() {
  const hasGps = latitudeInput.value !== '' && longitudeInput.value !== '';
  if (!dateInput.value || !hasGps) return;
  // Only re-run when the (date, lat, lon) tuple actually changes, so the
  // user can keep editing other fields without us hammering the upstream.
  const key = `${dateInput.value}|${latitudeInput.value}|${longitudeInput.value}`;
  if (key === lastAutoWeatherKey) return;
  lastAutoWeatherKey = key;
  await runWeatherFetch();
}
[dateInput, latitudeInput, longitudeInput].forEach((i) => {
  i.addEventListener('input', maybeAutoFetchWeather);
  i.addEventListener('change', maybeAutoFetchWeather);
});
[latitudeInput, longitudeInput].forEach((i) => {
  i.addEventListener('change', maybeAutoFillFromLocationHistory);
});

// Bortle / SQM auto-fill from past observations at nearby coords. There's
// no public Bortle API worth using; instead we offer the median of the
// observer's own readings within ~5 km. After one observation per site,
// the field becomes effectively automatic.
let lastLocationStatsKey = '';
async function maybeAutoFillFromLocationHistory() {
  const lat = Number(latitudeInput.value);
  const lon = Number(longitudeInput.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}`;
  if (key === lastLocationStatsKey) return;
  lastLocationStatsKey = key;
  try {
    const res = await fetch(`/api/admin/location-stats?lat=${lat}&lon=${lon}&radius_km=5`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.count) return;
    if (data.bortle != null && !bortleInput.value) {
      // Bortle dropdown wants integer 1-9; round the median.
      const b = Math.max(1, Math.min(9, Math.round(data.bortle)));
      suppressBortleSqmSync = true;
      bortleInput.value = String(b);
      suppressBortleSqmSync = false;
    }
    if (data.sqm != null && !sqmInput.value) {
      suppressBortleSqmSync = true;
      sqmInput.value = data.sqm;
      suppressBortleSqmSync = false;
    }
    if (data.location && !locationInput.value) {
      locationInput.value = data.location;
    }
  } catch { /* best effort */ }
}

// "Use this device's location" — wraps the Geolocation API, fills the
// lat/lon inputs from the browser, and kicks the same auto-fetches the
// inputs would fire via input/change. Most useful on phones (~5 m).
useDeviceLocationBtn?.addEventListener('click', () => {
  if (!navigator.geolocation) {
    if (gpsHint) gpsHint.textContent = 'Geolocation API not available in this browser.';
    return;
  }
  if (gpsHint) gpsHint.textContent = 'Requesting location…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latitudeInput.value = pos.coords.latitude.toFixed(6);
      longitudeInput.value = pos.coords.longitude.toFixed(6);
      if (gpsHint) {
        gpsHint.textContent = `Auto-filled from device GPS (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}, ±${Math.round(pos.coords.accuracy)} m).`;
      }
      maybeAutoFillFromLocationHistory();
      if (dateInput.value) maybeAutoFetchWeather();
    },
    (err) => {
      if (gpsHint) gpsHint.textContent = `Geolocation failed: ${err.message}.`;
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
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
