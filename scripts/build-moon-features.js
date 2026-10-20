#!/usr/bin/env node
// Builds lib/moon_features.json — the named lunar features the Moon map
// (lib/moon_map.js) can label — from the IAU / USGS Gazetteer of Planetary
// Nomenclature (public domain):
//
//   curl -O https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip
//   unzip MOON_nomenclature_center_pts.zip
//   curl -O https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg
//   node scripts/build-moon-features.js MOON_nomenclature_center_pts.dbf lroc_color_poles_1k.jpg
//
// Kept: features on or near the Earth-facing side (|longitude| <= 98°, so
// libration can bring them into view) — every mare / oceanus / lacus /
// sinus / palus, craters of 20 km or more, and the larger mountains,
// rilles, valleys, scarps, ridges and promontories, and the named landing
// sites — plus the Apollo sites the gazetteer doesn't name (NASA's
// published coordinates; Apollo 11's is its Statio Tranquillitatis).
//
// The gazetteer has only centres and bounding boxes, so outlines for the
// larger dark plains are traced from NASA's public-domain LRO mosaic (the
// second argument; the same one scripts/build-moon-albedo.js uses): its dark
// pixels are shared out between the maria whose boxes they fall in, nearest
// centre (relative to size) winning, and each mare's patch is traced.
//
// Output: [{ n: name, t: kind, lat, lon, d: diameter km, ring? }], lon east-
// positive in -180..180; `ring` = the traced outline, [[lat, lon], ...].
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const KIND = {
  AA: 'crater',
  ME: 'mare', OC: 'mare', LC: 'mare', SI: 'mare', PA: 'mare',
  MO: 'mons', PR: 'mons',
  RI: 'rima', VA: 'rima', RU: 'rima', DO: 'rima',
  ST: 'landing',
};
// Smallest size kept per gazetteer code (km); codes absent here are dropped.
const MIN_DIAMETER = { AA: 20, ME: 0, OC: 0, LC: 0, SI: 0, PA: 0, MO: 10, PR: 10, RI: 60, VA: 60, RU: 60, DO: 150, ST: 0 };
const MAX_ABS_LON = 98;

const APOLLO = [
  ['Apollo 11', 0.674, 23.473], ['Apollo 12', -3.012, -23.422], ['Apollo 14', -3.645, -17.471],
  ['Apollo 15', 26.132, 3.634], ['Apollo 16', -8.973, 15.501], ['Apollo 17', 20.191, 30.772],
];

function readDbf(file) {
  const b = fs.readFileSync(file);
  const nrec = b.readUInt32LE(4), hlen = b.readUInt16LE(8), rlen = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d; o += 32) {
    fields.push({ name: b.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: b[o + 16] });
  }
  const out = [];
  for (let i = 0; i < nrec; i++) {
    const o = hlen + i * rlen;
    if (b[o] === 0x2a) continue; // deleted record
    let p = o + 1;
    const r = {};
    for (const f of fields) { r[f.name] = b.toString('utf8', p, p + f.len).trim(); p += f.len; }
    out.push(r);
  }
  return out;
}

// Plains at least this wide (km) get a traced outline.
const MIN_RING_DIAMETER = 200;
const MOON_RADIUS_KM = 1737.4;

const wrap = (lon) => { const l = ((Number(lon) + 180) % 360 + 360) % 360 - 180; return Math.round(l * 1000) / 1000; };
const r3 = (v) => Math.round(Number(v) * 1000) / 1000;

// --- Mare outlines ----------------------------------------------------------

function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = values.length - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

