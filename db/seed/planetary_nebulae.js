// Bright planetary nebulae picked for smart-scope reach (~mag 12 and brighter,
// most large enough to render with structure on a Seestar S50/S30). Aliases
// bridge to Messier and Caldwell entries for the same nebula.

const SEESTAR_PLANETARY_NEBULAE = [
  { catalog: 'PN', catalogNumber: '1',  name: 'Dumbbell Nebula',          type: 'PN', ra: 19.9934, dec: 22.7214,  mag: 7.5,  constellation: 'Vulpecula',   aliases: ['M27', 'NGC 6853'] },
  { catalog: 'PN', catalogNumber: '2',  name: 'Ring Nebula',              type: 'PN', ra: 18.8931, dec: 33.0292,  mag: 8.8,  constellation: 'Lyra',         aliases: ['M57', 'NGC 6720'] },
  { catalog: 'PN', catalogNumber: '3',  name: 'Owl Nebula',               type: 'PN', ra: 11.2481, dec: 55.0189,  mag: 9.9,  constellation: 'Ursa Major',   aliases: ['M97', 'NGC 3587'] },
  { catalog: 'PN', catalogNumber: '4',  name: 'Little Dumbbell Nebula',   type: 'PN', ra: 1.7056,  dec: 51.5753,  mag: 10.1, constellation: 'Perseus',      aliases: ['M76', 'NGC 650'] },
  { catalog: 'PN', catalogNumber: '5',  name: 'Helix Nebula',             type: 'PN', ra: 22.4947, dec: -20.8378, mag: 7.3,  constellation: 'Aquarius',     aliases: ['NGC 7293', 'C63'] },
  { catalog: 'PN', catalogNumber: '6',  name: 'Saturn Nebula',            type: 'PN', ra: 21.0461, dec: -11.3628, mag: 8.0,  constellation: 'Aquarius',     aliases: ['NGC 7009', 'C55'] },
  { catalog: 'PN', catalogNumber: '7',  name: "Cat's Eye Nebula",         type: 'PN', ra: 17.9758, dec: 66.6331,  mag: 8.8,  constellation: 'Draco',        aliases: ['NGC 6543', 'C6'] },
  { catalog: 'PN', catalogNumber: '8',  name: 'Eskimo Nebula',            type: 'PN', ra: 7.4717,  dec: 20.9122,  mag: 9.2,  constellation: 'Gemini',       aliases: ['NGC 2392', 'C39'] },
  { catalog: 'PN', catalogNumber: '9',  name: 'Blinking Planetary',       type: 'PN', ra: 19.7456, dec: 50.5206,  mag: 8.8,  constellation: 'Cygnus',       aliases: ['NGC 6826', 'C15'] },
  { catalog: 'PN', catalogNumber: '10', name: 'Ghost of Jupiter',         type: 'PN', ra: 10.1417, dec: -18.6339, mag: 7.8,  constellation: 'Hydra',        aliases: ['NGC 3242', 'C59'] },
  { catalog: 'PN', catalogNumber: '11', name: 'Skull Nebula',             type: 'PN', ra: 0.7800,  dec: -11.8722, mag: 10.9, constellation: 'Cetus',        aliases: ['NGC 246', 'C56'] },
  { catalog: 'PN', catalogNumber: '12', name: 'Bow-Tie Nebula',           type: 'PN', ra: 0.2119,  dec: 72.5211,  mag: 11.6, constellation: 'Cepheus',      aliases: ['NGC 40', 'C2'] },
  { catalog: 'PN', catalogNumber: '13', name: 'Eight-Burst Nebula',       type: 'PN', ra: 10.1117, dec: -40.4356, mag: 9.4,  constellation: 'Vela',         aliases: ['NGC 3132', 'C74'] },
  { catalog: 'PN', catalogNumber: '14', name: "Cleopatra's Eye",          type: 'PN', ra: 4.2400,  dec: -12.7367, mag: 9.6,  constellation: 'Eridanus',     aliases: ['NGC 1535'] },
  { catalog: 'PN', catalogNumber: '15', name: 'Turtle Nebula',            type: 'PN', ra: 16.7706, dec: 23.7997,  mag: 8.8,  constellation: 'Hercules',     aliases: ['NGC 6210'] },
  { catalog: 'PN', catalogNumber: '16', name: 'Little Gem Nebula',        type: 'PN', ra: 19.6678, dec: -14.1547, mag: 9.3,  constellation: 'Sagittarius',  aliases: ['NGC 6818'] },
  { catalog: 'PN', catalogNumber: '17', name: 'Blue Snowball Nebula',     type: 'PN', ra: 23.4264, dec: 42.5525,  mag: 8.6,  constellation: 'Andromeda',    aliases: ['NGC 7662', 'C22'] },
  { catalog: 'PN', catalogNumber: '18', name: 'Blue Flash Nebula',        type: 'PN', ra: 20.3744, dec: 20.0997,  mag: 11.1, constellation: 'Delphinus',    aliases: ['NGC 6905'] },
  { catalog: 'PN', catalogNumber: '19', name: 'Bug Nebula',               type: 'PN', ra: 17.2272, dec: -37.1033, mag: 12.8, constellation: 'Scorpius',     aliases: ['NGC 6302', 'C69'] },
  { catalog: 'PN', catalogNumber: '20', name: 'Little Ghost Nebula',      type: 'PN', ra: 17.4767, dec: -23.7600, mag: 11.4, constellation: 'Ophiuchus',    aliases: ['NGC 6369'] },
  { catalog: 'PN', catalogNumber: '21', name: 'Box Nebula',               type: 'PN', ra: 7.4244,  dec: 29.4933,  mag: 11.2, constellation: 'Gemini',       aliases: ['NGC 2371'] },
  { catalog: 'PN', catalogNumber: '22', name: 'Medusa Nebula',            type: 'PN', ra: 7.4861,  dec: 13.2533,  mag: 12.0, constellation: 'Gemini',       aliases: ['Sh2-274', 'Abell 21'] },
  { catalog: 'PN', catalogNumber: '23', name: 'Phantom Streak Nebula',    type: 'PN', ra: 19.5961, dec: 9.0556,   mag: 11.5, constellation: 'Aquila',       aliases: ['NGC 6741'] },
  { catalog: 'PN', catalogNumber: '24', name: 'Cocoon Nebula (PN)',       type: 'PN', ra: 20.8442, dec: -10.6147, mag: 10.5, constellation: 'Aquarius',     aliases: ['NGC 6960-PN'] },
  { catalog: 'PN', catalogNumber: '25', name: 'Soap Bubble Nebula',       type: 'PN', ra: 20.2622, dec: 38.0556,  mag: 12.5, constellation: 'Cygnus',       aliases: ['PN G75.5+1.7'] },
  { catalog: 'PN', catalogNumber: '26', name: 'IC 418 (Spirograph)',      type: 'PN', ra: 5.4569,  dec: -12.6975, mag: 9.6,  constellation: 'Lepus',        aliases: ['IC 418'] },
  { catalog: 'PN', catalogNumber: '27', name: 'Crystal Ball Nebula',      type: 'PN', ra: 7.0294,  dec: -10.7100, mag: 9.7,  constellation: 'Monoceros',    aliases: ['NGC 2392-Crystal'] },
  { catalog: 'PN', catalogNumber: '28', name: 'NGC 1360',                 type: 'PN', ra: 3.5567,  dec: -25.8717, mag: 9.4,  constellation: 'Fornax',       aliases: ['NGC 1360'] },
  { catalog: 'PN', catalogNumber: '29', name: 'NGC 6058',                 type: 'PN', ra: 16.0617, dec: 40.6753,  mag: 12.9, constellation: 'Hercules',     aliases: ['NGC 6058'] },
  { catalog: 'PN', catalogNumber: '30', name: 'NGC 7027',                 type: 'PN', ra: 21.1183, dec: 42.2400,  mag: 8.5,  constellation: 'Cygnus',       aliases: ['NGC 7027'] },
];

module.exports = { SEESTAR_PLANETARY_NEBULAE };
