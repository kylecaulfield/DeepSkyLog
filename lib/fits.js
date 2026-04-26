const fs = require('fs');

const BLOCK = 2880;
const CARD = 80;

function parseCard(card) {
  const key = card.slice(0, 8).trim();
  if (!key || key === 'END' || key === 'COMMENT' || key === 'HISTORY') {
    return { key, value: null };
  }
  if (card[8] !== '=') return { key, value: null };
  const rest = card.slice(9).trim();
  if (rest.startsWith("'")) {
    const end = rest.indexOf("'", 1);
    const str = end > 0 ? rest.slice(1, end) : rest.slice(1);
    return { key, value: str.replace(/\s+$/, '') };
  }
  const commentIdx = rest.indexOf('/');
  const token = (commentIdx >= 0 ? rest.slice(0, commentIdx) : rest).trim();
  if (token === 'T') return { key, value: true };
  if (token === 'F') return { key, value: false };
  if (token !== '' && !Number.isNaN(Number(token))) return { key, value: Number(token) };
  return { key, value: token };
}

function readHeader(fd) {
  const header = {};
  const buf = Buffer.alloc(BLOCK);
  let offset = 0;
  let ended = false;
  while (!ended) {
    const bytes = fs.readSync(fd, buf, 0, BLOCK, offset);
    if (bytes !== BLOCK) throw new Error('Truncated FITS header');
    for (let i = 0; i < BLOCK; i += CARD) {
      const card = buf.toString('ascii', i, i + CARD);
      if (card.startsWith('END') && card.slice(3).trim() === '') {
        ended = true;
        break;
      }
      const { key, value } = parseCard(card);
      if (key && !(key in header) && value !== null) header[key] = value;
    }
    offset += BLOCK;
    if (offset > 1024 * 1024) throw new Error('FITS header too large');
  }
  return { header, dataOffset: offset };
}

function readFitsHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    return readHeader(fd).header;
  } finally {
    fs.closeSync(fd);
  }
}

function readFitsImage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const { header, dataOffset } = readHeader(fd);
    const { BITPIX: bitpix, NAXIS1: w, NAXIS2: h } = header;
    const planes = Number(header.NAXIS) === 3 && Number(header.NAXIS3) > 0
      ? Number(header.NAXIS3) : 1;
    const bzero = header.BZERO ?? 0;
    const bscale = header.BSCALE ?? 1;
    if (!w || !h) throw new Error('FITS missing NAXIS1/NAXIS2');

    const bpp = Math.abs(bitpix) / 8;
    const count = w * h * planes;
    const size = count * bpp;
    const buf = Buffer.alloc(size);
    const n = fs.readSync(fd, buf, 0, size, dataOffset);
    if (n !== size) throw new Error('Truncated FITS data');

    const pixels = new Float32Array(count);
    if (bitpix === 16) {
      for (let i = 0; i < count; i++) pixels[i] = bzero + bscale * buf.readInt16BE(i * 2);
    } else if (bitpix === -32) {
      for (let i = 0; i < count; i++) pixels[i] = bzero + bscale * buf.readFloatBE(i * 4);
    } else if (bitpix === 32) {
      for (let i = 0; i < count; i++) pixels[i] = bzero + bscale * buf.readInt32BE(i * 4);
    } else if (bitpix === 8) {
      for (let i = 0; i < count; i++) pixels[i] = bzero + bscale * buf.readUInt8(i);
    } else {
      throw new Error(`Unsupported BITPIX: ${bitpix}`);
    }

    return { header, pixels, width: w, height: h, planes };
  } finally {
    fs.closeSync(fd);
  }
}

function percentiles(pixels, pLow, pHigh) {
  const stride = Math.max(1, Math.floor(pixels.length / 200_000));
  const samples = [];
  for (let i = 0; i < pixels.length; i += stride) samples.push(pixels[i]);
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(samples.length * pLow)];
  const hi = samples[Math.min(samples.length - 1, Math.ceil(samples.length * pHigh) - 1)];
  return [lo, hi === lo ? lo + 1 : hi];
}

