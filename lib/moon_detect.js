// Finds the Moon in a photo and works out how the photo is turned.
//
// Disk: threshold the image, keep the biggest bright blob, and fit a
// circle to its edge with RANSAC. The sunlit limb is always a true half
// circle (or more), whereas the terminator is an ellipse, so the circle
// with the most edge points on it is the limb, at any phase.
//
// Orientation: render the Moon as the ephemeris says it looks at that
// moment (lib/moon_albedo.png — NASA's LRO mosaic — shaded for the Sun's
// position) and correlate it with the photo at every rotation, plain and
// mirrored. The lit shape pins the rotation at crescent and quarter phases,
// the maria pattern near full; the best match wins.
//
// Screen coordinates throughout: x right, y down, in the photo's displayed
// (EXIF-oriented) pixels. `rotation` is where lunar north points, degrees
// clockwise from straight up.
'use strict';

const path = require('path');
const sharp = require('sharp');

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const WORK_MAX = 1024; // longest side analysed, px
const GRID = 112; // samples across the disk diameter when matching
const LIMB_CUT = 0.94; // ignore the outer edge of the disk (r² beyond this)
// The "detail" match uses only samples where the Sun stands this high
// (cosine of its zenith angle), clear of the terminator's soft edge, and
// only when there are enough of them (a thin crescent may not have).
const DETAIL_MU0 = 0.2;
const MIN_DETAIL_SAMPLES = 300;
const ALBEDO_FILE = path.join(__dirname, 'moon_albedo.png');

const sinD = (d) => Math.sin(d * RAD);
const cosD = (d) => Math.cos(d * RAD);
const rev = (x) => ((x % 360) + 360) % 360;

// --- Geometry -------------------------------------------------------------

// Screen directions of lunar north and east for a photo turned `rotation`
// degrees; a mirror image (star diagonal, some phone exports) flips east.
function screenFrame(rotation, mirrored = false) {
  const t = rotation * RAD;
  return {
    north: [Math.sin(t), -Math.cos(t)],
    east: mirrored ? [-Math.cos(t), -Math.sin(t)] : [Math.cos(t), Math.sin(t)],
  };
}

// Moon-fixed unit vectors (x to 0°/0°, y to 90°E, z to the north pole) of
// the observer's line of sight and the disk's east / north axes, for
// libration (l, b). Orthographic disk coordinates of a surface point p are
// (p·east, p·north), and it faces the observer when p·view > 0.
function globeAxes(l, b) {
  const cl = cosD(l), sl = sinD(l), cb = cosD(b), sb = sinD(b);
  return {
    view: [cb * cl, cb * sl, sb],
    east: [-sl, cl, 0],
    north: [-sb * cl, -sb * sl, cb],
  };
}

function surfaceVector(lat, lon) {
  const cl = cosD(lat);
  return [cl * cosD(lon), cl * sinD(lon), sinD(lat)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// --- Albedo map and rendering --------------------------------------------

let albedoPromise = null;
function loadAlbedo() {
  if (!albedoPromise) {
    albedoPromise = sharp(ALBEDO_FILE).greyscale().raw().toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        const values = new Float32Array(info.width * info.height);
        for (let i = 0; i < values.length; i++) values[i] = data[i * info.channels] / 255;
        return { width: info.width, height: info.height, values };
      });
    albedoPromise.catch(() => { albedoPromise = null; });
  }
  return albedoPromise;
}

