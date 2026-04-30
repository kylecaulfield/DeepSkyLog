// Server-side OCR of the watermark band Seestar burns onto every export.
//
// Crops the bottom strip with sharp and pushes it through tesseract.js. The
// `lib/seestar_meta.js` parsers turn the resulting text into structured
// guesses. This module is bullet-proofed against tesseract failures —
// network blips, missing language data, async worker errors — so a flaky
// OCR backend never takes the API down with it.
//
// Opt out entirely with `DISABLE_OCR=1` (e.g. air-gapped deployments).

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DISABLED = process.env.DISABLE_OCR === '1';
const INIT_TIMEOUT_MS = Number(process.env.OCR_INIT_TIMEOUT_MS) || 15_000;
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS) || 20_000;

// scripts/fetch-tessdata.js drops the language data here at install time so
// the Docker image (and any local `npm install`) can run OCR offline. If
// the file is missing tesseract.js still works — it just downloads from
// jsdelivr the first time, paying ~10 MB on a cold start.
const TESSDATA_DIR = path.join(__dirname, '..', 'vendor', 'tessdata');
const TESSDATA_FILE = path.join(TESSDATA_DIR, 'eng.traineddata.gz');
const HAS_LOCAL_TESSDATA = fs.existsSync(TESSDATA_FILE)
  && fs.statSync(TESSDATA_FILE).size > 1_000_000;

let workerPromise = null;
let permanentlyDisabled = DISABLED;

// Tesseract.js loads its language data inside a Node Worker thread the first
// time createWorker resolves. If that load fails (no internet, 403 from the
// CDN, …) the error surfaces as an uncaughtException. We register a handler
// that swallows ONLY exceptions whose stack actually originates inside
// tesseract.js or whose message matches the narrow set of strings tesseract
// is known to throw. Everything else is re-thrown by re-emitting via
// `setImmediate` so Node's default crash-on-uncaughtException kicks in for
// non-OCR errors. `wasm` was previously in the regex; it's now removed
// because plenty of unrelated V8 errors mention WebAssembly.
function looksLikeTesseractError(err) {
  if (!err) return false;
  const stack = String(err.stack || '');
  if (/tesseract\.js|tesseract-core|node_modules[/\\]tesseract/i.test(stack)) return true;
  const msg = String(err.message || err);
  // Narrow string match: only the exact tessdata-fetch failure modes.
  if (/eng\.traineddata/i.test(msg)) return true;
  if (/Failed to fetch.*traineddata/i.test(msg)) return true;
  if (/jsdelivr.*tessdata/i.test(msg)) return true;
  return false;
}

process.on('uncaughtException', (err) => {
  if (looksLikeTesseractError(err)) {
    console.warn('Suppressed Tesseract async error:', err?.message || err);
    permanentlyDisabled = true;
    workerPromise = null;
    return;
  }
  // Not ours — defer to Node's default. We can't re-throw out of an
  // uncaughtException handler usefully, so detach our listener and let the
  // exception fire again on the next tick where the default handler runs.
  process.removeAllListeners('uncaughtException');
  setImmediate(() => { throw err; });
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
      const opts = HAS_LOCAL_TESSDATA ? { langPath: TESSDATA_DIR } : {};
      if (HAS_LOCAL_TESSDATA) {
        console.log(`OCR: using bundled traineddata at ${TESSDATA_DIR}`);
      } else {
        console.log('OCR: bundled traineddata missing, will fetch from CDN');
      }
      const w = await withTimeout(createWorker('eng', 1, opts), INIT_TIMEOUT_MS, 'OCR init');
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
