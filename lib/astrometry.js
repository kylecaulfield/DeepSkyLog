// Thin wrapper around https://nova.astrometry.net's REST API for "plate
// solving" — figuring out exactly where in the sky an image was taken,
// what its field of view is, and which way is up.
//
// The flow:
//   1. POST /api/login with the user's API key      → session token
//   2. POST /api/upload with the image (or url)     → submission id (subid)
//   3. Poll /api/submissions/<subid>                → list of jobs
//   4. Poll /api/jobs/<jobid>                       → 'success' / 'failure'
//   5. GET  /api/jobs/<jobid>/calibration           → centre RA/Dec, FOV, …
//
// All steps need the session token in form-data as `session=<token>`.
// The free public service is rate-limited and queue-driven; expect jobs
// to take seconds-to-minutes. The DeepSkyLog server submits and stores
// the subid; status is polled on demand from the admin UI.
//
// Set ASTROMETRY_API_KEY to enable. Without it every method throws a
// recognisable error so the caller can disable the feature gracefully.

const fsp = require('fs/promises');
const path = require('path');

const API_BASE = process.env.ASTROMETRY_API_BASE || 'https://nova.astrometry.net/api';
const FETCH_TIMEOUT_MS = Number(process.env.ASTROMETRY_TIMEOUT_MS) || 60_000;

class AstrometryError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function apiKey() {
  const k = (process.env.ASTROMETRY_API_KEY || '').trim();
  if (!k) throw new AstrometryError('ASTROMETRY_API_KEY not set', 'no_key');
  return k;
}

// Read-and-discard so undici can free the underlying socket / file handle
// when the response body isn't going to be parsed.
async function drain(res) {
  try { await res.body?.cancel?.(); } catch {}
}

async function postForm(endpoint, fields, fileFieldName, fileBuffer, fileName) {
  const url = `${API_BASE}${endpoint}`;
  const boundary = `----dskbnd${Date.now()}${Math.random().toString(36).slice(2)}`;
  // Sanitise filename for the multipart header — strip CR/LF/quote so a
  // weirdly-named file on disk can't break out of the form-data block.
  const safeFile = String(fileName || 'upload')
    .replace(/[\r\n"\\]/g, '_').slice(0, 200);
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
    ));
  }
  if (fileBuffer) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileFieldName}"; filename="${safeFile}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    ));
    chunks.push(fileBuffer);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await drain(res);
    throw new AstrometryError(`POST ${endpoint} → HTTP ${res.status}`, 'http');
  }
  return res.json();
}

async function getJson(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await drain(res);
    throw new AstrometryError(`GET ${endpoint} → HTTP ${res.status}`, 'http');
  }
  return res.json();
}

async function login() {
  const data = await postForm('/login', {
    'request-json': JSON.stringify({ apikey: apiKey() }),
  });
  if (data.status !== 'success' || !data.session) {
    throw new AstrometryError(`login failed: ${JSON.stringify(data)}`, 'login');
  }
  return data.session;
}

// Submit a local file. Returns the submission id (subid).
async function submitFile(session, filePath) {
  const buf = await fsp.readFile(filePath);
  const name = path.basename(filePath);
  const data = await postForm('/upload', {
    'request-json': JSON.stringify({
      session,
      publicly_visible: 'n',
      allow_modifications: 'd',
      allow_commercial_use: 'd',
    }),
  }, 'file', buf, name);
  if (data.status !== 'success' || !data.subid) {
    throw new AstrometryError(`upload failed: ${JSON.stringify(data)}`, 'upload');
  }
  return data.subid;
}

async function submission(subid) {
  return getJson(`/submissions/${subid}`);
}

async function job(jobid) {
  return getJson(`/jobs/${jobid}`);
}

async function calibration(jobid) {
  return getJson(`/jobs/${jobid}/calibration`);
}

async function jobInfo(jobid) {
  return getJson(`/jobs/${jobid}/info`);
}

// Status helpers. Returns one of:
//   'pending'  — submission still in queue, no job yet
//   'solving'  — job exists but not finished
//   'success'  — ready, calibration available
//   'failure'  — astrometry could not solve it
async function pollStatus(subid) {
  const sub = await submission(subid);
  const jobs = (sub.jobs || []).filter(Boolean);
  if (!jobs.length) return { state: 'pending', sub };
  const id = jobs[jobs.length - 1];
  const j = await job(id);
  if (j.status === 'success') {
    const [cal, info] = await Promise.all([calibration(id), jobInfo(id)]);
    return { state: 'success', sub, job_id: id, job: j, calibration: cal, info };
  }
  if (j.status === 'failure') return { state: 'failure', sub, job_id: id, job: j };
  return { state: 'solving', sub, job_id: id, job: j };
}

module.exports = {
  AstrometryError, apiKey,
  login, submitFile, submission, job, calibration, jobInfo, pollStatus,
};
