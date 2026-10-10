// Structured reader for the watermark band the Seestar app burns onto every
// exported JPG:
//
//   [logo]  Seestar S50 Pro  [tripod]                    NGC 6960
//   [moon]  Kyle Caulfield / 90° W, 39° N / 2026.10.03 22:43    84min
//
// or, on the app's Milky Way exports (no target, no integration time):
//
//   [logo]  Seestar S50 Pro  [tripod]
//                                                         Milky Way
//   [moon]  Kyle Caulfield / 90° W, 39° N / 2026.10.10 02:29
//
// Exports shared or saved from the Seestar app carry no EXIF Make/Model or
// GPS, so this band is the only record of the telescope, location and
// capture time. A single whole-band OCR pass (lib/seestar_ocr ocrBanner)
// reads it poorly: the thin model font comes back as "SeestarS50P0", the dim
// grey info line loses its dates and coordinates, and the icons leak into
// the photographer. This module reads each field from its own crop instead:
//
// 1. Rows: in the bottom 35% of the image, a per-row "ink" profile (pixels
//    well above the row median) gives text-like row clusters; the bottom-most
//    pair with plausible relative height/spacing is (model row, info row).
//    The unit of measure u comes from glyph heights (cap height / 0.74), not
//    from the image size, so every threshold below is in units of u and the
//    reader is resolution independent.
// 2. Layout: per row, connected components above a local background; glyphs
//    are merged into words (gap < 0.25u) and words into left/right groups
//    (gap > 1.6u). Top row: [logo] model [tripod] ... target. Bottom row:
//    [moon] name / coords / date ... integration. The logo is the first
//    narrow blob, the moon is whatever sits in the logo's column, the tripod
//    a narrow trailing blob, and the two ' / ' separators are found as lone
//    thin right-leaning components, so each field gets its own crop.
// 3. Clean-up: star specks and star blobs (morphological opening) are erased,
//    keeping punctuation by position/shape; the crop is background
//    subtracted, inverted to dark-on-white, upscaled and OCR'd as a single
//    line (PSM 7) with a field-specific character whitelist.
// 4. Trust: each field is read under several renderings and parsed strictly;
//    a value needs two agreeing reads (and a margin if reads conflict), the
//    number of characters must match the number of glyph blobs, the model
//    needs its glyph count (Pro or not) and size-digit shape to agree, and
//    free-text names need a confident read. Anything doubtful is null — a
//    blank field the user fills in beats a wrong telescope or location.
//
// Tuned against five real S30 Pro / S50 Pro exports (test/fixtures/
// seestar-bands/) at 720–2160 px widths and JPEG q55, plus synthetic bands
// for other names, hemispheres, decimal degrees, non-Pro models and
// landscape layouts. A band layout it does not recognise returns
// { found: false } so the caller can fall back to whole-band OCR.
'use strict';

const sharp = require('sharp');
const { parseTarget, namedTargetExact } = require('./seestar_meta');
const { recognize } = require('./seestar_ocr');

// Runs one OCR job on the shared worker. Returns { text, conf }, or throws
// OcrUnavailable so readBand can bail out as a whole (no worker, disabled,
// timed out) rather than vote on a half-read band.
class OcrUnavailable extends Error {}
async function ocr(buf, whitelist, psm = '7') {
  const r = await recognize(buf, { whitelist, psm });
  if (!r) throw new OcrUnavailable('OCR unavailable');
  return { text: (r.text || '').replace(/\n+/g, ' ').trim(), conf: r.confidence };
}

// ---------------------------------------------------------------- image utils

function percentileOf(hist, n, p) {
  const t = n * p;
  let c = 0;
  for (let i = 0; i < 256; i++) { c += hist[i]; if (c > t) return i; }
  return 255;
}

// Row clusters of "ink" in the search strip. Both band rows start at the left
// edge (logo + model, moon + info line), while the right-hand side holds the
// target and integration — or, on Milky Way exports, one label centred
// between the rows, which the full-width profile mistakes for the top row
// (or, with dense stars, merges everything into one block). So the rows are
// also looked for on the left part of the width: when both profiles find the
// same two rows the full-width extents are kept, as before; when they
// disagree, the left part's rows win.
const ROW_PROFILE_FRAC = 0.6;
function findRows(g, W, S) {
  const full = rowsFromProfile(g, W, S, W);
  const left = rowsFromProfile(g, W, S, Math.round(W * ROW_PROFILE_FRAC));
  const overlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];
  if (full && left && overlap(full.top, left.top) && overlap(full.bot, left.bot)) return full;
  return left || full;
}

// Rows from the ink profile of the first `w` columns (the ink bar is still
// set from the whole row's median, as before).
function rowsFromProfile(g, W, S, w) {
  const cnt = new Float32Array(S);
  const hist = new Uint32Array(256);
  for (let y = 0; y < S; y++) {
    hist.fill(0);
    const o = y * W;
    for (let x = 0; x < W; x++) hist[g[o + x]]++;
    const t = percentileOf(hist, W, 0.5) + 40;
    let c = 0;
    for (let x = 0; x < w; x++) if (g[o + x] > t) c++;
    cnt[y] = c;
  }
  // First pass with a fixed bar of 2% of the width. Dense star fields (rich
  // clusters, the Milky Way) put a few dozen bright pixels on every row,
  // which clears that bar, so the star rows merge with both text rows into
  // one cluster and no band is found. Text rows carry several times the ink
  // of a typical row, so only then retry with a bar scaled to the strip's
  // median row. Bands the fixed bar finds are read exactly as before.
  const fixedThr = w * 0.02;
  const typical = Float32Array.from(cnt).sort()[S >> 1];
  const denseThr = typical * 2.5;
  return pairRows(cnt, w, S, fixedThr)
    || (denseThr > fixedThr ? pairRows(cnt, w, S, denseThr) : null);
}