// 8-connected component of `mask` containing pixel `seed`, holes filled.
function component(mask, w, h, seed) {
  const out = new Uint8Array(w * h);
  const stack = [seed];
  out[seed] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % w, y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (mask[q] && !out[q]) { out[q] = 1; stack.push(q); }
    }
  }
  const outside = new Uint8Array(w * h);
  const seedOut = (q) => { if (!out[q] && !outside[q]) { outside[q] = 1; stack.push(q); } };
  for (let x = 0; x < w; x++) { seedOut(x); seedOut((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seedOut(y * w); seedOut(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w;
    if (x > 0) seedOut(p - 1);
    if (x < w - 1) seedOut(p + 1);
    if (p >= w) seedOut(p - w);
    if (p < w * (h - 1)) seedOut(p + w);
  }
  for (let i = 0; i < out.length; i++) if (!outside[i]) out[i] = 1;
  return out;
}

// Morphological opening then closing with a 3×3 square, `n` times each:
// knocks off one-pixel spurs and fills notches so the outline is smooth.
function smooth(mask, w, h, n) {
  const step = (src, keepIfAll) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let all = true, any = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        const v = xx >= 0 && yy >= 0 && xx < w && yy < h ? src[yy * w + xx] : 0;
        if (v) any = true; else all = false;
      }
      out[y * w + x] = keepIfAll ? (all ? 1 : 0) : (any ? 1 : 0);
    }
    return out;
  };
  let m = mask;
  for (let i = 0; i < n; i++) m = step(m, true);
  for (let i = 0; i < n; i++) m = step(m, false);
  for (let i = 0; i < n; i++) m = step(m, false);
  for (let i = 0; i < n; i++) m = step(m, true);
  return m;
}

// Outer boundary of a hole-free blob, clockwise, by Moore-neighbour tracing
// (Jacob's stopping criterion). Pixel coordinates [x, y].
const DIRS = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
const dirIndex = (dx, dy) => DIRS.findIndex(([a, b]) => a === dx && b === dy);
function trace(mask, w, h) {
  const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  let start = -1;
  for (let i = 0; i < mask.length && start < 0; i++) if (mask[i]) start = i;
  if (start < 0) return [];
  const sx = start % w, sy = (start - sx) / w;
  const out = [[sx, sy]];
  let x = sx, y = sy, back = 0; // backtrack pixel is to the west
  for (let guard = 0; guard < 4 * w * h; guard++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      if (fg(x + DIRS[d][0], y + DIRS[d][1])) { found = d; break; }
    }
    if (found < 0) break; // a lone pixel
    const prev = DIRS[(found + 7) % 8];
    const nx = x + DIRS[found][0], ny = y + DIRS[found][1];
    back = dirIndex(x + prev[0] - nx, y + prev[1] - ny);
    x = nx; y = ny;
    if (x === sx && y === sy && back === 0) break;
    out.push([x, y]);
  }
  return out;
}