// Bilinear albedo at a selenographic lat/lon (degrees).
function albedoAt(map, lat, lon) {
  const { width, height, values } = map;
  const x = ((lon + 180) / 360) * width - 0.5;
  const y = Math.max(0, Math.min(height - 1.001, ((90 - lat) / 180) * height - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const xa = ((x0 % width) + width) % width, xb = (xa + 1) % width;
  const r0 = y0 * width, r1 = r0 + width;
  return (values[r0 + xa] * (1 - fx) + values[r0 + xb] * fx) * (1 - fy)
    + (values[r1 + xa] * (1 - fx) + values[r1 + xb] * fx) * fy;
}

// Brightness of the disk at orthographic (x east, y north) — albedo times a
// Lommel–Seeliger phase law, the reason the full Moon looks flat — or 0 on
// the night side, and the cosine of the Sun's zenith angle there (mu0, <= 0
// at night). NaN for both off the disk.
function shadeAt(map, axes, sunVec, x, y) {
  const rr = x * x + y * y;
  if (rr >= 1) return { shade: NaN, mu0: NaN };
  const z = Math.sqrt(1 - rr);
  const p = [
    x * axes.east[0] + y * axes.north[0] + z * axes.view[0],
    x * axes.east[1] + y * axes.north[1] + z * axes.view[1],
    x * axes.east[2] + y * axes.north[2] + z * axes.view[2],
  ];
  const mu0 = dot(p, sunVec);
  if (mu0 <= 0) return { shade: 0, mu0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) * DEG;
  const lon = Math.atan2(p[1], p[0]) * DEG;
  return { shade: albedoAt(map, lat, lon) * mu0 / (mu0 + z), mu0 };
}

// The Moon as `face` (lib/moon_ephem.js) says it looks, lunar north up and
// east right, sampled n × n over the disk's bounding square (row-major):
// `shade` (brightness) and `mu0` (sunlight angle), NaN off the disk.
function canonicalImage(map, face, n) {
  const axes = globeAxes(face.libration.l, face.libration.b);
  const sunVec = surfaceVector(face.sun.b, face.sun.l);
  const shade = new Float32Array(n * n), mu0 = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const y = 1 - ((j + 0.5) / n) * 2;
    for (let i = 0; i < n; i++) {
      const s = shadeAt(map, axes, sunVec, ((i + 0.5) / n) * 2 - 1, y);
      shade[j * n + i] = s.shade;
      mu0[j * n + i] = s.mu0;
    }
  }
  return { shade, mu0, n };
}

// A synthetic photo: `size` square, black sky, the Moon of radius `r` at
// (cx, cy), turned `rotation` (mirrored if asked). Greyscale 0..255 Buffer.
// Tests and the docs use it; detection never does.
async function renderMoon({ face, size, cx = size / 2, cy = size / 2, r = size * 0.4, rotation = 0, mirrored = false, gain = 1.6 }) {
  const map = await loadAlbedo();
  const axes = globeAxes(face.libration.l, face.libration.b);
  const sunVec = surfaceVector(face.sun.b, face.sun.l);
  const { north, east } = screenFrame(rotation, mirrored);
  const buf = Buffer.alloc(size * size);
  const ss = [0.25, 0.75];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = 0;
      for (const oy of ss) for (const ox of ss) {
        const gx = (px + ox - 0.5 - cx) / r, gy = (py + oy - 0.5 - cy) / r;
        const v = shadeAt(map, axes, sunVec, gx * east[0] + gy * east[1], gx * north[0] + gy * north[1]).shade;
        if (Number.isFinite(v)) acc += v;
      }
      buf[py * size + px] = Math.max(0, Math.min(255, Math.round((acc / 4) * 255 * gain)));
    }
  }
  return buf;
}

// --- Image loading --------------------------------------------------------

