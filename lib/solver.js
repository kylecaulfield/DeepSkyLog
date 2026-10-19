// Plate solving with astrometry.net, run in the background with a log of
// every step.
//
// An observation's solver_status moves through:
//   queued   waiting here for its turn to upload (the local queue)
//   pending  uploaded; waiting in Nova's queue for a job
//   solving  Nova is running a job on it
//   success  solved — solved_* columns hold the calibration
//   failure  Nova could not solve it
// An upload that errors puts the observation back to idle (retryable).
//
// One worker uploads queued images one at a time (Nova's free queue prefers
// serial uploads), and a poller asks Nova about every pending / solving
// observation every `pollMs`, so results land without anyone refreshing a
// page. Each step is written to solver_events, which GET
// /api/admin/platesolve/activity serves to the admin observations page.
'use strict';

const fs = require('fs');
const path = require('path');

const ACTIVE = ['queued', 'pending', 'solving'];
const MAX_EVENTS = 2000;
const POLL_BATCH = 10;
// A status check that keeps failing is logged at most this often per
// observation, so a Nova outage doesn't flood the log.
const ERROR_LOG_EVERY_MS = 10 * 60_000;

// RA (degrees) / Dec as "20h 58m 47s" / "+44° 19′ 12″".
function fmtRa(deg) {
  let s = Math.round(((deg / 15) % 24 + 24) % 24 * 3600);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}
function fmtDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  let s = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(s / 3600); s -= d * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

