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

## Model ("radar-3") — fitted, not guessed

```text
implied value = fitted value × token odds
fitted value  = exp(a_category + 0.5223 × ln TVL) × growth × chains
```

- **Fit:** log-log regression of ln(market cap) on ln(TVL) over the 128
  live protocols with a positive market cap (16 live records carry mcap 0
  and are left out). Pooled slope 0.5223, pooled intercept 6.9646. Each
  category's intercept is its mean residual, shrunk n/(n+5) toward the
  pooled intercept.
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

| Test | This model | Flat median mcap/TVL | Improvement |
| ---- | ---------- | -------------------- | ----------- |
| Leave-one-out (n=128) | median abs log err 1.22 | 1.58 | **×1.29** |
| Walk-forward (66 train → 29 test) | median abs log err 1.23 | 1.67 | **×1.36** |

The dashboard's proof strip prints these numbers from the run itself,
and the detail view recomputes each row's fitted value live from the TVL
and the fitted line, so the board and the code agree.

## Farm economics

Every plan is costed in $/hr: 11 transactions over 8 weeks, about 3 hours
of the farmer's time, gas per transaction estimated by chain (Ethereum $6,
Arbitrum $0.30, Base $0.10, Solana $0.05, BNB $0.30, Polygon $0.10,
Avalanche $0.50, Optimism $0.20, other $1.00). Expected farmer value
assumes an active farmer captures 0.001% of the launch value — a relative
score, never a payout promise. Verdict: **FARM** if net $/hr ≥ $100,
**THIN** if ≥ $20, else **SKIP**.

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
- `lib/radar.ts` — the fitted model, validation, board builder and farm plans
- `vendor/makefun-board.ts` — make.fun dossier library (vendored from the kit)
- `dashboard/` — static page, no network: board, detail view per protocol,
  search / category / chain filters, sort (incl. $/hr and token odds),
  watchlist toggle, live-token view, proof strip with validation + census
- `screenshots/` — 1-board, 2-detail (Polymarket International), 3-filtered
  (Risk Curators), 1440×900
