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

## 6. Hard cap legality

This league has no cash trades (unlike Ottoneu) to bail out an over-cap
roster, so exceeding the cap isn't a soft warning — it's illegal.
`isCapLegal(currentUsed, additionalCommitment, league)` is the one
reusable primitive for this: pass a team's currently-committed salary and
the net $ change a hypothetical move would add (negative for a move that
frees cap, e.g. sending salary away in a trade). Equality (exactly at the
cap) is legal. The Bid Advisor uses it both for the team-wide cap header
and for a specific bid's cap impact, rendering an unmissable "ILLEGAL"
banner rather than colored text when a move would violate it. A future
trade tool should reuse this same function rather than re-deriving the
legality check.

## 7. Lineup impact (`optimizeLineup` / `lineupImpact`)

Answers "does this player start for me, and who does he bump?" for a
candidate the user is considering bidding on. `optimizeLineup(players,
slots)` is the single-team analog of §3's replacement-level algorithm —
same greedy logic (base slots, then FLEX, then SUPERFLEX to the
highest-scoring eligible leftover), applied to one team's roster instead
of the league-wide population, ranked by **raw points, not VBD** (the
goal here is maximizing this team's total starting output, not marginal
value over league replacement — those are different questions).

`lineupImpact(beforeLineup, afterLineup, candidateId)` diffs two
`optimizeLineup` results: which slot the candidate lands in (`null` if he
doesn't crack the lineup), which currently-starting players get displaced
to the bench (a simple set-difference — this correctly captures cascading
reshuffles, e.g. a new RB2 pushing the old RB2 into FLEX and bumping the
old FLEX starter to the bench, with no special-casing needed), and the
net change in total starting points. The Bid Advisor recomputes this for
every candidate against the user's current roster (`myRoster` = valued
players where `team === myTeam`).

## 8. Contract Advisor: surplus and term value

`contract.html` ranks a team's roster by **term value** = season surplus
(`$ value − salary`) × `years` (the `Years` column from the contracts
CSV — clean 1-4 year values, verified against all 163 rostered players).

This is deliberately **not** an Ottoneu-style multi-year dynasty formula
(`Y0 + 0.90×Y1 + 0.81×Y2`) — that requires genuinely distinct projected
stat lines per future year (Ottoneu gets these from separate BatX Y1/Y2
exports), and no such multi-year projection source exists for this
league. Term value is a single-season surplus scaled by contract length,
not a projection of what the player will produce in years 2 and 3 — it
answers "how much is this deal worth to me for as long as I hold it,"
not "what will he score next year." Recommendation badges (`Keeper` /
`Fringe` / `Cut candidate`) are driven by season surplus alone, not term
value, so contract length doesn't get baked into the label — the user
applies their own judgment (age, injury risk, role trajectory) on top of
the raw numbers, deliberately not modeled here.

## 9. Age / experience data (`matchBioData`)

`data/sleeper_bio_2026.csv` is a filtered derivative of Sleeper's public,
no-auth `/v1/players/nfl` endpoint (active QB/RB/WR/TE with a known age —
see `data/README.md` for the refresh script). Investigated FantasyPros'
public API first: it has age too, but the free tier caps every browse-style
endpoint at 10 results with no way to search by name, making bulk coverage
of a whole roster impractical. Sleeper's endpoint returns everyone in one
uncapped call, so it won.

`matchBioData(players, bioRows)` joins on `normalizeName(name) + position`
— `normalizeName` lowercases, strips periods/apostrophes, and strips a
trailing `Jr/Sr/II/III/IV/V` suffix, since Sleeper and League Tycoon
disagree on suffixes often enough to matter (e.g. League Tycoon's "Michael
Penix Jr." vs Sleeper's "Michael Penix"). When a normalized name+position
matches more than one Sleeper row (rare — confirmed 6 cases league-wide,
e.g. two active NFL players both named "Frank Gore" at RB), it narrows by
`nflTeam`; if that still doesn't resolve to exactly one row, `age`/
`yearsExp` are left `null` rather than guessing. Verified against the real
roster data: 100% match rate across all 159 rostered valued-position
players, 87.8% across the full 2,074-player valued pool (rostered + FA).

Age/experience are displayed as **context only** (Contract Advisor's Age/
Exp columns) — deliberately not folded into surplus, term value, or the
Keeper/Fringe/Cut badges. There's no real aging-curve model here; the user
applies that judgment themselves on top of the raw numbers.

## 10. Tunable knobs

| Knob | Where | Current | Meaning |
|---|---|---|---|
| `SURPLUS_KEEPER_MIN` | `contract.html` | $10 | season surplus above which a player is a "Keeper" rather than "Fringe"; below $0 is "Cut candidate". Round approximation of Ottoneu's `TF_GAIN_MIN` (5) scaled from a $400 to a $1000 cap |
| `kDstFlatReserve` | `leagues.js` | $1/spot | $ held off the pool per K/DST roster spot, since real bids happen even though they're unvalued |
| $ conversion population | `computeDollarValues` (`shared.js`) | starting + bench slots, excl. PS/IR | who gets an individually computed $ value vs. a flat $1 |
| `psCapDiscount` / `irCapDiscount` | `leagues.js` | 25% / 50% | cap-impact preview multipliers |

## 11. Known limitations (accepted for v1)

- K/DST have no individual $ values (flat $1/spot reserve only).
- No multi-year dynasty valuation horizon — this is a single-season
  points-to-dollars model, not a keeper-value/contract-horizon model.
- Fumbles-lost and 2pt-conversion rates aren't in the data source; both
  score as 0.
- Opponents' PS/IR designations aren't in the data source, so opposing
  teams' cap totals use full (undiscounted) salary as an approximation.
  Your own team's PS/IR status is tracked precisely via the Bid
  Advisor's toggle.
- `optimizeLineup` doesn't know which of the user's own rostered players
  are on PS/IR (same data gap as above), so it treats the user's entire
  CSV-listed roster as active-roster-eligible for lineup purposes. In
  practice this only matters if the user is actively stashing players on
  PS/IR, which most managers in this league don't do.
