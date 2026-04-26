// Tolerant parser for the JSON sidecar files that Seestar S30 / S30 Pro / S50
// drop next to each capture. Field names vary by app version; this walks the
// whole object and pulls the first key (case-insensitive) that matches a
// known alias. It returns canonical fields ready to drop into the upload
// form, plus a human-readable summary.

const ALIASES = {
  exposure_seconds: [
    'exposure_time', 'exposure_s', 'exposure', 'sub_exposure',
    'subexposure_time', 'sub_exp', 'expose_s', 'exp_time', 'exp',
    'frame_exposure', 'single_exposure',
  ],
  stack_count: [
    'stack_count', 'frame_count', 'frames', 'subframes', 'num_frames',
    'stacked_frames', 'stack_size', 'integration_count', 'subs',
  ],
  total_exposure_seconds: [
    'total_exposure', 'integration_time', 'total_integration',
    'total_exposure_seconds', 'total_exp_time',
  ],
  gain: ['gain', 'iso_gain', 'sensor_gain'],
  iso: ['iso', 'iso_speed'],
  filter_name: ['filter', 'filter_name', 'filter_type'],
  target: ['target', 'target_name', 'object_name', 'object'],
  observed_at: [
    'date_obs', 'date_observed', 'start_time', 'capture_start',
    'timestamp', 'datetime', 'utc_datetime',
  ],
  latitude: ['latitude', 'lat', 'gps_lat'],
  longitude: ['longitude', 'lon', 'lng', 'gps_lon', 'gps_lng'],
  temperature: ['temperature', 'sensor_temp', 'ccd_temperature'],
  mode: ['mode', 'capture_mode', 'image_type'],
  device: ['device', 'device_name', 'scope', 'telescope', 'model'],
};

function pluck(obj, aliases, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return undefined;
  seen.add(obj);
  const lcAliases = aliases.map((a) => a.toLowerCase());
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || typeof v === 'object') continue;
    if (lcAliases.includes(k.toLowerCase())) return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const r = pluck(v, aliases, seen);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function asNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asString(v) {
  if (typeof v === 'string') return v.trim() || null;
  return null;
}

export function parseSeestarJson(obj) {
  const out = {};
  const exposure = asNumber(pluck(obj, ALIASES.exposure_seconds));
  const stack = asNumber(pluck(obj, ALIASES.stack_count));
  const totalExposure = asNumber(pluck(obj, ALIASES.total_exposure_seconds));

  if (exposure != null) out.exposure_seconds = exposure;
  else if (totalExposure != null && stack && stack > 0) out.exposure_seconds = totalExposure / stack;

  if (stack != null) out.stack_count = stack;

  const gain = asNumber(pluck(obj, ALIASES.gain));
  if (gain != null) out.gain = gain;

  const iso = asNumber(pluck(obj, ALIASES.iso));
  if (iso != null) out.iso = iso;

  const filter = asString(pluck(obj, ALIASES.filter_name));
  if (filter) out.filter_name = filter;

  const target = asString(pluck(obj, ALIASES.target));
  if (target) out.target = target;

  const observed = asString(pluck(obj, ALIASES.observed_at));
  if (observed && !Number.isNaN(Date.parse(observed))) out.observed_at = observed;

  const lat = asNumber(pluck(obj, ALIASES.latitude));
  const lon = asNumber(pluck(obj, ALIASES.longitude));
  if (lat != null) out.latitude = lat;
  if (lon != null) out.longitude = lon;

  const mode = asString(pluck(obj, ALIASES.mode));
  if (mode) out.mode = mode;

  const device = asString(pluck(obj, ALIASES.device));
  if (device) out.device = device;

  // Build a one-line summary that the upload UI can show.
  const bits = [];
  if (out.stack_count && out.exposure_seconds) {
    const total = (out.stack_count * out.exposure_seconds) / 60;
    bits.push(`${out.stack_count}×${out.exposure_seconds}s (${total.toFixed(1)} min total)`);
  } else if (out.exposure_seconds) {
    bits.push(`${out.exposure_seconds}s exposure`);
  }
  if (out.gain != null) bits.push(`gain ${out.gain}`);
  if (out.filter_name) bits.push(out.filter_name);
  if (out.mode) bits.push(out.mode);
  if (bits.length) out.summary = bits.join(' · ');

  return out;
}
