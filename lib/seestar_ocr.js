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
// JSON of the parameters last applied to the current worker (see recognize).
// A new worker starts from tesseract's defaults, so this resets with it.
let paramsKey = null;

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
  paramsKey = null;
  workerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const local = hasLocalTessdata();
      // tesseract.js caches the unpacked language data as
      // `<cachePath>/eng.traineddata`, defaulting to the process cwd — which
      // dropped a 5 MB untracked file in the repo root on `npm start`. Keep
      // the cache next to the bundled data instead (gitignored, and owned by
      // the app user in the Docker image).
      const opts = local
        ? { langPath: TESSDATA_DIR, cachePath: TESSDATA_DIR }
        : { cachePath: TESSDATA_DIR };
      // Without bundled data (SKIP_TESSDATA=1) the folder may not exist yet;
      // a failed cache write is only logged by tesseract.js, but it would
      // mean re-downloading the language data on every worker init.
      try { fs.mkdirSync(TESSDATA_DIR, { recursive: true }); } catch {}
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

// Every OCR job goes through here. The worker is shared and tesseract
// parameters are worker state, so a setParameters + recognize pair must not
// interleave with another request's pair: jobs run one at a time on a
// promise chain. Parameters are always set in full, so one caller's
// whitelist or page-segmentation mode never leaks into the next caller.
//
// Resolves to { text, confidence }, or null when OCR is disabled, the
// worker is unavailable, or the job failed / timed out.
const DEFAULT_PARAMS = {
  // What a fresh tesseract.js worker uses (PSM.SINGLE_BLOCK) — not the
  // tesseract CLI's '3'. Matching it keeps ocrBanner's output unchanged.
  tessedit_pageseg_mode: '6',
  tessedit_char_whitelist: '',
  user_defined_dpi: '',
  preserve_interword_spaces: '0',
};
let chain = Promise.resolve();

function recognize(buffer, { psm, whitelist, dpi, preserveSpaces } = {}) {
  const params = {
    tessedit_pageseg_mode: psm != null ? String(psm) : DEFAULT_PARAMS.tessedit_pageseg_mode,
    tessedit_char_whitelist: whitelist != null ? whitelist : DEFAULT_PARAMS.tessedit_char_whitelist,
    // Field crops are rendered at a fixed glyph height; an explicit DPI
    // stops tesseract warning about (and guessing) a missing resolution.
    user_defined_dpi: dpi != null ? String(dpi) : (psm != null ? '300' : DEFAULT_PARAMS.user_defined_dpi),
    preserve_interword_spaces: preserveSpaces != null
      ? (preserveSpaces ? '1' : '0')
      : (psm != null ? '1' : DEFAULT_PARAMS.preserve_interword_spaces),
  };
  const job = chain.then(() => runJob(buffer, params));
  chain = job.catch(() => {});
  return job;
}

async function runJob(buffer, params) {
  if (ocrDisabled()) return null;
  const worker = await getWorker();
  if (!worker) return null;
  try {
    const key = JSON.stringify(params);
    if (key !== paramsKey) {
      await withTimeout(worker.setParameters(params), OCR_TIMEOUT_MS, 'OCR setParameters');
      paramsKey = key;
    }
    const result = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS, 'OCR recognise');
    return { text: result?.data?.text || '', confidence: result?.data?.confidence ?? 0 };
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

// Whole-band OCR with tesseract's default layout analysis. Kept as the
// fallback for band layouts lib/seestar_band.js does not recognise.
async function ocrBanner(imagePath) {
  if (ocrDisabled()) return null;
  let buffer;
  try { buffer = await cropBanner(imagePath); } catch { return null; }
  if (!buffer) return null;
  const result = await recognize(buffer);
  return (result?.text || '').trim() || null;
}

async function shutdown() {
  try {
    if (workerPromise) {
      const w = await workerPromise;
      if (w) await w.terminate();
    }
  } catch {} finally {
    workerPromise = null;
    paramsKey = null;
  }
}

module.exports = { ocrBanner, recognize, shutdown };
