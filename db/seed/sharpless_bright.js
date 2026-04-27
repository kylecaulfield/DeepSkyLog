// Bright HII regions from Stewart Sharpless's 1959 catalog. Sh2 has 313
// entries but most are too faint and diffuse for a small smart scope; this
// is a curated subset of the brightest, most-photographed Sh2 emission
// nebulae that an S50/S30 can render.

const SHARPLESS_BRIGHT = [
  { catalog: 'Sh2', catalogNumber: '155', name: 'Cave Nebula',          type: 'DN', ra: 22.9550, dec: 62.6167,  mag: 7.7,  constellation: 'Cepheus',     aliases: ['C9'] },
  { catalog: 'Sh2', catalogNumber: '157', name: 'Lobster Claw Nebula',  type: 'DN', ra: 23.2575, dec: 60.4575,  mag: 7.0,  constellation: 'Cassiopeia',  aliases: [] },
  { catalog: 'Sh2', catalogNumber: '162', name: 'Bubble Nebula',        type: 'DN', ra: 23.3439, dec: 61.2008,  mag: 11.0, constellation: 'Cassiopeia',  aliases: ['NGC 7635', 'C11'] },
  { catalog: 'Sh2', catalogNumber: '171', name: "Wizard / NGC 7380",    type: 'DN', ra: 22.7917, dec: 58.1167,  mag: 7.2,  constellation: 'Cepheus',     aliases: ['NGC 7380'] },
  { catalog: 'Sh2', catalogNumber: '184', name: 'Pacman Nebula',        type: 'DN', ra: 0.8867,  dec: 56.6233,  mag: 7.4,  constellation: 'Cassiopeia',  aliases: ['NGC 281'] },
  { catalog: 'Sh2', catalogNumber: '199', name: 'Soul Nebula',          type: 'DN', ra: 2.9333,  dec: 60.4500,  mag: 6.5,  constellation: 'Cassiopeia',  aliases: ['IC 1848'] },
  { catalog: 'Sh2', catalogNumber: '190', name: 'Heart Nebula',         type: 'DN', ra: 2.5567,  dec: 61.4500,  mag: 6.5,  constellation: 'Cassiopeia',  aliases: ['IC 1805'] },
  { catalog: 'Sh2', catalogNumber: '220', name: 'California Nebula',    type: 'DN', ra: 4.0333,  dec: 36.4167,  mag: 5.0,  constellation: 'Perseus',     aliases: ['NGC 1499'] },
  { catalog: 'Sh2', catalogNumber: '232', name: 'Flaming Star Nebula',  type: 'DN', ra: 5.2828,  dec: 34.3333,  mag: 6.0,  constellation: 'Auriga',      aliases: ['IC 405', 'C31'] },
  { catalog: 'Sh2', catalogNumber: '236', name: 'Tadpole Nebula',       type: 'DN', ra: 5.6233,  dec: 34.2483,  mag: 7.7,  constellation: 'Auriga',      aliases: ['IC 410'] },
  { catalog: 'Sh2', catalogNumber: '264', name: 'Lambda Orionis Ring',  type: 'DN', ra: 5.5833,  dec: 9.9333,   mag: 5.0,  constellation: 'Orion',       aliases: [] },
  { catalog: 'Sh2', catalogNumber: '276', name: "Barnard's Loop",       type: 'DN', ra: 5.5333,  dec: -1.8333,  mag: 5.0,  constellation: 'Orion',       aliases: [] },
  { catalog: 'Sh2', catalogNumber: '275', name: 'Orion Nebula (Sh2)',   type: 'DN', ra: 5.5881,  dec: -5.3911,  mag: 4.0,  constellation: 'Orion',       aliases: ['M42', 'NGC 1976'] },
  { catalog: 'Sh2', catalogNumber: '252', name: 'Monkey Head Nebula',   type: 'DN', ra: 6.1583,  dec: 20.5000,  mag: 6.8,  constellation: 'Orion',       aliases: ['NGC 2174'] },
  { catalog: 'Sh2', catalogNumber: '275b', name: "De Mairan's Nebula",  type: 'DN', ra: 5.5925,  dec: -5.2700,  mag: 9.0,  constellation: 'Orion',       aliases: ['M43', 'NGC 1982'] },
  { catalog: 'Sh2', catalogNumber: '273', name: 'Cone Nebula region',   type: 'DN', ra: 6.6750,  dec: 9.8833,   mag: 4.1,  constellation: 'Monoceros',   aliases: ['NGC 2264'] },
  { catalog: 'Sh2', catalogNumber: '275c', name: 'Rosette Nebula',      type: 'DN', ra: 6.5358,  dec: 4.9500,   mag: 9.0,  constellation: 'Monoceros',   aliases: ['NGC 2237', 'C49'] },
  { catalog: 'Sh2', catalogNumber: '298', name: 'Seagull Nebula',       type: 'DN', ra: 7.0583,  dec: -10.6667, mag: 7.0,  constellation: 'Monoceros',   aliases: ['IC 2177'] },
  { catalog: 'Sh2', catalogNumber: '308', name: 'Dolphin Nebula',       type: 'DN', ra: 6.9039,  dec: -25.1467, mag: 11.0, constellation: 'Canis Major', aliases: [] },
  { catalog: 'Sh2', catalogNumber: '25',  name: 'Lagoon (Sh2-25)',      type: 'DN', ra: 18.0606, dec: -24.3867, mag: 6.0,  constellation: 'Sagittarius', aliases: ['M8',  'NGC 6523'] },
  { catalog: 'Sh2', catalogNumber: '30',  name: 'Trifid (Sh2-30)',      type: 'DN', ra: 18.0353, dec: -23.0300, mag: 6.3,  constellation: 'Sagittarius', aliases: ['M20', 'NGC 6514'] },
  { catalog: 'Sh2', catalogNumber: '45',  name: 'Omega (Sh2-45)',       type: 'DN', ra: 18.3461, dec: -16.1717, mag: 6.0,  constellation: 'Sagittarius', aliases: ['M17', 'NGC 6618'] },
  { catalog: 'Sh2', catalogNumber: '49',  name: 'Eagle (Sh2-49)',       type: 'DN', ra: 18.3122, dec: -13.7833, mag: 6.0,  constellation: 'Serpens',     aliases: ['M16', 'NGC 6611'] },
  { catalog: 'Sh2', catalogNumber: '101', name: 'Tulip Nebula',         type: 'DN', ra: 20.0167, dec: 35.3000,  mag: 9.0,  constellation: 'Cygnus',      aliases: [] },
  { catalog: 'Sh2', catalogNumber: '105', name: 'Crescent Nebula',      type: 'DN', ra: 20.2000, dec: 38.3550,  mag: 7.4,  constellation: 'Cygnus',      aliases: ['NGC 6888', 'C27'] },
  { catalog: 'Sh2', catalogNumber: '117', name: 'North America Nebula', type: 'DN', ra: 20.9800, dec: 44.3400,  mag: 4.0,  constellation: 'Cygnus',      aliases: ['NGC 7000', 'C20'] },
  { catalog: 'Sh2', catalogNumber: '119', name: 'Pelican Nebula',       type: 'DN', ra: 20.8333, dec: 44.3500,  mag: 8.0,  constellation: 'Cygnus',      aliases: ['IC 5070'] },
  { catalog: 'Sh2', catalogNumber: '125', name: 'Cocoon Nebula',        type: 'DN', ra: 21.8872, dec: 47.2700,  mag: 7.2,  constellation: 'Cygnus',      aliases: ['IC 5146', 'C19'] },
  { catalog: 'Sh2', catalogNumber: '134', name: 'NGC 7822',             type: 'DN', ra: 0.0633,  dec: 67.8167,  mag: 6.5,  constellation: 'Cepheus',     aliases: ['NGC 7822'] },
];

module.exports = { SHARPLESS_BRIGHT };
