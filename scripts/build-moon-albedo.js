#!/usr/bin/env node
// Builds lib/moon_albedo.png — a 1°-per-pixel greyscale map of the Moon
// (equirectangular, longitude -180..180 east-positive left to right,
// latitude +90..-90 top to bottom) that lib/moon_detect.js matches photos
// against — from NASA's public-domain LRO colour mosaic (CGI Moon Kit):
//
//   curl -O https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_1k.jpg
//   node scripts/build-moon-albedo.js lroc_color_poles_1k.jpg
'use strict';

const path = require('path');
const sharp = require('sharp');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/build-moon-albedo.js lroc_color_poles_1k.jpg');
    process.exit(2);
  }
  const out = path.join(__dirname, '..', 'lib', 'moon_albedo.png');
  await sharp(file).greyscale().resize(360, 180, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 }).toFile(out);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
