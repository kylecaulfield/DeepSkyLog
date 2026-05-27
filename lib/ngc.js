// NGC/IC catalog lookup. Backs the upload form's "did you mean…" path when
// the user types something that isn't in any seeded list. Bundled from the
// public-domain OpenNGC dataset; the JSON file is stripped to objects with
// magnitude ≤ 14 (or unknown) to keep the install footprint small.
//
// Each row: [name, type, raStr, decStr, constellation, magnitude, commonNames]
// e.g.     ["NGC1976", "Cl+N", "05:35:17.30", "-05:23:25.0", "Ori", 4.0, "M42,Orion Nebula"]

const fs = require('node:fs');
const path = require('node:path');

let CACHE = null;          // { primary: Map, aliases: Map<key, row[]>, all: [] }

function load() {
  if (CACHE) return CACHE;
  const raw = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed', 'ngc.json'), 'utf8');
  const all = JSON.parse(raw);
  // primary  : normalised primary name  → row  (1:1)
  // aliases  : normalised common name   → row[] (1:N, multiple rows may share
  //            an alias like 'Veil Nebula'; we keep them all so callers can
  //            surface a 'did you mean…?' picker).
  const primary = new Map();
  const aliases = new Map();
  for (const row of all) {
    const [name, , , , , , common] = row;
    primary.set(normalise(name), row);
    for (const alias of String(common || '').split(',')) {
      const k = normalise(alias);
      if (!k) continue;
      // Don't shadow a primary key with a common-name alias.
      if (primary.has(k)) continue;
      const arr = aliases.get(k);
      if (arr) {
        if (!arr.includes(row)) arr.push(row);
      } else aliases.set(k, [row]);
    }
  }
  CACHE = { primary, aliases, all };
  return CACHE;
}

function normalise(s) {
  const upper = String(s || '').toUpperCase().replace(/\s+/g, '').trim();
  // OpenNGC stores names zero-padded ("IC0410", "NGC0001") but users type
  // the unpadded form ("IC410", "NGC1"). Strip leading zeros after the
  // alpha prefix so both representations collide on the same key.
  return upper.replace(/^([A-Z]+)0+(\d)/, '$1$2');
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

function rowToHit(row) {
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

function lookup(query) {
  if (!query) return null;
  const { primary, aliases } = load();
  const key = normalise(query);
  // Primary name match always wins.
  const direct = primary.get(key);
  if (direct) return rowToHit(direct);
  // Otherwise pick the brightest alias match, so 'Veil Nebula' picks
  // the brightest of the NGC 6960/6992/6995 trio rather than whichever
  // OpenNGC happened to list first.
  const matches = aliases.get(key);
  if (!matches || !matches.length) return null;
  const ranked = [...matches].sort((a, b) => {
    const ma = a[5] == null ? Infinity : Number(a[5]);
    const mb = b[5] == null ? Infinity : Number(b[5]);
    return ma - mb;
  });
  const hit = rowToHit(ranked[0]);
  // Surface the other candidates so the client can offer a picker.
  if (ranked.length > 1) {
    hit.alternates = ranked.slice(1, 6).map(rowToHit);
  }
  return hit;
}

module.exports = { lookup };
