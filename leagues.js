// leagues.js — per-league config objects.
// Adding a future league means adding another entry here plus its own data
// file in data/ — shared.js and the projection pipeline are not duplicated.
const LEAGUES = [
  {
    id: 'dynasty-cap',
    name: 'Dynasty $1000 Cap',
    teams: 10,
    capPerTeam: 1000,
    rosterSlots: {
      QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1,
      K: 1, DST: 1, BENCH: 10, PS: 10, IR: 2,
    },
    psCapDiscount: 0.25,
    irCapDiscount: 0.50,
    kDstFlatReserve: 1,
    scoring: {
      passYd: 0.04, passTD: 6, int: -4, passTwoPt: 2,
      rushYd: 0.1, rushTD: 6, rushTwoPt: 2,
      recYd: 0.1, recTD: 6, recTwoPt: 2,
      fumLost: -2,
      recByPosition: { RB: 0.5, WR: 1.0, TE: 1.5 },
    },
    dataFile: 'leaguetycoon_players_contracts_2026.csv',
  },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LEAGUES };
}