function createSolver({ db, uploadDir, astrometry, log = console, pollMs = 30_000, uploadGapMs = 1_000 }) {
  const root = path.resolve(uploadDir);
  const insertEvent = db.prepare(
    `INSERT INTO solver_events (observation_id, kind, message, details)
     VALUES (@observation_id, @kind, @message, @details)`,
  );
  const pruneEvents = db.prepare(
    `DELETE FROM solver_events WHERE id <= (SELECT MAX(id) FROM solver_events) - ${MAX_EVENTS}`,
  );
  const setStatus = (id, fields) => {
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE observations SET ${sets} WHERE id = @id`).run({ ...fields, id });
  };

  function logEvent(observationId, kind, message, details = null) {
    insertEvent.run({
      observation_id: observationId ?? null, kind, message,
      details: details ? JSON.stringify(details) : null,
    });
  }
  let eventsSincePrune = 0;
  function event(observationId, kind, message, details) {
    try {
      logEvent(observationId, kind, message, details);
      if (++eventsSincePrune >= 100) { eventsSincePrune = 0; pruneEvents.run(); }
    } catch (err) {
      log.warn(`solver: could not log event: ${err.message}`);
    }
  }

  // ---- queue -------------------------------------------------------------

  // Put observations in the upload queue. Returns per-id outcomes so the
  // caller can report what was skipped and why. Observations already queued,
  // at Nova, or solved are skipped; those without an image file too.
  function enqueue(ids) {
    const results = [];
    const get = db.prepare('SELECT id, image_path, solver_status FROM observations WHERE id = ?');
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const id of ids) {
        const obs = get.get(id);
        if (!obs) { results.push({ id, status: 'skipped', reason: 'not found' }); continue; }
        if (!obs.image_path) { results.push({ id, status: 'skipped', reason: 'no image' }); continue; }
        if (obs.solver_status === 'success') { results.push({ id, status: 'skipped', reason: 'already solved' }); continue; }
        if (ACTIVE.includes(obs.solver_status)) {
          results.push({ id, status: 'skipped', reason: `already ${obs.solver_status}` });
          continue;
        }
        if (!imagePath(obs.image_path)) {
          results.push({ id, status: 'error', reason: 'image file not found' });
          event(id, 'error', 'Not queued: the image file is missing on the server');
          continue;
        }
        setStatus(id, { solver_status: 'queued', solver_queued_at: now, solver_job_id: null });
        event(id, 'queued', 'Queued for plate solving');
        results.push({ id, status: 'queued' });
      }
    });
    tx();
    if (results.some((r) => r.status === 'queued')) drain();
    return results;
  }

  function imagePath(rel) {
    const full = path.resolve(root, rel);
    return full.startsWith(root + path.sep) && fs.existsSync(full) ? full : null;
  }

  let draining = null;
  // Upload queued observations one at a time until the queue is empty.
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      let session = null;
      const next = db.prepare(
        `SELECT id, image_path FROM observations WHERE solver_status = 'queued'
          ORDER BY solver_queued_at, id LIMIT 1`,
      );
      for (;;) {
        const obs = next.get();
        if (!obs) break;
        const full = imagePath(obs.image_path || '');
        if (!full) {
          setStatus(obs.id, { solver_status: null });
          event(obs.id, 'error', 'Upload skipped: the image file is missing on the server');
          continue;
        }
        try {
          if (!session) session = await astrometry.login();
        } catch (err) {
          // No key or Nova refusing logins: nothing in the queue can go
          // anywhere, so return it all to idle and say why once.
          const n = db.prepare(`UPDATE observations SET solver_status = NULL WHERE solver_status = 'queued'`).run().changes;
          event(null, 'error', `Could not log in to astrometry.net (${err.message}); ${n} queued image(s) returned to unsolved`);
          break;
        }
        event(obs.id, 'uploading', 'Uploading to astrometry.net');
        try {
          const subid = String(await astrometry.submitFile(session, full));
          setStatus(obs.id, { solver_status: 'pending', solver_job_id: subid });
          event(obs.id, 'submitted', `Uploaded — astrometry.net submission ${subid}, waiting for a solver`, { subid });
          startPolling();
        } catch (err) {
          setStatus(obs.id, { solver_status: null });
          event(obs.id, 'error', `Upload failed: ${err.message}. Back to unsolved; try again later.`);
          if (err.code === 'login' || /HTTP 40[13]/.test(err.message)) session = null;
        }
        if (uploadGapMs) await new Promise((r) => setTimeout(r, uploadGapMs));
      }
    })().catch((err) => log.warn(`solver: upload worker failed: ${err.message}`))
      .finally(() => { draining = null; });
    return draining;
  }

  // ---- status ------------------------------------------------------------

  // Apply one Nova status to an observation, logging changes. Returns the
  // fields the GET endpoint reports.
  function applyPoll(obs, poll) {
    if (poll.state === 'pending') {
      if (obs.solver_status !== 'pending') setStatus(obs.id, { solver_status: 'pending' });
      return { status: 'pending' };
    }
    if (poll.state === 'solving') {
      if (obs.solver_status !== 'solving') {
        setStatus(obs.id, { solver_status: 'solving' });
        event(obs.id, 'solving', `Solving — astrometry.net job ${poll.job_id}`, { job_id: poll.job_id });
      }
      return { status: 'solving' };
    }
    if (poll.state === 'failure') {
      setStatus(obs.id, { solver_status: 'failure', solved_at: new Date().toISOString() });
      event(obs.id, 'failed', `Astrometry.net could not solve this image (job ${poll.job_id})`, { job_id: poll.job_id });
      return { status: 'failure' };
    }
    const cal = poll.calibration || {};
    const updates = {
      solver_status: 'success',
      solved_ra_hours: cal.ra != null ? cal.ra / 15 : null, // the API gives RA in degrees
      solved_dec_degrees: cal.dec ?? null,
      solved_radius_deg: cal.radius ?? null,
      solved_orientation_deg: cal.orientation ?? null,
      solved_pixscale: cal.pixscale ?? null,
      solved_at: new Date().toISOString(),
      solved_json: JSON.stringify({ calibration: cal, info: poll.info || null }),
    };
    setStatus(obs.id, updates);
    const objects = (poll.info?.objects_in_field || []).slice(0, 5);
    const bits = [];
    if (cal.ra != null && cal.dec != null) bits.push(`RA ${fmtRa(cal.ra)}, Dec ${fmtDec(cal.dec)}`);
    if (cal.radius != null) bits.push(`field radius ${cal.radius.toFixed(2)}°`);
    if (cal.pixscale != null) bits.push(`${cal.pixscale.toFixed(2)}″/px`);
    if (cal.orientation != null) bits.push(`orientation ${cal.orientation.toFixed(0)}°`);
    if (objects.length) bits.push(`in field: ${objects.join(', ')}`);
    event(obs.id, 'solved', `Solved${bits.length ? ' — ' + bits.join(' · ') : ''}`, {
      job_id: poll.job_id, ra_deg: cal.ra ?? null, dec_deg: cal.dec ?? null, radius_deg: cal.radius ?? null,
      pixscale: cal.pixscale ?? null, orientation: cal.orientation ?? null, objects_in_field: objects,
    });
    return { status: 'success', ...updates };
  }

  const lastPolled = new Map();
  const lastErrorLogged = new Map();
  // Ask Nova about one observation now (the per-observation GET endpoint).
  async function pollOne(obs) {
    lastPolled.set(obs.id, Date.now());
    const poll = await astrometry.pollStatus(obs.solver_job_id);
    lastErrorLogged.delete(obs.id);
    return applyPoll(obs, poll);
  }

  let pollTimer = null;
  let polling = false;
  async function tick() {
    if (polling) return;
    polling = true;
    try {
      const rows = db.prepare(
        `SELECT id, solver_status, solver_job_id FROM observations
          WHERE solver_status IN ('pending', 'solving') AND solver_job_id IS NOT NULL`,
      ).all();
      if (!rows.length) { stopPolling(); return; }
      rows.sort((a, b) => (lastPolled.get(a.id) || 0) - (lastPolled.get(b.id) || 0));
      for (const obs of rows.slice(0, POLL_BATCH)) {
        try {
          await pollOne(obs);
        } catch (err) {
          const last = lastErrorLogged.get(obs.id) || 0;
          if (Date.now() - last > ERROR_LOG_EVERY_MS) {
            lastErrorLogged.set(obs.id, Date.now());
            event(obs.id, 'error', `Status check failed: ${err.message}. Will keep trying.`);
          }
        }
      }
    } catch (err) {
      log.warn(`solver: poll failed: ${err.message}`);
    } finally {
      polling = false;
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(tick, pollMs);
    pollTimer.unref?.();
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  // Resume after a restart: upload whatever is still queued, poll whatever
  // is still at Nova.
  function start() {
    const queued = db.prepare(`SELECT COUNT(*) AS n FROM observations WHERE solver_status = 'queued'`).get().n;
    const active = db.prepare(
      `SELECT COUNT(*) AS n FROM observations WHERE solver_status IN ('pending', 'solving') AND solver_job_id IS NOT NULL`,
    ).get().n;
    if (queued) drain();
    if (active) { startPolling(); setTimeout(tick, 1_000).unref?.(); }
  }

  // ---- activity ------------------------------------------------------------

  const LABEL = `COALESCE(
      lo.catalog || lo.catalog_number || COALESCE(' · ' || lo.name, ''),
      o.catalog || o.catalog_number,
      o.object_name, o.title, '#' || o.id)`;

  // Everything the activity log shows: counts per state, what is in progress
  // (with when it entered its current state), and log events after
  // `afterId` (oldest first, at most `limit`; the newest `limit` on the first
  // call, when afterId is 0).
  function activity(afterId = 0, limit = 100) {
    afterId = Number(afterId) || 0;
    const counts = { queued: 0, pending: 0, solving: 0, success: 0, failure: 0, unsolved: 0 };
    for (const r of db.prepare(
      `SELECT CASE
                WHEN solver_status IN ('queued', 'pending', 'solving', 'success', 'failure') THEN solver_status
                WHEN image_path IS NOT NULL THEN 'unsolved'
              END AS s, COUNT(*) AS n
         FROM observations GROUP BY s`,
    ).all()) if (r.s) counts[r.s] = r.n;

    const active = db.prepare(
      `SELECT o.id, o.object_id, o.solver_status AS status, o.solver_job_id AS subid, ${LABEL} AS label,
              (SELECT MAX(e.at) FROM solver_events e WHERE e.observation_id = o.id) AS since
         FROM observations o LEFT JOIN list_objects lo ON lo.id = o.object_id
        WHERE o.solver_status IN ('queued', 'pending', 'solving')
        ORDER BY CASE o.solver_status WHEN 'solving' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                 o.solver_queued_at, o.id`,
    ).all();

    const cols = `e.id, e.at, e.observation_id, e.kind, e.message, e.details, o.object_id,
                  CASE WHEN o.id IS NULL THEN NULL ELSE ${LABEL} END AS label`;
    const from = `FROM solver_events e LEFT JOIN observations o ON o.id = e.observation_id
                  LEFT JOIN list_objects lo ON lo.id = o.object_id`;
    const maxId = db.prepare('SELECT MAX(id) AS id FROM solver_events').get().id || 0;
    // Ids only grow; a cursor beyond the newest event (a restored backup)
    // starts over.
    if (afterId > maxId) afterId = 0;
    const rows = afterId > 0
      ? db.prepare(`SELECT ${cols} ${from} WHERE e.id > ? ORDER BY e.id LIMIT ?`).all(afterId, limit)
      : db.prepare(`SELECT ${cols} ${from} ORDER BY e.id DESC LIMIT ?`).all(limit).reverse();
    const events = rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
    // The cursor for the next call: past what was returned, so a burst larger
    // than `limit` arrives over several calls instead of being skipped.
    const lastId = afterId > 0 ? (rows.length ? rows[rows.length - 1].id : afterId) : maxId;
    // Current state of every observation those events mention, so the page
    // can update just those rows.
    const ids = [...new Set(events.map((e) => e.observation_id).filter((v) => v != null))];
    const observations = ids.length
      ? db.prepare(
        `SELECT id, solver_status, solved_radius_deg FROM observations WHERE id IN (${ids.map(() => '?').join(',')})`,
      ).all(...ids)
      : [];
    return { counts, active, events, observations, last_event_id: lastId };
  }

  return { enqueue, drain, pollOne, tick, start, stopPolling, activity, event, _fmt: { fmtRa, fmtDec } };
}

module.exports = { createSolver };
