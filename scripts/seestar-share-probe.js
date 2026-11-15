#!/usr/bin/env node
// Probe for ZWO's undocumented Seestar "share plan" API (reverse engineered
// from the Android app; see https://github.com/astronomyk/seestarpy/issues/5).
// It answers one question before any feature is built on it: does creating a
// share work without a login token?
//
//   node scripts/seestar-share-probe.js --get e6e5r1a3   # read a real share, check its shape
//   node scripts/seestar-share-probe.js --dry-run        # print the POST, send nothing
//   node scripts/seestar-share-probe.js                  # POST a one-target plan (M42), no auth
//   node scripts/seestar-share-probe.js --server-qr      # also ask ZWO for the QR PNG (a 2nd share)
//
// Options: --name "Plan name"; --header "Name: value" (repeatable, e.g. to try
// the app's X-Lang header); --out file.png (where --server-qr saves the PNG).
// The POST creates a real share on ZWO's servers each time it succeeds.
//
// What a real share looks like (GET of e6e5r1a3, checked 2026-11-15) — JSON
// strings three deep:
//   body.payload            string -> PlanItem
//   PlanItem.payload        string -> [TargetItem, ...]
//   PlanItem.extra          string -> { wideIncrementId }
// PlanItem.createTime is in seconds, operationTime in milliseconds.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.seestar.com';
const LINK_BASE = 'https://app.zwoastro.com/Seestar/plan?id=';
const TIMEOUT_MS = 20_000;

function parseArgs(argv) {
  const args = { headers: {}, name: 'DeepSkyLog probe' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--server-qr') args.serverQr = true;
    else if (a === '--get') args.get = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--header') {
      const m = /^([^:]+):\s*(.*)$/.exec(argv[++i] || '');
      if (!m) throw new Error('--header wants "Name: value"');
      args.headers[m[1].trim()] = m[2];
    } else if (a === '-h' || a === '--help') args.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return args;
}

// M42 for tonight from Mount Prospect, IL: 23:00 local, one hour. start_min
// counts minutes after local midnight (past-midnight slots go above 1440).
function buildBody(planName) {
  const target = {
    ai_generated: false,
    alias_name: 'Orion Nebula',
    camera: { exp_ms: { stack_l: 10000 }, stack: { capt_type: 'stack' } },
    camera_mode: 'tele',
    duration_min: 60,
    lp_filter: false,
    mount: { tracking: false },
    start_min: 23 * 60,
    target_id: 1976042, // any positive id unique within the plan
    target_name: 'M 42',
    target_ra_dec: [5.5881, -5.391], // RA hours, Dec degrees (J2000)
    second_camera: null,
  };
  const now = Date.now();
  const plan = {
    createTime: Math.floor(now / 1000),
    extra: JSON.stringify({ wideIncrementId: 0 }),
    id: crypto.randomUUID(),
    name: planName,
    operation: 'update',
    operationTime: now,
    payload: JSON.stringify([target]),
    recommendDurationMinute: 30,
  };
  return {
    payload: JSON.stringify(plan),
    metadata: { planName, targetCount: 1, shootingDurationMinutes: target.duration_min },
  };
}

// Undo the nested string encoding of a share ({ payload, metadata }).
function decodeShare(data) {
  const plan = JSON.parse(data.payload);
  const notes = [];
  if (typeof plan.payload === 'string') plan.payload = JSON.parse(plan.payload);
  else notes.push('PlanItem.payload is NOT a string');
  if (typeof plan.extra === 'string') plan.extra = JSON.parse(plan.extra);
  else notes.push('PlanItem.extra is NOT a string');
  return { plan, metadata: data.metadata, notes };
}

async function call(method, url, headers, body) {
  const res = await fetch(url, {
    method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  console.log(`\n< HTTP ${res.status} ${res.statusText}`);
  for (const [k, v] of res.headers) console.log(`< ${k}: ${v}`);
  console.log(`\n${text}\n`);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 20).join('\n').replace(/^\/\/ ?/gm, ''));
    return;
  }

  if (args.get) {
    const id = String(args.get).replace(/^.*[?&]id=/, '');
    const url = `${API_BASE}/v1/share/plan/${encodeURIComponent(id)}`;
    console.log(`> GET ${url}`);
    const { json } = await call('GET', url, args.headers);
    if (json?.code === 200 && json.data?.payload) {
      const decoded = decodeShare(json.data);
      console.log('Decoded share:');
      console.log(JSON.stringify(decoded, null, 2));
      const t = decoded.plan.payload[0] || {};
      console.log(`\nPlanItem keys:   ${Object.keys(decoded.plan).sort().join(', ')}`);
      console.log(`TargetItem keys: ${Object.keys(t).sort().join(', ')}`);
    } else {
      console.log(`Not a share: body code ${json?.code}, msg ${JSON.stringify(json?.msg)}`);
      process.exitCode = 1;
    }
    return;
  }

  const body = JSON.stringify(buildBody(args.name));
  const headers = { 'Content-Type': 'application/json', ...args.headers };
  const url = `${API_BASE}/v1/share/plan`;
  console.log(`> POST ${url}`);
  for (const [k, v] of Object.entries(headers)) console.log(`> ${k}: ${v}`);
  console.log(`\n${body}\n`);
  console.log('Decoded, for reading:');
  console.log(JSON.stringify(decodeShare(JSON.parse(body)), null, 2));
  if (args.dryRun) {
    console.log('\n--dry-run: nothing sent.');
    return;
  }

  const { status, json } = await call('POST', url, headers, body);
  const shareId = json?.data?.shareId;
  if (status !== 200 || json?.code !== 200 || !shareId) {
    console.log(`FAILED: HTTP ${status}, body code ${json?.code}, msg ${JSON.stringify(json?.msg)}`);
    process.exitCode = 1;
    return;
  }
  const link = `${LINK_BASE}${shareId}`;
  console.log(`OK. shareId ${shareId}`);
  console.log(`Server's shareLink: ${json.data.shareLink}`);
  console.log(`Link the app's scanner accepts: ${link}`);
  if (json.data.shareLink !== link) console.log('NOTE: the server\'s shareLink differs from the expected form.');
  console.log(`Read it back with: node scripts/seestar-share-probe.js --get ${shareId}`);

  if (args.serverQr) {
    const qrUrl = `${API_BASE}/v1/share/plan/qrcode`;
    console.log(`\n> POST ${qrUrl} (same body; this creates a second share)`);
    const qr = await call('POST', qrUrl, headers, body);
    const b64 = String(qr.json?.data?.qrcode || '').replace(/^data:image\/\w+;base64,/, '');
    if (qr.status === 200 && qr.json?.code === 200 && b64) {
      const out = path.resolve(args.out || 'seestar-share-qr.png');
      fs.writeFileSync(out, Buffer.from(b64, 'base64'));
      console.log(`QR saved to ${out}`);
    } else {
      console.log(`QR FAILED: HTTP ${qr.status}, body code ${qr.json?.code}, msg ${JSON.stringify(qr.json?.msg)}`);
      process.exitCode = 1;
    }
  } else {
    console.log('For a QR: re-run with --server-qr, or paste the link into any QR generator.');
  }
}

main().catch((err) => {
  console.error(`probe failed: ${err.cause?.code || err.name}: ${err.message}`);
  process.exit(1);
});
