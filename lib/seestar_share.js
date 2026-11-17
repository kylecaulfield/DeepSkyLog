// "Share to Seestar": turns a planner schedule into a Seestar Share Plan —
// a link / QR code the official Seestar app imports into its Local Plans.
//
// ZWO's API for this is UNDOCUMENTED and could change or disappear. What is
// here was reverse engineered from the Android app (see
// https://github.com/astronomyk/seestarpy/issues/5) and checked against the
// live service on 2026-11-15 with scripts/seestar-share-probe.js. Everything
// that knows about that API lives in this file.
//
//   POST {API}/v1/share/plan   body { payload, metadata }, no login needed
//     -> { code: 200, msg: "OK", data: { shareId, shareLink } }
//   Errors come back in the body ({ code: 100002, msg: "Parameter error" }),
//   sometimes with HTTP 400, sometimes — per the app's code — with HTTP 200.
//
// The body is JSON strings three deep:
//   payload            string -> PlanItem
//   PlanItem.payload   string -> [TargetItem, ...]
//   PlanItem.extra     string -> { wideIncrementId }
// PlanItem.createTime is in seconds, operationTime in milliseconds.
//
// The app silently drops any target it doesn't like on import (see
// validateTargets), so a plan is checked here first and refused whole rather
// than shared with targets that would vanish.
'use strict';

const crypto = require('crypto');
const QRCode = require('qrcode');

const API_BASE = () => process.env.SEESTAR_API_BASE || 'https://api.seestar.com';
// The only link form the app's scanner accepts.
const LINK_BASE = 'https://app.zwoastro.com/Seestar/plan?id=';
const TIMEOUT_MS = 15_000;
// The app's own per-target defaults, as a plan shared from the app carries
// them: 10 s subs, stacked, no light-pollution filter, main ("tele") camera.
const EXPOSURE_MS = 10_000;
const CAMERA_MODE = 'tele';
const MAX_TARGETS = 60;

// A problem with the plan itself (`problems`: one line per fault) or an
// answer from ZWO (`zwoCode` / `zwoMessage`, verbatim; `httpStatus`).
class SeestarShareError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'SeestarShareError';
    Object.assign(this, extra);
  }
}

