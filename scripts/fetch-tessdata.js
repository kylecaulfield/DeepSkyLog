#!/usr/bin/env node
// Fetches the eng.traineddata.gz blob tesseract.js needs for OCR and stashes
// it under vendor/tessdata/. Runs as a postinstall hook so the Docker image
// (and any local `npm install`) has the data baked in — no CDN round-trip
// the first time someone uploads a Seestar JPG.
//
// The script is best-effort: any network failure logs a warning and exits 0
// so a flaky install mirror never blocks `npm install`. tesseract.js will
// fall back to the CDN at runtime if the file ends up missing.
//
// Skip with SKIP_TESSDATA=1 (CI without internet) or DISABLE_OCR=1.

const fs = require('fs');
const path = require('path');
const https = require('https');

const URL = process.env.TESSDATA_URL
  || 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
const TARGET_DIR = path.join(__dirname, '..', 'vendor', 'tessdata');
const TARGET = path.join(TARGET_DIR, 'eng.traineddata.gz');
const CONNECT_TIMEOUT_MS = 20_000;
const MIN_SIZE_BYTES = 1_000_000; // sanity check; the real file is ~10 MB

function log(msg) { console.log(`[fetch-tessdata] ${msg}`); }
function warn(msg) { console.warn(`[fetch-tessdata] WARNING: ${msg}`); }

// Always make sure the dir exists so downstream COPY-from-deps in the
// Dockerfile doesn't fail when we couldn't (or chose not to) download.
fs.mkdirSync(TARGET_DIR, { recursive: true });

if (process.env.SKIP_TESSDATA === '1' || process.env.DISABLE_OCR === '1') {
  log('skipping download (SKIP_TESSDATA / DISABLE_OCR set)');
  process.exit(0);
}

if (fs.existsSync(TARGET) && fs.statSync(TARGET).size > MIN_SIZE_BYTES) {
  log(`already present at ${path.relative(process.cwd(), TARGET)}`);
  process.exit(0);
}
const tmp = TARGET + '.tmp';

function fetch(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: CONNECT_TIMEOUT_MS }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return fetch(res.headers.location, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close((err) => err ? reject(err) : resolve()));
      file.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`connection timed out after ${CONNECT_TIMEOUT_MS}ms`)));
    req.on('error', reject);
  });
}

(async () => {
  log(`downloading ${URL}`);
  try {
    await fetch(URL);
    const size = fs.statSync(tmp).size;
    if (size < MIN_SIZE_BYTES) {
      throw new Error(`downloaded file is suspiciously small (${size} bytes)`);
    }
    fs.renameSync(tmp, TARGET);
    log(`saved ${(size / 1024 / 1024).toFixed(1)} MB to ${path.relative(process.cwd(), TARGET)}`);
  } catch (err) {
    warn(err.message);
    warn('OCR will fall back to the CDN at runtime, or be disabled if that also fails.');
    try { fs.unlinkSync(tmp); } catch {}
  }
})();
