// Solar System bodies. Coordinates and magnitudes vary continuously, so
// these rows are stored without ra/dec/mag and instead carry an `ephemeris`
// tag — the server fills in current RA/Dec/magnitude at request time via
// lib/ephemeris.js.

const SOLAR_SYSTEM = [
  { catalog: 'SOL', catalogNumber: '1', name: 'Sun',     type: 'STAR', ra: null, dec: null, mag: -26.7, constellation: null, ephemeris: 'sun'     },
  { catalog: 'SOL', catalogNumber: '2', name: 'Moon',    type: 'MOON', ra: null, dec: null, mag: -12.7, constellation: null, ephemeris: 'moon'    },
  { catalog: 'SOL', catalogNumber: '3', name: 'Mercury', type: 'PLAN', ra: null, dec: null, mag: -0.5,  constellation: null, ephemeris: 'mercury' },
  { catalog: 'SOL', catalogNumber: '4', name: 'Venus',   type: 'PLAN', ra: null, dec: null, mag: -4.0,  constellation: null, ephemeris: 'venus'   },
  { catalog: 'SOL', catalogNumber: '5', name: 'Mars',    type: 'PLAN', ra: null, dec: null, mag: -1.0,  constellation: null, ephemeris: 'mars'    },
  { catalog: 'SOL', catalogNumber: '6', name: 'Jupiter', type: 'PLAN', ra: null, dec: null, mag: -2.5,  constellation: null, ephemeris: 'jupiter' },
  { catalog: 'SOL', catalogNumber: '7', name: 'Saturn',  type: 'PLAN', ra: null, dec: null, mag: 0.5,   constellation: null, ephemeris: 'saturn'  },
  { catalog: 'SOL', catalogNumber: '8', name: 'Uranus',  type: 'PLAN', ra: null, dec: null, mag: 5.7,   constellation: null, ephemeris: 'uranus'  },
  { catalog: 'SOL', catalogNumber: '9', name: 'Neptune', type: 'PLAN', ra: null, dec: null, mag: 7.8,   constellation: null, ephemeris: 'neptune' },
];

module.exports = { SOLAR_SYSTEM };
