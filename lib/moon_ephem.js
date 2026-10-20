// The Moon's face as seen from Earth at a given moment: libration (which
// selenographic point faces the observer), the position angle of the lunar
// north pole, where the Sun stands over the Moon (what is lit), and the
// bright-limb angle and illuminated fraction. lib/moon_map.js uses it to
// project named features onto a photo.
//
// Formulas from Meeus, "Astronomical Algorithms" (2nd ed.): ch. 47 (Moon
// position, the larger terms of the ELP-2000/82 series — a few arc-seconds),
// ch. 25 (Sun, low accuracy), ch. 22 (main nutation terms), ch. 48 (bright
// limb, illuminated fraction) and ch. 53 (optical + physical libration, axis
// position angle, selenographic Sun). With observer lat/lon the Moon's
// position is made topocentric first, which shifts libration by up to ~1°.
// Angles in and out are degrees; selenographic longitude is east-positive.
'use strict';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const INCLINATION = 1.54242; // lunar equator to ecliptic, degrees
const EARTH_RADIUS_KM = 6378.14;
const AU_KM = 149597870.7;

const rev = (x) => ((x % 360) + 360) % 360;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);

// Table 47.A: D, M, M', F, Σl (1e-6°), Σr (1e-3 km).
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

// Table 47.B: D, M, M', F, Σb (1e-6°).
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

// Julian Ephemeris Day. TT - UTC is ~69 s this decade; the Moon moves about
// 0.6" in that time, so a fixed value is plenty.
function julianEphemerisDay(date) {
  return date.getTime() / 86400000 + 2440587.5 + 69.2 / 86400;
}

function fundamentals(T) {
  return {
    Lp: rev(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000),
    D: rev(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000),
    M: rev(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000),
    Mp: rev(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000),
    F: rev(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000),
    // Mean longitude of the Moon's ascending node.
    Om: rev(125.0445479 - 1934.1362891 * T + 0.0020754 * T * T + T ** 3 / 467441 - T ** 4 / 60616000),
    E: 1 - 0.002516 * T - 0.0000074 * T * T,
  };
}

// Geocentric ecliptic longitude / latitude (mean equinox of date, no
// nutation) and distance of the Moon. Meeus ch. 47.
function moonEcliptic(T, f) {
  const { Lp, D, M, Mp, F, E } = f;
  let sl = 0, sr = 0, sb = 0;
  const ecc = (m) => (m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E));
  for (const [d, m, mp, ff, l, r] of LR) {
    const arg = d * D + m * M + mp * Mp + ff * F;
    const e = ecc(m);
    sl += l * e * sin(arg);
    sr += r * e * cos(arg);
  }
  for (const [d, m, mp, ff, b] of B) sb += b * ecc(m) * sin(d * D + m * M + mp * Mp + ff * F);
  const A1 = 119.75 + 131.849 * T, A2 = 53.09 + 479264.290 * T, A3 = 313.45 + 481266.484 * T;
  sl += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2);
  sb += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
    + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp);
  return { lambda: rev(Lp + sl / 1e6), beta: sb / 1e6, distanceKm: 385000.56 + sr / 1000 };
}

// Main nutation terms (Meeus ch. 22, ~0.5" in Δψ) and the true obliquity.
function nutation(T, Om) {
  const Ls = 280.4665 + 36000.7698 * T, Lm = 218.3165 + 481267.8813 * T;
  const dpsi = (-17.20 * sin(Om) - 1.32 * sin(2 * Ls) - 0.23 * sin(2 * Lm) + 0.21 * sin(2 * Om)) / 3600;
  const deps = (9.20 * cos(Om) + 0.57 * cos(2 * Ls) + 0.10 * cos(2 * Lm) - 0.09 * cos(2 * Om)) / 3600;
  const eps0 = 23.4392911 - 0.0130042 * T - 1.64e-7 * T * T + 5.036e-7 * T ** 3;
  return { dpsi, eps: eps0 + deps };
}

// Apparent ecliptic longitude and distance of the Sun (Meeus ch. 25, ~0.01°).
function sunEcliptic(T) {
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const e = 0.016708634 - 0.000042037 * T - 0.0000001267 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  const R = 1.000001018 * (1 - e * e) / (1 + e * cos(M + C));
  const om = 125.04 - 1934.136 * T;
  return { lambda: rev(L0 + C - 0.00569 - 0.00478 * sin(om)), distanceKm: R * AU_KM };
}

