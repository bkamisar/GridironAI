# GridironAI — Bid Advisor v1 Design

Status: approved, data in hand — ready for implementation planning
Date: 2026-08-17

## Purpose

GridironAI is a multi-league fantasy football tool suite, modeled directly on
the OttoneuAI suite's approach (static HTML/JS, no backend, `shared.js`
valuation engine, `data/` CSVs auto-loaded on page load, deployed to GitHub
Pages so it's usable from any device). It will eventually cover all of the
user's leagues (this $1000-cap dynasty league first, then the superflex
league and redraft snake leagues), sharing player projections across
per-league scoring/roster configs. For this league, the projection +
ownership source is a League Tycoon export (see Data sources below) rather
than the Clay PDF/CSV used by the separate React draft-assistant app —
future leagues may draw from either source depending on what each
platform provides.

v1's concrete deliverable: a **Bid Advisor** tool for one specific league's
ongoing offseason slow (nominate-and-bid) auction draft, giving the user a
suggested dollar value for any nominated player in real time.

## League context (v1's first league)

- $1000 salary cap per team, 10 teams ($10,000 total pool), dynasty (keep-forever)
- Starting lineup: 1 QB, 2 RB, 2 WR, TE, FLEX, SUPERFLEX, DST, K
- Bench: 10 spots, plus a 10-slot practice squad for rookies who have never
  appeared in an NFL game (most managers don't fill all 10), plus 2 IR slots
- **Practice squad cap treatment**: a PS player's salary counts at **25%** against the $1000 cap (not the full bid amount)
- **IR cap treatment**: an IR player's salary counts at **50%** against the $1000 cap
- Draft mechanic: nominate a player, timed bidding window, highest bid wins
- Draft is already in progress — some rosters/salaries are already committed (League Tycoon platform)
- Undrafted rookies (from an earlier separate rookie draft) are in this same auction pool alongside veterans

### Scoring rules

| Category | Rule |
|---|---|
| Passing | 0.04 pt/yd, 6 pt/TD, -4/INT, 2 pt/2pt conversion |
| Rushing | 0.1 pt/yd, 6 pt/TD, 2 pt/2pt conversion |
| Receiving | 0.1 pt/yd, 6 pt/TD, 2 pt/2pt conversion |
| Receptions | **position-conditional**: RB 0.5, WR 1.0, TE 1.5 |
| Fumbles lost | -2 |
| K / DST | **not statistically valued in v1** (see Scope) — each gets a flat $1/roster spot reserved off the pool instead |

**Known data gap**: the League Tycoon export (see Data sources below) does
not project fumbles-lost or 2pt-conversion rates per player. Both
contribute 0 to v1 scoring. Real
impact is small for the large majority of players; call out in `MODEL.md`
as a known simplification, not a bug, if a valuation looks slightly off
for high-fumble/goal-line-vulture types.

## Architecture

New standalone repo, `GridironAI`, sibling to `Fantasy Football tools` and
`OttoneuAI` in `C:\Users\bkami\Documents\`. Plain HTML/CSS/JS, no build
step, no backend — deployed to GitHub Pages.

```
GridironAI/
  index.html          # Data Hub: cap overview, CSV auto-load, manual upload fallback
  bid.html             # Bid Advisor (v1's deliverable)
  shared.js            # valuation engine (scoring, VBD, $ conversion) + leagues.js config
  leagues.js            # per-league config objects (roster slots, scoring, cap, PS discount)
  theme.css
  MODEL.md              # math reference + invariants, written once engine is implemented
  data/
    leaguetycoon_players_contracts_2026.csv  # League Tycoon export: ownership, salary/years, raw stat projections
  README.md              # data/ file conventions, update instructions (mirrors OttoneuAI's)
```

### Data sources

One file feeds v1 (obtained, committed to `data/`):

**`leaguetycoon_players_contracts_2026.csv`** — one row per player
league-wide (2,208 rows): fantasy team name or `FA`, name, position, NFL
team, `Real Salary` + `Years` (rostered players only, blank for `FA`
rows), League Tycoon's own `VAL`/`ADP`/`PROJ FPTS` (informational only —
see below), and raw per-season-projected stats (rush/rec/pass yards, TDs,
INTs, etc.). This single export covers everything v1 needs:

- **Ownership** — `Team` vs `FA` tells us which players are already
  rostered (excluded from bid targets) vs. free agents (biddable).
- **Salary/cap data** — `Real Salary` gives exact $ paid per rostered
  player (163 of 2,208 rows are currently rostered), enough to compute
  each team's total cap used (`sum(Real Salary)` per team) without
  needing a separate export.
- **Stats to score** — raw stat columns, scored via this league's custom
  rules rather than trusting League Tycoon's own `PROJ FPTS` (which
  reflects League Tycoon's scoring assumptions, not necessarily this
  league's exact rules). `PROJ FPTS`/`VAL` are kept only as an informal
  sanity-check cross-reference.

Replaces the Clay CSV (`Fantasy Football tools/data/clay_2026_offense.csv`)
for this league — broader coverage (ownership status, a much larger pool
including deep rookies). Clay remains the projections source for the
separate React draft-assistant app; unrelated to this repo.

**Known gap**: no column indicates PS/IR slot assignment for rostered
players — only total salary and team. This doesn't block computing each
team's total cap used (exact, from `Real Salary`), but it means the
PS/IR *discount* can't be derived automatically from this file alone.
v1's resolution: the Bid Advisor lets the user manually mark which of
**their own** roster's players are on PS/IR (the case that actually
matters for "how much can I bid") rather than trying to infer or import
every opponent's PS/IR status — opponents' totals use full (undiscounted)
salary as a reasonable approximation of their spent cap.

### Multi-league data model

Each league is a config object in `leagues.js`:

```js
{
  id: 'dynasty-cap',
  name: '...',
  teams: 10,
  capPerTeam: 1000,
  rosterSlots: { QB:1, RB:2, WR:2, TE:1, FLEX:1, SUPERFLEX:1, K:1, DST:1, BENCH:10, PS:10, IR:2 },
  psCapDiscount: 0.25,
  irCapDiscount: 0.50,
  scoring: { passYd: 0.04, passTD: 6, int: -4, twoPt: 2, rushYd: 0.1, rushTD: 6,
             recYd: 0.1, recTD: 6, fumLost: -2,
             recByPosition: { RB: 0.5, WR: 1.0, TE: 1.5 } },
  kDstFlatReserve: 1, // $ per K/DST roster spot, held out of the pool before VBD-share distribution
}
```

Adding the next league later means adding another config entry and its own
roster/salary data file — the engine and projections are shared, not
duplicated.

## Valuation engine (`shared.js`)

Ports the same algorithm already implemented and unit-tested in the
`Fantasy Football tools` React app's `src/core/` (scoring → replacement
level → VBD → tiers → z-score), re-expressed in plain JS, extended to
support:

1. **Position-conditional scoring** — `recByPosition` overrides the flat
   per-stat weight for the `rec` stat based on the player's position.
2. **Superflex-aware replacement level** — reused as-is from the validated
   React app logic (SUPERFLEX counts toward positional replacement pools
   the same way FLEX does).
3. **$ conversion (VBD → dollars)** — Ottoneu-style: every valued
   (non-K/DST) rostered player gets a $1 floor; the remaining pool is
   distributed by share of total positive VBD.
   - **Pool adjustment**: before distribution, subtract
     `kDstFlatReserve × (K slots + DST slots) × teams` from the $10,000
     pool, since real bids on K/DST happen even though we don't project
     their points. This keeps QB/RB/WR/TE dollars from being inflated by
     pretending nobody spends on kickers/defense.
4. **PS/IR cap-impact preview** — a toggle on a bid target (none / PS / IR)
   shows cap impact as `bid × 1.0`, `bid × 0.25`, or `bid × 0.50`
   respectively, per the league's discount rules. This only affects the
   cap-room preview, never the player's underlying $ value.

K and DST players are excluded from the VBD/$ valuation entirely in v1 —
they won't appear with a computed suggested-bid value. Each gets a flat
$1-per-spot line in the cap-math reserve only.

## Bid Advisor page (`bid.html`)

Modeled directly on OttoneuAI's `bid.html`:

- **Cap situation header**: spent, remaining, PS/IR-adjusted remaining.
- **Search box**: type the player being nominated → advice card with
  suggested bid, bargain/fair/stretch/over bands relative to remaining cap
  and roster needs, and a none/PS/IR toggle to preview discounted cap impact.
- **Top targets table**: best remaining $ values among not-yet-rostered
  players, filterable by position.

## League Tycoon import

Resolved — both ownership and salary data come from the single
`leaguetycoon_players_contracts_2026.csv` export (see Data sources).
Import logic: parse the CSV, key rows by `Team`, sum `Real Salary` per
team for cap-used, treat `FA` rows as the biddable pool. Re-importing an
updated export (as the slow draft progresses) is just dropping a fresh
copy of the same file in `data/` — no schema changes expected.

## Testing

Mirrors the discipline already used in `Fantasy Football tools`: unit
tests for the scoring/VBD/$ conversion math (in particular the
position-conditional reception scoring and the K/DST pool-reserve
adjustment, since both are new relative to the ported React logic).
Manual verification of the Bid Advisor UI against known player values
before relying on it live during the draft.

## Scope boundaries

**In v1:**
- This one dynasty league's $ valuations for QB/RB/WR/TE (offense only)
- Rookies included — `leaguetycoon_players_contracts_2026.csv` already
  covers them (confirmed: undrafted rookies appear with `FA` ownership and
  projected stats)
- Bid Advisor tool + Data Hub (CSV/import loading, cap overview)
- Single-year (this-season) points → dollars; **not** a multi-year
  dynasty horizon model (no Ottoneu-style Y0+0.90×Y1+0.81×Y2 blend in v1)

**Explicitly out of v1 (future phases):**
- Real K/DST statistical valuation (needs a defense/kicker projection data
  source not currently available — flat $1/spot only for now)
- Additional leagues (superflex, redraft snake) — architecture supports
  adding them, but no other league's config/data is built yet
- Additional Ottoneu-suite-style tools: roster analysis, trade finder,
  standings/briefing dashboard, FA/waiver finder
- Start/sit weekly lineup tool
- Multi-year dynasty valuation horizon (contract-horizon math like
  Ottoneu's `computeContractHorizon`)

## Open items

None blocking. All data needed for v1 is in hand
(`leaguetycoon_players_contracts_2026.csv`). Remaining known gaps
(fumbles/2pt scoring data, per-opponent PS/IR designation) are accepted
simplifications documented above, not open questions.
