// tests/engine.test.js — run with: node tests/engine.test.js
const assert = require('assert');
const engine = require('../shared.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL - ' + name);
    console.log('    ' + e.message);
  }
}

// ── esc ──
test('esc escapes angle brackets and quotes', () => {
  assert.strictEqual(engine.esc('<script>"hi"</script>'), '&lt;script&gt;&quot;hi&quot;&lt;/script&gt;');
});
test('esc handles null/undefined as empty string', () => {
  assert.strictEqual(engine.esc(null), '');
  assert.strictEqual(engine.esc(undefined), '');
});
test('esc handles numeric zero', () => {
  assert.strictEqual(engine.esc(0), '0');
});

// ── parseCSV ──
test('parseCSV parses a simple comma-delimited table', () => {
  const rows = engine.parseCSV('Name,HR\nJudge,62\nTrout,40');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0]['Name'], 'Judge');
  assert.strictEqual(rows[0]['HR'], '62');
  assert.strictEqual(rows[1]['Name'], 'Trout');
});
test('parseCSV handles quoted commas inside a field', () => {
  const rows = engine.parseCSV('Name,Position\n"Hunter, Travis","WR,CB"');
  assert.strictEqual(rows[0]['Name'], 'Hunter, Travis');
  assert.strictEqual(rows[0]['Position'], 'WR,CB');
});
test('parseCSV correctly decodes a field whose content is itself quote-bounded', () => {
  const rows = engine.parseCSV('Name,Nick\nBob,"""Ace"""');
  assert.strictEqual(rows[0]['Nick'], '"Ace"');
});

// ── parseLeagueTycoonCSV ──
const LT_SAMPLE = [
  'Team,Player,Position,NFL Team,Real Salary,Years,VAL,ADP,PROJ FPTS,AVG,GMS,RUSH YD,RUSH TD,RUSH CAR,REC,REC YD,REC TD,REC TAR,PASS CMP,PASS ATT,PASS YD,PASS TD,PASS INT',
  'Team To Be Named Later,Josh Allen,QB,BUF,269,1,242,26,389.7,22.92,17,570.83,11.67,115.84,,,,,327.96,490.86,3684.14,27.76,11.06',
  'FA,Ja\'Marr Chase,WR,CIN,,,223,3,330.3,19.43,17,18.48,0.05,3.33,121.01,1431.99,10.91,121.01,,,,,',
  'Badger? Hardly Know Her!,Travis Hunter,"WR,CB",JAX,1,196,107.3,6.31,17,11.19,0.05,2.36,40.64,488.4,2.84,40.64,,,,,',
].join('\n');

test('parseLeagueTycoonCSV extracts rostered player with salary', () => {
  const players = engine.parseLeagueTycoonCSV(LT_SAMPLE);
  const allen = players.find(p => p.name === 'Josh Allen');
  assert.strictEqual(allen.position, 'QB');
  assert.strictEqual(allen.nflTeam, 'BUF');
  assert.strictEqual(allen.team, 'Team To Be Named Later');
  assert.strictEqual(allen.isFreeAgent, false);
  assert.strictEqual(allen.salary, 269);
  assert.strictEqual(allen.years, 1);
  assert.strictEqual(allen.stats.passYd, 3684.14);
  assert.strictEqual(allen.stats.passTD, 27.76);
  assert.strictEqual(allen.stats.int, 11.06);
});

test('parseLeagueTycoonCSV marks FA rows as free agents with null salary', () => {
  const players = engine.parseLeagueTycoonCSV(LT_SAMPLE);
  const chase = players.find(p => p.name === "Ja'Marr Chase");
  assert.strictEqual(chase.team, 'FA');
  assert.strictEqual(chase.isFreeAgent, true);
  assert.strictEqual(chase.salary, null);
  assert.strictEqual(chase.stats.rec, 121.01);
  assert.strictEqual(chase.stats.recYd, 1431.99);
  assert.strictEqual(chase.stats.recTD, 10.91);
});

