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

// ── NODE EXPORT (test-only; no-op in the browser) ─────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, parseCSV, parseCSVLine, parseLeagueTycoonCSV, scorePlayer,
    computeStartableCounts, computeReplacementLevels, valuePlayers,
    computeDollarValues,
  };
}
