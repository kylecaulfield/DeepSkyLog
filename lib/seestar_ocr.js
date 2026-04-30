// Server-side OCR of the watermark band Seestar burns onto every export.
//
// Crops the bottom strip with sharp and pushes it through tesseract.js. The
// `lib/seestar_meta.js` parsers turn the resulting text into structured
// guesses. This module is bullet-proofed against tesseract failures —
// network blips, missing language data, async worker errors — so a flaky
// OCR backend never takes the API down with it.
//
// Opt out entirely with `DISABLE_OCR=1` (e.g. air-gapped deployments).

const sharp = require('sharp');

const DISABLED = process.env.DISABLE_OCR === '1';
const INIT_TIMEOUT_MS = Number(process.env.OCR_INIT_TIMEOUT_MS) || 15_000;
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 20_000;

let workerPromise = null;
let permanentlyDisabled = DISABLED;

// Tesseract.js loads its language data inside a Node Worker thread the first
// time createWorker resolves. If that load fails (no internet, 403 from the
// CDN, …) the error surfaces as an uncaughtException. Filter only those out
// so a flaky OCR backend doesn't crash the server. Anything else falls
// through to Node's default handler.
process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  if (/tesseract|traineddata|jsdelivr|tessdata|wasm/i.test(msg)) {
    console.warn('Suppressed Tesseract async error:', msg);
    permanentlyDisabled = true;
    workerPromise = null;
    return;
  }
  // Re-emit so the default behaviour (log + exit) still applies for non-OCR
  // exceptions. We use console.error then process.exit because we cannot
  // re-throw out of an uncaughtException handler in a useful way.
  console.error(err);
  process.exit(1);
});

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); },
                 (e) => { clearTimeout(t); reject(e); });
  });
}

async function getWorker() {
  if (permanentlyDisabled) return null;
  if (workerPromise) {
    try { return await workerPromise; } catch { return null; }
  }
  workerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const w = await withTimeout(createWorker('eng'), INIT_TIMEOUT_MS, 'OCR init');
      return w;
    } catch (err) {
      permanentlyDisabled = true;
      workerPromise = null;
      console.warn('Tesseract initialisation failed, disabling OCR:', err.message);
      throw err;
    }
  })();
  try { return await workerPromise; } catch { return null; }
}

async function cropBanner(imagePath) {
  try {
    const meta = await sharp(imagePath).metadata();
    if (!meta.width || !meta.height) return null;
    const bandHeight = Math.max(80, Math.round(meta.height * 0.085));
    const top = Math.max(0, meta.height - bandHeight);
    return await sharp(imagePath)
      .extract({ left: 0, top, width: meta.width, height: meta.height - top })
      .greyscale()
      .normalise()
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

async function ocrBanner(imagePath) {
  if (permanentlyDisabled) return null;
  let buffer;
  try { buffer = await cropBanner(imagePath); } catch { return null; }
  if (!buffer) return null;
  const worker = await getWorker();
  if (!worker) return null;
  try {
    const result = await withTimeout(
      worker.recognize(buffer), OCR_TIMEOUT_MS, 'OCR recognise',
    );
    return (result?.data?.text || '').trim() || null;
  } catch (err) {
    console.warn('OCR failed:', err.message);
    return null;
  }
}

async function shutdown() {
  try {
    if (workerPromise) {
      const w = await workerPromise;
      if (w) await w.terminate();
    }
  } catch {} finally {
    workerPromise = null;
  }
}

module.exports = { ocrBanner, shutdown };
