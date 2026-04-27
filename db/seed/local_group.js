// Local Group of galaxies — the gravitationally-bound association our Milky
// Way belongs to. Includes the major spirals (Andromeda, M33), their
// satellites, and the known dwarf companions of the Milky Way.
// Primary catalog id "LG" + sequence number; aliases bridge to Messier,
// NGC, IC and Caldwell where applicable.

const LOCAL_GROUP = [
  { catalog: 'LG', catalogNumber: '1',  name: 'Andromeda Galaxy',  type: 'GAL', ra: 0.7122,  dec: 41.2692,  mag: 3.4,  constellation: 'Andromeda',     aliases: ['M31', 'NGC 224'] },
  { catalog: 'LG', catalogNumber: '2',  name: 'M32',               type: 'GAL', ra: 0.7114,  dec: 40.8653,  mag: 8.1,  constellation: 'Andromeda',     aliases: ['M32', 'NGC 221'] },
  { catalog: 'LG', catalogNumber: '3',  name: 'M110',              type: 'GAL', ra: 0.6728,  dec: 41.6856,  mag: 8.1,  constellation: 'Andromeda',     aliases: ['M110', 'NGC 205'] },
  { catalog: 'LG', catalogNumber: '4',  name: 'Triangulum Galaxy', type: 'GAL', ra: 1.5642,  dec: 30.6602,  mag: 5.7,  constellation: 'Triangulum',    aliases: ['M33', 'NGC 598'] },
  { catalog: 'LG', catalogNumber: '5',  name: "Barnard's Galaxy",  type: 'GAL', ra: 19.7453, dec: -14.8058, mag: 9.3,  constellation: 'Sagittarius',   aliases: ['NGC 6822', 'C57'] },
  { catalog: 'LG', catalogNumber: '6',  name: 'IC 1613',           type: 'GAL', ra: 1.0783,  dec: 2.1175,   mag: 9.3,  constellation: 'Cetus',         aliases: ['IC 1613', 'C51'] },
  { catalog: 'LG', catalogNumber: '7',  name: 'NGC 185',           type: 'GAL', ra: 0.6497,  dec: 48.3372,  mag: 9.2,  constellation: 'Cassiopeia',    aliases: ['NGC 185', 'C18'] },
  { catalog: 'LG', catalogNumber: '8',  name: 'NGC 147',           type: 'GAL', ra: 0.5511,  dec: 48.5094,  mag: 9.3,  constellation: 'Cassiopeia',    aliases: ['NGC 147', 'C17'] },
  { catalog: 'LG', catalogNumber: '9',  name: 'WLM Galaxy',        type: 'GAL', ra: 0.0317,  dec: -15.4592, mag: 11.0, constellation: 'Cetus',         aliases: ['WLM', 'DDO 221'] },
  { catalog: 'LG', catalogNumber: '10', name: 'Pegasus Dwarf',     type: 'GAL', ra: 23.4794, dec: 14.7461,  mag: 12.4, constellation: 'Pegasus',       aliases: ['DDO 216'] },
  { catalog: 'LG', catalogNumber: '11', name: 'Sextans A',         type: 'GAL', ra: 10.1833, dec: -4.6917,  mag: 11.9, constellation: 'Sextans',       aliases: ['UGCA 205'] },
  { catalog: 'LG', catalogNumber: '12', name: 'Sextans B',         type: 'GAL', ra: 10.0000, dec: 5.3333,   mag: 11.9, constellation: 'Sextans',       aliases: ['UGC 5373'] },
  { catalog: 'LG', catalogNumber: '13', name: 'Leo I',             type: 'GAL', ra: 10.1392, dec: 12.3083,  mag: 11.2, constellation: 'Leo',           aliases: ['UGC 5470', 'DDO 74'] },
  { catalog: 'LG', catalogNumber: '14', name: 'Leo II',            type: 'GAL', ra: 11.2255, dec: 22.1525,  mag: 12.6, constellation: 'Leo',           aliases: ['UGC 6253', 'DDO 93'] },
  { catalog: 'LG', catalogNumber: '15', name: 'Sculptor Dwarf',    type: 'GAL', ra: 1.0014,  dec: -33.7089, mag: 8.6,  constellation: 'Sculptor',      aliases: ['ESO 351-30'] },
  { catalog: 'LG', catalogNumber: '16', name: 'Fornax Dwarf',      type: 'GAL', ra: 2.6650,  dec: -34.4500, mag: 9.0,  constellation: 'Fornax',        aliases: ['ESO 356-04'] },
  { catalog: 'LG', catalogNumber: '17', name: 'Carina Dwarf',      type: 'GAL', ra: 6.6928,  dec: -50.9658, mag: 11.3, constellation: 'Carina',        aliases: ['ESO 206-20'] },
  { catalog: 'LG', catalogNumber: '18', name: 'Draco Dwarf',       type: 'GAL', ra: 17.3367, dec: 57.9150,  mag: 10.9, constellation: 'Draco',         aliases: ['UGC 10822', 'DDO 208'] },
  { catalog: 'LG', catalogNumber: '19', name: 'Ursa Minor Dwarf',  type: 'GAL', ra: 15.1500, dec: 67.2167,  mag: 11.9, constellation: 'Ursa Minor',    aliases: ['UGC 9749', 'DDO 199'] },
  { catalog: 'LG', catalogNumber: '20', name: 'Large Magellanic Cloud', type: 'GAL', ra: 5.3933, dec: -69.7561, mag: 0.9, constellation: 'Dorado',     aliases: ['LMC', 'ESO 56-115'] },
  { catalog: 'LG', catalogNumber: '21', name: 'Small Magellanic Cloud', type: 'GAL', ra: 0.8775, dec: -72.8281, mag: 2.7, constellation: 'Tucana',     aliases: ['SMC', 'NGC 292'] },
  { catalog: 'LG', catalogNumber: '22', name: 'Phoenix Dwarf',     type: 'GAL', ra: 1.8517,  dec: -44.4444, mag: 13.1, constellation: 'Phoenix',       aliases: ['ESO 245-7'] },
];

module.exports = { LOCAL_GROUP };