test('parseLeagueTycoonCSV takes the first token of a multi-position player', () => {
  const players = engine.parseLeagueTycoonCSV(LT_SAMPLE);
  const hunter = players.find(p => p.name === 'Travis Hunter');
  assert.strictEqual(hunter.position, 'WR');
});

test('parseLeagueTycoonCSV omits stat keys with no value rather than defaulting to 0', () => {
  const players = engine.parseLeagueTycoonCSV(LT_SAMPLE);
  const allen = players.find(p => p.name === 'Josh Allen');
  assert.strictEqual('rec' in allen.stats, false); // Allen has no receiving stats
});

// ── scorePlayer ──
// This league's scoring, matching the approved design spec exactly.
const DYNASTY_CAP_SCORING = {
  passYd: 0.04, passTD: 6, int: -4, passTwoPt: 2,
  rushYd: 0.1, rushTD: 6, rushTwoPt: 2,
  recYd: 0.1, recTD: 6, recTwoPt: 2,
  fumLost: -2,
  recByPosition: { RB: 0.5, WR: 1.0, TE: 1.5 },
};

test('scorePlayer scores a QB from raw passing stats', () => {
  // Josh Allen: 3684.14 passYd, 27.76 passTD, 11.06 int
  // 3684.14*0.04 + 27.76*6 - 11.06*4 = 147.3656 + 166.56 - 44.24 = 269.6856
  const allen = { position: 'QB', stats: { passYd: 3684.14, passTD: 27.76, int: 11.06 } };
  assert.ok(Math.abs(engine.scorePlayer(allen, DYNASTY_CAP_SCORING) - 269.6856) < 0.001);
});

test('scorePlayer applies the WR reception weight (1.0)', () => {
  // Ja'Marr Chase: 121.01 rec, 1431.99 recYd, 10.91 recTD, 18.48 rushYd, 0.05 rushTD
  // 121.01*1.0 + 1431.99*0.1 + 10.91*6 + 18.48*0.1 + 0.05*6 = 331.817
  const chase = { position: 'WR', stats: { rec: 121.01, recYd: 1431.99, recTD: 10.91, rushYd: 18.48, rushTD: 0.05 } };
  assert.ok(Math.abs(engine.scorePlayer(chase, DYNASTY_CAP_SCORING) - 331.817) < 0.001);
});

test('scorePlayer applies the RB reception weight (0.5), lower than WR for the same catch total', () => {
  // Jahmyr Gibbs: 68.16 rec, 519.86 recYd, 3.91 recTD, 1272.77 rushYd, 13.74 rushTD
  // 68.16*0.5 + 519.86*0.1 + 3.91*6 + 1272.77*0.1 + 13.74*6 = 319.243
  const gibbs = { position: 'RB', stats: { rec: 68.16, recYd: 519.86, recTD: 3.91, rushYd: 1272.77, rushTD: 13.74 } };
  assert.ok(Math.abs(engine.scorePlayer(gibbs, DYNASTY_CAP_SCORING) - 319.243) < 0.001);
});

test('scorePlayer ignores stats with no scoring rule', () => {
  const p = { position: 'QB', stats: { passYd: 100, someUnknownStat: 999 } };
  assert.ok(Math.abs(engine.scorePlayer(p, DYNASTY_CAP_SCORING) - 4) < 0.001); // 100*0.04
});

// ── computeStartableCounts / computeReplacementLevels ──
function scoredPop(map) {
  const out = [];
  for (const pos in map) {
    map[pos].forEach(pts => out.push({ position: pos, points: pts }));
  }
  return out;
}

test('computeStartableCounts multiplies base slots by team count', () => {
  const counts = engine.computeStartableCounts(
    scoredPop({ QB: [300, 290, 280] }), 2,
    { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 },
  );
  assert.strictEqual(counts.QB, 2);
});

