# GridironAI Bid Advisor v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GridironAI's first tool — a Bid Advisor giving a $ value for any nominated player during the $1000-cap dynasty league's ongoing slow auction draft.

**Architecture:** Static HTML/CSS/JS suite (no build step, no backend, GitHub-Pages-deployable), modeled directly on the OttoneuAI suite: one `shared.js` valuation engine (scoring → superflex-aware replacement level → VBD → $ conversion), a `leagues.js` per-league config, and per-tool HTML pages that load CSVs from `data/` and render against `shared.js`. v1 ships two pages: `index.html` (Data Hub) and `bid.html` (Bid Advisor).

**Tech Stack:** Plain JavaScript (ES5-compatible, no framework), HTML5, CSS. Engine functions are dual-mode (browser globals via `<script>` tag, CommonJS-exportable for Node-based automated testing) so the core math can be TDD'd with `node` directly — no npm install, no build step, matching the zero-tooling spirit of the rest of the suite. Page scripts build the DOM with `createElement`/`textContent` (never `innerHTML` with interpolated data) — the same defensive pattern OttoneuAI's own `bid.html` uses, since player names come from an uploaded CSV and must be treated as untrusted.

**Reference spec:** `docs/superpowers/specs/2026-08-17-bid-advisor-v1-design.md`

---

## File structure

```
GridironAI/
  shared.js                    # engine: CSV parsing, scoring, VBD, $ conversion, cap math
  leagues.js                   # league config objects (this league = 'dynasty-cap')
  theme.css                    # shared page chrome
  index.html                   # Data Hub: load CSV, pick your team, cap overview
  bid.html                     # Bid Advisor: search a nominee, get a suggested bid
  MODEL.md                     # math reference (written last, once engine is final)
  data/
    leaguetycoon_players_contracts_2026.csv   # already committed
    README.md                  # data/ file conventions
  tests/
    engine.test.js             # Node-run unit tests for shared.js
```

---

## Task 1: Scaffold `shared.js` and the Node test harness

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\shared.js`
- Create: `C:\Users\bkami\Documents\GridironAI\tests\engine.test.js`

- [ ] **Step 1: Create the empty engine file with the dual-mode export guard**

Write `shared.js`:

```js
// shared.js — GridironAI engine
// Load via <script src="shared.js"> in every tool page.
// Also requireable from Node (see bottom) for automated testing — no npm/build needed.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {};
}
```

- [ ] **Step 2: Create the test harness**

Write `tests/engine.test.js`:

```js
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

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run it to confirm the harness works with zero tests**

Run: `node tests/engine.test.js`
Expected: `0 passed, 0 failed`, exit code 0

- [ ] **Step 4: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Scaffold shared.js engine and Node test harness"
```

---

## Task 2: Utilities — `esc`, `parseCSV`, `parseCSVLine`

Ported directly from `OttoneuAI/shared.js` (validated, in production use there). `esc()` stays in the engine for any future case that genuinely needs an HTML string, but the v1 pages (Tasks 12–13) use `textContent`/`createElement` instead, so it isn't relied on for XSS-critical paths.

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

Insert into `tests/engine.test.js`, above the `console.log(passed...)` line:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 5 FAIL lines (e.g. `engine.esc is not a function`)

- [ ] **Step 3: Implement**

Replace `shared.js` contents with:

```js
// shared.js — GridironAI engine
// Load via <script src="shared.js"> in every tool page.
// Also requireable from Node (see bottom) for automated testing — no npm/build needed.

// ── SECURITY HELPER ──────────────────────────────────────────────────────────
// Escape user-supplied strings before inserting into innerHTML. Kept for any
// future HTML-string use; v1 page code prefers textContent/createElement and
// doesn't rely on this for XSS safety.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── CSV PARSING ──────────────────────────────────────────────────────────────
function parseCSVLine(line, delim) {
  delim = delim || ',';
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseCSVLine(lines[0], delim).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const values = parseCSVLine(line, delim);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (values[i] || '').trim().replace(/^"|"$/g, ''); });
      return obj;
    });
}

// ── NODE EXPORT (test-only; no-op in the browser) ─────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, parseCSV, parseCSVLine };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `5 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add esc/parseCSV utilities to shared.js engine"
```

---

## Task 3: League Tycoon CSV parser

Maps the real export's columns (`Team,Player,Position,NFL Team,Real Salary,Years,VAL,ADP,PROJ FPTS,AVG,GMS,RUSH YD,RUSH TD,RUSH CAR,REC,REC YD,REC TD,REC TAR,PASS CMP,PASS ATT,PASS YD,PASS TD,PASS INT`) into a normalized player object. `Real Salary`/`Years` are blank for `FA` rows (`parseCSV` gives `''`) — normalized to `null`. Positions like `"WR,CB"` (Travis Hunter) split on comma, first token wins (matches the primary-position convention already used in `Fantasy Football tools`).

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

Insert above `console.log(passed...)`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 4 FAIL lines (`engine.parseLeagueTycoonCSV is not a function`)

- [ ] **Step 3: Implement**

Add to `shared.js`, above the `// ── NODE EXPORT` section:

