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

module.exports = { julianDay, gmstDegrees, altAz, moonPhase, moonPhaseName };