// Cluster rows whose ink count clears `thr` and return the bottom-most pair
// that looks like the band's (model row, info row), or null.
function pairRows(cnt, W, S, thr) {
  const cl = [];
  let s = -1, gap = 0;
  for (let y = 0; y < S; y++) {
    if (cnt[y] > thr) { if (s < 0) s = y; gap = 0; }
    else if (s >= 0) { gap++; if (gap > 2) { cl.push([s, y - gap]); s = -1; gap = 0; } }
  }
  if (s >= 0) cl.push([s, S - 1]);
  // a text row has many ink pixels on its densest line; star rows do not
  const big = cl.filter(([a, b]) => {
    if (b - a + 1 < 3) return false;
    let pk = 0;
    for (let y = a; y <= b; y++) if (cnt[y] > pk) pk = cnt[y];
    return pk >= 0.06 * W;
  });
  for (let j = big.length - 1; j >= 1; j--) {
    const b = big[j];
    const hb = b[1] - b[0] + 1;
    if (S - 1 - b[1] > 3 * hb) continue;
    // The info line always has a margin below it; ink running into the
    // image's bottom edge is foreground (a lit horizon), not the band.
    if (S - 1 - b[1] < 0.25 * hb) continue;
    for (let i = j - 1; i >= 0; i--) {
      const a = big[i];
      const ha = a[1] - a[0] + 1;
      const g2 = b[0] - a[1];
      if (g2 > 2.5 * hb) break;
      const r = hb / ha;
      if (r > 0.3 && r < 1.3 && g2 > 0.3 * hb) return { top: a, bot: b };
    }
  }
  return null;
}

// Connected-component analysis of one row strip. Returns blobs (merged
// components) with x/y extents in strip coordinates, plus the local background.
function rowBlobs(g, W, y0, y1, u) {
  const h = y1 - y0 + 1;
  // local background per block of columns (median)
  const B = Math.max(8, Math.round(u));
  const nb = Math.ceil(W / B);
  const bgB = new Float32Array(nb);
  const hist = new Uint32Array(256);
  for (let b = 0; b < nb; b++) {
    hist.fill(0);
    const xa = b * B, xb = Math.min(W, xa + B);
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let x = xa; x < xb; x++) { hist[g[y * W + x]]++; n++; }
    bgB[b] = percentileOf(hist, n, 0.5);
  }
  const bg = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const f = x / B - 0.5;
    const i0 = Math.max(0, Math.min(nb - 1, Math.floor(f)));
    const i1 = Math.min(nb - 1, i0 + 1);
    const t = Math.max(0, Math.min(1, f - i0));
    bg[x] = bgB[i0] * (1 - t) + bgB[i1] * t;
  }
  const T = 30;
  const mask = new Uint8Array(W * h);
  for (let y = 0; y < h; y++) {
    const o = (y + y0) * W;
    for (let x = 0; x < W; x++) if (g[o + x] > bg[x] + T) mask[y * W + x] = 1;
  }
  // union-find CC (8-connectivity)
  const lab = new Int32Array(W * h).fill(-1);
  const parent = [];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let l = -1;
      const nbrs = [];
      if (x > 0 && mask[i - 1]) nbrs.push(lab[i - 1]);
      if (y > 0) {
        if (mask[i - W]) nbrs.push(lab[i - W]);
        if (x > 0 && mask[i - W - 1]) nbrs.push(lab[i - W - 1]);
        if (x < W - 1 && mask[i - W + 1]) nbrs.push(lab[i - W + 1]);
      }
      if (nbrs.length === 0) { l = parent.length; parent.push(l); }
      else { l = nbrs[0]; for (let k = 1; k < nbrs.length; k++) uni(l, nbrs[k]); }
      lab[i] = l;
    }
  }
  const comps = new Map();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (lab[i] < 0) continue;
      const r = find(lab[i]);
      lab[i] = r;
      let c = comps.get(r);
      if (!c) { c = { id: r, x0: x, x1: x, y0: y, y1: y, n: 0, peak: 0 }; comps.set(r, c); }
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      c.n++;
      const d = g[(y + y0) * W + x] - bg[x];
      if (d > c.peak) c.peak = d;
    }
  }
  const keep = [];
  const small = [];
  for (const c of comps.values()) {
    const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1;
    if (ch >= 0.4 * u || (cw >= 0.6 * u && ch >= 0.12 * u)) keep.push(c); else small.push(c);
  }
  keep.sort((a, b) => a.x0 - b.x0);
  // merge into glyph groups (gap < 0.25u)
  const blobs = [];
  for (const c of keep) {
    const last = blobs[blobs.length - 1];
    if (last && c.x0 - last.x1 < 0.25 * u) {
      last.x1 = Math.max(last.x1, c.x1); last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1); last.n += c.n;
    } else blobs.push({ ...c });
  }
  return { blobs, bg, lab, keep, small, y0, h, u };
}