// The photo as displayed (EXIF orientation applied), greyscale, longest side
// at most WORK_MAX. `sx`/`sy` map full-size pixels to working pixels.
async function loadWork(imagePath) {
  const meta = await sharp(imagePath, { failOn: 'none' }).metadata();
  if (!meta.width || !meta.height) throw new Error('unreadable image');
  const swap = (meta.orientation || 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;
  const scale = Math.min(1, WORK_MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const { data, info } = await sharp(imagePath, { failOn: 'none' }).rotate().removeAlpha().greyscale()
    .resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const grey = new Uint8Array(w * h);
  for (let i = 0; i < grey.length; i++) grey[i] = data[i * info.channels];
  return { width, height, w, h, sx: w / width, sy: h / height, grey };
}

// --- Disk -----------------------------------------------------------------

// Brightness separating the Moon from the sky: a fifth of the way from the
// sky (5th percentile) to the bright highlands (99.5th), kept clear of the
// sky's noise. (Otsu's method, the textbook choice, splits maria from
// highlands instead when the Moon fills much of the frame.)
function limbThreshold(grey) {
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i++) hist[grey[i]]++;
  const pct = (q) => {
    const target = q * grey.length;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
    return 255;
  };
  const sky = pct(0.05), bright = pct(0.995);
  const span = bright - sky;
  const noise = pct(0.25) - sky;
  return sky + Math.min(0.5 * span, Math.max(0.2 * span, 8 * noise, 4));
}

// The largest 8-connected blob of `mask`, holes filled, as a Uint8Array.
function largestBlob(mask, w, h) {
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestLabel = 0, bestSize = 0, next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let top = 0, size = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const p = stack[--top];
      size++;
      const x = p % w, y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q] && !label[q]) { label[q] = next; stack[top++] = q; }
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  const blob = new Uint8Array(w * h);
  if (!bestLabel) return { blob, size: 0 };
  for (let i = 0; i < blob.length; i++) blob[i] = label[i] === bestLabel ? 1 : 0;
  // Fill holes (dark maria and craters inside the limb): whatever the
  // outside can't reach is inside.
  const outside = new Uint8Array(w * h);
  let top = 0;
  const seed = (q) => { if (!blob[q] && !outside[q]) { outside[q] = 1; stack[top++] = q; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (top) {
    const p = stack[--top];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  for (let i = 0; i < blob.length; i++) if (!outside[i]) blob[i] = 1;
  return { blob, size: bestSize };
}

// Edge pixels of the blob, skipping the frame border (a Moon cut off by the
// frame has straight edges there that aren't limb), with the local contrast
// at each: the sunlit limb is a hard step to black sky, the terminator a soft
// ramp, so contrast tells them apart even where the terminator runs close
// to the limb (a nearly full Moon).
function edgePoints(blob, grey, w, h) {
  const xs = [], ys = [], contrast = [];
  const K = 3;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (!blob[p] || (blob[p - 1] && blob[p + 1] && blob[p - w] && blob[p + w])) continue;
      let lo = 255, hi = 0;
      for (let yy = Math.max(0, y - K); yy <= Math.min(h - 1, y + K); yy++) {
        for (let xx = Math.max(0, x - K); xx <= Math.min(w - 1, x + K); xx++) {
          const v = grey[yy * w + xx];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      xs.push(x); ys.push(y); contrast.push(hi - lo);
    }
  }
  return { xs, ys, contrast };
}

// The sharp edge points: contrast at least half that of the crispest edges.
// Falls back to every edge point when too few qualify.
function sharpEdges({ xs, ys, contrast }) {
  const sorted = contrast.slice().sort((a, b) => a - b);
  const cut = 0.5 * sorted[Math.floor(sorted.length * 0.95)];
  const keep = { xs: [], ys: [] };
  for (let i = 0; i < xs.length; i++) if (contrast[i] >= cut) { keep.xs.push(xs[i]); keep.ys.push(ys[i]); }
  return keep.xs.length >= 30 ? keep : { xs, ys };
}

function circleFrom3(x1, y1, x2, y2, x3, y3) {
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(d) < 1e-9) return null;
  const s1 = x1 * x1 + y1 * y1, s2 = x2 * x2 + y2 * y2, s3 = x3 * x3 + y3 * y3;
  const cx = (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d;
  const cy = (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d;
  return { cx, cy, r: Math.hypot(x1 - cx, y1 - cy) };
}

function solve3(m, v) {
  // Cramer's rule; m is 3×3 row-major.
  const det = (a) => a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const d = det(m);
  if (Math.abs(d) < 1e-12) return null;
  const out = [];
  for (let c = 0; c < 3; c++) {
    const a = m.slice();
    for (let r = 0; r < 3; r++) a[r * 3 + c] = v[r];
    out.push(det(a) / d);
  }
  return out;
}

// Geometric least-squares circle through the given points (Gauss–Newton
// from a starting circle).
function refineCircle(xs, ys, idx, c) {
  let { cx, cy, r } = c;
  for (let iter = 0; iter < 8; iter++) {
    const JtJ = new Float64Array(9), Jtr = new Float64Array(3);
    for (const i of idx) {
      const dx = xs[i] - cx, dy = ys[i] - cy;
      const d = Math.hypot(dx, dy) || 1e-9;
      const res = d - r;
      const J = [-dx / d, -dy / d, -1];
      for (let a = 0; a < 3; a++) {
        Jtr[a] += J[a] * res;
        for (let b = 0; b < 3; b++) JtJ[a * 3 + b] += J[a] * J[b];
      }
    }
    const step = solve3(Array.from(JtJ), Array.from(Jtr, (v) => -v));
    if (!step) break;
    cx += step[0]; cy += step[1]; r += step[2];
    if (Math.hypot(step[0], step[1], step[2]) < 1e-3) break;
  }
  return { cx, cy, r };
}

// Small deterministic PRNG so a photo always gives the same answer.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function findDisk(work) {
  const { w, h, grey } = work;
  const threshold = limbThreshold(grey);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = grey[i] > threshold ? 1 : 0;
  const { blob, size } = largestBlob(mask, w, h);
  if (size < 200) return null;
  const edges = edgePoints(blob, grey, w, h);
  if (edges.xs.length < 30) return null;
  const { xs, ys } = sharpEdges(edges);
  const n = xs.length;
  if (n < 30) return null;

  const rand = mulberry32(0x5eed + n);
  const maxR = Math.max(w, h);
  const tolOf = (r) => Math.max(1.5, r * 0.012);
  let best = null, bestCount = 0;
  for (let iter = 0; iter < 400; iter++) {
    const a = Math.floor(rand() * n), b = Math.floor(rand() * n), c = Math.floor(rand() * n);
    if (a === b || b === c || a === c) continue;
    const circ = circleFrom3(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c]);
    if (!circ || circ.r < 10 || circ.r > maxR) continue;
    const tol = tolOf(circ.r);
    let count = 0;
    for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(xs[i] - circ.cx, ys[i] - circ.cy) - circ.r) < tol) count++;
    if (count > bestCount) { bestCount = count; best = circ; }
  }
  if (!best) return null;

  let circ = best, idx = [];
  for (let round = 0; round < 3; round++) {
    const tol = tolOf(circ.r);
    idx = [];
    for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(xs[i] - circ.cx, ys[i] - circ.cy) - circ.r) < tol) idx.push(i);
    if (idx.length < 20) return null;
    circ = refineCircle(xs, ys, idx, circ);
  }
  // How much of the circumference the edge actually follows (5° bins).
  const bins = new Uint8Array(72);
  for (const i of idx) bins[Math.floor(rev(Math.atan2(ys[i] - circ.cy, xs[i] - circ.cx) * DEG) / 5) % 72] = 1;
  const coverage = bins.reduce((s, v) => s + v, 0) / 72;
  if (circ.r < 15 || coverage < 0.25) return null;
  // Edge pixels sit half a pixel inside the threshold crossing.
  return { cx: circ.cx, cy: circ.cy, r: circ.r + 0.5, coverage, threshold };
}

