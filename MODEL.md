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