// Decide which small components inside [x0,x1] are noise (stars) rather than
// punctuation ('.', ':', ',', degree sign). Returns a Set of component ids.
function noiseIds(row, g, W, x0, x1, opts = {}) {
  const { keep, small, u } = row;
  const big = keep.filter((c) => c.x1 >= x0 && c.x0 <= x1);
  const noise = new Set();
  if (!big.length) return noise;
  const ys1 = big.map((c) => c.y1).sort((a, b) => a - b);
  const ys0 = big.map((c) => c.y0).sort((a, b) => a - b);
  const base = ys1[ys1.length >> 1];
  // top of the tallest glyphs (caps/digits/ascenders), not the x-height
  const capTop = ys0[Math.floor(ys0.length * 0.1)];
  const peaks = big.map((c) => c.peak).sort((a, b) => a - b);
  const lev = peaks[peaks.length >> 1];
  for (const c of small) {
    if (c.x1 < x0 || c.x0 > x1) continue;
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
    const cy = (c.y0 + c.y1) / 2;
    const bar = cw >= 2.5 * ch; // '-' or '_': stars are round
    let isNoise = false;
    if (Math.max(cw, ch) < 0.08 * u) isNoise = true;
    else if (c.peak > 1.6 * lev && lev > 0) isNoise = true;
    else if (cy < capTop - 0.12 * u || cy > base + (bar ? 0.3 : 0.12) * u) isNoise = true;
    else if (!bar && ch < 1.4 * cw && cy < capTop + 0.3 * (base - capTop)
      && opts.kind !== 'coord' && !big.some((b) => b.x1 - b.x0 < 0.35 * u && b.y0 > c.y1 - 1
        && Math.abs((b.x0 + b.x1) / 2 - (c.x0 + c.x1) / 2) < 0.15 * u)) {
      // a round speck up at cap height is a star unless it dots an i/j
      // (apostrophes are taller than wide; degree signs only in coords)
      isNoise = true;
    } else {
      // must sit next to a glyph; a lone dot in the middle of a word gap is
      // a star, not punctuation
      let gl = Infinity, gr = Infinity;
      for (const b of big) {
        if (b.x1 < c.x0) gl = Math.min(gl, c.x0 - b.x1);
        else if (b.x0 > c.x1) gr = Math.min(gr, b.x0 - c.x1);
        else { gl = 0; gr = Math.min(gr, 0); }
      }
      if (Math.min(gl, gr) > 0.35 * u) isNoise = true;
      else if (opts.kind === 'name' && !bar && gl >= 0.2 * u && gr >= 0.2 * u && Math.max(cw, ch) < 0.25 * u) isNoise = true;
    }
    if (isNoise) noise.add(c.id);
  }
  return noise;
}

function groupBy(blobs, maxGap) {
  const groups = [];
  for (const b of blobs) {
    const last = groups[groups.length - 1];
    if (last && b.x0 - last.x1 <= maxGap) {
      last.x1 = Math.max(last.x1, b.x1); last.y0 = Math.min(last.y0, b.y0); last.y1 = Math.max(last.y1, b.y1); last.items.push(b);
    } else groups.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, items: [b] });
  }
  return groups;
}

// Binary morphology helpers (square structuring element, size k, on a w*h mask).
function erode1D(src, w, h, k, horiz) {
  const out = new Uint8Array(w * h);
  const r = k >> 1;
  if (horiz) {
    for (let y = 0; y < h; y++) {
      let run = 0;
      const o = y * w;
      // run = number of consecutive 1s ending at x
      const runs = new Int32Array(w);
      for (let x = 0; x < w; x++) { run = src[o + x] ? run + 1 : 0; runs[x] = run; }
      for (let x = r; x < w - (k - 1 - r); x++) if (runs[x + (k - 1 - r)] >= k) out[o + x] = 1;
    }
  } else {
    for (let x = 0; x < w; x++) {
      let run = 0;
      const runs = new Int32Array(h);
      for (let y = 0; y < h; y++) { run = src[y * w + x] ? run + 1 : 0; runs[y] = run; }
      for (let y = r; y < h - (k - 1 - r); y++) if (runs[y + (k - 1 - r)] >= k) out[y * w + x] = 1;
    }
  }
  return out;
}
function dilate1D(src, w, h, k, horiz) {
  const out = new Uint8Array(w * h);
  const r = k >> 1;
  if (horiz) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let last = -1e9;
      for (let x = 0; x < w; x++) { if (src[o + x]) last = x; if (x - last <= (k - 1 - r)) out[o + x] = 1; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (src[o + x]) last = x; if (last - x <= r) out[o + x] = 1; }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (src[y * w + x]) last = y; if (y - last <= (k - 1 - r)) out[y * w + x] = 1; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (src[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
    }
  }
  return out;
}
const erode = (m, w, h, k) => erode1D(erode1D(m, w, h, k, true), w, h, k, false);
const dilate = (m, w, h, k) => dilate1D(dilate1D(m, w, h, k, true), w, h, k, false);