// --- Orientation ----------------------------------------------------------

function integralImage(grey, w, h) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += grey[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  return ii;
}

// Photo brightness on a GRID×GRID lattice over the disk, each sample the
// mean of the photo pixels it covers. Returns screen-unit coordinates and
// standardised (zero-mean, unit-variance) values.
function samplePhoto(work, disk) {
  const { w, h, grey } = work;
  const ii = integralImage(grey, w, h);
  const half = Math.max(0.5, disk.r / GRID);
  const gx = [], gy = [], vals = [];
  for (let j = 0; j < GRID; j++) {
    const y = ((j + 0.5) / GRID) * 2 - 1;
    for (let i = 0; i < GRID; i++) {
      const x = ((i + 0.5) / GRID) * 2 - 1;
      if (x * x + y * y > LIMB_CUT) continue;
      const px = disk.cx + x * disk.r, py = disk.cy + y * disk.r;
      const x0 = Math.max(0, Math.round(px - half)), x1 = Math.min(w, Math.round(px + half) + 1);
      const y0 = Math.max(0, Math.round(py - half)), y1 = Math.min(h, Math.round(py + half) + 1);
      if (x1 <= x0 || y1 <= y0 || px < 0 || py < 0 || px >= w || py >= h) continue;
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      gx.push(x); gy.push(y); vals.push(sum / ((x1 - x0) * (y1 - y0)));
    }
  }
  const n = vals.length;
  const mean = vals.reduce((s, v) => s + v, 0) / (n || 1);
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n || 1));
  const z = Float64Array.from(vals, (v) => (sd > 0 ? (v - mean) / sd : 0));
  return { gx: Float64Array.from(gx), gy: Float64Array.from(gy), z, n, contrast: sd };
}