// Douglas–Peucker simplification of an open polyline.
function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let worst = -1, dist = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > dist) { dist = d; worst = i; }
    }
    if (worst >= 0 && dist > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

async function addOutlines(features, mosaic) {
  const W = 1024, H = 512;
  const { data } = await sharp(mosaic).greyscale().resize(W, H, { fit: 'fill' }).blur(1.5)
    .raw().toBuffer({ resolveWithObject: true });
  const lonOf = (x) => ((x + 0.5) / W) * 360 - 180;
  const latOf = (y) => 90 - ((y + 0.5) / H) * 180;
  const near = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (Math.abs(lonOf(x)) < 80 && Math.abs(latOf(y)) < 70) near.push(data[y * W + x]);
  }
  const dark = otsu(near);
  const plains = features.filter((f) => f.t === 'mare' && f.d >= MIN_RING_DIAMETER && f.box);
  const owner = new Int16Array(W * H).fill(-1);
  const toRad = Math.PI / 180;
  for (let y = 0; y < H; y++) {
    const lat = latOf(y);
    for (let x = 0; x < W; x++) {
      if (data[y * W + x] > dark) continue;
      const lon = lonOf(x);
      let best = -1, bestScore = Infinity;
      plains.forEach((f, i) => {
        const [minLat, maxLat, minLon, maxLon] = f.box;
        if (lat < minLat - 1 || lat > maxLat + 1 || lon < minLon - 1 || lon > maxLon + 1) return;
        const c = Math.sin(lat * toRad) * Math.sin(f.lat * toRad)
          + Math.cos(lat * toRad) * Math.cos(f.lat * toRad) * Math.cos((lon - f.lon) * toRad);
        const score = Math.acos(Math.max(-1, Math.min(1, c))) / (f.d / 2 / MOON_RADIUS_KM);
        if (score < bestScore) { bestScore = score; best = i; }
      });
      owner[y * W + x] = best;
    }
  }
  plains.forEach((f, i) => {
    let mask = new Uint8Array(W * H);
    for (let p = 0; p < mask.length; p++) mask[p] = owner[p] === i ? 1 : 0;
    mask = smooth(mask, W, H, 2);
    // The patch holding the centre, or failing that the one nearest it.
    const cx = Math.round(((f.lon + 180) / 360) * W - 0.5), cy = Math.round(((90 - f.lat) / 180) * H - 0.5);
    let seed = -1, seedDist = Infinity;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const d = Math.hypot((p % W) - cx, Math.floor(p / W) - cy);
      if (d < seedDist) { seedDist = d; seed = p; }
    }
    const radiusPx = (f.d / 2 / MOON_RADIUS_KM) * (180 / Math.PI) * (W / 360);
    if (seed < 0 || seedDist > radiusPx * 0.5) return;
    const blob = component(mask, W, H, seed);
    const area = blob.reduce((s, v) => s + v, 0);
    if (area < 20) return;
    const ring = simplify(trace(blob, W, H), 1.2);
    if (ring.length < 6) return;
    f.ring = ring.map(([x, y]) => [Math.round(latOf(y) * 10) / 10, Math.round(lonOf(x) * 10) / 10]);
  });
  return plains.filter((f) => f.ring).length;
}

async function main() {
  const [file, mosaic] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/build-moon-features.js MOON_nomenclature_center_pts.dbf [lroc_color_poles_1k.jpg]');
    process.exit(2);
  }
  const features = [];
  for (const r of readDbf(file)) {
    const kind = KIND[r.code];
    if (!kind || !/^Adopted/.test(r.approval)) continue;
    const lon = wrap(r.center_lon);
    const d = Number(r.diameter) || 0;
    if (Math.abs(lon) > MAX_ABS_LON || d < MIN_DIAMETER[r.code]) continue;
    const f = { n: r.clean_name || r.name, t: kind, lat: r3(r.center_lat), lon, d: Math.round(d * 10) / 10 };
    if (kind === 'mare') f.box = [r3(r.min_lat), r3(r.max_lat), wrap(r.min_lon), wrap(r.max_lon)];
    features.push(f);
  }
  const outlined = mosaic ? await addOutlines(features, mosaic) : 0;
  for (const f of features) delete f.box;
  // An Apollo site the gazetteer already names keeps the gazetteer's name.
  const named = features.filter((f) => f.t === 'landing');
  for (const [n, lat, lon] of APOLLO) {
    if (named.some((f) => Math.abs(f.lat - lat) < 0.05 && Math.abs(f.lon - lon) < 0.05)) continue;
    features.push({ n, t: 'landing', lat, lon, d: 0 });
  }
  // Biggest first: the map labels in this order and skips what collides.
  const rank = { mare: 0, landing: 1, mons: 2, rima: 3, crater: 4 };
  features.sort((a, b) => (rank[a.t] - rank[b.t]) || (b.d - a.d) || a.n.localeCompare(b.n));
  const out = path.join(__dirname, '..', 'lib', 'moon_features.json');
  fs.writeFileSync(out, `${JSON.stringify(features).replace(/\},\{/g, '},\n{')}\n`);
  const counts = features.reduce((m, f) => ({ ...m, [f.t]: (m[f.t] || 0) + 1 }), {});
  console.log(`wrote ${features.length} features (${outlined} outlined) to ${path.relative(process.cwd(), out)}`, counts);
}

main().catch((err) => { console.error(err); process.exit(1); });