// Cut a region out of a row strip as an "ink strength" map (0 = background,
// 1 = full text ink) with star specks and star blobs removed.
function prepRegion(g, W, row, x0, x1, y0, y1, opts = {}) {
  const bgArr = row.bg;
  x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(W - 1, Math.ceil(x1));
  y0 = Math.max(row.y0, y0); y1 = Math.min(row.y0 + row.h - 1, y1);
  const noise = noiseIds(row, g, W, x0, x1, opts);
  if (opts.core) {
    // components belonging to neighbouring text (e.g. the tail of a '/')
    const [ca, cb] = opts.core;
    const tol = 0.05 * row.u;
    for (const c of row.keep.concat(row.small)) {
      if (c.x1 < x0 || c.x0 > x1) continue;
      const cx = (c.x0 + c.x1) / 2;
      if (cx < ca - tol || cx > cb + tol) noise.add(c.id);
    }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bigIds = new Set(row.keep.map((c) => c.id));
  // text ink level from big components
  const hist = new Uint32Array(256);
  let n = 0;
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ry = y + y0 - row.y0;
    const l = row.lab[ry * W + x + x0];
    if (l < 0 || noise.has(l)) continue;
    m[y * w + x] = 1;
    if (bigIds.has(l)) {
      const d = g[(y + y0) * W + x + x0] - bgArr[x + x0];
      hist[Math.max(0, Math.min(255, Math.round(d)))]++; n++;
    }
  }
  const lev = Math.max(30, n ? percentileOf(hist, n, 0.9) : 80);
  // stroke width: typical horizontal run length of ink
  const runs = [];
  for (let y = 0; y < h; y++) {
    let r = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && m[y * w + x]) r++;
      else if (r) { runs.push(r); r = 0; }
    }
  }
  runs.sort((a, b2) => a - b2);
  const sw = runs.length ? runs[Math.floor(runs.length * 0.4)] : 2;
  let star = null;
  if (opts.starOpen !== false) {
    const k = Math.max(3, Math.round(2 * sw + 1));
    const op = dilate(erode(m, w, h, k), w, h, k);
    let any = false;
    for (let i = 0; i < op.length; i++) if (op[i]) { any = true; break; }
    if (any) star = dilate(op, w, h, Math.max(3, Math.round(sw) | 1));
  }
  const img = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!m[i]) {
      const d0 = g[(y + y0) * W + x + x0] - bgArr[x + x0];
      if (d0 < 15) continue; // faint, not part of a component
    }
    if (star && star[i]) continue;
    const ry = y + y0 - row.y0;
    const l = row.lab[ry * W + x + x0];
    if (l >= 0 && noise.has(l)) continue;
    const d = g[(y + y0) * W + x + x0] - bgArr[x + x0];
    let v = d <= 0 ? 0 : d / lev;
    if (v > 1) v = 1;
    img[i] = v;
  }
  return { w, h, img, sw, lev, nGlyphs: countGlyphs(img, w, h, row.u) };
}

// Number of glyph-sized connected components in a cleaned region (used to
// sanity-check how many characters OCR should have produced).
function countGlyphs(img, w, h, u) {
  const lab = new Int32Array(w * h).fill(-1);
  const stack = [];
  let n = 0;
  for (let i0 = 0; i0 < w * h; i0++) {
    if (img[i0] < 0.35 || lab[i0] >= 0) continue;
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    lab[i0] = n; stack.push(i0);
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (lab[j] < 0 && img[j] >= 0.35) { lab[j] = n; stack.push(j); }
      }
    }
    const ch = y1 - y0 + 1, cw = x1 - x0 + 1;
    if (ch >= 0.4 * u || (cw >= 0.6 * u && ch >= 0.12 * u)) n++; // else: speck / punctuation
  }
  return n;
}

async function renderRegion(reg, targetH, mode) {
  const { w, h, img } = reg;
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = mode === 'bin' ? (img[i] > 0.45 ? 1 : 0) : img[i];
    out[i] = 255 - Math.round(v * 255);
  }
  const scale = targetH / h;
  const pad = Math.round(targetH * 0.3);
  const buf = await sharp(out, { raw: { width: w, height: h, channels: 1 } })
    .resize({ width: Math.max(8, Math.round(w * scale)), height: targetH, kernel: 'lanczos3', fit: 'fill' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 1 })
    .toBuffer();
  return buf;
}

// A lone, tall, thin, right-leaning component: the " / " field separator.
function isSlash(b, row, W) {
  const u = row.u;
  const cs = row.keep.filter((c) => c.x0 >= b.x0 && c.x1 <= b.x1);
  if (cs.length !== 1) return false;
  const c = cs[0];
  const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  if (w < 0.1 * u || w > 0.45 * u || h < 0.6 * u) return false;
  const q = Math.max(1, Math.round(h / 4));
  let tx = 0, tn = 0, bx = 0, bn = 0;
  for (let y = c.y0; y <= c.y1; y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      if (row.lab[y * W + x] !== c.id) continue;
      if (y < c.y0 + q) { tx += x; tn++; }
      if (y > c.y1 - q) { bx += x; bn++; }
    }
  }
  if (!tn || !bn) return false;
  const d = tx / tn - bx / bn;
  return d >= 0.08 * u && d >= 0.3 * w;
}

// Shape vote on the size digit of "S30"/"S50": a 5 has a vertical stroke at
// the left just under its top bar, a 3 is open on the left there. Looks at
// the middle component of the size token; returns '3', '5' or null.
function sizeDigitShape(row, W, tok) {
  if (!tok) return null;
  const cs = row.keep.filter((c) => c.x0 >= tok.x0 && c.x1 <= tok.x1).sort((a, b) => a.x0 - b.x0);
  if (cs.length !== 3) return null;
  const c = cs[1];
  const h = c.y1 - c.y0 + 1, w = c.x1 - c.x0 + 1;
  if (h < 6 || w < 3) return null;
  let sum = 0, n = 0;
  for (let y = Math.round(c.y0 + 0.15 * h); y <= Math.round(c.y0 + 0.3 * h); y++) {
    for (let x = c.x0; x <= c.x1; x++) {
      if (row.lab[y * W + x] === c.id) { sum += (x - c.x0) / w; n++; break; }
    }
  }
  if (!n) return null;
  const left = sum / n;
  if (left <= 0.2) return '5';
  if (left >= 0.3) return '3';
  return null;
}

// ---------------------------------------------------------------- parsers

