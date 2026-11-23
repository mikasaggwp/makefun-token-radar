# Token Radar — Build the best token launch radar

Entry for make.fun bounty `token-radar-01` ($1,325; ends 14 Dec 2026 10:00 UTC).

## What it is

A dashboard ranking every pre-token protocol in the sealed DefiLlama
snapshot (as of 2026-11-14) by implied launch value — 198 rows: the whole
40-protocol watchlist plus 158 rankable pre-token protocols below the $50M
floor. Protocols whose token already trades are kept apart in the Live view
at the market's own value.

## Model ("radar-2")

```
implied value = TVL × category multiple × growth × maturity × chains
```

- Category multiple: curators & allocators 0.40, lending & CDP 0.32,
  DEXs & perps 0.30, RWA & basis 0.28, yield 0.26, stables / payments /
  insurance / prediction 0.24, other 0.20, a bare chain 0.15.
- Growth: 7-day TVL change clamped to −50%…+100%, weight 0.6.
- Maturity: 0.70 + min(age, 1460d)/1460 × 0.30 (unknown age = 365d).
- Chains: +3% per extra chain, max +15%.
- No name is special-cased. Wrapped / staked / bridged products of
  tokens that already trade are excluded (Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC, CEX categories; wrapped/staked names;
  exchange prefixes).

Each row carries a 7-step farm plan with cost and time, derived from the
protocol's own record (category, chains, TVL, age).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Writes `board.json` (198 rows), `data.js`, `dashboard/`, `screenshots/`
and `dossier.json` to the output directory. Deterministic: two runs write
identical bytes.

## Files

- `main.ts` — entrypoint (Node 22, stdlib only)
- `lib/radar.ts` — the model, board builder and farm plans
- `vendor/makefun-board.ts` — make.fun dossier library (vendored from the kit)
- `dashboard/` — static page, no network: board, detail view per protocol,
  search / category / chain filters, sort, watchlist toggle, live-token view
- `screenshots/` — 1-board, 2-detail (Steakhouse Financial), 3-filtered
  (Risk Curators), 1440×900
