// Low-precision ephemeris for the Sun, Moon and the 8 major planets.
// Formulas adapted from Paul Schlyter's "How to compute planetary positions"
// (https://stjarnhimlen.se/comp/ppcomp.html). Accuracy is roughly:
//   Sun:     ~0.01° in RA/Dec
//   Moon:    ~0.05°
//   Planets: ~1–2 arcmin
// — fine for "is Saturn up tonight?" planning, not for plate solving.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function rev(x) {
  let v = x % 360;
  if (v < 0) v += 360;
  return v;
}

// Schlyter's "d" — days since 1999-12-31 00:00 UT.
function schlyterDay(date) {
  return date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_543.5;
}

// Solve Kepler's equation for eccentric anomaly E given M (deg) and e.
function kepler(M, e) {
  let E = M + (e * DEG) * Math.sin(M * RAD) * (1 + e * Math.cos(M * RAD));
  for (let i = 0; i < 8; i++) {
    const dE = (E - (e * DEG) * Math.sin(E * RAD) - M)
             / (1 - e * Math.cos(E * RAD));
    E -= dE;
    if (Math.abs(dE) < 1e-6) break;
  }
  return E;
}

function obliquity(d) {
  return 23.4393 - 3.563e-7 * d;
}

// Returns heliocentric position {x,y,z,r} in AU using Schlyter elements.
function heliocentric(elements, d) {
  const N = rev(elements.N0 + elements.Nd * d);
  const i = elements.i0 + elements.id * d;
  const w = rev(elements.w0 + elements.wd * d);
  const a = elements.a0 + elements.ad * d;
  const e = elements.e0 + elements.ed * d;
  const M = rev(elements.M0 + elements.Md * d);

  const E = kepler(M, e);
  const xv = a * (Math.cos(E * RAD) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const v = rev(Math.atan2(yv, xv) * DEG);
  const r = Math.sqrt(xv * xv + yv * yv);
  const lon = rev(v + w);

  const xh = r * (Math.cos(N * RAD) * Math.cos(lon * RAD)
                - Math.sin(N * RAD) * Math.sin(lon * RAD) * Math.cos(i * RAD));
  const yh = r * (Math.sin(N * RAD) * Math.cos(lon * RAD)
                + Math.cos(N * RAD) * Math.sin(lon * RAD) * Math.cos(i * RAD));
  const zh = r * Math.sin(lon * RAD) * Math.sin(i * RAD);
  return { x: xh, y: yh, z: zh, r };
}

// Schlyter's planetary elements at epoch d=0 (1999-12-31 00h UT).
const ELEMENTS = {
  mercury: { N0: 48.3313, Nd: 3.24587e-5, i0: 7.0047,  id: 5.00e-8,    w0: 29.1241,  wd: 1.01444e-5, a0: 0.387098, ad: 0,        e0: 0.205635, ed: 5.59e-10,  M0: 168.6562, Md: 4.0923344368 },
  venus:   { N0: 76.6799, Nd: 2.46590e-5, i0: 3.3946,  id: 2.75e-8,    w0: 54.8910,  wd: 1.38374e-5, a0: 0.723330, ad: 0,        e0: 0.006773, ed: -1.302e-9, M0: 48.0052,  Md: 1.6021302244 },
  mars:    { N0: 49.5574, Nd: 2.11081e-5, i0: 1.8497,  id: -1.78e-8,   w0: 286.5016, wd: 2.92961e-5, a0: 1.523688, ad: 0,        e0: 0.093405, ed: 2.516e-9,  M0: 18.6021,  Md: 0.5240207766 },
  jupiter: { N0: 100.4542, Nd: 2.76854e-5, i0: 1.3030, id: -1.557e-7,  w0: 273.8777, wd: 1.64505e-5, a0: 5.20256,  ad: 0,        e0: 0.048498, ed: 4.469e-9,  M0: 19.8950,  Md: 0.0830853001 },
  saturn:  { N0: 113.6634, Nd: 2.38980e-5, i0: 2.4886, id: -1.081e-7,  w0: 339.3939, wd: 2.97661e-5, a0: 9.55475,  ad: 0,        e0: 0.055546, ed: -9.499e-9, M0: 316.9670, Md: 0.0334442282 },
  uranus:  { N0: 74.0005,  Nd: 1.3978e-5,  i0: 0.7733, id: 1.9e-8,     w0: 96.6612,  wd: 3.0565e-5,  a0: 19.18171, ad: -1.55e-8, e0: 0.047318, ed: 7.45e-9,   M0: 142.5905, Md: 0.011725806  },
  neptune: { N0: 131.7806, Nd: 3.0173e-5,  i0: 1.7700, id: -2.55e-7,   w0: 272.8461, wd: -6.027e-6,  a0: 30.05826, ad: 3.313e-8, e0: 0.008606, ed: 2.15e-9,   M0: 260.2471, Md: 0.005995147  },
};

// Sun's geocentric position vector (also = -Earth's heliocentric).
function sunVector(date) {
  const d = schlyterDay(date);
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = rev(356.0470 + 0.9856002585 * d);
  const E = kepler(M, e);
  const xv = Math.cos(E * RAD) - e;
  const yv = Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const v = rev(Math.atan2(yv, xv) * DEG);
  const r = Math.sqrt(xv * xv + yv * yv);
  const lon = rev(v + w);
  return {
    x: r * Math.cos(lon * RAD),
    y: r * Math.sin(lon * RAD),
    z: 0,
    r, lon,
  };
}

function equatorialFromEcliptic(x, y, z, d) {
  const ecl = obliquity(d) * RAD;
  const xe = x;
  const ye = y * Math.cos(ecl) - z * Math.sin(ecl);
  const ze = y * Math.sin(ecl) + z * Math.cos(ecl);
  let ra = Math.atan2(ye, xe) * DEG;
  if (ra < 0) ra += 360;
  const dec = Math.atan2(ze, Math.sqrt(xe * xe + ye * ye)) * DEG;
  return { raHours: ra / 15, decDeg: dec };
}

function ephemerisSun(date) {
  const d = schlyterDay(date);
  const s = sunVector(date);
  return { ...equatorialFromEcliptic(s.x, s.y, s.z, d), magnitude: -26.7 };
}

// Moon: Schlyter elements with the largest perturbation terms.
function ephemerisMoon(date) {
  const d = schlyterDay(date);
  const N = rev(125.1228 - 0.0529538083 * d);
  const i = 5.1454;
  const w = rev(318.0634 + 0.1643573223 * d);
  const a = 60.2666; // Earth radii
  const e = 0.054900;
  const M = rev(115.3654 + 13.0649929509 * d);

  const E = kepler(M, e);
  const xv = a * (Math.cos(E * RAD) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E * RAD);
  const v = rev(Math.atan2(yv, xv) * DEG);
  const r = Math.sqrt(xv * xv + yv * yv);
  const lon = rev(v + w);

  let xh = r * (Math.cos(N * RAD) * Math.cos(lon * RAD)
              - Math.sin(N * RAD) * Math.sin(lon * RAD) * Math.cos(i * RAD));
  let yh = r * (Math.sin(N * RAD) * Math.cos(lon * RAD)
              + Math.cos(N * RAD) * Math.sin(lon * RAD) * Math.cos(i * RAD));
  let zh = r * Math.sin(lon * RAD) * Math.sin(i * RAD);

  // Top-tier perturbations to lift accuracy from ~2° to ~0.05°.
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ls = rev(ws + Ms);
  const Lm = rev(N + w + M);
  const D = rev(Lm - Ls);
  const F = rev(Lm - N);

  let lonG = Math.atan2(yh, xh) * DEG;
  let latG = Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * DEG;
  let rG = Math.sqrt(xh * xh + yh * yh + zh * zh);

  lonG += -1.274 * Math.sin((M - 2 * D) * RAD)
        +  0.658 * Math.sin(2 * D * RAD)
        + -0.186 * Math.sin(Ms * RAD)
        + -0.059 * Math.sin((2 * M - 2 * D) * RAD)
        + -0.057 * Math.sin((M - 2 * D + Ms) * RAD)
        +  0.053 * Math.sin((M + 2 * D) * RAD)
        +  0.046 * Math.sin((2 * D - Ms) * RAD)
        +  0.041 * Math.sin((M - Ms) * RAD)
        + -0.035 * Math.sin(D * RAD)
        + -0.031 * Math.sin((M + Ms) * RAD);
  latG += -0.173 * Math.sin((F - 2 * D) * RAD)
        + -0.055 * Math.sin((M - F - 2 * D) * RAD)
        + -0.046 * Math.sin((M + F - 2 * D) * RAD)
        +  0.033 * Math.sin((F + 2 * D) * RAD)
        +  0.017 * Math.sin((2 * M + F) * RAD);
  rG += -0.58 * Math.cos((M - 2 * D) * RAD)
      + -0.46 * Math.cos(2 * D * RAD);

  xh = rG * Math.cos(lonG * RAD) * Math.cos(latG * RAD);
  yh = rG * Math.sin(lonG * RAD) * Math.cos(latG * RAD);
  zh = rG * Math.sin(latG * RAD);

  return { ...equatorialFromEcliptic(xh, yh, zh, d), magnitude: -12.7 };
}

const PLANET_MAG = {
  mercury: { H: -0.36, ph: 0.027, ph3: 2.2e-13 },
  venus:   { H: -4.34, ph: 0.013, ph3: 4.2e-7 },
  mars:    { H: -1.51, ph: 0.016 },
  jupiter: { H: -9.25, ph: 0.014 },
  saturn:  { H: -9.0 },
  uranus:  { H: -7.15, ph: 0.001 },
  neptune: { H: -6.90 },
};

function ephemerisPlanet(name, date) {
  const els = ELEMENTS[name];
  if (!els) return null;
  const d = schlyterDay(date);
  const sun = sunVector(date);
  const p = heliocentric(els, d);
  // Geocentric = heliocentric planet + Sun's geocentric vector.
  const xg = p.x + sun.x;
  const yg = p.y + sun.y;
  const zg = p.z;
  const eq = equatorialFromEcliptic(xg, yg, zg, d);

  const dist = Math.sqrt(xg * xg + yg * yg + zg * zg);
  const cosPh = (p.r * p.r + dist * dist - sun.r * sun.r) / (2 * p.r * dist);
  const phaseAngle = Math.acos(Math.max(-1, Math.min(1, cosPh))) * DEG;
  const m = PLANET_MAG[name] || {};
  let mag = null;
  if (m.H != null) {
    mag = m.H + 5 * Math.log10(p.r * dist);
    if (m.ph)  mag += m.ph * phaseAngle;
    if (m.ph3) mag += m.ph3 * phaseAngle * phaseAngle * phaseAngle;
  }
  return {
    ...eq,
    magnitude: mag != null ? Math.round(mag * 10) / 10 : null,
    phase_angle_deg: phaseAngle,
    distance_au: dist,
  };
}

function bodyPosition(name, date = new Date()) {
  switch ((name || '').toLowerCase()) {
    case 'sun':     return ephemerisSun(date);
    case 'moon':    return ephemerisMoon(date);
    case 'mercury':
    case 'venus':
    case 'mars':
    case 'jupiter':
    case 'saturn':
    case 'uranus':
    case 'neptune': return ephemerisPlanet(name.toLowerCase(), date);
    default:        return null;
  }
}

module.exports = { bodyPosition };