function bilinear(img, n, u, v) {
  const x = Math.max(0, Math.min(n - 1.001, u)), y = Math.max(0, Math.min(n - 1.001, v));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p = y0 * n + x0;
  const a = img[p], b = img[p + 1], c = img[p + n], d = img[p + n + 1];
  // Off-disk corners read as dark sky.
  const f = (t) => (Number.isFinite(t) ? t : 0);
  return (f(a) * (1 - fx) + f(b) * fx) * (1 - fy) + (f(c) * (1 - fx) + f(d) * fx) * fy;
}

// How well the photo samples match the canonical render turned to
// (rotation, mirrored): Pearson correlation over the whole disk (`shape` —
// mostly where the light falls) and over the well-lit part only (`detail` —
// the maria and bright craters, which tell a mirror image or a slightly
// wrong angle apart). `score` averages the two.
function correlation(samples, canon, rotation, mirrored) {
  const { north, east } = screenFrame(rotation, mirrored);
  const { gx, gy, z, n } = samples;
  const N = canon.n;
  let sp = 0, spp = 0, szp = 0;
  let dn = 0, dz = 0, dzz = 0, dp = 0, dpp = 0, dzp = 0;
  for (let k = 0; k < n; k++) {
    const x = gx[k] * east[0] + gy[k] * east[1];
    const y = gx[k] * north[0] + gy[k] * north[1];
    const u = ((x + 1) / 2) * N - 0.5, v = ((1 - y) / 2) * N - 0.5;
    const p = bilinear(canon.shade, N, u, v);
    const zk = z[k];
    sp += p; spp += p * p; szp += zk * p;
    if (bilinear(canon.mu0, N, u, v) > DETAIL_MU0) {
      dn++; dz += zk; dzz += zk * zk; dp += p; dpp += p * p; dzp += zk * p;
    }
  }
  const varP = spp - (sp * sp) / n;
  const shape = varP > 1e-12 ? szp / Math.sqrt(n * varP) : 0;
  let detail = null;
  if (dn >= MIN_DETAIL_SAMPLES) {
    const vz = dzz - (dz * dz) / dn, vp = dpp - (dp * dp) / dn;
    detail = vz > 1e-9 && vp > 1e-12 ? (dzp - (dz * dp) / dn) / Math.sqrt(vz * vp) : 0;
  }
  return { shape, detail, score: detail == null ? shape : (shape + detail) / 2 };
}