```js
// ── LEAGUE TYCOON PARSER ──────────────────────────────────────────────────────
// Maps the raw export's headers to our internal stat keys. Missing/blank cells
// are omitted from `stats` (not defaulted to 0) so scorePlayer only sums stats
// the export actually provided.
const LT_STAT_COLS = {
  'RUSH YD': 'rushYd', 'RUSH TD': 'rushTD',
  'REC': 'rec', 'REC YD': 'recYd', 'REC TD': 'recTD',
  'PASS YD': 'passYd', 'PASS TD': 'passTD', 'PASS INT': 'int',
};

function parseLeagueTycoonCSV(text) {
  const rows = parseCSV(text);
  return rows.map((row, i) => {
    const positions = (row['Position'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const team = row['Team'] || 'FA';
    const stats = {};
    for (const col in LT_STAT_COLS) {
      const raw = row[col];
      if (raw !== '' && raw != null) stats[LT_STAT_COLS[col]] = Number(raw);
    }
    return {
      id: (row['Player'] || '') + '-' + (row['NFL Team'] || '') + '-' + i,
      name: row['Player'] || '',
      position: positions[0] || '',
      nflTeam: row['NFL Team'] || '',
      team: team,
      isFreeAgent: team === 'FA',
      salary: row['Real Salary'] !== '' && row['Real Salary'] != null ? Number(row['Real Salary']) : null,
      years: row['Years'] !== '' && row['Years'] != null ? Number(row['Years']) : null,
      stats: stats,
    };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `9 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add League Tycoon CSV parser to engine"
```

---

## Task 4: Scoring — position-conditional `scorePlayer`

Extends the flat linear scoring used in `Fantasy Football tools/src/core/scoring.ts` with a position-conditional override for receptions (RB 0.5 / WR 1.0 / TE 1.5), since this league's scoring rules make receptions worth different amounts by position. Every other stat stays a flat per-unit weight.

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

Real player data, hand-computed against this league's exact scoring rules:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 4 FAIL lines (`engine.scorePlayer is not a function`)

- [ ] **Step 3: Implement**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── SCORING ──────────────────────────────────────────────────────────────────
// Fantasy points = sum over stats of stat_value * weight. `rec` is
// position-conditional (scoring.recByPosition) since this league values
// receptions differently by position; every other stat is a flat weight.
function scorePlayer(player, scoring) {
  let total = 0;
  for (const stat in player.stats) {
    const value = player.stats[stat];
    if (stat === 'rec' && scoring.recByPosition) {
      const w = scoring.recByPosition[player.position];
      if (w !== undefined) total += value * w;
      continue;
    }
    const weight = scoring[stat];
    if (weight !== undefined) total += value * weight;
  }
  return total;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `13 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add position-conditional scorePlayer to engine"
```

---

## Task 5: Superflex-aware replacement level

Ported from `Fantasy Football tools/src/core/replacement.ts` (validated, unit-tested there), adapted to plain JS and to only cover the positions this league values (`QB/RB/WR/TE`) — K/DST are excluded from replacement-level math entirely, since v1 doesn't statistically value them (see spec's Scope boundaries). Test scenarios below are carried over verbatim from `Fantasy Football tools/src/core/replacement.test.ts` to confirm the port is faithful.

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 5 FAIL lines

- [ ] **Step 3: Implement**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── REPLACEMENT LEVEL (superflex-aware) ───────────────────────────────────────
// Ported from Fantasy Football tools/src/core/replacement.ts. K/DST excluded —
// v1 doesn't statistically value them (see design spec Scope boundaries).
const VALUED_POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const FLEX_ELIGIBLE = ['RB', 'WR', 'TE'];
const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE'];

function byPositionDesc(players) {
  const groups = {};
  players.forEach(p => {
    if (!groups[p.position]) groups[p.position] = [];
    groups[p.position].push(p);
  });
  for (const pos in groups) groups[pos].sort((a, b) => b.points - a.points);
  return groups;
}

function computeStartableCounts(players, teams, slots) {
  const groups = byPositionDesc(players);
  const counts = { QB: 0, RB: 0, WR: 0, TE: 0 };
  VALUED_POSITIONS.forEach(pos => { counts[pos] = teams * (slots[pos] || 0); });

  function award(spots, eligible) {
    for (let i = 0; i < spots; i++) {
      let bestPos = null, bestPts = -Infinity;
      eligible.forEach(pos => {
        const list = groups[pos] || [];
        const nextIdx = counts[pos];
        if (nextIdx < list.length && list[nextIdx].points > bestPts) {
          bestPts = list[nextIdx].points;
          bestPos = pos;
        }
      });
      if (bestPos === null) break;
      counts[bestPos] += 1;
    }
  }
  award(teams * (slots.FLEX || 0), FLEX_ELIGIBLE);
  award(teams * (slots.SUPERFLEX || 0), SUPERFLEX_ELIGIBLE);
  return counts;
}

function computeReplacementLevels(players, teams, slots) {
  const groups = byPositionDesc(players);
  const counts = computeStartableCounts(players, teams, slots);
  const repl = {};
  VALUED_POSITIONS.forEach(pos => {
    const list = groups[pos] || [];
    const idx = counts[pos];
    repl[pos] = idx < list.length ? list[idx].points : 0;
  });
  return repl;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `18 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Port superflex-aware replacement level to engine"