function eclipticToEquatorial(lambda, beta, eps) {
  const ra = Math.atan2(sin(lambda) * cos(eps) - Math.tan(beta * RAD) * sin(eps), cos(lambda)) * DEG;
  const dec = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda)) * DEG;
  return { ra: rev(ra), dec };
}

function equatorialToEcliptic(ra, dec, eps) {
  const lambda = Math.atan2(sin(ra) * cos(eps) + Math.tan(dec * RAD) * sin(eps), cos(ra)) * DEG;
  const beta = Math.asin(sin(dec) * cos(eps) - cos(dec) * sin(eps) * sin(ra)) * DEG;
  return { lambda: rev(lambda), beta };
}

// Apparent sidereal time at Greenwich, degrees (Meeus 12.4 + equation of
// the equinoxes).
function siderealDeg(jd, dpsi, eps) {
  const T = (jd - 2451545) / 36525;
  return rev(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T
    - T ** 3 / 38710000 + dpsi * cos(eps));
}

// Shift a geocentric (ra, dec, distance) to an observer on the surface
// (vector subtraction; Earth taken as a sphere — the error is ~0.2% of the
// ~1° parallax).
function topocentric({ ra, dec, distanceKm }, lat, lon, lst) {
  const x = distanceKm * cos(dec) * cos(ra) - EARTH_RADIUS_KM * cos(lat) * cos(lst);
  const y = distanceKm * cos(dec) * sin(ra) - EARTH_RADIUS_KM * cos(lat) * sin(lst);
  const z = distanceKm * sin(dec) - EARTH_RADIUS_KM * sin(lat);
  const d = Math.hypot(x, y, z);
  return { ra: rev(Math.atan2(y, x) * DEG), dec: Math.asin(z / d) * DEG, distanceKm: d };
}

// Physical libration terms (Meeus ch. 53): ρ, σ, τ in degrees.
function physical(T, f) {
  const { D, M, Mp, F, Om, E } = f;
  const K1 = 119.75 + 131.849 * T, K2 = 72.56 + 20.186 * T;
  const rho = -0.02752 * cos(Mp) - 0.02245 * sin(F) + 0.00684 * cos(Mp - 2 * F)
    - 0.00293 * cos(2 * F) - 0.00085 * cos(2 * F - 2 * D) - 0.00054 * cos(Mp - 2 * D)
    - 0.00020 * sin(Mp + F) - 0.00020 * cos(Mp + 2 * F) - 0.00020 * cos(Mp - F)
    + 0.00014 * cos(Mp + 2 * F - 2 * D);
  const sigma = -0.02816 * sin(Mp) + 0.02244 * cos(F) - 0.00682 * sin(Mp - 2 * F)
    - 0.00279 * sin(2 * F) - 0.00083 * sin(2 * F - 2 * D) + 0.00069 * sin(Mp - 2 * D)
    + 0.00040 * cos(Mp + F) - 0.00025 * sin(2 * Mp) - 0.00023 * sin(Mp + 2 * F)
    + 0.00020 * cos(Mp - F) + 0.00019 * sin(Mp - F) + 0.00013 * sin(Mp + 2 * F - 2 * D)
    - 0.00010 * cos(Mp - 3 * F);
  const tau = 0.02520 * E * sin(M) + 0.00473 * sin(2 * Mp - 2 * F) - 0.00467 * sin(Mp)
    + 0.00396 * sin(K1) + 0.00276 * sin(2 * Mp - 2 * D) + 0.00196 * sin(Om)
    - 0.00183 * cos(Mp - F) + 0.00115 * sin(Mp - 2 * D) - 0.00096 * sin(Mp - D)
    + 0.00046 * sin(2 * F - 2 * D) - 0.00039 * sin(Mp - F) - 0.00032 * sin(Mp - M - D)
    + 0.00027 * sin(2 * Mp - M - 2 * D) + 0.00023 * sin(K2) - 0.00014 * sin(2 * D)
    + 0.00014 * cos(2 * Mp - 2 * F) - 0.00012 * sin(Mp - 2 * F) - 0.00012 * sin(2 * Mp)
    + 0.00011 * sin(2 * Mp - 2 * M - 2 * D);
  return { rho, sigma, tau };
}

