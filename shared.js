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
  const headers = parseCSVLine(lines[0], delim).map(h => h.trim());
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const values = parseCSVLine(line, delim);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
      return obj;
    });
}

// ── LEAGUE TYCOON PARSER ──────────────────────────────────────────────────────
// Maps the raw export's headers to our internal stat keys. Missing/blank cells
// are omitted from `stats` (not defaulted to 0) so scorePlayer only sums stats
// the export actually provided.
const LT_STAT_COLS = {
  'RUSH YD': 'rushYd', 'RUSH TD': 'rushTD',
  'REC': 'rec', 'REC YD': 'recYd', 'REC TD': 'recTD',
  'PASS YD': 'passYd', 'PASS TD': 'passTD', 'PASS INT': 'int',
};

// NOTE: `id` (name-nflTeam-rowIndex) is stable only within a single parse call —
// it is NOT stable across re-imports (row order changes between League Tycoon
// exports). Do not persist `id` across page loads/sessions without addressing this.
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

  // Defensive: don't trust caller ordering (valuePlayers already sorts by vbd
  // desc, but a future caller could re-sort valuedResult.players in place,
  // e.g. bid.html sorting for alphabetical display).
  const sorted = valuedResult.players.slice().sort((a, b) => b.vbd - a.vbd);
  const population = sorted.slice(0, populationSize);
  const totalPositiveVBD = population.reduce((s, p) => s + Math.max(0, p.vbd), 0);
  const floorReserve = population.length * 1;
  // Assumes population floors ($1 each) fit within the pool, true for any
  // plausibly-sized league (this one: 180 floors vs a $10,000 pool). A
  // misconfigured tiny league could have floor obligations exceed the pool —
  // not guarded against, not expected to occur in practice.
  const distributionPool = Math.max(0, pool - kDstReserve - floorReserve);

  // Independent per-player rounding means sum(dollars) + kDstReserve can drift
  // slightly from `pool` (confirmed ~0.03% on real data) — acceptable for v1's
  // advisory bid suggestions; not treated as a hard constraint to reconcile.
  const dollars = {};
  population.forEach(p => {
    const share = totalPositiveVBD > 0 ? Math.max(0, p.vbd) / totalPositiveVBD : 0;
    dollars[p.id] = Math.max(1, Math.round(1 + share * distributionPool));
  });
  return dollars;
}

// ── LINEUP OPTIMIZATION (single team) ─────────────────────────────────────────
// Assigns ONE team's players to starting slots to maximize total starting
// points — same greedy logic as computeStartableCounts (base slots, then
// FLEX, then SUPERFLEX awarded to the highest-scoring eligible leftover),
// applied to a single roster instead of a league-wide population. Used for
// lineup-impact previews: "does this player start for me, and who does he
// bump?" Ranks by raw points (not VBD) — the goal here is maximizing this
// team's total output, not marginal value over league replacement.
function optimizeLineup(players, slots) {
  const groups = byPositionDesc(players);
  const bySlot = { QB: [], RB: [], WR: [], TE: [], FLEX: [], SUPERFLEX: [] };
  const used = new Set();

  VALUED_POSITIONS.forEach(pos => {
    const list = groups[pos] || [];
    const n = slots[pos] || 0;
    for (let i = 0; i < n && i < list.length; i++) {
      bySlot[pos].push(list[i]);
      used.add(list[i].id);
    }
  });

  function bestUnused(eligible) {
    let best = null;
    eligible.forEach(pos => {
      (groups[pos] || []).forEach(p => {
        if (!used.has(p.id) && (best === null || p.points > best.points)) best = p;
      });
    });
    return best;
  }

  for (let i = 0; i < (slots.FLEX || 0); i++) {
    const p = bestUnused(FLEX_ELIGIBLE);
    if (!p) break;
    bySlot.FLEX.push(p);
    used.add(p.id);
  }
  for (let i = 0; i < (slots.SUPERFLEX || 0); i++) {
    const p = bestUnused(SUPERFLEX_ELIGIBLE);
    if (!p) break;
    bySlot.SUPERFLEX.push(p);
    used.add(p.id);
  }

  const starters = [].concat(bySlot.QB, bySlot.RB, bySlot.WR, bySlot.TE, bySlot.FLEX, bySlot.SUPERFLEX);
  const bench = players.filter(p => !used.has(p.id));
  return {
    bySlot: bySlot,
    starters: starters,
    starterIds: new Set(starters.map(p => p.id)),
    bench: bench,
    startersTotal: starters.reduce((s, p) => s + p.points, 0),
  };
}

// Describes a hypothetical add's impact on a lineup: which slot the
// candidate would occupy (null if he doesn't crack the starting lineup),
// which currently-starting players get displaced to the bench, and the net
// change in total starting points.
function lineupImpact(beforeLineup, afterLineup, candidateId) {
  let landedSlot = null;
  ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX'].forEach(slot => {
    if (afterLineup.bySlot[slot].some(p => p.id === candidateId)) landedSlot = slot;
  });
  const bumped = beforeLineup.starters.filter(p => !afterLineup.starterIds.has(p.id));
  return {
    landedSlot: landedSlot,
    bumped: bumped,
    pointsDelta: afterLineup.startersTotal - beforeLineup.startersTotal,
  };
}

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