```

---

## Task 6: VBD pipeline — `valuePlayers`

Combines scoring and replacement level into one pipeline: score every valued-position player, compute replacement, attach VBD, sort descending.

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 2 FAIL lines

- [ ] **Step 3: Implement**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── VBD PIPELINE ────────────────────────────────────────────────────────────
// Scores every valued-position player, computes VBD against superflex-aware
// replacement level, sorts descending. Returns { players, replacement, startable }.
function valuePlayers(players, league) {
  const scored = players
    .filter(p => VALUED_POSITIONS.indexOf(p.position) !== -1)
    .map(p => Object.assign({}, p, { points: scorePlayer(p, league.scoring) }));

  const replacement = computeReplacementLevels(scored, league.teams, league.rosterSlots);
  const startable = computeStartableCounts(scored, league.teams, league.rosterSlots);

  scored.forEach(p => { p.vbd = p.points - (replacement[p.position] || 0); });
  scored.sort((a, b) => b.vbd - a.vbd);

  return { players: scored, replacement: replacement, startable: startable };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `20 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add valuePlayers VBD pipeline to engine"
```

---

## Task 7: Dollar conversion — `computeDollarValues`

Implements the design spec's $ conversion: total pool ($10,000) minus a flat K/DST reserve ($1 per K/DST roster spot leaguewide), minus a $1 floor for every player expected to occupy a **paid roster spot** leaguewide (starting slots + bench, excluding PS/IR since those are usually unfilled per the league context), with the remainder distributed by share of positive VBD among that same population. Players outside that population are bench-caliber and not individually valued in v1 (the Bid Advisor will show them as "$1, depth").

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 2 FAIL lines

- [ ] **Step 3: Implement**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── DOLLAR CONVERSION ──────────────────────────────────────────────────────
// VBD -> $, Ottoneu-style: $1 floor per player in the "will be paid for"
// population (starting slots + bench, leaguewide — PS/IR excluded since most
// managers don't fill them), remainder distributed by share of positive VBD
// within that same population. K/DST get a flat reserve held off the top
// instead of individual values (v1 doesn't statistically value them).
function computeDollarValues(valuedResult, league) {
  const teams = league.teams;
  const pool = teams * league.capPerTeam;

  const kDstSlots = (league.rosterSlots.K || 0) + (league.rosterSlots.DST || 0);
  const kDstReserve = (league.kDstFlatReserve || 0) * kDstSlots * teams;

  const startingSlots = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX'].reduce(
    (s, k) => s + (league.rosterSlots[k] || 0), 0,
  );
  const benchSlots = league.rosterSlots.BENCH || 0;
  const populationSize = (startingSlots + benchSlots) * teams;

  const population = valuedResult.players.slice(0, populationSize);
  const totalPositiveVBD = population.reduce((s, p) => s + Math.max(0, p.vbd), 0);
  const floorReserve = population.length * 1;
  const distributionPool = Math.max(0, pool - kDstReserve - floorReserve);

  const dollars = {};
  population.forEach(p => {
    const share = totalPositiveVBD > 0 ? Math.max(0, p.vbd) / totalPositiveVBD : 0;
    dollars[p.id] = Math.max(1, Math.round(1 + share * distributionPool));
  });
  return dollars;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `22 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add VBD-to-dollar conversion with K/DST reserve to engine"
```

---

## Task 8: Cap situation — `computeCapSituation`, `applyCapImpact`

`computeCapSituation` sums a team's committed salary from the roster rows (`Real Salary`, already present on every rostered player). `applyCapImpact` applies the PS (25%) / IR (50%) discount for the cap-impact preview toggle in the Bid Advisor.

**Files:**
- Modify: `shared.js`
- Modify: `tests/engine.test.js`

- [ ] **Step 1: Add failing tests**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/engine.test.js`
Expected: 4 FAIL lines

- [ ] **Step 3: Implement**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── CAP SITUATION ──────────────────────────────────────────────────────────
function computeCapSituation(rows, teamName, league) {
  const used = rows
    .filter(r => r.team === teamName)
    .reduce((s, r) => s + (r.salary || 0), 0);
  return { used: used, remaining: league.capPerTeam - used };
}

