// Finest NGC — a curated selection of bright non-Messier NGC and IC objects
// suited to small refractors and smart scopes (Seestar S50/S30 class).
// Each entry's `aliases` cross-references the same physical object as it
// appears in other built-in lists (Caldwell number primarily) so that an
// upload of e.g. C14 ticks the Double Cluster on this list too.

const FINEST_NGC = [
  // Andromeda
  { catalog: 'NGC', catalogNumber: '752',  name: 'Caldwell 28 Cluster',     type: 'OC',  ra: 1.9633,  dec: 37.7950,  mag: 5.7,  constellation: 'Andromeda',       aliases: ['C28'] },
  { catalog: 'NGC', catalogNumber: '891',  name: 'Silver Sliver Galaxy',    type: 'GAL', ra: 2.3756,  dec: 42.3494,  mag: 9.9,  constellation: 'Andromeda',       aliases: ['C23'] },
  // Aquarius
  { catalog: 'NGC', catalogNumber: '7009', name: 'Saturn Nebula',           type: 'PN',  ra: 21.0461, dec: -11.3628, mag: 8.0,  constellation: 'Aquarius',        aliases: ['C55'] },
  { catalog: 'NGC', catalogNumber: '7293', name: 'Helix Nebula',            type: 'PN',  ra: 22.4947, dec: -20.8378, mag: 7.3,  constellation: 'Aquarius',        aliases: ['C63'] },
  // Aries
  { catalog: 'NGC', catalogNumber: '772',  name: 'NGC 772',                 type: 'GAL', ra: 1.9928,  dec: 19.0067,  mag: 10.3, constellation: 'Aries',           aliases: [] },
  // Auriga
  { catalog: 'NGC', catalogNumber: '1907', name: 'NGC 1907',                type: 'OC',  ra: 5.4533,  dec: 35.3300,  mag: 8.2,  constellation: 'Auriga',          aliases: [] },
  { catalog: 'NGC', catalogNumber: '2281', name: 'NGC 2281',                type: 'OC',  ra: 6.8133,  dec: 41.0667,  mag: 5.4,  constellation: 'Auriga',          aliases: [] },
  // Boötes
  { catalog: 'NGC', catalogNumber: '5466', name: 'NGC 5466',                type: 'GC',  ra: 14.0908, dec: 28.5347,  mag: 9.2,  constellation: 'Boötes',          aliases: [] },
  // Camelopardalis
  { catalog: 'NGC', catalogNumber: '1502', name: 'NGC 1502',                type: 'OC',  ra: 4.1267,  dec: 62.3333,  mag: 5.7,  constellation: 'Camelopardalis',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '2403', name: 'NGC 2403',                type: 'GAL', ra: 7.6094,  dec: 65.6031,  mag: 8.4,  constellation: 'Camelopardalis',  aliases: ['C7'] },
  // Cancer
  { catalog: 'NGC', catalogNumber: '2683', name: 'UFO Galaxy',              type: 'GAL', ra: 8.8744,  dec: 33.4217,  mag: 9.7,  constellation: 'Lynx',            aliases: [] },
  { catalog: 'NGC', catalogNumber: '2775', name: 'NGC 2775',                type: 'GAL', ra: 9.1742,  dec: 7.0381,   mag: 10.3, constellation: 'Cancer',          aliases: ['C48'] },
  // Canes Venatici
  { catalog: 'NGC', catalogNumber: '4214', name: 'NGC 4214',                type: 'GAL', ra: 12.2622, dec: 36.3267,  mag: 9.8,  constellation: 'Canes Venatici',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '4244', name: 'Silver Needle Galaxy',    type: 'GAL', ra: 12.2947, dec: 37.8069,  mag: 10.4, constellation: 'Canes Venatici',  aliases: ['C26'] },
  { catalog: 'NGC', catalogNumber: '4449', name: 'NGC 4449',                type: 'GAL', ra: 12.4644, dec: 44.0956,  mag: 9.4,  constellation: 'Canes Venatici',  aliases: ['C21'] },
  { catalog: 'NGC', catalogNumber: '4490', name: 'Cocoon Galaxy',           type: 'GAL', ra: 12.5128, dec: 41.6444,  mag: 9.8,  constellation: 'Canes Venatici',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '4631', name: 'Whale Galaxy',            type: 'GAL', ra: 12.6092, dec: 32.5461,  mag: 9.8,  constellation: 'Canes Venatici',  aliases: ['C32'] },
  { catalog: 'NGC', catalogNumber: '4656', name: 'Hockey Stick Galaxy',     type: 'GAL', ra: 12.7392, dec: 32.1683,  mag: 10.5, constellation: 'Canes Venatici',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '5005', name: 'NGC 5005',                type: 'GAL', ra: 13.1819, dec: 37.0592,  mag: 9.8,  constellation: 'Canes Venatici',  aliases: ['C29'] },
  // Canis Major
  { catalog: 'NGC', catalogNumber: '2360', name: "Caroline's Cluster",      type: 'OC',  ra: 7.2972,  dec: -15.6167, mag: 7.2,  constellation: 'Canis Major',     aliases: ['C58'] },
  { catalog: 'NGC', catalogNumber: '2362', name: 'Tau Canis Majoris Cluster', type: 'OC', ra: 7.3092, dec: -24.9567, mag: 4.1,  constellation: 'Canis Major',     aliases: ['C64'] },
  // Cassiopeia
  { catalog: 'NGC', catalogNumber: '129',  name: 'NGC 129',                 type: 'OC',  ra: 0.5008,  dec: 60.2167,  mag: 6.5,  constellation: 'Cassiopeia',      aliases: [] },
  { catalog: 'NGC', catalogNumber: '281',  name: 'Pacman Nebula',           type: 'DN',  ra: 0.8867,  dec: 56.6233,  mag: 7.4,  constellation: 'Cassiopeia',      aliases: [] },
  { catalog: 'NGC', catalogNumber: '457',  name: 'Owl / ET Cluster',        type: 'OC',  ra: 1.3250,  dec: 58.3333,  mag: 6.4,  constellation: 'Cassiopeia',      aliases: ['C13'] },
  { catalog: 'NGC', catalogNumber: '559',  name: 'NGC 559',                 type: 'OC',  ra: 1.4617,  dec: 63.3000,  mag: 9.5,  constellation: 'Cassiopeia',      aliases: ['C8'] },
  { catalog: 'NGC', catalogNumber: '663',  name: 'NGC 663',                 type: 'OC',  ra: 1.7675,  dec: 61.2250,  mag: 7.1,  constellation: 'Cassiopeia',      aliases: ['C10'] },
  { catalog: 'NGC', catalogNumber: '7635', name: 'Bubble Nebula',           type: 'DN',  ra: 23.3439, dec: 61.2008,  mag: 11.0, constellation: 'Cassiopeia',      aliases: ['C11'] },
  { catalog: 'NGC', catalogNumber: '7789', name: "Caroline's Rose",         type: 'OC',  ra: 23.9700, dec: 56.7167,  mag: 6.7,  constellation: 'Cassiopeia',      aliases: [] },
  // Cepheus
  { catalog: 'NGC', catalogNumber: '40',   name: 'Bow-Tie Nebula',          type: 'PN',  ra: 0.2119,  dec: 72.5211,  mag: 11.6, constellation: 'Cepheus',         aliases: ['C2'] },
  { catalog: 'NGC', catalogNumber: '188',  name: 'NGC 188',                 type: 'OC',  ra: 0.7933,  dec: 85.2550,  mag: 8.1,  constellation: 'Cepheus',         aliases: ['C1'] },
  { catalog: 'NGC', catalogNumber: '6939', name: 'NGC 6939',                type: 'OC',  ra: 20.5292, dec: 60.6492,  mag: 7.8,  constellation: 'Cepheus',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '6946', name: 'Fireworks Galaxy',        type: 'GAL', ra: 20.5828, dec: 60.1531,  mag: 8.8,  constellation: 'Cepheus',         aliases: ['C12'] },
  { catalog: 'NGC', catalogNumber: '7023', name: 'Iris Nebula',             type: 'DN',  ra: 21.0150, dec: 68.1633,  mag: 6.8,  constellation: 'Cepheus',         aliases: ['C4'] },
  { catalog: 'NGC', catalogNumber: '7160', name: 'NGC 7160',                type: 'OC',  ra: 21.8956, dec: 62.5917,  mag: 6.1,  constellation: 'Cepheus',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '7510', name: 'NGC 7510',                type: 'OC',  ra: 23.1933, dec: 60.5667,  mag: 7.9,  constellation: 'Cepheus',         aliases: [] },
  // Cetus
  { catalog: 'NGC', catalogNumber: '246',  name: 'Skull Nebula',            type: 'PN',  ra: 0.7800,  dec: -11.8722, mag: 10.9, constellation: 'Cetus',           aliases: ['C56'] },
  { catalog: 'NGC', catalogNumber: '247',  name: 'Needle Eye Galaxy',       type: 'GAL', ra: 0.7872,  dec: -20.7583, mag: 9.1,  constellation: 'Cetus',           aliases: ['C62'] },
  { catalog: 'NGC', catalogNumber: '936',  name: 'NGC 936',                 type: 'GAL', ra: 2.4625,  dec: -1.1567,  mag: 10.1, constellation: 'Cetus',           aliases: [] },
  // Coma Berenices
  { catalog: 'NGC', catalogNumber: '4147', name: 'NGC 4147',                type: 'GC',  ra: 12.1686, dec: 18.5428,  mag: 10.4, constellation: 'Coma Berenices',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '4414', name: 'NGC 4414',                type: 'GAL', ra: 12.4358, dec: 31.2233,  mag: 10.1, constellation: 'Coma Berenices',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '4494', name: 'NGC 4494',                type: 'GAL', ra: 12.5247, dec: 25.7758,  mag: 9.8,  constellation: 'Coma Berenices',  aliases: [] },
  { catalog: 'NGC', catalogNumber: '4559', name: 'NGC 4559',                type: 'GAL', ra: 12.5997, dec: 27.9597,  mag: 9.8,  constellation: 'Coma Berenices',  aliases: ['C36'] },
  { catalog: 'NGC', catalogNumber: '4565', name: 'Needle Galaxy',           type: 'GAL', ra: 12.6586, dec: 25.9875,  mag: 9.6,  constellation: 'Coma Berenices',  aliases: ['C38'] },
  { catalog: 'NGC', catalogNumber: '4725', name: 'NGC 4725',                type: 'GAL', ra: 12.8333, dec: 25.5008,  mag: 9.4,  constellation: 'Coma Berenices',  aliases: [] },
  // Cygnus
  { catalog: 'NGC', catalogNumber: '6826', name: 'Blinking Planetary',      type: 'PN',  ra: 19.7456, dec: 50.5206,  mag: 8.8,  constellation: 'Cygnus',          aliases: ['C15'] },
  { catalog: 'NGC', catalogNumber: '6888', name: 'Crescent Nebula',         type: 'DN',  ra: 20.2000, dec: 38.3550,  mag: 7.4,  constellation: 'Cygnus',          aliases: ['C27'] },
  { catalog: 'NGC', catalogNumber: '6960', name: 'Western Veil Nebula',     type: 'SNR', ra: 20.7600, dec: 30.7083,  mag: 7.0,  constellation: 'Cygnus',          aliases: ['C34'] },
  { catalog: 'NGC', catalogNumber: '6992', name: 'Eastern Veil Nebula',     type: 'SNR', ra: 20.9233, dec: 31.2000,  mag: 7.0,  constellation: 'Cygnus',          aliases: ['C33'] },
  { catalog: 'NGC', catalogNumber: '7000', name: 'North America Nebula',    type: 'DN',  ra: 20.9800, dec: 44.3400,  mag: 4.0,  constellation: 'Cygnus',          aliases: ['C20'] },
  { catalog: 'NGC', catalogNumber: '7039', name: 'NGC 7039',                type: 'OC',  ra: 21.1850, dec: 45.6500,  mag: 7.6,  constellation: 'Cygnus',          aliases: [] },
  { catalog: 'NGC', catalogNumber: '7063', name: 'NGC 7063',                type: 'OC',  ra: 21.4067, dec: 36.4833,  mag: 7.0,  constellation: 'Cygnus',          aliases: [] },
  // Delphinus
  { catalog: 'NGC', catalogNumber: '6934', name: 'NGC 6934',                type: 'GC',  ra: 20.5711, dec: 7.4044,   mag: 8.9,  constellation: 'Delphinus',       aliases: ['C47'] },
  { catalog: 'NGC', catalogNumber: '7006', name: 'NGC 7006',                type: 'GC',  ra: 21.0264, dec: 16.1878,  mag: 10.6, constellation: 'Delphinus',       aliases: ['C42'] },
  // Draco
  { catalog: 'NGC', catalogNumber: '4236', name: 'NGC 4236',                type: 'GAL', ra: 12.2828, dec: 69.4636,  mag: 9.7,  constellation: 'Draco',           aliases: ['C3'] },
  { catalog: 'NGC', catalogNumber: '5907', name: 'Splinter Galaxy',         type: 'GAL', ra: 15.2647, dec: 56.3289,  mag: 11.0, constellation: 'Draco',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '6543', name: "Cat's Eye Nebula",        type: 'PN',  ra: 17.9758, dec: 66.6331,  mag: 8.8,  constellation: 'Draco',           aliases: ['C6'] },
  // Eridanus
  { catalog: 'NGC', catalogNumber: '1232', name: 'NGC 1232',                type: 'GAL', ra: 3.1633,  dec: -20.5800, mag: 9.9,  constellation: 'Eridanus',        aliases: [] },
  { catalog: 'NGC', catalogNumber: '1535', name: "Cleopatra's Eye",         type: 'PN',  ra: 4.2400,  dec: -12.7367, mag: 9.6,  constellation: 'Eridanus',        aliases: [] },
  // Gemini
  { catalog: 'NGC', catalogNumber: '2129', name: 'NGC 2129',                type: 'OC',  ra: 6.0117,  dec: 23.3167,  mag: 6.7,  constellation: 'Gemini',          aliases: [] },
  { catalog: 'NGC', catalogNumber: '2158', name: 'NGC 2158',                type: 'OC',  ra: 6.1267,  dec: 24.0967,  mag: 8.6,  constellation: 'Gemini',          aliases: [] },
  { catalog: 'NGC', catalogNumber: '2392', name: 'Eskimo Nebula',           type: 'PN',  ra: 7.4717,  dec: 20.9122,  mag: 9.2,  constellation: 'Gemini',          aliases: ['C39'] },
  { catalog: 'NGC', catalogNumber: '2420', name: 'NGC 2420',                type: 'OC',  ra: 7.6300,  dec: 21.5833,  mag: 8.3,  constellation: 'Gemini',          aliases: [] },
  // Hercules
  { catalog: 'NGC', catalogNumber: '6210', name: 'Turtle Nebula',           type: 'PN',  ra: 16.7706, dec: 23.7997,  mag: 8.8,  constellation: 'Hercules',        aliases: [] },
  { catalog: 'NGC', catalogNumber: '6229', name: 'NGC 6229',                type: 'GC',  ra: 16.7842, dec: 47.5275,  mag: 9.4,  constellation: 'Hercules',        aliases: [] },
  // Hydra
  { catalog: 'NGC', catalogNumber: '3242', name: 'Ghost of Jupiter',        type: 'PN',  ra: 10.1417, dec: -18.6339, mag: 7.8,  constellation: 'Hydra',           aliases: ['C59'] },
  { catalog: 'NGC', catalogNumber: '5694', name: 'NGC 5694',                type: 'GC',  ra: 14.6642, dec: -26.5394, mag: 10.2, constellation: 'Hydra',           aliases: ['C66'] },
  // Lacerta
  { catalog: 'NGC', catalogNumber: '7209', name: 'NGC 7209',                type: 'OC',  ra: 22.0883, dec: 46.5000,  mag: 6.7,  constellation: 'Lacerta',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '7243', name: 'NGC 7243',                type: 'OC',  ra: 22.2533, dec: 49.8833,  mag: 6.4,  constellation: 'Lacerta',         aliases: ['C16'] },
  // Leo
  { catalog: 'NGC', catalogNumber: '2903', name: 'NGC 2903',                type: 'GAL', ra: 9.5317,  dec: 21.5008,  mag: 9.0,  constellation: 'Leo',             aliases: [] },
  { catalog: 'NGC', catalogNumber: '3344', name: 'NGC 3344',                type: 'GAL', ra: 10.7256, dec: 24.9225,  mag: 9.9,  constellation: 'Leo Minor',       aliases: [] },
  { catalog: 'NGC', catalogNumber: '3521', name: 'Bubble Galaxy',           type: 'GAL', ra: 11.0975, dec: -0.0361,  mag: 9.0,  constellation: 'Leo',             aliases: [] },
  { catalog: 'NGC', catalogNumber: '3628', name: 'Hamburger Galaxy',        type: 'GAL', ra: 11.3328, dec: 13.5894,  mag: 9.5,  constellation: 'Leo',             aliases: [] },
  // Lepus
  { catalog: 'NGC', catalogNumber: '2017', name: 'NGC 2017',                type: 'AST', ra: 5.6033,  dec: -17.8333, mag: 6.4,  constellation: 'Lepus',           aliases: [] },
  // Lyra
  { catalog: 'NGC', catalogNumber: '6791', name: 'NGC 6791',                type: 'OC',  ra: 19.3422, dec: 37.7717,  mag: 9.5,  constellation: 'Lyra',            aliases: [] },
  // Monoceros
  { catalog: 'NGC', catalogNumber: '2244', name: 'Rosette Cluster',         type: 'OC',  ra: 6.5386,  dec: 4.9333,   mag: 4.8,  constellation: 'Monoceros',       aliases: ['C50'] },
  { catalog: 'NGC', catalogNumber: '2261', name: "Hubble's Variable Nebula", type: 'DN', ra: 6.6631,  dec: 8.7361,   mag: 9.0,  constellation: 'Monoceros',       aliases: ['C46'] },
  { catalog: 'NGC', catalogNumber: '2264', name: 'Christmas Tree Cluster',  type: 'OC',  ra: 6.6750,  dec: 9.8833,   mag: 4.1,  constellation: 'Monoceros',       aliases: [] },
  { catalog: 'NGC', catalogNumber: '2301', name: "Hagrid's Dragon",         type: 'OC',  ra: 6.8642,  dec: 0.4647,   mag: 6.0,  constellation: 'Monoceros',       aliases: [] },
  { catalog: 'NGC', catalogNumber: '2353', name: 'NGC 2353',                type: 'OC',  ra: 7.2433,  dec: -10.2667, mag: 7.1,  constellation: 'Monoceros',       aliases: [] },
  { catalog: 'NGC', catalogNumber: '2506', name: 'NGC 2506',                type: 'OC',  ra: 8.0017,  dec: -10.7750, mag: 7.6,  constellation: 'Monoceros',       aliases: ['C54'] },
  // Ophiuchus
  { catalog: 'NGC', catalogNumber: '6633', name: 'NGC 6633',                type: 'OC',  ra: 18.4622, dec: 6.6172,   mag: 4.6,  constellation: 'Ophiuchus',       aliases: [] },
  // Orion
  { catalog: 'NGC', catalogNumber: '2024', name: 'Flame Nebula',            type: 'DN',  ra: 5.6822,  dec: -1.8439,  mag: 10.0, constellation: 'Orion',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '2169', name: '37 Cluster',              type: 'OC',  ra: 6.1408,  dec: 13.9750,  mag: 5.9,  constellation: 'Orion',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '2174', name: 'Monkey Head Nebula',      type: 'DN',  ra: 6.1583,  dec: 20.5000,  mag: 6.8,  constellation: 'Orion',           aliases: [] },
  // Pegasus
  { catalog: 'NGC', catalogNumber: '7331', name: 'NGC 7331',                type: 'GAL', ra: 22.6178, dec: 34.4153,  mag: 9.5,  constellation: 'Pegasus',         aliases: ['C30'] },
  { catalog: 'NGC', catalogNumber: '7479', name: 'NGC 7479',                type: 'GAL', ra: 23.0797, dec: 12.3225,  mag: 11.0, constellation: 'Pegasus',         aliases: ['C44'] },
  { catalog: 'NGC', catalogNumber: '7814', name: 'Little Sombrero',         type: 'GAL', ra: 0.0517,  dec: 16.1453,  mag: 10.5, constellation: 'Pegasus',         aliases: ['C43'] },
  // Perseus
  { catalog: 'NGC', catalogNumber: '869',  name: 'h Persei (Double Cluster)', type: 'OC', ra: 2.3361, dec: 57.1347,  mag: 4.3,  constellation: 'Perseus',         aliases: ['C14'] },
  { catalog: 'NGC', catalogNumber: '884',  name: 'χ Persei (Double Cluster)', type: 'OC', ra: 2.3722, dec: 57.1500,  mag: 4.4,  constellation: 'Perseus',         aliases: ['C14'] },
  { catalog: 'NGC', catalogNumber: '1023', name: 'NGC 1023',                type: 'GAL', ra: 2.6731,  dec: 39.0633,  mag: 9.4,  constellation: 'Perseus',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '1342', name: 'NGC 1342',                type: 'OC',  ra: 3.5350,  dec: 37.3833,  mag: 6.7,  constellation: 'Perseus',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '1499', name: 'California Nebula',       type: 'DN',  ra: 4.0333,  dec: 36.4167,  mag: 5.0,  constellation: 'Perseus',         aliases: [] },
  { catalog: 'NGC', catalogNumber: '1528', name: 'NGC 1528',                type: 'OC',  ra: 4.2533,  dec: 51.2167,  mag: 6.4,  constellation: 'Perseus',         aliases: [] },
  // Puppis
  { catalog: 'NGC', catalogNumber: '2451', name: 'NGC 2451',                type: 'OC',  ra: 7.7533,  dec: -37.9667, mag: 2.8,  constellation: 'Puppis',          aliases: [] },
  { catalog: 'NGC', catalogNumber: '2477', name: 'NGC 2477',                type: 'OC',  ra: 7.8717,  dec: -38.5333, mag: 5.8,  constellation: 'Puppis',          aliases: ['C71'] },
  { catalog: 'NGC', catalogNumber: '2539', name: 'NGC 2539',                type: 'OC',  ra: 8.1700,  dec: -12.8333, mag: 6.5,  constellation: 'Puppis',          aliases: [] },
  // Sagittarius
  { catalog: 'NGC', catalogNumber: '6520', name: 'NGC 6520',                type: 'OC',  ra: 18.0633, dec: -27.8833, mag: 7.6,  constellation: 'Sagittarius',     aliases: [] },
  { catalog: 'NGC', catalogNumber: '6818', name: 'Little Gem Nebula',       type: 'PN',  ra: 19.6678, dec: -14.1547, mag: 9.3,  constellation: 'Sagittarius',     aliases: [] },
  // Scorpius
  { catalog: 'NGC', catalogNumber: '6124', name: 'NGC 6124',                type: 'OC',  ra: 16.4383, dec: -40.6500, mag: 5.8,  constellation: 'Scorpius',        aliases: ['C75'] },
  { catalog: 'NGC', catalogNumber: '6231', name: 'NGC 6231',                type: 'OC',  ra: 16.9022, dec: -41.8275, mag: 2.6,  constellation: 'Scorpius',        aliases: ['C76'] },
  { catalog: 'NGC', catalogNumber: '6388', name: 'NGC 6388',                type: 'GC',  ra: 17.5917, dec: -44.7361, mag: 6.7,  constellation: 'Scorpius',        aliases: [] },
  { catalog: 'NGC', catalogNumber: '6541', name: 'NGC 6541',                type: 'GC',  ra: 18.1350, dec: -43.7150, mag: 6.3,  constellation: 'Scorpius',        aliases: ['C78'] },
  // Sculptor
  { catalog: 'NGC', catalogNumber: '55',   name: 'NGC 55',                  type: 'GAL', ra: 0.2486,  dec: -39.1967, mag: 7.9,  constellation: 'Sculptor',        aliases: ['C72'] },
  { catalog: 'NGC', catalogNumber: '253',  name: 'Sculptor Galaxy',         type: 'GAL', ra: 0.7925,  dec: -25.2881, mag: 7.1,  constellation: 'Sculptor',        aliases: ['C65'] },
  { catalog: 'NGC', catalogNumber: '288',  name: 'NGC 288',                 type: 'GC',  ra: 0.8800,  dec: -26.5825, mag: 8.1,  constellation: 'Sculptor',        aliases: [] },
  { catalog: 'NGC', catalogNumber: '300',  name: 'NGC 300',                 type: 'GAL', ra: 0.9178,  dec: -37.6839, mag: 8.1,  constellation: 'Sculptor',        aliases: ['C70'] },
  // Sextans
  { catalog: 'NGC', catalogNumber: '3115', name: 'Spindle Galaxy',          type: 'GAL', ra: 10.0978, dec: -7.7228,  mag: 9.2,  constellation: 'Sextans',         aliases: ['C53'] },
  // Tucana
  { catalog: 'NGC', catalogNumber: '104',  name: '47 Tucanae',              type: 'GC',  ra: 0.4006,  dec: -72.0814, mag: 4.0,  constellation: 'Tucana',          aliases: ['C106'] },
  { catalog: 'NGC', catalogNumber: '362',  name: 'NGC 362',                 type: 'GC',  ra: 1.0550,  dec: -70.8489, mag: 6.6,  constellation: 'Tucana',          aliases: ['C104'] },
  // Ursa Major
  { catalog: 'NGC', catalogNumber: '2841', name: 'NGC 2841',                type: 'GAL', ra: 9.3672,  dec: 50.9764,  mag: 9.2,  constellation: 'Ursa Major',      aliases: [] },
  { catalog: 'NGC', catalogNumber: '3184', name: 'NGC 3184',                type: 'GAL', ra: 10.3025, dec: 41.4244,  mag: 9.8,  constellation: 'Ursa Major',      aliases: [] },
  { catalog: 'NGC', catalogNumber: '3198', name: 'NGC 3198',                type: 'GAL', ra: 10.3331, dec: 45.5497,  mag: 10.3, constellation: 'Ursa Major',      aliases: [] },
  // Vela
  { catalog: 'NGC', catalogNumber: '3132', name: 'Eight-Burst Nebula',      type: 'PN',  ra: 10.1117, dec: -40.4356, mag: 9.4,  constellation: 'Vela',            aliases: ['C74'] },
  { catalog: 'NGC', catalogNumber: '3201', name: 'NGC 3201',                type: 'GC',  ra: 10.2928, dec: -46.4119, mag: 6.8,  constellation: 'Vela',            aliases: ['C79'] },
  // Virgo
  { catalog: 'NGC', catalogNumber: '4216', name: 'NGC 4216',                type: 'GAL', ra: 12.2747, dec: 13.1494,  mag: 10.0, constellation: 'Virgo',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '4438', name: 'The Eyes',                type: 'GAL', ra: 12.4775, dec: 13.0086,  mag: 10.0, constellation: 'Virgo',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '4535', name: 'Lost Galaxy',             type: 'GAL', ra: 12.5894, dec: 8.1981,   mag: 9.8,  constellation: 'Virgo',           aliases: [] },
  { catalog: 'NGC', catalogNumber: '4697', name: 'NGC 4697',                type: 'GAL', ra: 12.8106, dec: -5.8006,  mag: 9.3,  constellation: 'Virgo',           aliases: ['C52'] },
  // Vulpecula
  { catalog: 'NGC', catalogNumber: '6940', name: 'NGC 6940',                type: 'OC',  ra: 20.5800, dec: 28.2833,  mag: 6.3,  constellation: 'Vulpecula',       aliases: [] },
];

module.exports = { FINEST_NGC };
