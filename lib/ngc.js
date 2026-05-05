// NGC/IC catalog lookup. Backs the upload form's "did you mean…" path when
// the user types something that isn't in any seeded list. Bundled from the
// public-domain OpenNGC dataset; the JSON file is stripped to objects with
// magnitude ≤ 14 (or unknown) to keep the install footprint small.
//
// Each row: [name, type, raStr, decStr, constellation, magnitude, commonNames]
// e.g.     ["NGC1976", "Cl+N", "05:35:17.30", "-05:23:25.0", "Ori", 4.0, "M42,Orion Nebula"]

const fs = require('node:fs');
const path = require('node:path');

let CACHE = null;          // { byKey: Map, all: [] }

function load() {
  if (CACHE) return CACHE;
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed', 'ngc.json'), 'utf8');
  const all = JSON.parse(raw);
  const byKey = new Map();
  for (const row of all) {
    const [name, , , , , , common] = row;
    byKey.set(normalise(name), row);
    // Also index common names (M42, Orion Nebula, etc.) so lookup works
    // for the names users actually type.
    for (const alias of String(common || '').split(',')) {
      const k = normalise(alias);
      if (k && !byKey.has(k)) byKey.set(k, row);
    }
  }
  CACHE = { byKey, all };
  return CACHE;
}

function normalise(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, '').trim();
}

// "05:35:17.30" -> 5.587..  (decimal hours)
function parseRaHours(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d+):([\d.]+)/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
}
// "+05:23:25.0" / "-05:23:25.0" -> decimal degrees
function parseDecDeg(s) {
  if (!s) return null;
  const m = String(s).match(/^([+\-]?)(\d+):(\d+):([\d.]+)/);
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600);
}

// OpenNGC type codes -> our compact OBJECT_TYPES vocabulary.
const TYPE_MAP = {
  G: 'GAL', GPair: 'GAL', GTrpl: 'GAL', GGroup: 'GAL',
  OCl: 'OC', GCl: 'GC',
  PN: 'PN', SNR: 'SNR',
  HII: 'DN', EmN: 'DN', Neb: 'DN', RfN: 'DN', DrkN: 'DN', 'Cl+N': 'DN',
  Star: 'STAR', '**': 'DS',
};

function lookup(query) {
  if (!query) return null;
  const { byKey } = load();
  const row = byKey.get(normalise(query));
  if (!row) return null;
  const [name, type, ra, dec, constellation, magnitude] = row;
  const m = name.match(/^([A-Z]+)0*(\d+[A-Za-z]?)$/);
  return {
    catalog: m ? m[1] : name,
    catalog_number: m ? m[2] : '',
    name,
    object_type: TYPE_MAP[type] || null,
    constellation: constellation || null,
    ra_hours: parseRaHours(ra),
    dec_degrees: parseDecDeg(dec),
    magnitude: magnitude == null ? null : Number(magnitude),
    source: 'OpenNGC',
  };
}

module.exports = { lookup };