// This league has no cap-relief mechanism (no salary-only trades, unlike
// Ottoneu) — going over the cap isn't a soft warning, it's an illegal
// transaction. Reusable by any tool checking a hypothetical roster move
// (a bid, a trade, an add/drop) against the hard cap: pass the team's
// currently-committed salary and the net $ change the move would add
// (negative for a move that frees up cap, e.g. sending salary away in a
// trade). Equality (exactly at the cap) is legal.
function isCapLegal(currentUsed, additionalCommitment, league) {
  return currentUsed + additionalCommitment <= league.capPerTeam;
}

// ── SLEEPER BIO DATA (age / experience) ───────────────────────────────────────
// data/sleeper_bio_2026.csv is a filtered derivative of Sleeper's public,
// no-auth /v1/players/nfl endpoint (active QB/RB/WR/TE with a known age) —
// see data/README.md for how to refresh it. Sleeper's own player names don't
// always match League Tycoon's (e.g. suffixes like "Jr." are frequently
// dropped), so matching goes through normalizeName rather than an exact
// string compare.
function parseSleeperBioCSV(text) {
  const rows = parseCSV(text);
  return rows.map(row => ({
    name: row['name'] || '',
    position: row['position'] || '',
    team: row['team'] || '',
    age: row['age'] !== '' && row['age'] != null ? Number(row['age']) : null,
    yearsExp: row['years_exp'] !== '' && row['years_exp'] != null ? Number(row['years_exp']) : null,
  }));
}

const NAME_SUFFIX_RE = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;

function normalizeName(name) {
  let n = String(name).toLowerCase();
  n = n.replace(NAME_SUFFIX_RE, '');
  n = n.replace(/[.']/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

// Attaches age/yearsExp (null if unmatched — never guessed) to each player.
// Matches on normalizeName(name) + position; when that's ambiguous (a real
// but rare case — e.g. two active "Frank Gore" RBs, one of them the son of
// the well-known veteran), narrows by nflTeam. Still ambiguous after that ->
// no match, rather than silently picking one and risking a wrong age.
function matchBioData(players, bioRows) {
  const index = {};
  bioRows.forEach(row => {
    const key = normalizeName(row.name) + '|' + row.position;
    (index[key] = index[key] || []).push(row);
  });
  return players.map(p => {
    const key = normalizeName(p.name) + '|' + p.position;
    let candidates = index[key] || [];
    if (candidates.length > 1) {
      const byTeam = candidates.filter(c => c.team === p.nflTeam);
      candidates = byTeam.length === 1 ? byTeam : [];
    }
    const match = candidates.length === 1 ? candidates[0] : null;
    return Object.assign({}, p, {
      age: match ? match.age : null,
      yearsExp: match ? match.yearsExp : null,
    });
  });
}

// ── AGE CURVE (rough approximation, not a real per-player projection) ───────
// See docs/superpowers/specs for sourcing notes. minAge/maxAge define an
// inclusive age bucket per position; maxAge 999 means "this age and up."
function parseAgeCurveCSV(text) {
  const rows = parseCSV(text);
  return rows.map(row => ({
    position: row['position'] || '',
    minAge: Number(row['minAge']),
    maxAge: Number(row['maxAge']),
    multiplier: Number(row['multiplier']),
  }));
}

function ageCurveMultiplier(position, age, curveRows) {
  if (age == null) return null;
  const row = curveRows.find(r => r.position === position && age >= r.minAge && age <= r.maxAge);
  return row ? row.multiplier : null;
}

// Scales each future year's VALUE relative to the player's CURRENT-age
// multiplier (year 0 always uses exactly 1x, so it reduces to this season's
// real value), then re-subtracts the flat salary to get that year's surplus
// — salary doesn't grow with an age curve, only production does, so scaling
// the combined surplus number directly (rather than value alone) would
// distort any player whose surplus is salary-dominated. Sums across `years`.
// Returns null rather than a fake number when age or curve coverage is
// missing — never silently substitutes a guess.
function curveAdjustedTermValue(position, age, years, value, salary, curveRows) {
  const base = ageCurveMultiplier(position, age, curveRows);
  if (base == null) return null;
  let sum = 0;
  for (let i = 0; i < years; i++) {
    const m = ageCurveMultiplier(position, age + i, curveRows);
    const yearValue = m != null ? value * (m / base) : value;
    sum += yearValue - salary;
  }
  return sum;
}

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
  { file: 'sleeper_bio_2026.csv', key: 'gridiron_bio', parse: parseSleeperBioCSV },
  { file: 'age_curve_2026.csv', key: 'gridiron_age_curve', parse: parseAgeCurveCSV },
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

// ── NODE EXPORT (test-only; no-op in the browser) ─────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, parseCSV, parseCSVLine, parseLeagueTycoonCSV, scorePlayer,
    computeStartableCounts, computeReplacementLevels, valuePlayers,
    computeDollarValues, computeCapSituation, applyCapImpact, isCapLegal,
    optimizeLineup, lineupImpact,
    parseSleeperBioCSV, normalizeName, matchBioData,
    parseAgeCurveCSV, ageCurveMultiplier, curveAdjustedTermValue,
  };
}
