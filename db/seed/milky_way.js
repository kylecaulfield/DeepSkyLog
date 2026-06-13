// Wide-field Milky Way starscapes the Seestar S30 Pro (and S30) can
// frame in mosaic mode. These are the canonical "wide" shots that
// don't fit in the S50's 1.3°×0.7° single frame but suit the
// 2.1°×1.2° S30 / S30 Pro window — or stitch nicely via mosaic.
// Each entry uses the brightest contributing catalog id; the cross-
// list alias graph ties them back to Messier / Caldwell / Sharpless.

const MILKY_WAY_WIDE = [
  { catalog: 'MWWF', catalogNumber: '1',  name: 'Galactic Core (Sgr A* region)',     type: 'MW', ra: 17.7500, dec: -28.9400, mag: 1.0,  constellation: 'Sagittarius', aliases: [] },
  { catalog: 'MWWF', catalogNumber: '2',  name: 'Lagoon + Trifid wide field',        type: 'DN', ra: 18.0500, dec: -23.5000, mag: 5.5,  constellation: 'Sagittarius', aliases: ['M8', 'M20'] },
  { catalog: 'MWWF', catalogNumber: '3',  name: 'M24 Sagittarius Star Cloud',        type: 'MW', ra: 18.3000, dec: -18.4500, mag: 4.6,  constellation: 'Sagittarius', aliases: ['M24'] },
  { catalog: 'MWWF', catalogNumber: '4',  name: 'Rho Ophiuchi complex',              type: 'DN', ra: 16.4900, dec: -24.5000, mag: 5.0,  constellation: 'Ophiuchus',   aliases: [] },
  { catalog: 'MWWF', catalogNumber: '5',  name: 'Cygnus rift / Sadr region',         type: 'MW', ra: 20.3700, dec: 40.2500,  mag: 2.2,  constellation: 'Cygnus',      aliases: [] },
  { catalog: 'MWWF', catalogNumber: '6',  name: 'North America + Pelican',           type: 'DN', ra: 20.9000, dec: 44.3000,  mag: 4.0,  constellation: 'Cygnus',      aliases: ['NGC 7000', 'IC 5070', 'C20'] },
  { catalog: 'MWWF', catalogNumber: '7',  name: 'Veil Nebula loop',                  type: 'SNR', ra: 20.8300, dec: 30.7000, mag: 7.0,  constellation: 'Cygnus',      aliases: ['NGC 6960', 'NGC 6992', 'C33', 'C34'] },
  { catalog: 'MWWF', catalogNumber: '8',  name: 'Cassiopeia Heart + Soul',           type: 'DN', ra: 2.7300,  dec: 61.0000,  mag: 6.5,  constellation: 'Cassiopeia',  aliases: ['IC 1805', 'IC 1848'] },
  { catalog: 'MWWF', catalogNumber: '9',  name: 'Double Cluster + surrounds',        type: 'OC', ra: 2.3300,  dec: 57.1000,  mag: 4.3,  constellation: 'Perseus',     aliases: ['NGC 869', 'NGC 884', 'C14'] },
  { catalog: 'MWWF', catalogNumber: '10', name: 'California + Pleiades wide',        type: 'DN', ra: 3.8000,  dec: 30.0000,  mag: 5.5,  constellation: 'Perseus',     aliases: ['NGC 1499', 'M45', 'C41'] },
  { catalog: 'MWWF', catalogNumber: '11', name: 'Auriga IC 405 + IC 410',            type: 'DN', ra: 5.4500,  dec: 34.3000,  mag: 6.5,  constellation: 'Auriga',      aliases: ['IC 405', 'IC 410', 'C31'] },
  { catalog: 'MWWF', catalogNumber: '12', name: "Orion belt + Barnard's Loop",       type: 'DN', ra: 5.6000,  dec: -1.8000,  mag: 5.0,  constellation: 'Orion',       aliases: [] },
  { catalog: 'MWWF', catalogNumber: '13', name: 'Rosette + Cone wide field',         type: 'DN', ra: 6.6000,  dec: 6.0000,   mag: 6.0,  constellation: 'Monoceros',   aliases: ['NGC 2237', 'NGC 2264', 'C49', 'C50'] },
  { catalog: 'MWWF', catalogNumber: '14', name: 'Carina Nebula complex',             type: 'DN', ra: 10.7500, dec: -59.7000, mag: 3.0,  constellation: 'Carina',      aliases: ['NGC 3372', 'C92'] },
  { catalog: 'MWWF', catalogNumber: '15', name: 'Vela Supernova Remnant',            type: 'SNR', ra: 8.6000, dec: -45.2000, mag: 12.0, constellation: 'Vela',        aliases: [] },
];

module.exports = { MILKY_WAY_WIDE };
