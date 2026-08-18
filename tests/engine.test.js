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

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
