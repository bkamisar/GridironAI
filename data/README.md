# data/

CSV files here are fetched automatically by the app on every page load
(GitHub Pages only — skipped when opened via `file://`, see `shared.js`'s
`autoLoadFromRepo`). Filenames must match exactly.

## Files

| Filename | Contents |
|---|---|
| `leaguetycoon_players_contracts_2026.csv` | League Tycoon export: ownership (team or FA), salary/contract years for rostered players, raw stat projections for all players |
| `sleeper_bio_2026.csv` | Age/years-exp for active QB/RB/WR/TE, derived from Sleeper's public `/v1/players/nfl` endpoint (no auth, no rate limit — see below). Columns: `name,position,team,age,years_exp` |

## Updating data

**League Tycoon export:** as the slow draft progresses, re-export and
replace `leaguetycoon_players_contracts_2026.csv` (same filename). Commit
to `main`; GitHub Pages picks it up on next page load. Local testing: use
the upload UI on the Data Hub (`index.html`) instead of relying on
auto-load, since `file://` pages skip it.

**Sleeper bio data:** ages don't change week to week, so this only needs
refreshing occasionally (a new season, or to pick up newly-signed players).
Regenerate with:

```js
// One-time/occasional script — fetch, filter, write.
const raw = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
const rows = [];
for (const id in raw) {
  const p = raw[id];
  if (!['QB','RB','WR','TE'].includes(p.position)) continue;
  if (p.age == null || !p.active) continue;
  rows.push([p.full_name || (p.first_name + ' ' + p.last_name), p.position, p.team || '', p.age, p.years_exp ?? ''].join(','));
}
// write ['name,position,team,age,years_exp', ...rows].join('\n') to sleeper_bio_2026.csv
```

Sleeper's docs ask for at most one call per day to this endpoint (it's a
~14MB dump of every NFL player, active and inactive) — this is exactly
that occasional bulk sync, not a live per-page-load call. See
`matchBioData`/`normalizeName` in `shared.js` for how rows get matched to
League Tycoon player names (which don't always agree with Sleeper's — e.g.
suffixes like "Jr." are often dropped).