// Selenographic longitude / latitude of the point under a body seen from
// the Moon in ecliptic direction (lambda, beta) — the libration formulas.
function selenographic(lambda, beta, f, phys) {
  const W = lambda - f.Om;
  const A = Math.atan2(sin(W) * cos(beta) * cos(INCLINATION) - sin(beta) * sin(INCLINATION),
    cos(W) * cos(beta)) * DEG;
  const lp = A - f.F;
  const bp = Math.asin(-sin(W) * cos(beta) * sin(INCLINATION) - sin(beta) * cos(INCLINATION)) * DEG;
  const lpp = -phys.tau + (phys.rho * cos(A) + phys.sigma * sin(A)) * Math.tan(bp * RAD);
  const bpp = phys.sigma * cos(A) - phys.rho * sin(A);
  return { l: rev(lp + lpp + 180) - 180, b: bp + bpp };
}

// Everything about the Moon's face at `date` (a Date, UTC instant).
// `observer` = { lat, lon } (degrees, east-positive) makes it topocentric.
function moonFace(date, observer = null) {
  const jde = julianEphemerisDay(date);
  const T = (jde - 2451545) / 36525;
  const f = fundamentals(T);
  const phys = physical(T, f);
  const { dpsi, eps } = nutation(T, f.Om);

  const geo = moonEcliptic(T, f);
  let moonEq = { ...eclipticToEquatorial(geo.lambda + dpsi, geo.beta, eps), distanceKm: geo.distanceKm };
  let lambda = geo.lambda, beta = geo.beta; // geometric, as the libration formulas want
  const topo = observer && Number.isFinite(observer.lat) && Number.isFinite(observer.lon);
  if (topo) {
    moonEq = topocentric(moonEq, observer.lat, observer.lon, siderealDeg(jde, dpsi, eps) + observer.lon);
    const ec = equatorialToEcliptic(moonEq.ra, moonEq.dec, eps);
    lambda = ec.lambda - dpsi;
    beta = ec.beta;
  }

  const { l, b } = selenographic(lambda, beta, f, phys);

  // Position angle of the Moon's north pole, east of celestial north.
  const V = f.Om + dpsi + phys.sigma / sin(INCLINATION);
  const X = sin(INCLINATION + phys.rho) * sin(V);
  const Y = sin(INCLINATION + phys.rho) * cos(V) * cos(eps) - cos(INCLINATION + phys.rho) * sin(eps);
  const omega = Math.atan2(X, Y) * DEG;
  const P = Math.asin(Math.max(-1, Math.min(1, Math.hypot(X, Y) * cos(moonEq.ra - omega) / cos(b)))) * DEG;

  // Sun: selenographic sub-solar point (Meeus 53: heliocentric direction
  // of the Moon), bright limb and phase (Meeus 48).
  const sun = sunEcliptic(T);
  const ratio = geo.distanceKm / sun.distanceKm;
  const lambdaH = sun.lambda + 180 + ratio * DEG * cos(geo.beta) * sin(sun.lambda - geo.lambda);
  const betaH = ratio * geo.beta;
  const sub = selenographic(lambdaH - dpsi, betaH, f, phys);
  const sunEq = eclipticToEquatorial(sun.lambda, 0, eps);
  const dRa = sunEq.ra - moonEq.ra;
  const chi = rev(Math.atan2(cos(sunEq.dec) * sin(dRa),
    sin(sunEq.dec) * cos(moonEq.dec) - cos(sunEq.dec) * sin(moonEq.dec) * cos(dRa)) * DEG);
  const cosPsi = sin(sunEq.dec) * sin(moonEq.dec) + cos(sunEq.dec) * cos(moonEq.dec) * cos(dRa);
  const psi = Math.acos(Math.max(-1, Math.min(1, cosPsi)));
  const phaseAngle = Math.atan2(sun.distanceKm * Math.sin(psi), moonEq.distanceKm - sun.distanceKm * Math.cos(psi));
  // Waxing while the Moon is less than 180° east of the Sun in longitude.
  const waxing = rev(geo.lambda - sun.lambda) < 180;

  return {
    libration: { l, b },
    positionAngle: P,
    sun: { l: sub.l, b: sub.b, colongitude: rev(90 - sub.l) },
    brightLimb: chi,
    illuminated: (1 + Math.cos(phaseAngle)) / 2,
    waxing,
    moon: { ra: moonEq.ra, dec: moonEq.dec, distanceKm: moonEq.distanceKm, lambda: geo.lambda, beta: geo.beta },
    topocentric: !!topo,
  };
}

module.exports = { moonFace, julianEphemerisDay };