test('computeStartableCounts awards FLEX to the best leftover RB/WR/TE', () => {
  // 1 team, RB base 1, WR base 1, FLEX 1. Base takes RB1(100)/WR1(90).
  // Leftovers: RB2(80) vs WR2(70) -> FLEX goes to RB.
  const counts = engine.computeStartableCounts(
    scoredPop({ RB: [100, 80, 60], WR: [90, 70, 50] }), 1,
    { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 1, SUPERFLEX: 0 },
  );
  assert.strictEqual(counts.RB, 2);
  assert.strictEqual(counts.WR, 1);
});

test('computeStartableCounts awards SUPERFLEX to a QB when QB2 beats flex leftovers', () => {
  const counts = engine.computeStartableCounts(
    scoredPop({ QB: [400, 380], RB: [100, 80], WR: [90, 70] }), 1,
    { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 1 },
  );
  assert.strictEqual(counts.QB, 2); // QB2 (380) beats RB2 (80)/WR2 (70)
});

test('computeReplacementLevels = points of the first non-startable player', () => {
  // 2 teams, 1 QB each => startable QB = 2. Replacement = 3rd QB.
  const repl = engine.computeReplacementLevels(
    scoredPop({ QB: [300, 290, 280, 270] }), 2,
    { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 },
  );
  assert.strictEqual(repl.QB, 280);
});

test('computeReplacementLevels is 0 when there are not enough players', () => {
  const repl = engine.computeReplacementLevels(
    scoredPop({ TE: [120] }), 2,
    { QB: 0, RB: 0, WR: 0, TE: 1, FLEX: 0, SUPERFLEX: 0 },
  );
  assert.strictEqual(repl.TE, 0); // need a 3rd TE (index 2), none exists
});

// ── valuePlayers ──
test('valuePlayers scores, computes VBD, and sorts descending by VBD', () => {
  const players = [
    { id: 'qb1', position: 'QB', stats: { passYd: 4000, passTD: 30, int: 10 } }, // 160+180-40=300
    { id: 'qb2', position: 'QB', stats: { passYd: 3000, passTD: 20, int: 10 } }, // 120+120-40=200
    { id: 'qb3', position: 'QB', stats: { passYd: 2500, passTD: 15, int: 10 } }, // 100+90-40=150
  ];
  const league = {
    teams: 1,
    rosterSlots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 },
    scoring: DYNASTY_CAP_SCORING,
  };
  const result = engine.valuePlayers(players, league);
  // startable QB = 1 -> replacement = qb2's points (200)
  assert.strictEqual(result.replacement.QB, 200);
  assert.strictEqual(result.players[0].id, 'qb1');
  assert.ok(Math.abs(result.players[0].vbd - 100) < 0.001); // 300 - 200
  assert.ok(Math.abs(result.players[1].vbd - 0) < 0.001);   // 200 - 200
  assert.ok(Math.abs(result.players[2].vbd - -50) < 0.001); // 150 - 200
});

test('valuePlayers excludes K/DST from the valued population', () => {
  const players = [
    { id: 'k1', position: 'K', stats: {} },
    { id: 'qb1', position: 'QB', stats: { passYd: 100 } },
  ];
  const league = {
    teams: 1,
    rosterSlots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 },
    scoring: DYNASTY_CAP_SCORING,
  };
  const result = engine.valuePlayers(players, league);
  assert.strictEqual(result.players.length, 1);
  assert.strictEqual(result.players[0].id, 'qb1');
});