// PS/IR cap-impact preview: what a bid actually costs against the cap given
// where the player would be rostered. Never affects the player's $ value.
function applyCapImpact(bidAmount, slot, league) {
  if (slot === 'PS') return bidAmount * league.psCapDiscount;
  if (slot === 'IR') return bidAmount * league.irCapDiscount;
  return bidAmount;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/engine.test.js`
Expected: `26 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add shared.js tests/engine.test.js
git commit -m "Add cap situation and PS/IR cap-impact math to engine"
```

---

## Task 9: Browser storage + auto-load-from-repo helpers

`saveData`/`loadData` wrap `localStorage`; `autoLoadFromRepo` fetches `data/*.csv` on page load (ported from `OttoneuAI/shared.js`, skips when opened via `file://` per that repo's documented convention — manual upload is the local-testing fallback). These are browser-only (no `localStorage`/`fetch` in plain Node), so they're not part of the Node test suite — verified manually in Task 14 when the pages are exercised in a browser.

**Files:**
- Modify: `shared.js`

- [ ] **Step 1: Add the helpers**

Add to `shared.js`, above `// ── NODE EXPORT`:

```js
// ── LOCAL STORAGE ────────────────────────────────────────────────────────────
function saveData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadData(key) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { console.warn('loadData: bad JSON for key', key); return null; }
}

// ── REPO AUTO-LOAD ───────────────────────────────────────────────────────────
// Fetches data/<file> and parses+stores it under `key`. Skips entirely when
// opened via file:// (no fetch of local files across origins) — the Data Hub's
// manual upload covers local testing, matching the OttoneuAI convention.
const REPO_FILES = [
  { file: 'leaguetycoon_players_contracts_2026.csv', key: 'gridiron_players', parse: parseLeagueTycoonCSV },
];

async function autoLoadFromRepo() {
  if (window.location.protocol === 'file:') return {};
  const status = {};
  await Promise.all(REPO_FILES.map(async ({ file, key, parse }) => {
    try {
      const res = await fetch('./data/' + file);
      if (!res.ok) { console.warn('[autoLoad] 404:', file); status[file] = false; return; }
      const text = await res.text();
      const parsed = parse(text);
      saveData(key, parsed);
      saveData(key + '_ts', Date.now());
      status[file] = true;
    } catch (e) {
      console.error('[autoLoad] ERROR:', file, e);
      status[file] = false;
    }
  }));
  return status;
}
```

- [ ] **Step 2: Confirm no new Node exports are needed**

`saveData`/`loadData`/`autoLoadFromRepo` depend on `localStorage`/`fetch`/`window`, which don't exist in plain Node — they're intentionally left out of the `module.exports` block.

- [ ] **Step 3: Run the full suite to confirm nothing broke**

Run: `node tests/engine.test.js`
Expected: `26 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add shared.js
git commit -m "Add localStorage helpers and repo auto-load to engine"
```

---

## Task 10: `leagues.js` — league config

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\leagues.js`

- [ ] **Step 1: Write the config**

```js
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
```

- [ ] **Step 2: Sanity-check it loads in Node**

Run: `node -e "console.log(require('./leagues.js').LEAGUES[0].id)"`
Expected: `dynasty-cap`

- [ ] **Step 3: Commit**

```bash
git add leagues.js
git commit -m "Add dynasty-cap league config"
```

---

## Task 11: `theme.css` and `data/README.md`

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\theme.css`
- Create: `C:\Users\bkami\Documents\GridironAI\data\README.md`

- [ ] **Step 1: Write a minimal shared stylesheet**

```css
/* theme.css — shared page chrome across GridironAI tools */
* { box-sizing: border-box; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #222; }
h1 { font-size: 1.4rem; margin-bottom: 4px; }
.subtitle { color: #666; font-size: 0.9rem; margin-bottom: 24px; }
.nav { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
.nav a { padding: 8px 16px; background: #1a73e8; color: #fff; border-radius: 6px; text-decoration: none; font-size: 0.9rem; }
.nav a:hover, .nav a.active { background: #1557b0; }
.card { background: #fff; border-radius: 10px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
.error { background: #fce8e6; border-left: 4px solid #c62828; padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
.section-title { font-size: 1rem; font-weight: 600; margin: 24px 0 12px; }
```

- [ ] **Step 2: Write the data folder README**

```markdown
# data/

CSV files here are fetched automatically by the app on every page load
(GitHub Pages only — skipped when opened via `file://`, see `shared.js`'s
`autoLoadFromRepo`). Filenames must match exactly.

## Files

| Filename | Contents |
|---|---|
| `leaguetycoon_players_contracts_2026.csv` | League Tycoon export: ownership (team or FA), salary/contract years for rostered players, raw stat projections for all players |

## Updating data

As the slow draft progresses, re-export from League Tycoon and replace this
file (same filename). Commit to `main`; GitHub Pages picks it up on next
page load. Local testing: use the upload UI on the Data Hub (`index.html`)
instead of relying on auto-load, since `file://` pages skip it.
```

- [ ] **Step 3: Commit**

```bash
git add theme.css data/README.md
git commit -m "Add shared stylesheet and data folder README"
```

---

## Task 12: `index.html` — Data Hub

Loads the League Tycoon CSV (auto from `data/` on GitHub Pages, manual upload fallback for local testing), lets the user pick which team is theirs (persisted), shows load status. Builds all dynamic content with `createElement`/`textContent` — never `innerHTML` with interpolated data, since player/team names come from an uploaded CSV.

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\index.html`

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GridironAI — Data Hub</title>
  <link rel="stylesheet" href="theme.css">
  <style>
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; margin-bottom: 12px; }
    .badge.loaded { background: #e6f4ea; color: #1e7e34; }
    .badge.missing { background: #fce8e6; color: #c62828; }
    .card label { display: block; font-size: 0.85rem; color: #555; margin-bottom: 6px; }
    .card input[type=file] { width: 100%; font-size: 0.85rem; }
    .meta { font-size: 0.78rem; color: #888; margin-top: 6px; min-height: 18px; }
    .team-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .team-row select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>GridironAI</h1>
  <p class="subtitle">Upload your League Tycoon export once — the Bid Advisor uses it automatically.</p>

  <nav class="nav">
    <a href="index.html" class="active">Data Hub</a>
    <a href="bid.html">Bid Advisor</a>
  </nav>

  <div id="repoLoading" style="display:none;color:#666;font-size:.88rem;padding:4px 0 12px">Loading league data from repo…</div>

  <div class="section-title">My Team</div>
  <div class="team-row">
    <label for="teamSelect" style="font-size:0.9rem">Your team:</label>
    <select id="teamSelect"><option value="">— load the players CSV first —</option></select>
  </div>

  <div class="section-title">Data File</div>
  <div class="grid" id="csvGrid"></div>

  <script src="leagues.js"></script>
  <script src="shared.js"></script>
  <script>
    function buildGrid() {
      const grid = document.getElementById('csvGrid');
      while (grid.firstChild) grid.removeChild(grid.firstChild);

      const stored = loadData('gridiron_players');
      const count = stored ? stored.length : 0;
      const ts = loadData('gridiron_players_ts');

      const card = document.createElement('div');
      card.className = 'card';

      const h2 = document.createElement('h2');
      h2.textContent = 'League Tycoon Players Export';

      const badge = document.createElement('span');
      badge.className = 'badge ' + (stored ? 'loaded' : 'missing');
      badge.textContent = stored ? '\u2713 ' + count + ' players' : 'Required';

      const label = document.createElement('label');
      label.textContent = 'Upload CSV:';

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv';
      input.addEventListener('change', handleFile);

      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = ts ? new Date(ts).toLocaleString() : 'Not loaded';

      card.appendChild(h2);
      card.appendChild(badge);
      card.appendChild(label);
      card.appendChild(input);
      card.appendChild(meta);
      grid.appendChild(card);
    }

    function handleFile(event) {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        const parsed = parseLeagueTycoonCSV(e.target.result);
        saveData('gridiron_players', parsed);
        saveData('gridiron_players_ts', Date.now());
        buildGrid();
        rebuildTeamDropdown(parsed);
      };
      reader.readAsText(file);
    }

    function rebuildTeamDropdown(players) {
      const teams = Array.from(new Set(players.filter(p => !p.isFreeAgent).map(p => p.team))).sort();
      const sel = document.getElementById('teamSelect');
      const saved = loadData('gridiron_my_team') || '';
      while (sel.firstChild) sel.removeChild(sel.firstChild);

      const def = document.createElement('option');
      def.value = '';
      def.textContent = '— select your team —';
      sel.appendChild(def);

      teams.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t; // textContent — never innerHTML — since team names come from the CSV
        if (t === saved) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    document.getElementById('teamSelect').addEventListener('change', function () {
      saveData('gridiron_my_team', this.value);
    });

    (async function () {
      document.getElementById('repoLoading').style.display = '';
      await autoLoadFromRepo();
      document.getElementById('repoLoading').style.display = 'none';
      buildGrid();
      const savedPlayers = loadData('gridiron_players');
      if (savedPlayers) rebuildTeamDropdown(savedPlayers);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "Add Data Hub page"
```

---

## Task 13: `bid.html` — Bid Advisor

Cap situation header (spent / remaining, with a none/PS/IR toggle previewing discounted cap impact), a search box for the nominee, an advice card (suggested bid + bargain/fair/stretch/over bands), and a top-targets table. All dynamic content is built with `createElement`/`textContent`, matching OttoneuAI's own `bid.html` pattern — player names come from an uploaded CSV and are treated as untrusted.

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\bid.html`

- [ ] **Step 1: Write the page**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>GridironAI — Bid Advisor</title>
  <link rel="stylesheet" href="theme.css">
  <style>
    .cap-header { background: #fff; border-radius: 10px; padding: 14px 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); display: flex; gap: 28px; flex-wrap: wrap; align-items: center; margin-bottom: 20px; }
    .cap-item strong { display: block; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin-bottom: 3px; }
    .cap-item span { font-size: 1.05rem; font-weight: 700; }
    .cap-over { color: #c62828; }
    .search-wrap { position: relative; max-width: 460px; margin-bottom: 8px; }
    .bid-search { width: 100%; padding: 9px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 0.92rem; }
    .search-dd { position: absolute; left: 0; right: 0; top: 100%; background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,0.15); z-index: 20; max-height: 320px; overflow-y: auto; margin-top: 3px; }
    .dd-item { padding: 8px 12px; font-size: 0.86rem; cursor: pointer; display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px solid #f5f5f5; }
    .dd-item:hover { background: #f0f4ff; }
    .dd-val { color: #888; font-size: 0.8rem; white-space: nowrap; }
    .advice { background: #fff; border-radius: 12px; padding: 22px 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.12); margin-bottom: 24px; }
    .advice-name { font-size: 1.15rem; font-weight: 700; margin-bottom: 12px; }
    .rec-big { font-size: 2.4rem; font-weight: 800; color: #1a73e8; line-height: 1; }
    .rec-lbl { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: #999; margin-bottom: 4px; }
    .band-strip { display: flex; gap: 0; margin: 14px 0 16px; border-radius: 8px; overflow: hidden; font-size: 0.72rem; text-align: center; }
    .band { padding: 6px 4px; color: #fff; font-weight: 600; flex: 1; }
    .band small { display: block; font-weight: 400; opacity: 0.9; font-size: 0.68rem; }
    .band-bargain { background: #1e7e34; }
    .band-fair { background: #4a90d9; }
    .band-stretch { background: #e6941c; }
    .band-over { background: #c0552e; }
    .ps-toggle { display: flex; gap: 8px; align-items: center; margin: 12px 0; font-size: 0.86rem; }
    .ps-toggle button { padding: 5px 12px; border: 1px solid #ccc; border-radius: 6px; background: #fff; cursor: pointer; font-size: 0.84rem; }
    .ps-toggle button.active { background: #1a73e8; color: #fff; border-color: #1a73e8; }
    .cap-line { margin-top: 10px; padding: 10px 14px; background: #f8f8f8; border-radius: 8px; font-size: 0.86rem; }
    .warn-hard { margin-top: 8px; padding: 9px 14px; background: #fce8e6; border-left: 4px solid #c62828; border-radius: 4px; font-size: 0.84rem; color: #c62828; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.1); font-size: 0.86rem; }
    th { background: #1a73e8; color: #fff; padding: 9px 10px; text-align: right; font-weight: 600; }
    th:first-child, th:nth-child(2) { text-align: left; }
    td { padding: 7px 10px; text-align: right; border-bottom: 1px solid #f0f0f0; }
    td:first-child, td:nth-child(2) { text-align: left; }
    .tbl-wrap { overflow-x: auto; }
  </style>
</head>
<body>
  <h1>Bid Advisor</h1>
  <nav class="nav">
    <a href="index.html">Data Hub</a>
    <a href="bid.html" class="active">Bid Advisor</a>
  </nav>

  <div id="error"></div>
  <div id="content" style="display:none">
    <div class="section-title">My Cap Situation</div>
    <div class="cap-header" id="capHeader"></div>

    <div class="section-title">Who's being nominated?</div>
    <div class="search-wrap">
      <input type="text" class="bid-search" id="bidSearch" placeholder="Search a player…" autocomplete="off">
      <div class="search-dd" id="searchDD" style="display:none"></div>
    </div>
    <div id="adviceWrap"></div>

    <div class="section-title">Top Remaining Targets</div>
    <div class="tbl-wrap">
      <table>
        <thead><tr><th>Player</th><th>Pos</th><th>$ Value</th><th>VBD</th></tr></thead>
        <tbody id="topBody"></tbody>
      </table>
    </div>
  </div>

  <script src="leagues.js"></script>
  <script src="shared.js"></script>
  <script>
  (async function () {
    await autoLoadFromRepo();

    const errEl = document.getElementById('error');
    const content = document.getElementById('content');
    function showErr(msg, linkText, linkHref) {
      const d = document.createElement('div');
      d.className = 'error';
      d.textContent = msg + (linkText ? ' ' : '');
      if (linkText) {
        const a = document.createElement('a');
        a.href = linkHref;
        a.textContent = linkText;
        d.appendChild(a);
      }
      errEl.appendChild(d);
    }

    const LEAGUE = LEAGUES[0];
    const players = loadData('gridiron_players');
    const myTeam = loadData('gridiron_my_team') || '';
    if (!players) { showErr('Missing data — upload the CSV on the', 'Data Hub.', 'index.html'); return; }
    if (!myTeam) { showErr('Set your team on the', 'Data Hub.', 'index.html'); return; }

    content.style.display = '';

    const valued = valuePlayers(players, LEAGUE);
    const dollars = computeDollarValues(valued, LEAGUE);
    function dollarOf(p) { return dollars[p.id] || 1; }

    const cap = computeCapSituation(players, myTeam, LEAGUE);

    // ── Cap header ──────────────────────────────────────────────────────────
    function capItem(label, value, cls) {
      const item = document.createElement('div');
      item.className = 'cap-item';
      const strong = document.createElement('strong');
      strong.textContent = label;
      const span = document.createElement('span');
      span.textContent = value;
      if (cls) span.className = cls;
      item.appendChild(strong);
      item.appendChild(span);
      return item;
    }

    function renderCapHeader() {
      const h = document.getElementById('capHeader');
      while (h.firstChild) h.removeChild(h.firstChild);
      h.appendChild(capItem('Committed salary', '$' + cap.used));
      h.appendChild(capItem('Cap remaining', '$' + cap.remaining, cap.remaining <= 0 ? 'cap-over' : ''));
      if (cap.remaining <= 0) {
        const w = document.createElement('div');
        w.className = 'warn-hard';
        w.style.marginTop = '0';
        w.textContent = 'You are at or over your $' + LEAGUE.capPerTeam + ' cap.';
        h.appendChild(w);
      }
    }
    renderCapHeader();

    // ── Advice card ─────────────────────────────────────────────────────────
    let currentPlayer = null;
    let capSlot = 'none'; // none | PS | IR

    function bandDiv(cls, label, sub) {
      const d = document.createElement('div');
      d.className = 'band ' + cls;
      d.appendChild(document.createTextNode(label));
      const s = document.createElement('small');
      s.textContent = sub;
      d.appendChild(s);
      return d;
    }

    function renderAdvice(p) {
      currentPlayer = p;
      capSlot = 'none';
      const wrap = document.getElementById('adviceWrap');
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

      const value = dollarOf(p);
      const bargainCeil = Math.round(0.7 * value);
      const stretchCeil = Math.round(1.15 * value);

      const card = document.createElement('div');
      card.className = 'advice';

      const name = document.createElement('div');
      name.className = 'advice-name';
      name.textContent = p.name + ' (' + p.position + ', ' + p.nflTeam + ')';
      card.appendChild(name);

      const recLbl = document.createElement('div');
      recLbl.className = 'rec-lbl';
      recLbl.textContent = 'Suggested bid';
      card.appendChild(recLbl);

      const recBig = document.createElement('div');
      recBig.className = 'rec-big';
      recBig.textContent = '$' + value;
      card.appendChild(recBig);

      const strip = document.createElement('div');
      strip.className = 'band-strip';
      strip.appendChild(bandDiv('band-bargain', 'Bargain', '\u2264 $' + bargainCeil));
      strip.appendChild(bandDiv('band-fair', 'Fair', '\u2264 $' + value));
      strip.appendChild(bandDiv('band-stretch', 'Stretch', '\u2264 $' + stretchCeil));
      strip.appendChild(bandDiv('band-over', 'Overpay', '> $' + stretchCeil));
      card.appendChild(strip);

      const toggle = document.createElement('div');
      toggle.className = 'ps-toggle';
      const toggleLabel = document.createElement('span');
      toggleLabel.textContent = 'Cap impact if drafted to:';
      toggle.appendChild(toggleLabel);
      [['none', 'Active roster'], ['PS', 'Practice squad'], ['IR', 'IR']].forEach(([slot, label]) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.className = slot === 'none' ? 'active' : '';
        btn.addEventListener('click', () => {
          capSlot = slot;
          toggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderCapImpact();
        });
        toggle.appendChild(btn);
      });
      card.appendChild(toggle);

      const capLine = document.createElement('div');
      capLine.className = 'cap-line';
      capLine.id = 'capImpactLine';
      card.appendChild(capLine);

      wrap.appendChild(card);
      renderCapImpact();
    }

    function renderCapImpact() {
      if (!currentPlayer) return;
      const value = dollarOf(currentPlayer);
      const impact = Math.round(applyCapImpact(value, capSlot, LEAGUE));
      const after = cap.remaining - impact;
      const line = document.getElementById('capImpactLine');
      line.textContent = 'A $' + value + ' bid costs $' + impact + ' of cap room' +
        (capSlot !== 'none' ? ' (' + capSlot + ' discount applied)' : '') +
        ' — $' + after + ' left after.';
    }

    // ── Search dropdown ─────────────────────────────────────────────────────
    const available = valued.players.filter(p => {
      const raw = players.find(pl => pl.id === p.id);
      return raw && raw.isFreeAgent;
    });
    const byValue = available.slice().sort((a, b) => dollarOf(b) - dollarOf(a));

    const searchEl = document.getElementById('bidSearch');
    const ddEl = document.getElementById('searchDD');
    function closeDD() {
      ddEl.style.display = 'none';
      while (ddEl.firstChild) ddEl.removeChild(ddEl.firstChild);
    }
    searchEl.addEventListener('input', function () {
      const q = this.value.toLowerCase().trim();
      closeDD();
      if (!q) return;
      const hits = byValue.filter(p => p.name.toLowerCase().indexOf(q) !== -1).slice(0, 12);
      if (!hits.length) return;
      hits.forEach(p => {
        const item = document.createElement('div');
        item.className = 'dd-item';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = p.name + ' (' + p.position + ')';
        const valSpan = document.createElement('span');
        valSpan.className = 'dd-val';
        valSpan.textContent = '$' + dollarOf(p);
        item.appendChild(nameSpan);
        item.appendChild(valSpan);
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          searchEl.value = p.name;
          closeDD();
          renderAdvice(p);
        });
        ddEl.appendChild(item);
      });
      ddEl.style.display = '';
    });
    searchEl.addEventListener('blur', () => setTimeout(closeDD, 150));

    // ── Top targets table ───────────────────────────────────────────────────
    const topBody = document.getElementById('topBody');
    byValue.slice(0, 30).forEach(p => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      [p.name, p.position, '$' + dollarOf(p), p.vbd.toFixed(1)].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tr.addEventListener('click', () => { searchEl.value = p.name; renderAdvice(p); });
      topBody.appendChild(tr);
    });
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add bid.html
git commit -m "Add Bid Advisor page"
```

---

## Task 14: Manual end-to-end verification

Real-data sanity check before relying on this live, per the design spec's Testing section.

**Files:** none (verification only)

- [ ] **Step 1: Open the Data Hub locally and load the real CSV**

Open `index.html` directly in a browser (file:// — auto-load is skipped by design, so use the upload control). Upload `data/leaguetycoon_players_contracts_2026.csv`. Confirm the badge shows "✓ 2208 players" and the team dropdown lists real team names (e.g. "Team 10", "Herbert the Chubb Bug").

- [ ] **Step 2: Pick a team and open the Bid Advisor**

Select any team with a non-trivial roster (e.g. "Herbert the Chubb Bug", which had Bijan Robinson $164, Joe Burrow $184, Amon-Ra St. Brown $119 in the sample data). Navigate to `bid.html`. Confirm the cap header shows a committed-salary total that's the sum of that team's real `Real Salary` values and no console errors appear.

- [ ] **Step 3: Sanity-check a suggested bid against hand-computed expectations**

Search for Ja'Marr Chase (a top free agent in the sample data, WR, 121.01 rec / 1431.99 recYd / 10.91 recTD / 18.48 rushYd / 0.05 rushTD → 331.817 raw points per Task 4's test vector). Confirm:
- The advice card shows a suggested bid well above $1 (he's a clear top-of-pool WR).
- The bargain/fair/stretch bands are internally consistent (bargain < fair < stretch).
- Toggling "Practice squad" drops the cap-impact line to 25% of the bid; toggling "IR" drops it to 50%.

- [ ] **Step 4: Spot-check the top targets table**

Confirm the top-targets table is sorted descending by $ value, and that known elite free agents from the sample data (Jonathan Taylor, Justin Jefferson) appear near the top rather than a kicker or deep bench player.

- [ ] **Step 5: Note the outcome**

If anything looks wrong (a $1000 bid for a bench player, negative $ values, a crash), stop and diagnose against `shared.js` before proceeding — do not paper over a wrong number. If everything checks out, proceed to Task 15.

---

## Task 15: `MODEL.md`

Written last, once the engine is final — documents the math the way `OttoneuAI/MODEL.md` does, so the assumptions made during planning (especially the $-conversion population size, a genuine modeling judgment call) are visible and revisable once real bids provide market-price signal.

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\MODEL.md`

- [ ] **Step 1: Write it**

```markdown
# MODEL.md — How GridironAI Computes Bid Values

Reference for maintaining `shared.js`. Read before changing any valuation math.

League: Dynasty $1000 Cap, 10 teams, $10,000 pool. Points-based (not
category/roto). Superflex-capable (1 QB + 1 SUPERFLEX). Full rules in
`docs/superpowers/specs/2026-08-17-bid-advisor-v1-design.md`.

## 1. Data feed

`data/leaguetycoon_players_contracts_2026.csv` — League Tycoon export,
manually re-pulled and committed as the slow draft progresses. Ownership
(`Team` vs `FA`) and `Real Salary` come straight from the export; fantasy
points are **recomputed from raw stats** using this league's scoring
rules, never trusted from the export's own `PROJ FPTS`/`VAL` columns
(those reflect League Tycoon's own scoring assumptions).

**Known gap:** no fumbles-lost or 2pt-conversion data in the export. Both
score as 0. Small impact for the large majority of players.

## 2. Scoring

Position-conditional receptions (RB 0.5 / WR 1.0 / TE 1.5); everything
else is a flat per-unit weight. See `leagues.js` for the exact table.

## 3. Replacement level (superflex-aware)

Ported from `Fantasy Football tools/src/core/replacement.ts`. Startable
counts = teams × base slots per position, then FLEX awarded to the best
leftover RB/WR/TE, then SUPERFLEX awarded to the best leftover QB/RB/WR/TE
— whichever is highest-scoring wins each award. Replacement level per
position = the points of the first player who doesn't crack that count.
K/DST excluded entirely (not statistically valued in v1).

## 4. VBD → dollars

Every player's VBD = his points minus his position's replacement level.

**$ conversion population** (`computeDollarValues`): the top
`(starting slots + bench slots) × teams` players by VBD get an
individually computed dollar value; everyone else is bench-caliber ($1,
not individually tracked). This is a **judgment call, not a measured
constant** — it approximates "how many roster spots will actually get
paid for," using starting + bench slots and excluding practice
squad/IR (10 + 2 slots/team) since most managers don't fill those. If
real bidding data suggests this population is too small (stars are
overvalued because the reserve for bench spending is too low) or too
large (stars are undervalued), this is the first knob to revisit —
see the Tunable knobs table below.

Within that population: $1 floor each, K/DST get a flat
`kDstFlatReserve` ($1) × (K+DST slots) × teams held off the top of the
pool (not distributed to any individual, since K/DST aren't valued),
remainder distributed by share of **positive** VBD. Below-replacement
players in the population land at exactly $1 (their VBD floors the
share calc at 0), matching how real bidders don't pay more than the
minimum for replacement-level production.

## 5. PS / IR cap impact

A bid's cap impact depends on where the player lands: full price on the
active roster/bench, 25% on the practice squad, 50% on IR
(`applyCapImpact`). This only affects the cap-room preview in the Bid
Advisor — never the player's underlying $ value.

## 6. Tunable knobs

| Knob | Where | Current | Meaning |
|---|---|---|---|
| `kDstFlatReserve` | `leagues.js` | $1/spot | $ held off the pool per K/DST roster spot, since real bids happen even though they're unvalued |
| $ conversion population | `computeDollarValues` (`shared.js`) | starting + bench slots, excl. PS/IR | who gets an individually computed $ value vs. a flat $1 |
| `psCapDiscount` / `irCapDiscount` | `leagues.js` | 25% / 50% | cap-impact preview multipliers |

## 7. Known limitations (accepted for v1)

- K/DST have no individual $ values (flat $1/spot reserve only).
- No multi-year dynasty valuation horizon — this is a single-season
  points-to-dollars model, not a keeper-value/contract-horizon model.
- Fumbles-lost and 2pt-conversion rates aren't in the data source; both
  score as 0.
- Opponents' PS/IR designations aren't in the data source, so opposing
  teams' cap totals use full (undiscounted) salary as an approximation.
  Your own team's PS/IR status is tracked precisely via the Bid
  Advisor's toggle.
```

- [ ] **Step 2: Commit**

```bash
git add MODEL.md
git commit -m "Add MODEL.md math reference"
```

---

## Task 16: Top-level README

**Files:**
- Create: `C:\Users\bkami\Documents\GridironAI\README.md`

- [ ] **Step 1: Write it**

```markdown
# GridironAI

A multi-league fantasy football tool suite — static HTML/JS, no backend,
modeled on the [OttoneuAI](https://github.com/bkamisar/OttoneuAI) suite's
approach. Deployed to GitHub Pages so it's usable from any device.

## v1: Bid Advisor

For the $1000-cap dynasty league's ongoing slow auction draft. Open
`index.html`, upload the League Tycoon players export, pick your team,
then use `bid.html` to get a suggested $ value for any nominated player.

See `docs/superpowers/specs/2026-08-17-bid-advisor-v1-design.md` for the
full design and `MODEL.md` for the valuation math once implemented.

## Tests

`node tests/engine.test.js` — no npm install required.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add top-level README"
```