function parseName(text) {
  if (!text) return null;
  let t = text.replace(/\s+/g, ' ').trim();
  t = t.replace(/^[^\p{L}\d]+/u, '').replace(/[^\p{L}\d)]+$/u, '');
  // a '.' glued to a long word is almost always a star, not an initial
  t = t.replace(/(\p{L}{3,})[.,'](?=\s|$)/gu, '$1');
  // in a multi-word name, "Luc.Martin" is a star in the word gap
  if (/\s|\p{L}-\p{L}/u.test(t)) t = t.replace(/(\p{L}\p{Ll}{2,})[.,'](?=\p{Lu}\p{Ll})/gu, '$1 ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 48) return null;
  if (!/\p{L}{2}/u.test(t)) return null;
  return t;
}

function parseCoordsText(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  // The whole segment must be "<num>° <D>, <num>° <D>"; a space inside a
  // number (a lost decimal point) or stray digits mean a misread.
  const NUM = '(\\d{1,3}(?:\\.\\d{1,4})?)';
  const SEP = "\\s*[°.,']{0,3}\\s*";
  const re = new RegExp(`^${NUM}${SEP}([NSEW])\\s*[,.]{0,2}\\s*${NUM}${SEP}([NSEW])[.,']?$`);
  const m = t.match(re);
  if (!m) return null;
  let lat = null, lon = null;
  for (const [v0, d] of [[m[1], m[2]], [m[3], m[4]]]) {
    const v = parseFloat(v0);
    // Nobody images with a Seestar beyond ±75°, and that is exactly where a
    // star touching a "3" sends a latitude ("39° N" read as 89).
    if (d === 'N' || d === 'S') { if (lat != null || v > MAX_LATITUDE) return null; lat = d === 'N' ? v : -v; }
    else { if (lon != null || v > 180) return null; lon = d === 'E' ? v : -v; }
  }
  if (lat == null || lon == null) return null;
  return { latitude: lat, longitude: lon };
}

function parseDateText(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  // Seestar prints a fixed-width "YYYY.MM.DD HH:MM"; separators are often
  // misread (',' ':' or even a digit when a star sits on them), so any single
  // character is accepted in a separator slot.
  // Anchored at both ends: anything alphanumeric after the minutes (e.g. a
  // 12-hour "PM") means we do not understand the line.
  let m = t.match(/^[^\dA-Za-z]{0,2}(20\d\d).(\d\d).(\d\d) ?[^\d ]? ?(\d\d).(\d\d)[^\dA-Za-z]{0,2}$/);
  if (!m) {
    // separators swallowed (a star on a dot) or spaces inserted: exactly the
    // 12 digits of YYYYMMDDHHMM and nothing else digit-like.
    const d = t.replace(/[^0-9]/g, '');
    if (d.length === 12 && /^20/.test(d) && /^[0-9 .,:]+$/.test(t)) m = [null, d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10), d.slice(10, 12)];
  }
  if (!m) return null;
  const [, y, mo, d, hh, mi] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +hh > 23 || +mi > 59) return null;
  if (+y < 2020 || +y > new Date().getFullYear() + 1) return null;
  return `${y}-${mo}-${d}T${hh}:${mi}`;
}

function parseModel(text, nGlyphs) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  // "Seestar" (allowing a dropped letter) then the size token. The leading
  // 'S' of the token is often read as '5'; the size digit itself must be an
  // unambiguous 3 or 5 or we give up.
  const m = t.match(/S?e{1,2}s?ta?r?\s*([S5])\s*([35])\s*[0o]\s*(.*)$/);
  if (!m) return null;
  const size = m[2] === '3' ? '30' : '50';
  const rest = m[3].replace(/\s+/g, '');
  let proText;
  if (rest === '') proText = false;
  else if (/^P?r?[o0]$|^Pr?[o0]?$/.test(rest) && rest.length >= 2) proText = true;
  else return null;
  // Independent geometric check: "Seestar S50 Pro" is 13 glyphs, "Seestar
  // S50" 10 (allow one merged pair / one stray blob either way).
  if (nGlyphs != null) {
    let proGeom = null;
    if (nGlyphs >= 12 && nGlyphs <= 14) proGeom = true;
    else if (nGlyphs >= 9 && nGlyphs <= 11) proGeom = false;
    if (proGeom !== proText) return null;
  }
  return `Seestar S${size}${proText ? ' Pro' : ''}`;
}

function parseTargetText(text) {
  if (!text) return null;
  // "IC" is often read with a one/ell for the I; no catalog starts "1C"
  const t = text.replace(/\s+/g, ' ').trim().replace(/^[1l|]C(?=\s*\d)/, 'IC');
  const m = t.match(/^(NGC|IC|S[hH]\s*2|[CcMm]|Cr|Mel|Tr|Abell|LDN|LBN)\s*[-–]?\s*(\d{1,4})(?:\s|$)/);
  if (!m) return null;
  let cat = m[1].replace(/\s+/g, '');
  if (/^[cm]$/.test(cat)) cat = cat.toUpperCase();
  if (/^S[hH]2$/.test(cat)) cat = 'Sh2';
  const num = m[2];
  if (/^0/.test(num)) return null;
  const pt = parseTarget(`${cat} ${num}`);
  return pt ? pt.raw : null;
}

// A named target filling the whole crop ("Milky Way"), as its canonical name;
// null when anything else is in the crop.
function parseNamedLabel(text) {
  return namedTargetExact(text)?.name ?? null;
}

