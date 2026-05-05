// Tiny astronomy helpers — Julian Day, sidereal time, equatorial → horizontal,
// and a synodic-month-based moon phase.
// Accuracy is plenty for "is this object up right now" planning, not for
// surveying. RA inputs are in decimal hours; declinations in degrees.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const SYNODIC_MONTH = 29.530588853;

function julianDay(date = new Date()) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

// Greenwich Mean Sidereal Time in degrees (USNO simplified formula).
function gmstDegrees(date = new Date()) {
  const jd = julianDay(date);
  const t = jd - 2_451_545.0;
  let g = 280.46061837 + 360.98564736629 * t;
  g %= 360;
  if (g < 0) g += 360;
  return g;
}

// Convert (RA hours, Dec deg) at a given location/time to (alt, az) in degrees.
// `lat` and `lon` are observer latitude/longitude in degrees (east-positive).
function altAz({ raHours, decDeg, lat, lon, date = new Date() }) {
  if (raHours == null || decDeg == null || lat == null || lon == null) return null;
  const lst = (gmstDegrees(date) + lon) % 360;
  let ha = lst - raHours * 15;
  ha = ((ha + 540) % 360) - 180; // wrap to [-180, 180]

  const haRad = ha * RAD;
  const decRad = decDeg * RAD;
  const latRad = lat * RAD;

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * DEG;

  const cosAlt = Math.cos(alt * RAD);
  let az;
  if (cosAlt < 1e-6) {
    az = 0;
  } else {
    const sinAz = -Math.cos(decRad) * Math.sin(haRad) / cosAlt;
    const cosAz =
      (Math.sin(decRad) - Math.sin(latRad) * Math.sin(alt * RAD)) /
      (Math.cos(latRad) * cosAlt);
    az = Math.atan2(sinAz, cosAz) * DEG;
    if (az < 0) az += 360;
  }
  return { altitude: alt, azimuth: az, hourAngle: ha };
}

// Lunar phase 0..1 where 0 = new, 0.5 = full, with a human-readable name.
// Reference: a known new moon at JD 2451550.1.
function moonPhase(date = new Date()) {
  const days = julianDay(date) - 2_451_550.1;
  const phase = ((days / SYNODIC_MONTH) % 1 + 1) % 1;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  return { phase, illumination, name: moonPhaseName(phase) };
}

function moonPhaseName(phase) {
  if (phase < 0.03 || phase >= 0.97) return 'New Moon';
  if (phase < 0.22) return 'Waxing Crescent';
  if (phase < 0.28) return 'First Quarter';
  if (phase < 0.47) return 'Waxing Gibbous';
  if (phase < 0.53) return 'Full Moon';
  if (phase < 0.72) return 'Waning Gibbous';
  if (phase < 0.78) return 'Last Quarter';
  return 'Waning Crescent';
}

// Low-precision Sun position (Meeus ch.25 simplified, ~0.01° accuracy in
// the next century). Returns { raHours, decDeg }. Good enough for twilight
// and "is the sun below -18° yet" checks; not for solar imaging.
function sunPosition(date = new Date()) {
  const n = julianDay(date) - 2_451_545.0;
  const L = ((280.460 + 0.9856474 * n) % 360 + 360) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360 + 360) % 360 * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  let raHours = (ra * DEG) / 15;
  if (raHours < 0) raHours += 24;
  return { raHours, decDeg: dec * DEG };
}

// Low-precision Moon position (~0.5° accuracy). Returns { raHours, decDeg }.
// Plenty for moon-up windows and moon-target separation thresholds; not for
// occultation timing.
function moonPosition(date = new Date()) {
  const d = julianDay(date) - 2_451_545.0;
  const L = (218.316 + 13.176396 * d) * RAD;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.229350 * d) * RAD;
  const lambda = L + 6.289 * RAD * Math.sin(M);
  const beta = 5.128 * RAD * Math.sin(F);
  const epsilon = 23.439 * RAD;
  const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
  const sinB = Math.sin(beta), cosB = Math.cos(beta);
  const ra = Math.atan2(sinL * Math.cos(epsilon) - Math.tan(beta) * Math.sin(epsilon), cosL);
  const dec = Math.asin(sinB * Math.cos(epsilon) + cosB * Math.sin(epsilon) * sinL);
  let raHours = (ra * DEG) / 15;
  if (raHours < 0) raHours += 24;
  return { raHours, decDeg: dec * DEG };
}

// Great-circle separation between two equatorial points, in degrees.
function angularSeparationDeg(a, b) {
  const ra1 = a.raHours * 15 * RAD, dec1 = a.decDeg * RAD;
  const ra2 = b.raHours * 15 * RAD, dec2 = b.decDeg * RAD;
  const c = Math.sin(dec1) * Math.sin(dec2)
          + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, c))) * DEG;
}

module.exports = {
  julianDay, gmstDegrees, altAz, moonPhase, moonPhaseName,
  sunPosition, moonPosition, angularSeparationDeg,
};
