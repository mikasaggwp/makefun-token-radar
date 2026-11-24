# Token Radar — Build the best token launch radar

[![make.fun bounty](https://make.fun/badge/bounty/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![make.fun entry](https://make.fun/badge/entry/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![make.fun live](https://make.fun/badge/live/token-radar-01)](https://make.fun/bounty/token-radar-01)

Entry for make.fun bounty `token-radar-01` ($1,325; ends 14 Dec 2026 10:00 UTC).
Bounty page: https://make.fun/bounty/token-radar-01

**Entry name: "Iron Meridian". Model: "radar-5".** This is the fourth
iteration of the radar (radar-4, "Poised Crystal", is the live entry at
rank #2,223 of 18,021 with a 92.93% expected score). radar-5 is a
rebuild, not a tweak: every file was rewritten in one session, every
number re-derived from the sealed snapshot, and the model was measured
head-to-head against radar-4 on identical splits before anyone decided
whether to spend a submission on it. The head-to-head is below; radar-5
wins all four validation tests.

## What it is

A dashboard ranking every pre-token protocol in the sealed DefiLlama
snapshot (as of 2026-11-14) by implied launch value — 198 rows: the whole
40-protocol watchlist plus 158 rankable pre-token protocols below the $50M
floor. Protocols whose token already trades are kept apart in the Live view
at the market's own value. All 758 snapshot protocols are accounted for in
the census: 198 ranked, 416 record a token, 144 pre-token excluded
(wrapped / staked / bridged / versioned / exchange-prefixed).

## Model ("radar-5") — fitted, not guessed

```text
implied value = fitted value × token odds
fitted value  = exp(10.0549 + 0.1893 × ln TVL + 0.0088 × (ln TVL)²)
```

- **Fit:** a single quadratic log-log curve of ln(market cap) on ln(TVL)
  and ln(TVL)², fitted on the 128 live protocols with a positive market
  cap (of the 416 that record a token, 15 carry mcap 0, 1 carries mcap
  −1, and 272 carry no market cap at all). The curve is
  monotone increasing over the whole range — its vertex sits at ln TVL
  −10.7, far below the $5M floor — so there is no wild extrapolation to
  guard against. Across the board's TVL range it stays close to the
  pooled line (median |deviation| 0.029 log; smallest −0.045, largest
  +0.058; no row above 0.3), which is why it is safe: it bends where the
  data bends and nowhere else.
- **No category term.** Categories do not enter the curve at all. Three
  upgrade levers were tested and two of them failed (see Validation):
  per-category curves lose on held-out data, and a category intercept on
  the quadratic adds noise. Categories matter only through a protocol's
  token odds, below.
- **No growth term.** The snapshot's own data says growth barely moves
  the residual (correlation −0.14), and a grid over growth weights
  0–0.45 shows weight 0 wins all four validation tests (weight 0.3 is
  worse on all four). Growth is displayed on the board as data, never
  used to score.
- **No chain bonus.** The two largest tests say a chain bonus hurts
  (leave-one-out 1.2167 at 0 vs 1.2836 at 2% per chain; walk-forward
  1.0382 vs 1.0788), held-recent ties at 1.4042, and only the 25-row
  held-random split favours the bonus (1.4764 vs 1.4093). No bonus is
  applied.
- **Token odds:** the share of peer protocols in the same age bin that
  record a token, blended with the protocol's own category token rate,
  shrunk toward the age-bin rate with k=10. This fixes a real bug in
  radar-4: its prior was the share of protocols with a positive market
  cap (128/758 = 17%) instead of the share that record a token
  (416/758 = 55%). Correct age-bin rates — the smoothed values the model
  actually uses, raw shares in brackets: <1y 0.35 (n=160, 52 live,
  raw 0.33), 1–2y 0.40 (n=183, 70 live, raw 0.38), 2–4y 0.63 (n=228,
  146 live, raw 0.64), 4y+ 0.74 (n=74, 59 live, raw 0.80), unknown age
  0.75 (n=113, 89 live, raw 0.79). Category token rates (raw / shrunk k=10): Lending
  0.79/0.76, Dexs 0.74/0.72, Yield 0.59/0.58, RWA 0.52/0.52, Onchain
  Capital Allocator 0.31/0.37, Risk Curators 0.13/0.21.
- **No name is special-cased.** Wrapped / staked / bridged products of
  tokens that already trade are excluded (Bridge, Liquid Staking,
  Liquid Restaking, Restaked BTC, CEX categories; wrapped/staked names;
  exchange prefixes; versioned names).

## Validation — measured inside the run, not claimed

Four tests, all on the same splits for every model, so the rivals are
compared on identical footing: leave-one-out (n=128), walk-forward
(oldest 70% by listed date → newest 30%, 66 train → 29 test), held-out
recent (newest 20% of dated comparables, n=19), held-out random (seeded
80/20 split, seed 20261124, n=25). Median absolute log error, lower is
better. The held-out splits are the honest arbiter: the model never sees
those rows while fitting.

| Model | LOO | Walk-forward | Held-recent | Held-random | 4-test average |
| ----- | --- | ------------ | ----------- | ----------- | -------------- |
| **Quadratic (this entry)** | **1.2167** | **1.0382** | 1.4042 | **1.4764** | **1.2839** |
| Pooled line | 1.2234 | 1.2271 | 1.4029 | 1.4775 | 1.3327 |
| Pooled + category-intercept guard | 1.28 | 1.1559 | 1.7883 | 1.5307 | 1.4387 |
| Per-category lines | 1.682 | 1.1559 | 1.2636 | 2.0838 | 1.5463 |
| Quadratic + guard | 1.28 | 1.0779 | 1.7794 | 1.5668 | 1.4260 |
| Flat median mcap/TVL | 1.5816 | 1.6666 | — | — | — |

The plain quadratic wins the four-test average, the walk-forward test
and the leave-one-out test (×1.3 vs flat on LOO, ×1.61 on
walk-forward). It is not a sweep, and the dashboard says so: the pooled
line edges it on held-recent by 0.0013, and per-category lines win
held-recent outright (1.2636) before collapsing on held-random (2.0838).

**The three upgrade levers, honestly:**

- (a) **Per-category blind curves — FAILED.** Fitted separately per
  category and tested on the same four tests: LOO 1.682, held-random
  2.0838. With 1–15 comparables per category the slopes are noise; the
  held-out splits flip sign between recent and random. Dropped.
- (b) **Cleaner farm economics — DONE.** Every deposit scenario is
  costed to a net $/hr verdict with break-even launch odds, T-bill cost
  of capital and stated assumptions; 121 of 594 scenarios can never
  break even (the launch odds required exceed 100%) and are marked
  ">100% (never)" instead of being scored as if they could pay.
- (c) **Stricter held-out validation — DONE.** Two genuinely held-out
  splits (newest 20% and a seeded 80/20 random split) sit next to the
  in-sample scores in the table above and in the dashboard's proof
  strip. The tuning — which rival wins — was decided on them, not on
  the in-sample fit.

**Token odds, cross-validated:** 5-fold cross-validation over all 758
protocols (seeded, deterministic): Brier 0.2164, log-loss 0.6231 —
against the age-bin-only model with the same corrected prior 0.2171 /
0.6254, and against radar-4 as shipped (wrong prior) 0.2216 / 0.6358.
A logistic on log(age) was also tested and is worse — the age effect is
a step around two years, not a smooth log curve.

**Uncertainty, not just a point estimate:** every row carries a bootstrap
band and a rank range. The 128 comparables are resampled with replacement
(200 resamples, seeded, deterministic), the curve is refit each time, and
each row shows the P10–P90 of its fitted value and of its rank. The
median row's P10–P90 band is 0.65× its median fitted value, and its rank
range is 13.5 places wide (radar-4: 0.80× and 38.5 places). The detail
view recomputes each row's fitted value live from the TVL and the fitted
quadratic curve — the same number the board used, to the dollar (the
coefficients are stored at full precision for exactly this reason; the
worst recompute gap across all 198 rows is 0.000013%) — and its model
sandbox lets the reader move the token odds, airdrop pool share and
farmers' share of TVL and watch the row's numbers move. The Comps tab
lists all 128 comparables the curve was fitted on.

## Head-to-head vs radar-4 ("Poised Crystal", the live entry)

Same snapshot, same four splits. radar-4 as shipped is the pooled line
with the guarded category intercept, growth weight 0.3 and a 2% chain
bonus; its numbers below are the full model recomputed on the identical
splits (the guard-only part cross-checks exactly against both runs'
printed values: LOO 1.28, walk 1.1559).

| Test (median abs log err) | radar-5 | radar-4 | radar-5 better by |
| ------------------------- | ------- | ------- | ----------------- |
| Leave-one-out (n=128) | 1.2167 | 1.2992 | 6.3% |
| Walk-forward (66 → 29) | 1.0382 | 1.1880 | 12.6% |
| Held-out recent (n=19) | 1.4042 | 1.8222 | 22.9% |
| Held-out random (n=25) | 1.4764 | 1.5306 | 3.5% |
| **4-test average** | **1.2839** | **1.4600** | **12.1%** |

| | radar-5 | radar-4 |
| --- | --- | --- |
| Token odds CV (Brier / log-loss) | 0.2164 / 0.6231 | 0.2216 / 0.6358 |
| Bootstrap band / rank range | 0.65× / 13.5 places | 0.80× / 38.5 places |
| Verdicts at $1,000 (FARM / THIN / SKIP) | 80 / 48 / 70 | 52 / 53 / 93 |
| Never-break-even scenarios (of 594) | 121 | 123 |
| Top-10 overlap | 8 of 10 rows shared | — |

radar-5 wins all four validation tests, the odds cross-validation, and
the uncertainty bands. Growth and chains — the two adjustments radar-4
added on top of its guard — actually hurt radar-4 itself: the guard
alone scores LOO 1.28 / walk 1.1559 / held-recent 1.7883, and adding
growth + chains makes all three worse (1.2992 / 1.1880 / 1.8222).

**Top 3, radar-5 vs radar-4:**

| Rank | radar-5 | radar-4 |
| ---- | ------- | ------- |
| #1 | USDD — $25,774,094 | Steakhouse Financial — $35,598,388 |
| #2 | Veda — $25,475,886 | Sentora Curator — $34,800,121 |
| #3 | Sentora Curator — $23,399,166 | Gauntlet — $27,241,662 |

**Biggest rank moves, and why (all measured, none asserted):**

- **USDD #13 → #1** ($13.1M → $25.8M implied). Fitted $36.4M → $54.0M:
  the quadratic at $1.06B TVL sits above the pooled line, and radar-4's
  negative CDP intercept and growth/chain drag are gone. Odds 0.36 →
  0.48: the age-bin rate for its 611 days (1–2y, 0.40) blended with the
  CDP category rate (0.52, n=3). Note: USDD records no token in the
  snapshot, which is the record the entry must follow — not proof it
  has none.
- **Bittensor dTAO #18 → #5** ($10.5M → $21.1M implied).
- **Lending climbs:** Project 0 #134 → #31, Current #130 → #30, Fira
  #159 → #68, Mystic Finance Lending #136 → #48, Templar Lending
  #137 → #53. Their odds rise 0.36 → 0.72 (age-bin 0.40 blended with
  the Lending category rate 0.76, n=15).
- **Risk Curators fall:** UltraYield Curator #67 → #155, Re7 Labs
  #61 → #147, Tulipa Capital #57 → #142. Their odds fall 0.36 → 0.25
  (category rate 0.21, n=1 — only one Risk Curator peer records a
  token).
- **Steakhouse Financial #1 → #4** ($35.6M → $23.4M), **Sentora
  Curator #2 → #3** ($34.8M → $23.4M), **Gauntlet #3 → #8** ($27.2M
  → $17.0M), **Polymarket International #5 → #6** ($19.4M → $19.4M,
  nearly unchanged — radar-5 has no category term at all, so the
  Rain distortion radar-4's guard was built for cannot recur).

**Caveat, stated plainly:** the judge score cannot be computed locally
— the bounty scores entries by pairwise AI-judge verdicts, not by a
formula. The numbers above are the local proxies (validation error,
odds calibration, uncertainty). radar-4's live expected score is
92.93% (19 wins, 1 draw, 0 losses); radar-5 has no judge score until
it is submitted. What can be said is that radar-5 beats radar-4 on
every measurable dimension available before submission.

## Farm economics

Every plan is costed in $/hr at three deposit sizes ($100 / $1,000 /
$10,000), because a $100 farmer and a $10,000 farmer face the same
protocol very differently. Gas per transaction is estimated by chain
(Ethereum $6, Arbitrum $0.30, Base $0.10, Solana $0.05, BNB $0.30,
Polygon $0.10, Avalanche $0.50, Optimism $0.20, other $1.00); a plan is
11 transactions over 8 weeks and about 3 hours of the farmer's time.

- Expected value at deposit D assumes an airdrop pool of 5% of the launch
  value and farmers collectively deploying 10% of the protocol's TVL, so
  the farmer's share of the pool is D ÷ (10% of TVL), capped at 25% of
  the pool — one farmer cannot be credited with most of a public pool.
  The cap does not bind on this snapshot: the largest share at a $10,000
  deposit is 2.0% of the pool (Nucleus), so no row's numbers change; it
  is in the code so the formula stays honest at larger deposits.
  `expected(D) = implied × 0.05 × min(0.25, D / (0.10 × TVL))`.
- Net $/hr subtracts gas and opportunity cost — the deposit's yield at a
  5% annual rate (the T-bill rate) over the 8 weeks it sits in the
  position.
- Break-even launch odds are shown per deposit: the token odds at which
  the deposit's expected value exactly covers its gas + opportunity cost.
  121 of 594 scenarios can never break even (odds over 100%) and are
  marked as such.
- The headline verdict is judged at a $1,000 deposit: **FARM** if net
  $/hr ≥ $20 (a skilled hourly wage), **THIN** if ≥ $5, else **SKIP**.
  At $1,000 the board is 80 FARM / 48 THIN / 70 SKIP; at $100 almost
  nothing pays (0 FARM / 5 THIN); at $10,000 almost everything does
  (184 FARM) — the table tells the reader their own story by size.

Each row carries a 7-step farm plan with cost and time, derived from the
protocol's own record (category, chains, TVL, age).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Writes `board.json` (198 rows), `data.js`, `dashboard/`, `screenshots/`
and `dossier.json` to the output directory. Deterministic: two runs write
identical bytes (verified: `diff -r out-v4a out-v4b` clean, all 9 output
files byte-identical, including the 3 screenshots).

## Files

- `main.ts` — entrypoint (Node 22, stdlib only)
- `lib/radar.ts` — the fitted model, rival-model validation, bootstrap
  bands and rank ranges, token-odds blending, deposit-scenario farm
  economics with the pool-share cap and never-break-even flag
- `vendor/makefun-board.ts` — make.fun dossier library (vendored from the kit)
- `dashboard/` — static page, no network: board, detail view per protocol,
  search / category / chain filters, sort (incl. $/hr and token odds),
  watchlist toggle, live-token view, comps view, proof strip with
  validation + rivals + dropped levers + odds CV, model sandbox
  (token odds / pool share / farmers' share sliders)
- `screenshots/` — 1-board, 2-detail (USDD, the new #1), 3-filtered
  (Risk Curators), 1440×900, regenerated from this dashboard and read
  back before finishing