function angleDiff(a, b) {
  const d = Math.abs(rev(a - b));
  return d > 180 ? 360 - d : d;
}

// Best (rotation, mirrored) for the photo samples. `margin` is how far the
// winner beats the next-best peak (a local maximum more than 30° away) and
// `mirrorMargin` the best mirror-image fit: small means ambiguous. A thin
// crescent is symmetric about the Sun's direction, so its handedness often
// stays ambiguous even when its angle is certain.
function findOrientation(samples, canon) {
  const STEP = 2;
  const curves = { false: [], true: [] };
  for (const mirrored of [false, true]) {
    for (let a = 0; a < 360; a += STEP) curves[mirrored].push({ rotation: a, ...correlation(samples, canon, a, mirrored) });
  }
  const refine = (mirrored) => {
    const curve = curves[mirrored];
    let best = curve.reduce((m, r) => (r.score > m.score ? r : m));
    const start = best.rotation;
    for (let d = -STEP; d <= STEP; d += 0.25) {
      const rotation = rev(start + d);
      const c = correlation(samples, canon, rotation, mirrored);
      if (c.score > best.score) best = { rotation, ...c };
    }
    const L = curve.length, W = Math.round(10 / STEP);
    let rival = Math.min(...curve.map((r) => r.score));
    curve.forEach((r, i) => {
      if (angleDiff(r.rotation, best.rotation) <= 30) return;
      for (let k = 1; k <= W; k++) {
        if (curve[(i + k) % L].score > r.score || curve[(i - k + L) % L].score > r.score) return;
      }
      rival = Math.max(rival, r.score);
    });
    return { ...best, mirrored, rival };
  };
  const plain = refine(false), flipped = refine(true);
  // A mirrored photo is the exception: it has to win clearly.
  const pick = flipped.score > plain.score + 0.03 ? flipped : plain;
  const other = pick === plain ? flipped : plain;
  return {
    rotation: Math.round(pick.rotation * 100) / 100,
    mirrored: pick.mirrored,
    score: pick.score,
    shape: pick.shape,
    detail: pick.detail,
    margin: pick.score - pick.rival,
    mirrorMargin: pick.score - other.score,
  };
}

// Disk + orientation for the photo at `imagePath` given the ephemeris
// `face` for its capture time. `fixed` = { rotation, mirrored } skips the
// orientation search (an admin override). Returns
// { width, height, disk: { cx, cy, r, coverage }, orientation } in full-size
// pixels, or { width, height, disk: null } when no Moon-like disk is found.
async function detectMoon(imagePath, face, { fixed = null } = {}) {
  const work = await loadWork(imagePath);
  const found = findDisk(work);
  const base = { width: work.width, height: work.height };
  if (!found) return { ...base, disk: null, orientation: null };
  const s = (work.sx + work.sy) / 2;
  const disk = {
    cx: (found.cx + 0.5) / work.sx - 0.5,
    cy: (found.cy + 0.5) / work.sy - 0.5,
    r: found.r / s,
    coverage: Math.round(found.coverage * 100) / 100,
  };
  let orientation;
  if (fixed) {
    orientation = { rotation: rev(Number(fixed.rotation) || 0), mirrored: !!fixed.mirrored, score: null, margin: null, mirrorMargin: null };
  } else {
    const samples = samplePhoto(work, found);
    if (samples.n < 200 || samples.contrast < 2) {
      orientation = null;
    } else {
      const canon = canonicalImage(await loadAlbedo(), face, GRID);
      orientation = findOrientation(samples, canon);
    }
  }
  return { ...base, disk, orientation };
}

module.exports = {
  detectMoon, renderMoon, screenFrame, globeAxes, surfaceVector, loadAlbedo,
  // exposed for tests and tuning
  findDisk, limbThreshold, loadWork, samplePhoto, canonicalImage, correlation, GRID,
};
