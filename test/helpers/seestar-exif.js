// The EXIF block recent Seestar app versions write into exported JPGs,
// rebuilt tag for tag from a real S50 Pro export (2026-10):
//
//   - IFD0 Make "ZWO" (no Model), so the band reader still runs.
//   - A GPS IFD with latitude/longitude refs "N"/"W" whose rationals are all
//     0/0 — exifr reports latitude/longitude as NaN.
//   - ExposureTime, FNumber and FocalLength stored as offsets that point at
//     the GPS IFD itself, so all three decode as 262145/131072 ≈ 2.0000076.
//
// seestarExifJpeg(jpeg) returns the JPEG with that block inserted after SOI.

function seestarExifTiff() {
  const b = Buffer.alloc(170);
  b.write('MM', 0, 'latin1');
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4);
  const IFD0 = 8, EXIF = 50, GPS = 92, ZEROS = 146;
  const entry = (at, tag, type, count, value) => {
    b.writeUInt16BE(tag, at);
    b.writeUInt16BE(type, at + 2);
    b.writeUInt32BE(count, at + 4);
    if (Buffer.isBuffer(value)) value.copy(b, at + 8);
    else b.writeUInt32BE(value, at + 8);
  };
  const ascii = (s) => Buffer.from(`${s}\0`, 'latin1');
  const ASCII = 2, LONG = 4, RATIONAL = 5;

  b.writeUInt16BE(3, IFD0);
  entry(IFD0 + 2, 0x010f, ASCII, 4, ascii('ZWO'));      // Make
  entry(IFD0 + 14, 0x8769, LONG, 1, EXIF);              // Exif IFD
  entry(IFD0 + 26, 0x8825, LONG, 1, GPS);               // GPS IFD

  b.writeUInt16BE(3, EXIF);
  entry(EXIF + 2, 0x829a, RATIONAL, 1, GPS);            // ExposureTime -> GPS IFD bytes
  entry(EXIF + 14, 0x829d, RATIONAL, 1, GPS);           // FNumber      -> GPS IFD bytes
  entry(EXIF + 26, 0x920a, RATIONAL, 1, GPS);           // FocalLength  -> GPS IFD bytes

  b.writeUInt16BE(4, GPS);
  entry(GPS + 2, 0x0001, ASCII, 2, ascii('N'));         // GPSLatitudeRef
  entry(GPS + 14, 0x0002, RATIONAL, 3, ZEROS);          // GPSLatitude: 0/0 0/0 0/0
  entry(GPS + 26, 0x0003, ASCII, 2, ascii('W'));        // GPSLongitudeRef
  entry(GPS + 38, 0x0004, RATIONAL, 3, ZEROS);          // GPSLongitude: 0/0 0/0 0/0
  return b;                                             // ZEROS..170 stays zero
}

function seestarExifJpeg(jpeg) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), seestarExifTiff()]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

module.exports = { seestarExifJpeg };