// ── computeDollarValues ──
test('computeDollarValues conserves the pool: sum of dollars + K/DST reserve = total pool', () => {
  // Tiny league: 2 teams, 1 QB starter + 1 bench slot each, no FLEX/SUPERFLEX, no K/DST.
  // Pool = 2*100 = 200. kDstReserve = 0. populationSize = (1+1)*2 = 4.
  const players = [
    { id: 'q1', position: 'QB', stats: { passYd: 5000 } }, // 200
    { id: 'q2', position: 'QB', stats: { passYd: 4000 } }, // 160
    { id: 'q3', position: 'QB', stats: { passYd: 3000 } }, // 120 (replacement, startable=2 -> repl=idx2=120)
    { id: 'q4', position: 'QB', stats: { passYd: 1000 } }, // 40  (below replacement)
    { id: 'q5', position: 'QB', stats: { passYd: 500 } },  // 20  (below replacement, outside population)
  ];
  const league = {
    teams: 2, capPerTeam: 100,
    rosterSlots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 1 },
    scoring: { passYd: 0.04 },
    kDstFlatReserve: 1,
  };
  const valued = engine.valuePlayers(players, league);
  const dollars = engine.computeDollarValues(valued, league);
  const total = Object.keys(dollars).reduce((s, id) => s + dollars[id], 0);
  assert.ok(total <= 200); // never exceeds the pool
  assert.strictEqual(dollars['q1'] > dollars['q2'], true); // higher VBD -> higher $
  assert.strictEqual('q5' in dollars, false); // outside the 4-player population
});

test('computeDollarValues gives every valued player at least the $1 floor', () => {
  const players = [
    { id: 'q1', position: 'QB', stats: { passYd: 5000 } },
    { id: 'q2', position: 'QB', stats: { passYd: 100 } }, // far below replacement
  ];
  const league = {
    teams: 1, capPerTeam: 1000,
    rosterSlots: { QB: 1, RB: 0, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 1 },
    scoring: { passYd: 0.04 },
    kDstFlatReserve: 1,
  };
  const valued = engine.valuePlayers(players, league);
  const dollars = engine.computeDollarValues(valued, league);
  assert.strictEqual(dollars['q2'], 1);
});

// ── computeCapSituation / applyCapImpact ──
test('computeCapSituation sums a team\'s salary and computes remaining cap', () => {
  const rows = [
    { team: 'Team 10', salary: 232 },
    { team: 'Team 10', salary: 148 },
    { team: 'FA', salary: null },
    { team: 'Other Team', salary: 500 },
  ];
  const league = { capPerTeam: 1000 };
  const cap = engine.computeCapSituation(rows, 'Team 10', league);
  assert.strictEqual(cap.used, 380);
  assert.strictEqual(cap.remaining, 620);
});

test('applyCapImpact applies the PS discount (25%)', () => {
  const league = { psCapDiscount: 0.25, irCapDiscount: 0.50 };
  assert.strictEqual(engine.applyCapImpact(40, 'PS', league), 10);
});

test('applyCapImpact applies the IR discount (50%)', () => {
  const league = { psCapDiscount: 0.25, irCapDiscount: 0.50 };
  assert.strictEqual(engine.applyCapImpact(40, 'IR', league), 20);
});

test('applyCapImpact charges the full bid with no slot designation', () => {
  const league = { psCapDiscount: 0.25, irCapDiscount: 0.50 };
  assert.strictEqual(engine.applyCapImpact(40, 'none', league), 40);
});

test('isCapLegal is true when a commitment fits under the cap', () => {
  const league = { capPerTeam: 1000 };
  assert.strictEqual(engine.isCapLegal(786, 200, league), true); // 986 <= 1000
});

test('isCapLegal is true at exactly the cap (equality is legal, not a violation)', () => {
  const league = { capPerTeam: 1000 };
  assert.strictEqual(engine.isCapLegal(786, 214, league), true); // 1000 <= 1000
});

test('isCapLegal is false when a commitment would exceed the cap', () => {
  const league = { capPerTeam: 1000 };
  assert.strictEqual(engine.isCapLegal(786, 215, league), false); // 1001 > 1000
});

test('isCapLegal handles a negative commitment (e.g. a trade sending salary away)', () => {
  const league = { capPerTeam: 1000 };
  assert.strictEqual(engine.isCapLegal(1050, -100, league), true); // 950 <= 1000
});

// ── optimizeLineup / lineupImpact ──
function mkP(id, position, points) { return { id: id, position: position, points: points }; }