// A stable positive id for a target, from its catalog designation (FNV-1a,
// kept to 31 bits; the app wants a long > 0). `taken` holds ids already used
// in this plan: a clash moves on to the next free one.
function targetId(key, taken) {
  let h = 0x811c9dc5;
  for (const ch of String(key)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let id = (h & 0x7fffffff) || 1;
  while (taken.has(id)) id = id === 0x7fffffff ? 1 : id + 1;
  taken.add(id);
  return id;
}

// The app's start_min for each slot of a plan: minutes after local midnight
// of the day the plan belongs to, running on past 1440 for slots after
// midnight (01:30 -> 1530). That day is the first slot's — except that a
// plan lying wholly between midnight and noon is the tail of the night
// before, so it counts from the previous midnight too. Slots in time order
// therefore always come out in increasing order, whenever the plan starts.
function planStartMinutes(dates, tzOffsetMinutes) {
  const local = dates.map((d) => Math.round(d.getTime() / 60000) + tzOffsetMinutes);
  const midnight = Math.floor(local[0] / 1440) * 1440;
  const minutes = local.map((m) => m - midnight);
  return minutes.every((m) => m < 720) ? minutes.map((m) => m + 1440) : minutes;
}

// The app's plan editor only places targets on a 10-minute grid, and a
// shared plan whose times are off it imports with no targets at all. So
// each slot's start and end move to the nearest 10 minutes: a slot never
// starts before the one ahead of it ends, and never lasts under 10 minutes.
// Times therefore differ from the planner's by up to 5 minutes (more after
// a run of very short slots). Takes and returns [{ start, duration }] in
// minutes, in time order.
const GRID_MINUTES = 10;
function snapToGrid(slots) {
  const snap = (m) => Math.round(m / GRID_MINUTES) * GRID_MINUTES;
  let free = -Infinity; // when the slot ahead ends
  return slots.map(({ start, duration }) => {
    // A slot with no usable length is left as it is, for validation to name.
    if (!(duration > 0) || !Number.isFinite(duration) || !Number.isFinite(start)) return { start, duration };
    const begin = Math.max(snap(start), free);
    const end = Math.max(snap(start + duration), begin + GRID_MINUTES);
    free = end;
    return { start: begin, duration: end - begin };
  });
}

// start_min for a one-slot plan.
function startMinutes(date, tzOffsetMinutes) {
  return planStartMinutes([date], tzOffsetMinutes)[0];
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// Catalogs whose "<catalog> <number>" is a designation people know. The
// site's own lists (GC 1 = 47 Tucanae, SOL 2 = the Moon, MWWF fields) are
// numbered for the list only, so those targets go by name.
const DESIGNATIONS = { M: 'M ', C: 'C ', NGC: 'NGC ', IC: 'IC ', Sh2: 'Sh2-' };

// Planner slots -> TargetItems. Each slot: { start: Date, durationMinutes,
// object: { catalog, catalog_number, name }, raHours, decDeg }.
// `tzOffsetMinutes` is the photographer's UTC offset, minutes east.
function buildTargets(slots, tzOffsetMinutes) {
  const taken = new Set();
  const starts = planStartMinutes(slots.map((slot) => slot.start), tzOffsetMinutes);
  const times = snapToGrid(slots.map((slot, i) => ({ start: starts[i], duration: slot.durationMinutes })));
  return slots.map((slot, i) => {
    const o = slot.object || {};
    const name = String(o.name || '').replace(/\s+/g, ' ').trim();
    const prefix = o.catalog_number ? DESIGNATIONS[o.catalog] : null;
    const designation = prefix ? `${prefix}${o.catalog_number}` : '';
    return {
      ai_generated: false,
      alias_name: designation ? name : '',
      camera: { exp_ms: { stack_l: EXPOSURE_MS }, stack: { capt_type: 'stack' } },
      camera_mode: CAMERA_MODE,
      duration_min: times[i].duration,
      lp_filter: false,
      mount: { tracking: false },
      start_min: times[i].start,
      target_id: targetId(o.catalog && o.catalog_number ? `${o.catalog} ${o.catalog_number}` : name, taken),
      target_name: designation || name,
      target_ra_dec: [round(slot.raHours, 5), round(slot.decDeg, 4)], // hours, degrees
      second_camera: null,
    };
  });
}

// Everything the app would drop a target for on import (plus an empty or
// oversized plan), as readable lines. Empty array = fine.
function validateTargets(targets) {
  const problems = [];
  if (!Array.isArray(targets) || !targets.length) return ['The plan has no targets.'];
  if (targets.length > MAX_TARGETS) problems.push(`The plan has ${targets.length} targets; the most shared at once is ${MAX_TARGETS}.`);
  const seen = new Set();
  targets.forEach((t, i) => {
    const who = `Target ${i + 1}${t.target_name ? ` (${t.target_name})` : ''}`;
    if (!Number.isSafeInteger(t.target_id) || t.target_id <= 0) problems.push(`${who}: id must be a positive whole number.`);
    else if (seen.has(t.target_id)) problems.push(`${who}: id ${t.target_id} is used twice.`);
    else seen.add(t.target_id);
    if (!String(t.target_name || '').trim()) problems.push(`${who}: has no name.`);
    const [ra, dec] = Array.isArray(t.target_ra_dec) ? t.target_ra_dec : [];
    if (!Number.isFinite(ra) || ra < 0 || ra > 24) problems.push(`${who}: right ascension ${ra} is not between 0 and 24 hours.`);
    if (!Number.isFinite(dec) || dec < -90 || dec > 90) problems.push(`${who}: declination ${dec} is not between -90 and 90 degrees.`);
    if (!Number.isInteger(t.start_min) || t.start_min < 0) problems.push(`${who}: start time ${t.start_min} is not a whole number of minutes from 0.`);
    else if (i > 0 && Number.isInteger(targets[i - 1].start_min) && t.start_min < targets[i - 1].start_min) {
      problems.push(`${who}: starts before the target ahead of it. Targets must be in time order.`);
    }
    if (!Number.isInteger(t.duration_min) || t.duration_min <= 0) problems.push(`${who}: duration ${t.duration_min} is not a whole number of minutes above 0.`);
  });
  return problems;
}

// The request body for a plan called `name` holding `targets`.
function buildRequestBody(name, targets, now = Date.now()) {
  const plan = {
    createTime: Math.floor(now / 1000),
    extra: JSON.stringify({ wideIncrementId: 0 }),
    id: crypto.randomUUID(),
    name,
    operation: 'update',
    operationTime: now,
    payload: JSON.stringify(targets),
    recommendDurationMinute: 30,
  };
  return {
    payload: JSON.stringify(plan),
    metadata: {
      planName: name,
      targetCount: targets.length,
      shootingDurationMinutes: targets.reduce((sum, t) => sum + t.duration_min, 0),
    },
  };
}

// POST the body. One retry, and only when no response arrived at all (a
// network error or timeout): a POST the server answered is never repeated,
// since each success creates a share.
async function postShare(body, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const url = `${API_BASE()}/v1/share/plan`;
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      break;
    } catch (err) {
      if (attempt >= 2) {
        const why = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.code || err.message);
        throw new SeestarShareError(`Couldn't reach the Seestar share service (${why}).`, { network: true });
      }
    }
  }
  let text;
  try {
    text = await res.text();
  } catch {
    // Answered, so no retry — but whether a share was made is unknown.
    throw new SeestarShareError(
      `The Seestar share service answered (HTTP ${res.status}) but its reply couldn't be read. Try again.`,
      { httpStatus: res.status },
    );
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  const shareId = json?.data?.shareId;
  if (!res.ok || json?.code !== 200 || typeof shareId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(shareId)) {
    const zwoCode = json?.code ?? null;
    const zwoMessage = typeof json?.msg === 'string' ? json.msg : null;
    const said = zwoCode != null || zwoMessage
      ? `code ${zwoCode}: ${zwoMessage ?? '(no message)'}`
      : `HTTP ${res.status} ${text.slice(0, 200)}`.trim();
    throw new SeestarShareError(`The Seestar share service refused the plan (${said}).`, {
      zwoCode, zwoMessage, httpStatus: res.status,
    });
  }
  return shareId;
}

