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
