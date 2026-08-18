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

// ── NODE EXPORT (test-only; no-op in the browser) ─────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { esc, parseCSV, parseCSVLine, parseLeagueTycoonCSV, scorePlayer };
}