// The link as a QR code the app's scanner reads: PNG, base64.
async function qrPngBase64(link) {
  const png = await QRCode.toBuffer(link, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 480 });
  return png.toString('base64');
}

// Share a plan: validate, POST, and draw the QR for the link. Resolves to
// { shareId, shareLink, qrPngBase64, planName, targetCount, durationMinutes,
// targets }. The QR is drawn here rather than fetched from ZWO's
// /v1/share/plan/qrcode, which would create a second, different share.
async function sharePlan({ name, slots, tzOffsetMinutes }, opts = {}) {
  const planName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const problems = [];
  if (!planName) problems.push('The plan needs a name.');
  if (!Number.isFinite(tzOffsetMinutes) || Math.abs(tzOffsetMinutes) > 14 * 60) problems.push('The time zone offset is missing or out of range.');
  const targets = problems.length ? [] : buildTargets(slots || [], tzOffsetMinutes);
  if (!problems.length) problems.push(...validateTargets(targets));
  if (problems.length) throw new SeestarShareError(`This plan can't be shared: ${problems[0]}`, { problems });

  const body = buildRequestBody(planName, targets);
  const shareId = await postShare(body, opts);
  const shareLink = `${LINK_BASE}${shareId}`;
  return {
    shareId,
    shareLink,
    qrPngBase64: await qrPngBase64(shareLink),
    planName,
    targetCount: targets.length,
    durationMinutes: body.metadata.shootingDurationMinutes,
    targets,
  };
}

module.exports = {
  sharePlan, qrPngBase64, buildTargets, validateTargets, buildRequestBody, startMinutes, planStartMinutes, snapToGrid, GRID_MINUTES, targetId,
  SeestarShareError, LINK_BASE, MAX_TARGETS,
};
