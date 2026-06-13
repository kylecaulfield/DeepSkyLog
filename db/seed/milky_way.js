// Wide-field Milky Way starscapes the Seestar S30 Pro can frame as
// mosaics. Each entry pairs a familiar wide-field name with the
// canonical Seestar-app target you actually slew to — the framing is
// implicit, but the catalog reference is something the Seestar's tour
// or 'Sky Atlas' will recognise. Cross-list aliases link these back
// to the Messier / Caldwell / Sharpless entries so uploading a wide
// shot of NGC 7000 ticks both lists.

const MILKY_WAY_WIDE = [
  // Summer Milky Way — Sagittarius and Cygnus.
  { catalog: 'MWWF', catalogNumber: '1',  name: 'Sagittarius Teapot pour · slew to M8 (Lagoon)',         type: 'DN', ra: 18.0606, dec: -24.3867, mag: 6.0,  constellation: 'Sagittarius', aliases: ['M8',  'NGC 6523'] },
  { catalog: 'MWWF', catalogNumber: '2',  name: 'Sagittarius Star Cloud · slew to M24',                  type: 'MW', ra: 18.3000, dec: -18.4500, mag: 4.6,  constellation: 'Sagittarius', aliases: ['M24'] },
  { catalog: 'MWWF', catalogNumber: '3',  name: 'Rho Ophiuchi colour field · slew to Antares',           type: 'MW', ra: 16.4900, dec: -26.4300, mag: 1.0,  constellation: 'Ophiuchus',   aliases: ['Antares'] },
  { catalog: 'MWWF', catalogNumber: '4',  name: 'Cygnus Sadr region · slew to NGC 6888 (Crescent)',      type: 'DN', ra: 20.2000, dec: 38.3550,  mag: 7.4,  constellation: 'Cygnus',      aliases: ['NGC 6888', 'C27'] },
  { catalog: 'MWWF', catalogNumber: '5',  name: 'North America + Pelican · slew to NGC 7000',            type: 'DN', ra: 20.9800, dec: 44.3400,  mag: 4.0,  constellation: 'Cygnus',      aliases: ['NGC 7000', 'IC 5070', 'C20'] },
  { catalog: 'MWWF', catalogNumber: '6',  name: 'Veil Nebula loop · slew to NGC 6960 (Western Veil)',    type: 'SNR', ra: 20.7600, dec: 30.5950, mag: 7.0,  constellation: 'Cygnus',      aliases: ['NGC 6960', 'NGC 6992', 'C33', 'C34'] },

  // Autumn / winter Milky Way — Cassiopeia, Perseus, Auriga, Orion.
  { catalog: 'MWWF', catalogNumber: '7',  name: 'Heart + Soul nebulae · slew to IC 1805 (Heart)',        type: 'DN', ra: 2.5567,  dec: 61.4500,  mag: 6.5,  constellation: 'Cassiopeia',  aliases: ['IC 1805', 'IC 1848'] },
  { catalog: 'MWWF', catalogNumber: '8',  name: 'Cassiopeia Pacman region · slew to NGC 281',            type: 'DN', ra: 0.8867,  dec: 56.6233,  mag: 7.4,  constellation: 'Cassiopeia',  aliases: ['NGC 281'] },
  { catalog: 'MWWF', catalogNumber: '9',  name: 'Perseus Double Cluster · slew to NGC 869',              type: 'OC', ra: 2.3300,  dec: 57.1000,  mag: 4.3,  constellation: 'Perseus',     aliases: ['NGC 869', 'NGC 884', 'C14'] },
  { catalog: 'MWWF', catalogNumber: '10', name: 'California + Pleiades wide · slew to NGC 1499',         type: 'DN', ra: 4.0333,  dec: 36.4167,  mag: 5.0,  constellation: 'Perseus',     aliases: ['NGC 1499', 'C41'] },
  { catalog: 'MWWF', catalogNumber: '11', name: 'Auriga emission complex · slew to IC 405 (Flaming Star)', type: 'DN', ra: 5.2828, dec: 34.3333, mag: 6.0,  constellation: 'Auriga',      aliases: ['IC 405', 'IC 410', 'C31'] },
  { catalog: 'MWWF', catalogNumber: '12', name: "Orion's belt + Barnard's Loop · slew to M42",           type: 'DN', ra: 5.5881,  dec: -5.3911,  mag: 4.0,  constellation: 'Orion',       aliases: ['M42', 'NGC 1976'] },
  { catalog: 'MWWF', catalogNumber: '13', name: 'Rosette + Cone wide · slew to NGC 2237 (Rosette)',      type: 'DN', ra: 6.5358,  dec: 4.9500,   mag: 6.0,  constellation: 'Monoceros',   aliases: ['NGC 2237', 'NGC 2264', 'C49', 'C50'] },
];

module.exports = { MILKY_WAY_WIDE };