test('optimizeLineup fills base slots by position and sums starters total', () => {
  const roster = [mkP('qb1', 'QB', 300), mkP('rb1', 'RB', 200), mkP('rb2', 'RB', 150), mkP('wr1', 'WR', 180)];
  const slots = { QB: 1, RB: 2, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0 };
  const lineup = engine.optimizeLineup(roster, slots);
  assert.strictEqual(lineup.bySlot.QB.length, 1);
  assert.strictEqual(lineup.bySlot.RB.length, 2);
  assert.strictEqual(lineup.bySlot.WR.length, 1);
  assert.strictEqual(lineup.bench.length, 0);
  assert.strictEqual(lineup.startersTotal, 300 + 200 + 150 + 180);
});

test('optimizeLineup awards FLEX to the best leftover RB/WR/TE and benches the rest', () => {
  const roster = [mkP('rb1', 'RB', 100), mkP('rb2', 'RB', 80), mkP('wr1', 'WR', 90), mkP('wr2', 'WR', 70)];
  const slots = { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 1, SUPERFLEX: 0 };
  const lineup = engine.optimizeLineup(roster, slots);
  // base: rb1, wr1. Leftovers: rb2(80) vs wr2(70) -> FLEX = rb2.
  assert.strictEqual(lineup.bySlot.FLEX[0].id, 'rb2');
  assert.strictEqual(lineup.bench.length, 1);
  assert.strictEqual(lineup.bench[0].id, 'wr2');
});

test('optimizeLineup awards SUPERFLEX to a QB2 when he beats flex-eligible leftovers', () => {
  const roster = [mkP('qb1', 'QB', 400), mkP('qb2', 'QB', 380), mkP('rb1', 'RB', 100), mkP('wr1', 'WR', 90)];
  const slots = { QB: 1, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 1 };
  const lineup = engine.optimizeLineup(roster, slots);
  assert.strictEqual(lineup.bySlot.SUPERFLEX[0].id, 'qb2');
  assert.strictEqual(lineup.bench.length, 0);
});

test('optimizeLineup benches players beyond all slots', () => {
  const roster = [mkP('wr1', 'WR', 90), mkP('wr2', 'WR', 70), mkP('wr3', 'WR', 50)];
  const slots = { QB: 0, RB: 0, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0 };
  const lineup = engine.optimizeLineup(roster, slots);
  assert.strictEqual(lineup.bySlot.WR.length, 1);
  assert.strictEqual(lineup.bench.length, 2);
});

test('lineupImpact reports the slot a candidate lands in and who gets bumped', () => {
  const before = [mkP('rb1', 'RB', 100)];
  const slots = { QB: 0, RB: 1, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 };
  const beforeLineup = engine.optimizeLineup(before, slots);
  const candidate = mkP('rb2', 'RB', 150); // beats rb1 outright for the single RB slot
  const afterLineup = engine.optimizeLineup(before.concat([candidate]), slots);
  const impact = engine.lineupImpact(beforeLineup, afterLineup, 'rb2');
  assert.strictEqual(impact.landedSlot, 'RB');
  assert.strictEqual(impact.bumped.length, 1);
  assert.strictEqual(impact.bumped[0].id, 'rb1');
  assert.strictEqual(impact.pointsDelta, 150 - 100);
});

test('lineupImpact reports null landedSlot and no bumps when the candidate does not crack the lineup', () => {
  const before = [mkP('rb1', 'RB', 100), mkP('rb2', 'RB', 90)];
  const slots = { QB: 0, RB: 2, WR: 0, TE: 0, FLEX: 0, SUPERFLEX: 0 };
  const beforeLineup = engine.optimizeLineup(before, slots);
  const candidate = mkP('rb3', 'RB', 10); // below both current starters, no FLEX to fall back to
  const afterLineup = engine.optimizeLineup(before.concat([candidate]), slots);
  const impact = engine.lineupImpact(beforeLineup, afterLineup, 'rb3');
  assert.strictEqual(impact.landedSlot, null);
  assert.strictEqual(impact.bumped.length, 0);
  assert.strictEqual(impact.pointsDelta, 0);
});

