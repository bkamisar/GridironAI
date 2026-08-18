# GridironAI

A multi-league fantasy football tool suite — static HTML/JS, no backend,
modeled on the [OttoneuAI](https://github.com/bkamisar/OttoneuAI) suite's
approach. Deployed to GitHub Pages so it's usable from any device.

## v1: Bid Advisor

For the $1000-cap dynasty league's ongoing slow auction draft. Open
`index.html`, upload the League Tycoon players export, pick your team,
then use `bid.html` to get a suggested $ value for any nominated player.

See `docs/superpowers/specs/2026-08-17-bid-advisor-v1-design.md` for the
full design and `MODEL.md` for the valuation math once implemented.

## Tests

`node tests/engine.test.js` — no npm install required.
