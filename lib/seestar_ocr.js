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
// Checked per-init (not once at module load) so a retry after an admin
// drops the file into vendor/tessdata/ picks it up without a restart.
function hasLocalTessdata() {
  try {
    return fs.existsSync(TESSDATA_FILE) && fs.statSync(TESSDATA_FILE).size > 1_000_000;
  } catch {
    return false;
  }
}

let workerPromise = null;

// A failed init (CDN down, no network) disables OCR for a cooldown rather
// than forever — the environment can recover (connectivity returns, an
// admin drops eng.traineddata into vendor/tessdata/). DISABLE_OCR=1 is the
// only truly permanent switch.
const RETRY_AFTER_MS = Number(process.env.OCR_RETRY_AFTER_MS) || 10 * 60_000;
let disabledUntil = DISABLED ? Infinity : 0;

function ocrDisabled() {
  return Date.now() < disabledUntil;
}

function disableForCooldown() {
  if (!DISABLED) disabledUntil = Date.now() + RETRY_AFTER_MS;
}

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

function onUncaught(err) {
  if (looksLikeTesseractError(err)) {
    console.warn('Suppressed Tesseract async error:', err?.message || err);
    disableForCooldown();
    workerPromise = null;
    return;
  }
  // Not ours — defer to Node's default. We can't re-throw out of an
  // uncaughtException handler usefully, so detach OUR listener (only ours —
  // removeAllListeners would strip crash-loggers registered elsewhere) and
  // let the exception fire again on the next tick.
  process.removeListener('uncaughtException', onUncaught);
  setImmediate(() => { throw err; });
}
process.on('uncaughtException', onUncaught);

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); },
                 (e) => { clearTimeout(t); reject(e); });
  });
}

async function getWorker() {
  if (ocrDisabled()) return null;
  if (workerPromise) {
    try { return await workerPromise; } catch { return null; }
  }
  workerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const local = hasLocalTessdata();
      const opts = local ? { langPath: TESSDATA_DIR } : {};
      if (local) {
        console.log(`OCR: using bundled traineddata at ${TESSDATA_DIR}`);
      } else {
        console.log('OCR: bundled traineddata missing, will fetch from CDN');
      }
      const w = await withTimeout(createWorker('eng', 1, opts), INIT_TIMEOUT_MS, 'OCR init');
      return w;
    } catch (err) {
      disableForCooldown();
      workerPromise = null;
      console.warn(
        `Tesseract initialisation failed, disabling OCR for ${Math.round(RETRY_AFTER_MS / 60_000)} min:`,
        err.message,
      );
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
  if (ocrDisabled()) return null;
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
    if (/timed out/.test(String(err.message))) {
      // The abandoned job is still running inside the shared worker; reusing
      // it would make every subsequent upload queue behind the stuck one.
      // Kill it and let the next call spin up a fresh worker.
      workerPromise = null;
      worker.terminate().catch(() => {});
    }
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