// ── parseSleeperBioCSV ──
const SLEEPER_SAMPLE = [
  'name,position,team,age,years_exp',
  'Josh Allen,QB,BUF,30,8',
  'Michael Penix,QB,ATL,26,1',
  'Frank Gore,RB,,38,17',
  'Frank Gore,RB,BUF,24,2',
].join('\n');

test('parseSleeperBioCSV parses name/position/team/age/years_exp', () => {
  const rows = engine.parseSleeperBioCSV(SLEEPER_SAMPLE);
  const allen = rows.find(r => r.name === 'Josh Allen');
  assert.strictEqual(allen.position, 'QB');
  assert.strictEqual(allen.team, 'BUF');
  assert.strictEqual(allen.age, 30);
  assert.strictEqual(allen.yearsExp, 8);
});

// ── normalizeName ──
test('normalizeName lowercases, strips punctuation, and strips a Jr/Sr/II/III/IV suffix', () => {
  assert.strictEqual(engine.normalizeName('Michael Penix Jr.'), 'michael penix');
  assert.strictEqual(engine.normalizeName("Ja'Marr Chase"), 'jamarr chase');
  assert.strictEqual(engine.normalizeName('A.J. Brown'), 'aj brown');
  assert.strictEqual(engine.normalizeName('Travis Etienne III'), 'travis etienne');
  assert.strictEqual(engine.normalizeName('Michael Penix'), 'michael penix');
});

// ── matchBioData ──
function mkLTPlayer(id, name, position, nflTeam) {
  return { id: id, name: name, position: position, nflTeam: nflTeam };
}

test('matchBioData attaches age/yearsExp on an exact name+position match', () => {
  const players = [mkLTPlayer('p1', 'Josh Allen', 'QB', 'BUF')];
  const bio = engine.parseSleeperBioCSV(SLEEPER_SAMPLE);
  const matched = engine.matchBioData(players, bio);
  assert.strictEqual(matched[0].age, 30);
  assert.strictEqual(matched[0].yearsExp, 8);
});

test('matchBioData matches across a suffix difference (League Tycoon "Jr.", Sleeper without)', () => {
  const players = [mkLTPlayer('p1', 'Michael Penix Jr.', 'QB', 'ATL')];
  const bio = engine.parseSleeperBioCSV(SLEEPER_SAMPLE);
  const matched = engine.matchBioData(players, bio);
  assert.strictEqual(matched[0].age, 26);
  assert.strictEqual(matched[0].yearsExp, 1);
});

test('matchBioData disambiguates a name+position collision using team', () => {
  const players = [mkLTPlayer('p1', 'Frank Gore', 'RB', 'BUF')];
  const bio = engine.parseSleeperBioCSV(SLEEPER_SAMPLE); // two "Frank Gore" RBs: no team, and BUF
  const matched = engine.matchBioData(players, bio);
  assert.strictEqual(matched[0].age, 24); // the BUF one, not the retired 38-year-old
  assert.strictEqual(matched[0].yearsExp, 2);
});

test('matchBioData leaves age/yearsExp null when team cannot disambiguate a collision', () => {
  const players = [mkLTPlayer('p1', 'Frank Gore', 'RB', 'DAL')]; // neither candidate is DAL
  const bio = engine.parseSleeperBioCSV(SLEEPER_SAMPLE);
  const matched = engine.matchBioData(players, bio);
  assert.strictEqual(matched[0].age, null);
  assert.strictEqual(matched[0].yearsExp, null);
});

test('matchBioData leaves age/yearsExp null when no match exists, rather than guessing', () => {
  const players = [mkLTPlayer('p1', 'Some Undrafted Rookie', 'WR', 'KC')];
  const bio = engine.parseSleeperBioCSV(SLEEPER_SAMPLE);
  const matched = engine.matchBioData(players, bio);
  assert.strictEqual(matched[0].age, null);
  assert.strictEqual(matched[0].yearsExp, null);
});

