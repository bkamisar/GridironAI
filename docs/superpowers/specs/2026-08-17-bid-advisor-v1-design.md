# GridironAI — Bid Advisor v1 Design

Status: approved, pending League Tycoon sample export
Date: 2026-08-17

## Purpose

GridironAI is a multi-league fantasy football tool suite, modeled directly on
the OttoneuAI suite's approach (static HTML/JS, no backend, `shared.js`
valuation engine, `data/` CSVs auto-loaded on page load, deployed to GitHub
Pages so it's usable from any device). It will eventually cover all of the
user's leagues (this $1000-cap dynasty league first, then the superflex
league and redraft snake leagues), sharing one set of player projections
(Mike Clay's ESPN Draft Kit PDF, already converted to CSV in the
`Fantasy Football tools` repo at `data/clay_2026_offense.csv`) across
per-league scoring/roster configs.

v1's concrete deliverable: a **Bid Advisor** tool for one specific league's
ongoing offseason slow (nominate-and-bid) auction draft, giving the user a
suggested dollar value for any nominated player in real time.

## League context (v1's first league)

- $1000 salary cap per team, 10 teams ($10,000 total pool), dynasty (keep-forever)
- Starting lineup: 1 QB, 2 RB, 2 WR, TE, FLEX, SUPERFLEX, DST, K
- Bench: 10 spots, plus a practice squad for rookies who have never appeared in an NFL game
- **Practice squad cap treatment**: a PS player's salary counts at **25%** against the $1000 cap (not the full bid amount)
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
    clay_2026_offense.csv   # copied from Fantasy Football tools repo (shared across leagues)
    <league>_rosters.csv    # League Tycoon export: team, player, position, salary, slot
  README.md              # data/ file conventions, update instructions (mirrors OttoneuAI's)
```

### Multi-league data model

Each league is a config object in `leagues.js`:

```js
{
  id: 'dynasty-cap',
  name: '...',
  teams: 10,
  capPerTeam: 1000,
  rosterSlots: { QB:1, RB:2, WR:2, TE:1, FLEX:1, SUPERFLEX:1, K:1, DST:1, BENCH:10, PS: null /* TBD, see Open item */ },
  psCapDiscount: 0.25,
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
4. **Practice squad cap-impact preview** — a PS toggle on a bid target
   shows cap impact as `bid × 0.25` rather than the full bid amount, per
   the league's PS discount rule.

K and DST players are excluded from the VBD/$ valuation entirely in v1 —
they won't appear with a computed suggested-bid value. Each gets a flat
$1-per-spot line in the cap-math reserve only.

## Bid Advisor page (`bid.html`)

Modeled directly on OttoneuAI's `bid.html`:

- **Cap situation header**: spent, remaining, PS-adjusted remaining.
- **Search box**: type the player being nominated → advice card with
  suggested bid, bargain/fair/stretch/over bands relative to remaining cap
  and roster needs, and a PS-toggle to preview discounted cap impact.
- **Top targets table**: best remaining $ values among not-yet-rostered
  players, filterable by position.

## League Tycoon import

Blocked on a sample export/API response (user to provide). Needs, at
minimum, per rostered player: team, name, position, salary, and
slot designation (starter / bench / practice squad) — used to compute each
team's remaining cap and to exclude already-rostered players from the
"available to bid on" pool. Importer will be built against the real export
shape once received; exact parsing logic is not finalized in this spec.

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
- Rookies included, assuming Clay's projections cover them (to be verified
  once player names are cross-checked against the League Tycoon export)
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

- League Tycoon roster/salary export sample — needed before the import
  component can be built or planned in detail.
- Exact practice squad slot count per team — needed to finalize the
  `rosterSlots.PS` value in `leagues.js`. Doesn't block engine/Bid Advisor
  work (PS cap-impact is computed per-player via the toggle, not from the
  slot count), but should be filled in before the Data Hub's roster
  overview is built.