function parseExposure(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, '').toLowerCase();
  const m = t.match(/^(?:(\d{1,2})h)?(?:(\d{1,3})m(?:in)?)?(?:(\d{1,2})s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const h = m[1] ? +m[1] : 0, mi = m[2] ? +m[2] : 0, se = m[3] ? +m[3] : 0;
  if ((m[1] && mi >= 60) || ((m[1] || m[2]) && se >= 60)) return null;
  const tot = h * 3600 + mi * 60 + se;
  return tot > 0 ? tot : null;
}

// Fallback when the two '/' separators were not both found geometrically
// (e.g. no name or no location in the band): split the OCR'd line on '/'
// and classify each part with the strict field parsers.
function parseInfo(text) {
  const out = { photographer: null, latitude: null, longitude: null, captured_at: null };
  if (!text) return out;
  const t = text.replace(/\s+/g, ' ').trim();
  // the date-time always closes the line; find where it starts
  const dm = t.match(/20\d\d\D?\d\d\D?\d\d.{0,3}\d\d\D?\d\d[^\dA-Za-z]{0,2}$/);
  if (!dm) return out;
  out.captured_at = parseDateText(dm[0]);
  if (!out.captured_at) return out; // layout not understood: trust nothing
  const head = t.slice(0, dm.index).replace(/[\s\/|.,'-]+$/, '');
  const rest = head ? head.split('/').map((x) => x.trim()).filter(Boolean) : [];
  if (rest.length === 2) {
    out.photographer = parseName(rest[0]);
    const c = parseCoordsText(rest[1]);
    if (c) { out.latitude = c.latitude; out.longitude = c.longitude; }
  } else if (rest.length === 1) {
    const c = parseCoordsText(rest[0]);
    if (c) { out.latitude = c.latitude; out.longitude = c.longitude; }
    else if (!/°|\d[\s.,'-]{0,3}[NSEW]\b|\d\.\d/.test(rest[0])) out.photographer = parseName(rest[0]);
  }
  return out;
}

// ---------------------------------------------------------------- main

const WL_MODEL = 'SestarPo0351 ';
const WL_TARGET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ';
const WL_LABEL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
const WL_EXPO = '0123456789hmins ';
const WL_NAME = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.'-_ ";
const WL_COORD = '0123456789.°NSEW, ';
const WL_DATE = '0123456789.: ';
const WL_INFO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/°.,:'- ";

const MAX_SHORT_SIDE = 1500;
const MAX_LATITUDE = 75;
// Free-text names have no structure to validate against, so also demand a
// confident read (garbage from non-Latin names and star-polluted reads come
// back well below this).
const NAME_MIN_CONF = 70;
const CAP_RATIO = 0.74; // cap height / unit (calibrated so 1u ~ bottom text-line height)

const VARIANTS = [
  { h: 56, mode: 'grey' },
  { h: 40, mode: 'grey' },
  { h: 48, mode: 'bin' },
  // only consulted while the reads above have not settled
  { h: 68, mode: 'grey' },
  { h: 34, mode: 'bin' },
];

const alnum = (t) => (t.match(/[A-Za-z0-9]/g) || []).length;
// OCR that produced fewer characters than there are glyph blobs dropped
// something ("111min" -> "11min"); more than one extra (touching glyphs can
// legitimately merge one pair) means it invented something.
const CHECK_MIN = (t, n) => alnum(t) >= n && alnum(t) <= n + 1;
// Dates are validated by their fixed 12-digit shape; a ':' whose dots merge
// can add a glyph, so allow one either way.
const CHECK_DATE = (t, n) => Math.abs(alnum(t) - n) <= 1;
// Whole info line (fallback path): the '/' separators are glyphs too.
const CHECK_INFO = (t, n) => Math.abs(alnum(t) + (t.match(/\//g) || []).length - n) <= 2;
// Coordinates: if a degree sign went missing it was probably read as a
// digit ("42.1° N" -> "42.19 N"), so then demand an exact glyph count.
const CHECK_COORD = (t, n) => ((t.match(/°/g) || []).length >= 2 ? CHECK_MIN(t, n) : alnum(t) === n);

// OCR one region under up to five renderings and vote. A value needs two
// agreeing reads and no disagreeing one, or, if reads conflict, a lead of two
// votes. Object results (coords, the info fallback) are voted field by field.
// Reads that fail the glyph-count check or the confidence floor do not vote.
function fieldVotes(reads) {
  const keys = new Set();
  for (const r of reads) if (r != null) for (const k of (typeof r === 'object' ? Object.keys(r) : ['_'])) keys.add(k);
  const out = new Map();
  for (const k of keys) {
    const vals = [];
    for (const r of reads) {
      if (r == null) continue;
      const v = typeof r === 'object' ? r[k] : r;
      if (v != null) vals.push(JSON.stringify(v));
    }
    out.set(k, vals);
  }
  return out;
}
function decideVals(vals) {
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]);
  if (!ranked.length || ranked[0][1] < 2) return null;
  if (ranked.length > 1 && ranked[0][1] - ranked[1][1] < 2) return null;
  return JSON.parse(ranked[0][0]);
}

async function vote(reg, wl, parse, texts, check = CHECK_MIN, minConf = 0) {
  const reads = [];
  let firstText = null;
  let isObj = false;
  for (let i = 0; i < VARIANTS.length; i++) {
    const v = VARIANTS[i];
    const buf = await renderRegion(reg, v.h, v.mode);
    const r = await ocr(buf, wl);
    if (firstText == null) firstText = r.text;
    let p = parse(r.text, r.conf);
    if (p != null && check && !check(r.text, reg.nGlyphs)) p = null;
    if (p != null && r.conf < minConf) p = null;
    if (p != null && typeof p === 'object') isObj = true;
    reads.push(p);
    // settled: every field has >= 2 reads and they all agree
    const fv = fieldVotes(reads);
    if (fv.size && [...fv.values()].every((vals) => vals.length >= 2 && new Set(vals).size === 1)) break;
  }
  texts.push(firstText);
  const fv = fieldVotes(reads);
  if (!isObj) return fv.has('_') ? decideVals(fv.get('_')) : null;
  const res = {};
  let any = false;
  for (const [k, vals] of fv) { res[k] = decideVals(vals); if (res[k] != null) any = true; }
  return any ? res : null;
}

const EMPTY = () => ({
  found: false, text: null, telescope: null, target: null, latitude: null,
  longitude: null, captured_at: null, exposure_seconds_total: null, photographer: null,
});

// Read the watermark band of an exported JPG/PNG.
//
// Resolves to null when OCR is unavailable (DISABLE_OCR, no worker, a timed
// out job), otherwise to an object whose `found` says whether a band layout
// was recognised at all. Every other field is null unless it was read with
// confidence:
//   telescope              'Seestar S50 Pro' | 'Seestar S50' | 'Seestar S30 Pro' | 'Seestar S30'
//   target                 parseTarget() object, e.g. { catalog: 'NGC', number: '6960', raw: 'NGC6960' }
//   latitude, longitude    signed decimal degrees (only ever both or neither)
//   captured_at            'YYYY-MM-DDTHH:MM' as printed (the device's local time)
//   exposure_seconds_total total integration in seconds
//   photographer           free text
// Never throws.
async function readBand(imagePath) {
  try {
    const res = await analyzeInner(imagePath);
    if (res.target) res.target = parseTarget(res.target);
    return res;
  } catch (err) {
    if (err instanceof OcrUnavailable) return null;
    console.warn('Seestar band read failed:', err.message);
    return EMPTY();
  }
}

async function analyzeInner(imagePath) {
  const res = EMPTY();
  const meta = await sharp(imagePath).metadata();
  let W0 = meta.width, H0 = meta.height;
  if (!W0 || !H0) return res;
  if (meta.orientation && meta.orientation >= 5) [W0, H0] = [H0, W0];
  // Big exports carry no extra information for 2-3% high text; analyse at
  // most ~1500 px on the short side (OCR crops are rescaled anyway).
  const k = Math.min(1, MAX_SHORT_SIDE / Math.min(W0, H0));
  const W = Math.max(1, Math.round(W0 * k)), H = Math.max(1, Math.round(H0 * k));
  if (W < 200 || H < 200) return res;
  // search strip: bottom 35% (the band is ~9% on portrait exports; generous
  // so landscape layouts that scale with the width still fit)
  const S0 = Math.round(H0 * 0.35);
  const S = Math.max(1, Math.round(S0 * k));
  let pipe = sharp(imagePath).rotate().extract({ left: 0, top: H0 - S0, width: W0, height: S0 });
  if (k < 1) {
    const full = await pipe.raw().toBuffer({ resolveWithObject: true });
    pipe = sharp(full.data, { raw: { width: full.info.width, height: full.info.height, channels: full.info.channels } })
      .resize(W, S, { fit: 'fill', kernel: 'lanczos3' });
  }
  const { data: g, info } = await pipe.greyscale().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || info.width !== W || info.height !== S) return res;
  const rows = findRows(g, W, S);
  if (!rows) return res;
  // Unit of measure: the row-cluster height depends on how much of the width
  // the text fills, so derive the unit from glyph heights instead (75th
  // percentile of glyph-component heights on the bottom row ~ cap height).
  const clamp = (y) => Math.max(0, Math.min(S - 1, Math.round(y)));
  const u0 = rows.bot[1] - rows.bot[0] + 1;
  const probe = rowBlobs(g, W, clamp(rows.bot[0] - 0.5 * u0), clamp(rows.bot[1] + 0.5 * u0), u0);
  const hs = probe.keep.map((c) => c.y1 - c.y0 + 1).sort((a, b) => a - b);
  if (hs.length < 4) return res;
  const capH = hs[Math.floor(hs.length * 0.75)];
  const u = capH / CAP_RATIO;
  const tops = probe.keep.filter((c) => { const h = c.y1 - c.y0 + 1; return h >= 0.85 * capH && h <= 1.25 * capH; })
    .map((c) => c.y0).sort((a, b) => a - b);
  if (!tops.length) return res;
  const capTop = probe.y0 + tops[tops.length >> 1];
  const bY0 = clamp(capTop - 0.25 * u), bY1 = clamp(capTop + 1.25 * u);
  const tprobe = rowBlobs(g, W, clamp(rows.top[0] - 0.5 * u), clamp(rows.top[1] + 0.5 * u), u);
  const ty0s = tprobe.keep.map((c) => c.y0).sort((a, b) => a - b);
  const ty1s = tprobe.keep.map((c) => c.y1).sort((a, b) => a - b);
  if (!ty0s.length) return res;
  const tY0 = clamp(tprobe.y0 + ty0s[Math.floor(ty0s.length * 0.1)] - 0.25 * u);
  const tY1 = Math.min(bY0 - 1, clamp(tprobe.y0 + ty1s[Math.floor(ty1s.length * 0.9)] + 0.25 * u));
  if (tY1 - tY0 < u) return res;
  const tr = rowBlobs(g, W, tY0, tY1, u);
  const br = rowBlobs(g, W, bY0, bY1, u);

  const tg = groupBy(tr.blobs, 1.6 * u);
  const bgp = groupBy(br.blobs, 1.6 * u);
  const texts = [];
  const regionOf = (row, Y0, items) => {
    const y0 = Y0 + Math.min(...items.map((b) => b.y0)), y1 = Y0 + Math.max(...items.map((b) => b.y1));
    const ext = Math.round(0.1 * u);
    return prepRegion(g, W, row, items[0].x0 - 0.2 * u, items[items.length - 1].x1 + 0.2 * u, y0 - ext, y1 + ext, { core: [items[0].x0, items[items.length - 1].x1] });
  };

  // ---- top row: [logo] model [tripod] ........ target
  let logo = null;
  if (tg.length >= 1) {
    let items = tg[0].items.slice();
    if (items.length && (items[0].x1 - items[0].x0 + 1) < 2.2 * u) logo = items.shift();
    if (items.length >= 2) {
      const lastI = items[items.length - 1], prev = items[items.length - 2];
      if (lastI.x1 - lastI.x0 + 1 < 1.15 * u && lastI.x0 - prev.x1 > 0.6 * u) items.pop();
    }
    if (items.length) {
      const mreg = regionOf(tr, tY0, items);
      const shape = items.length >= 2 ? sizeDigitShape(tr, W, items[1]) : null;
      const parseM = (t) => {
        const v = parseModel(t, mreg.nGlyphs);
        if (v && shape && !v.startsWith(`Seestar S${shape}0`)) return null; // OCR and glyph shape disagree
        return v;
      };
      res.telescope = await vote(mreg, WL_MODEL, parseM, texts, null);
    }
    if (tg.length >= 2) {
      const right = tg[tg.length - 1];
      res.target = await vote(regionOf(tr, tY0, right.items), WL_TARGET,
        (t) => parseTargetText(t) || parseNamedLabel(t), texts);
    }
  }

  // ---- no target on the top row: the app's Milky Way exports instead put
  // one larger label on the right, centred between the two rows (and print
  // no integration time).
  if (res.target == null) {
    const span = rowBlobs(g, W, tY0, bY1, u);
    const leftEnd = Math.max(tg.length ? tg[0].x1 : 0, bgp.length ? bgp[0].x1 : 0);
    const right = groupBy(span.blobs.filter((b) => b.x0 > leftEnd + 1.6 * u), 1.6 * u);
    const label = right[right.length - 1];
    if (label) {
      const ly0 = tY0 + label.y0, ly1 = tY0 + label.y1;
      const mid = (ly0 + ly1) / 2;
      const topMid = (tY0 + tY1) / 2, botMid = (bY0 + bY1) / 2;
      const quarter = (botMid - topMid) / 4;
      // One line (a target above an integration time spans both rows),
      // sitting in the middle half between the rows' centres.
      if (ly1 - ly0 + 1 <= 2.4 * u && mid > topMid + quarter && mid < botMid - quarter) {
        const ext = Math.round(0.1 * u);
        const reg = prepRegion(g, W, span, label.x0 - 0.2 * u, label.x1 + 0.2 * u, ly0 - ext, ly1 + ext,
          { core: [label.x0, label.x1], kind: 'name' });
        res.target = await vote(reg, WL_LABEL, parseNamedLabel, texts, null);
      }
    }
  }

  // ---- bottom row: [moon] name / coords / date ........ integration
  if (bgp.length >= 1) {
    let items = bgp[0].items.slice();
    // moon icon: centred in the logo's column and starting in its left half
    if (logo) items = items.filter((b) => !((b.x0 + b.x1) / 2 <= logo.x1 && b.x0 < (logo.x0 + logo.x1) / 2));
    else if (items.length > 1 && items[0].x1 - items[0].x0 + 1 < 0.8 * u && items[1].x0 - items[0].x1 > 0.35 * u
      && items[0].y1 - items[0].y0 + 1 >= 0.85 * (items[1].y1 - items[1].y0 + 1)) items.shift();
    if (items.length) {
      const slashes = [];
      items.forEach((b, i) => { if (i > 0 && i < items.length - 1 && isSlash(b, br, W)) slashes.push(i); });
      const reg = (a, b2, kind) => prepRegion(g, W, br, items[a].x0 - 0.2 * u, items[b2].x1 + 0.2 * u, bY0, bY1, { core: [items[a].x0, items[b2].x1], kind });
      if (slashes.length === 2) {
        const [s1, s2] = slashes;
        if (s1 > 0) res.photographer = await vote(reg(0, s1 - 1, 'name'), WL_NAME, parseName, texts, CHECK_MIN, NAME_MIN_CONF);
        if (s2 - 1 >= s1 + 1) {
          const c = await vote(reg(s1 + 1, s2 - 1, 'coord'), WL_COORD, parseCoordsText, texts, CHECK_COORD);
          // only report a position when both halves were agreed on
          if (c && c.latitude != null && c.longitude != null) { res.latitude = c.latitude; res.longitude = c.longitude; }
        }
        if (s2 + 1 <= items.length - 1) res.captured_at = await vote(reg(s2 + 1, items.length - 1, 'date'), WL_DATE, parseDateText, texts, CHECK_DATE);
      } else {
        const parseI = (t, conf) => {
          const o = parseInfo(t);
          if (conf < NAME_MIN_CONF) o.photographer = null; // same floor as the split path
          return o;
        };
        const info = await vote(reg(0, items.length - 1, 'info'), WL_INFO, parseI, texts, CHECK_INFO);
        if (info) {
          if (info.photographer != null) res.photographer = info.photographer;
          if (info.captured_at != null) res.captured_at = info.captured_at;
          if (info.latitude != null && info.longitude != null) { res.latitude = info.latitude; res.longitude = info.longitude; }
        }
      }
    }
    if (bgp.length >= 2) {
      const right = bgp[bgp.length - 1];
      res.exposure_seconds_total = await vote(prepRegion(g, W, br, right.x0 - 0.2 * u, right.x1 + 0.2 * u, bY0, bY1), WL_EXPO, parseExposure, texts);
    }
  }
  res.text = texts.join(' | ');
  res.found = ['telescope', 'target', 'latitude', 'captured_at', 'exposure_seconds_total', 'photographer']
    .some((k) => res[k] != null);
  return res;
}

module.exports = {
  readBand,
  // Exported for unit tests.
  _parse: { parseModel, parseTargetText, parseNamedLabel, parseExposure, parseInfo, parseCoordsText, parseDateText, parseName },
};