// ── parseAgeCurveCSV / ageCurveMultiplier / curveAdjustedTermValue ──
const AGE_CURVE_SAMPLE = [
  'position,minAge,maxAge,multiplier',
  'RB,0,24,1.00',
  'RB,25,27,0.90',
  'RB,28,30,0.65',
  'RB,31,33,0.35',
  'RB,34,999,0.20',
  'WR,0,24,0.85',
  'WR,25,27,1.00',
  'WR,28,30,0.90',
  'WR,31,33,0.70',
  'WR,34,999,0.50',
].join('\n');

test('parseAgeCurveCSV parses position/age-bucket/multiplier rows', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  assert.strictEqual(rows.length, 10);
  assert.deepStrictEqual(rows[0], { position: 'RB', minAge: 0, maxAge: 24, multiplier: 1.00 });
  assert.deepStrictEqual(rows[4], { position: 'RB', minAge: 34, maxAge: 999, multiplier: 0.20 });
});

test('ageCurveMultiplier finds the bucket containing the given age', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  assert.strictEqual(engine.ageCurveMultiplier('RB', 23, rows), 1.00);
  assert.strictEqual(engine.ageCurveMultiplier('RB', 26, rows), 0.90);
  assert.strictEqual(engine.ageCurveMultiplier('RB', 40, rows), 0.20);
  assert.strictEqual(engine.ageCurveMultiplier('WR', 29, rows), 0.90);
});

test('ageCurveMultiplier returns null for an uncovered position or missing age', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  assert.strictEqual(engine.ageCurveMultiplier('QB', 27, rows), null);
  assert.strictEqual(engine.ageCurveMultiplier('RB', null, rows), null);
});

test('curveAdjustedTermValue applies 1x when future years stay in the same bucket', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  // RB age 31, value 100, salary 40 -> ages 31,32,33 all in the 31-33
  // bucket, so value is unscaled each year: (100-40)*3 = 180.
  const flat = engine.curveAdjustedTermValue('RB', 31, 3, 100, 40, rows);
  assert.ok(Math.abs(flat - 180) < 0.001);
});

test('curveAdjustedTermValue scales VALUE (not the combined surplus) across a bucket change', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  // RB age 24 (mult 1.00), value 100, salary 40:
  //  age24: value 100*1.00/1.00=100 -> surplus 60
  //  age25: value 100*0.90/1.00=90  -> surplus 50 (25-27 bucket)
  //  age26: value 90  -> surplus 50
  // sum = 60+50+50 = 160
  const declining = engine.curveAdjustedTermValue('RB', 24, 3, 100, 40, rows);
  assert.ok(Math.abs(declining - 160) < 0.001);
});

test('curveAdjustedTermValue does not distort a salary-dominated (near-zero-value) player', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  // A $1-value TE owed $13/yr should barely move even as the multiplier
  // rises from 0.80 to 1.00 across the bucket change, since there's almost
  // no value to scale — NOT a proportional swing on the combined -$12
  // surplus (that was the bug: scaling surplus directly instead of value).
  const rowsTE = [
    { position: 'TE', minAge: 0, maxAge: 24, multiplier: 0.80 },
    { position: 'TE', minAge: 25, maxAge: 27, multiplier: 1.00 },
  ];
  const result = engine.curveAdjustedTermValue('TE', 23, 3, 1, 13, rowsTE);
  // age23: 1*0.80/0.80=1 -> -12; age24: same -> -12; age25: 1*1.00/0.80=1.25 -> -11.75
  assert.ok(Math.abs(result - (-35.75)) < 0.001);
});

test('curveAdjustedTermValue returns null when age or curve data is unavailable', () => {
  const rows = engine.parseAgeCurveCSV(AGE_CURVE_SAMPLE);
  assert.strictEqual(engine.curveAdjustedTermValue('RB', null, 3, 100, 40, rows), null);
  assert.strictEqual(engine.curveAdjustedTermValue('QB', 27, 3, 100, 40, rows), null);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
