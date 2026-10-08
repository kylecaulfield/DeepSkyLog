// Sanity checks for values exifr parses out of camera EXIF.
//
// Recent Seestar app exports (2026-10) write a malformed EXIF block: a GPS
// IFD whose latitude/longitude rationals are all 0/0, and ExposureTime,
// FNumber and FocalLength stored as offsets that point at that GPS IFD. exifr
// decodes the GPS as NaN and the three optics tags as the same junk number
// (262145/131072 ≈ 2.0000076). Both the upload pipeline (server.js) and the
// boot-time repair of rows saved before these checks existed
// (lib/repair_optics.js) go through here, so they agree on what is junk.
'use strict';

// A parsed EXIF number, or null when absent or unreadable: exifr decodes a
// 0/0 rational as NaN, and typeof NaN is 'number'.
function exifNumber(value) {
  return Number.isFinite(value) ? value : null;
}

// GPS position from parsed EXIF, or null. The zeroed Seestar GPS block reads
// as NaN, which must not count as "has GPS", or it hides the watermark's
// coordinates. 0,0 is the no-fix placeholder some apps write, never a real
// site.
function exifGps(exif) {
  const latitude = exifNumber(exif?.latitude);
  const longitude = exifNumber(exif?.longitude);
  if (latitude == null || longitude == null) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

// The junk value when ExposureTime, the f-number and FocalLength are all the
// same number — the signature of the malformed Seestar block — else null. No
// real camera reports the same number for all three.
function junkOpticsValue(exif) {
  const exposure = exifNumber(exif?.ExposureTime);
  const aperture = exifNumber(exif?.FNumber) ?? exifNumber(exif?.ApertureValue);
  const focal = exifNumber(exif?.FocalLength);
  return exposure != null && exposure === aperture && aperture === focal ? exposure : null;
}

// Exposure, f-number and focal length from parsed EXIF, each null when
// unreadable, and all null when they carry the junk signature.
function exifOptics(exif) {
  if (junkOpticsValue(exif) != null) {
    return { exposureSeconds: null, aperture: null, focalLengthMm: null };
  }
  return {
    exposureSeconds: exifNumber(exif?.ExposureTime),
    aperture: exifNumber(exif?.FNumber) ?? exifNumber(exif?.ApertureValue),
    focalLengthMm: exifNumber(exif?.FocalLength),
  };
}

module.exports = { exifNumber, exifGps, junkOpticsValue, exifOptics };
