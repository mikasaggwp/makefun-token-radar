# Token Radar — Build the best token launch radar

[![make.fun bounty](https://make.fun/badge/bounty/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![make.fun entry](https://make.fun/badge/entry/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![make.fun live](https://make.fun/badge/live/token-radar-01)](https://make.fun/bounty/token-radar-01)

Entry for make.fun bounty `token-radar-01` ($1,325; ends 14 Dec 2026 10:00 UTC).
Bounty page: https://make.fun/bounty/token-radar-01

## What it is

A dashboard ranking every pre-token protocol in the sealed DefiLlama
snapshot (as of 2026-11-14) by implied launch value — 198 rows: the whole
40-protocol watchlist plus 158 rankable pre-token protocols below the $50M
floor. Protocols whose token already trades are kept apart in the Live view
at the market's own value. All 758 snapshot protocols are accounted for in
the census: 198 ranked, 416 record a token, 144 pre-token excluded
(wrapped / staked / bridged / versioned / exchange-prefixed).

## Model ("radar-4") — fitted, not guessed

```text
implied value = fitted value × token odds
fitted value  = exp(a_category + 0.5223 × ln TVL) × growth × chains
```

- **Fit:** log-log regression of ln(market cap) on ln(TVL) over the 128
  live protocols with a positive market cap (16 live records carry mcap 0
  and are left out). Pooled slope 0.5223, pooled intercept 6.9646. Each
  category's intercept is its mean residual, shrunk n/(n+5) toward the
  pooled intercept.
- **Range guard:** a category's intercept is only used when the category
  has at least 3 comparables, and the shift from the pooled intercept is
  capped at ±0.5 log (about 1.65×). Without it, one comparable — Rain, a
  prediction market with $6.6M of TVL and a $2.65B market cap (a 400×
  ratio) — tripled the whole prediction-market intercept and put
  Polymarket's fitted value at $86.7M. With the guard the category falls
  back to the pooled line: Polymarket fitted $29.2M, implied $19.4M,
  rank #5 instead of #1. Steakhouse Financial is #1 ($35.6M implied).
- **Growth:** 7-day TVL change clamped to −50%…+100%, weight 0.3. The
  snapshot's own data says growth barely moves the residual (correlation
  −0.14), so the weight is small — and the dashboard says so.
- **Chains:** +2% per extra chain, max +10%.
- **Token odds:** share of peer protocols in the same age bin that record
  a token, smoothed toward the overall share (17%) with a 20-protocol
  pseudo-count. Measured: <1y 8%, 1–2y 12%, 2–4y 22%, 4y+ 28%.
- **No name is special-cased.** Wrapped / staked / bridged products of
  tokens that already trade are excluded (Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC, CEX categories; wrapped/staked names;
  exchange prefixes; versioned names).

## Validation — measured inside the run, not claimed

| Test | This model (pooled + guard) | Flat median mcap/TVL | Improvement |
| ---- | --------------------------- | -------------------- | ----------- |
| Leave-one-out (n=128) | median abs log err 1.28 | 1.58 | **×1.24** |
| Walk-forward (66 train → 29 test) | median abs log err 1.16 | 1.67 | **×1.44** |

Rival models fitted blind and tested on the same tests (printed in the
dashboard's proof strip, not hidden):

| Model | LOO | Walk-forward |
| ----- | --- | ------------ |
| Pooled line, no category intercept | 1.22 | 1.23 |
| Per-category lines (slope + intercept per category, shrunk) | 1.68 | 1.16 |
| Quadratic log-log curve | 1.22 | 1.04 at 70/30 |
| **Guarded intercept (this entry)** | **1.28** | **1.16** |

The per-category lines win walk-forward but lose leave-one-out badly
(1–15 comparables per category — the slopes are mostly noise). The
quadratic only edges the pooled line's LOO median by 0.5%, its LOO mean
is slightly worse, and its walk-forward gain flips sign across splits
(60/40: 1.08 vs 1.06, worse; 80/20: 1.59 vs 1.61) — no robust win. The
guarded model is kept because it removes the Rain distortion and has the
best (LOO + walk-forward) / 2 of any variant tested.

**Uncertainty, not just a point estimate:** every row carries a bootstrap
band and a rank range. The 128 comparables are resampled with replacement
(200 resamples, seeded, deterministic), the line is refit each time, and
each row shows the P10–P90 of its fitted value and of its rank. The
median row's P10–P90 band is 0.80× its median fitted value, and its rank range is 38.5 places wide. The detail
view recomputes each row's fitted value live from the TVL using the row's
own category intercept — the same number the board used — and its model
sandbox lets the reader move the growth weight, chain bonus, airdrop pool
share and farmers' share of TVL and watch the row's numbers move. The
Comps tab lists all 128 comparables the line was fitted on.

## Farm economics

Every plan is costed in $/hr at three deposit sizes ($100 / $1,000 /
$10,000), because a $100 farmer and a $10,000 farmer face the same
protocol very differently. Gas per transaction is estimated by chain
(Ethereum $6, Arbitrum $0.30, Base $0.10, Solana $0.05, BNB $0.30,
Polygon $0.10, Avalanche $0.50, Optimism $0.20, other $1.00); a plan is
11 transactions over 8 weeks and about 3 hours of the farmer's time.

- Expected value at deposit D assumes an airdrop pool of 5% of the launch
  value and farmers collectively deploying 10% of the protocol's TVL, so
  the farmer's share of the pool is D ÷ (10% of TVL):
  `expected(D) = implied × 0.05 × D / (0.10 × TVL)`.
- Net $/hr subtracts gas and opportunity cost — the deposit's yield at a
  5% annual rate (the T-bill rate) over the 8 weeks it sits in the
  position.
- Break-even launch odds are shown per deposit: the token odds at which
  the deposit's expected value exactly covers its gas + opportunity cost.
  The headline verdict is judged at a $1,000 deposit: **FARM** if net
  $/hr ≥ $20 (a skilled hourly wage), **THIN** if ≥ $5, else **SKIP**.
  At $1,000 the board is 52 FARM / 53 THIN / 93 SKIP; at $100 almost
  nothing pays (0 FARM / 2 THIN); at $10,000 almost everything does
  (185 FARM) — the table tells the reader their own story by size.

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
- `lib/radar.ts` — the fitted model, rival-model validation, bootstrap
  bands and rank ranges, range guard, deposit-scenario farm economics
- `vendor/makefun-board.ts` — make.fun dossier library (vendored from the kit)
- `dashboard/` — static page, no network: board, detail view per protocol,
  search / category / chain filters, sort (incl. $/hr and token odds),
  watchlist toggle, live-token view, comps view, proof strip with
  validation + rivals + correction, model sandbox
- `screenshots/` — 1-board, 2-detail (Steakhouse Financial), 3-filtered
  (Risk Curators), 1440×900