function stretch(v, low, range) {
  let t = (v - low) / range;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.round(255 * Math.sqrt(t));
}

function debayerGRBG(pixels, width, height, low, high) {
  const outW = width >> 1;
  const outH = height >> 1;
  const range = high - low;
  const out = Buffer.alloc(outW * outH * 3);
  let o = 0;
  for (let y = 0; y < outH; y++) {
    const row0 = (y * 2) * width;
    const row1 = (y * 2 + 1) * width;
    for (let x = 0; x < outW; x++) {
      const c0 = x * 2;
      const g1 = pixels[row0 + c0];
      const r  = pixels[row0 + c0 + 1];
      const b  = pixels[row1 + c0];
      const g2 = pixels[row1 + c0 + 1];
      out[o++] = stretch(r, low, range);
      out[o++] = stretch((g1 + g2) * 0.5, low, range);
      out[o++] = stretch(b, low, range);
    }
  }
  return { buffer: out, width: outW, height: outH, channels: 3 };
}

function grayscale(pixels, width, height, low, high) {
  const range = high - low;
  const out = Buffer.alloc(pixels.length);
  for (let i = 0; i < pixels.length; i++) out[i] = stretch(pixels[i], low, range);
  return { buffer: out, width, height, channels: 1 };
}

function planesRGB(pixels, width, height, low, high) {
  const range = high - low;
  const plane = width * height;
  const out = Buffer.alloc(plane * 3);
  for (let i = 0; i < plane; i++) {
    out[i * 3]     = stretch(pixels[i],             low, range);
    out[i * 3 + 1] = stretch(pixels[plane + i],     low, range);
    out[i * 3 + 2] = stretch(pixels[plane * 2 + i], low, range);
  }
  return { buffer: out, width, height, channels: 3 };
}

function renderPixels(filePath) {
  const { header, pixels, width, height, planes } = readFitsImage(filePath);
  const [low, high] = percentiles(pixels, 0.005, 0.998);
  if (planes === 3) return planesRGB(pixels, width, height, low, high);
  const bayer = typeof header.BAYERPAT === 'string' ? header.BAYERPAT.trim() : '';
  if (bayer === 'GRBG') return debayerGRBG(pixels, width, height, low, high);
  return grayscale(pixels, width, height, low, high);
}

async function renderFitsJpeg(filePath, sharp, { maxWidth, quality = 85 } = {}) {
  const { buffer, width, height, channels } = renderPixels(filePath);
  let pipe = sharp(buffer, { raw: { width, height, channels } });
  if (maxWidth) pipe = pipe.resize({ width: maxWidth, withoutEnlargement: true });
  return pipe.jpeg({ quality }).toBuffer();
}

function isFitsPath(p) {
  return /\.fits?$/i.test(p);
}

function fitsExif(header) {
  if (!header) return null;
  const iso = header['DATE-OBS'] ? String(header['DATE-OBS']) : null;
  const capturedAt = iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toISOString()
    : null;
  const device = typeof header.INSTRUME === 'string' ? header.INSTRUME.trim() : null;
  const exposure = typeof header.EXPTIME === 'number'
    ? header.EXPTIME
    : typeof header.EXPOSURE === 'number' ? header.EXPOSURE : null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    capturedAt,
    device,
    exposureSeconds: exposure,
    filter: typeof header.FILTER === 'string' ? header.FILTER.trim() : null,
    object: typeof header.OBJECT === 'string' ? header.OBJECT.trim() : null,
    latitude: num(header.SITELAT),
    longitude: num(header.SITELONG),
    focalLengthMm: num(header.FOCALLEN),
    aperture: num(header.APERTURE),
  };
}

module.exports = {
  isFitsPath,
  readFitsHeader,
  renderFitsJpeg,
  fitsExif,
};
