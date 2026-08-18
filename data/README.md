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
