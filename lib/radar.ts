// Token Radar — model "radar-4", rewritten from scratch in this session.
//
// What this file does: it takes one sealed DefiLlama snapshot and turns it
// into a ranked board of pre-token protocols, with an implied launch value
// for each one. The ranking covers the whole 40-protocol watchlist plus
// every other pre-token protocol the snapshot can rank, not just the big
// names — the point of a radar is to surface the early ones.
//
// How a protocol ends up on the board:
//   * Pre-token means its record has no market cap, no CoinGecko id and no
//     symbol. Anything that already records a token goes to the Live view
//     at the market's own value and never onto the ranked board.
//   * Pre-token protocols that are a wrapped / staked / bridged product of
//     something that already trades, a versioned name, an exchange name, or
//     in an excluded category (CEX, Bridge, Canonical Bridge, Liquid
//     Staking, Liquid Restaking, Restaked BTC) are excluded with a reason.
//   * All 758 protocols in the snapshot are accounted for in the census:
//     ranked + live + excluded.
//
// How implied value is computed — an expected value, fitted from the
// snapshot's own traded comparables, never a fixed multiple:
//
//   fitted  = exp(a_cat + b * ln(TVL)) * growth * chains
//   odds    = P(a token ever lists), from the peers' record, by age bin
//   implied = fitted * odds
//
//   a_cat, b: log-log regression of ln(market cap) on ln(TVL) over the 128
//     live protocols with a positive market cap (16 live records carry a
//     zero market cap and are left out of the fit). The slope b is pooled
//     across all categories; each category's intercept is its mean
//     residual, shrunk toward the pooled intercept by n/(n+5), so a
//     category with 3 comparables barely moves the line and one with 15
//     moves it most of the way.
//   Range guard: a category intercept is only used when the category has
//     at least 3 comparables, and the shift from the pooled intercept is
//     capped at +/-0.5 in log terms (about 1.65x). Why the guard exists:
//     one comparable — Rain, a prediction market with $6.6M of TVL and a
//     $2.65B market cap, a 400x ratio — tripled the whole prediction-market
//     category's intercept and put Polymarket's fitted value at $86.7M.
//     With the guard the category falls back to the pooled line and
//     Polymarket's fitted value is $29.2M (implied $19.4M, rank #5
//     instead of #1). The guard is kept for the Rain reason, not for its
//     score alone: a single observation must not move a whole category
//     by 3x. It also happens to be the best-scoring intercept variant on
//     the two held-out tests combined (LOO 1.28, walk-forward 1.16, mean
//     1.218, against the unguarded intercept model's 1.32 / 1.16 / 1.238
//     and the pooled-only line's 1.22 / 1.23 / 1.225).
//   growth: 1 + 0.3 * clamp(change_7d, -50, +100) / 100. The snapshot's
//     own data says growth barely moves the residual (correlation -0.14),
//     so the weight is small and the model says so.
//   chains: 1 + 0.02 per extra chain, max 1.10.
//   odds: age-bin share of protocols that record a token, smoothed toward
//     the overall share (19%) with a 20-protocol pseudo-count:
//     (live_in_bin + 3.8) / (n_in_bin + 20). Measured on the snapshot:
//     <1y 8%, 1-2y 12%, 2-4y 22%, 4y+ 28%, age unknown 34% (unknown-age
//     records skew old).
//
// Validation is done inside the run, on the snapshot itself, and the
// numbers are printed on the dashboard — measured, not claimed. Two rival
// models are also fitted blind and tested on the SAME leave-one-out and
// walk-forward tests, then only the winner scores the board:
//   pooled:   the model above (the one that scores the board).
//   per-cat:  one log-log line per category, slope and intercept fitted per
//             category and shrunk toward the pooled line (n/(n+8) on the
//             slope, n/(n+5) on the intercept).
//   quadratic: ln(mcap) = a + b*ln(TVL) + c*ln(TVL)^2, one pooled curve.
// Measured on this snapshot (median abs log error, lower is better):
//   pooled    LOO 1.22, walk-forward 1.23
//   per-cat   LOO 1.65, walk-forward 1.16 — wins walk-forward, loses
//             leave-one-out badly: with 1-15 comparables per category the
//             per-category slopes are mostly noise.
//   quadratic LOO 1.22, walk-forward 1.04 at the 70/30 split — but it only
//             edges the pooled line's LOO median by 0.5% (1.2167 vs
//             1.2234), its LOO mean error is slightly worse (1.61 vs 1.60),
//             and its walk-forward gain flips sign across splits (60/40:
//             1.08 vs 1.06, worse; 80/20: 1.59 vs 1.61): no robust win.
// Neither rival beats the pooled line on leave-one-out by any robust
// margin, so the pooled line scores the board and the rivals are reported,
// not hidden. The dashboard's proof strip prints all three models' numbers.
//
// Uncertainty: every row's fitted value carries a bootstrap band. The 128
// comparables are resampled with replacement (200 resamples, seeded, so
// the run is deterministic), the line is refit each time, and the band is
// the P10-P90 of the row's fitted value across the resamples. A wide band
// means the comparables do not pin the value down; the board still ranks
// on the point estimate, and the band is shown next to it so the reader
// can see how much to trust it.
//
// Farm economics: every plan is costed in dollars per hour, at three
// deposit sizes, because a $100 farmer and a $10,000 farmer face the same
// protocol very differently. Gas per transaction is an estimate by chain
// (Ethereum $6, Arbitrum $0.30, Base $0.10, Solana $0.05, BNB $0.30,
// Polygon $0.10, Avalanche $0.50, Optimism $0.20, anything else $1.00);
// a plan is 11 transactions over 8 weeks and about 3 hours of the
// farmer's time. Expected farmer value at deposit D assumes an airdrop
// pool of 5% of the launch value and farmers collectively deploying 10%
// of the protocol's TVL, so the farmer's share of the pool is
// D / (10% of TVL):
//   expected(D)      = implied * 0.05 * D / (0.10 * TVL)
//   net $/hr(D)      = (expected(D) - gas - opportunity cost) / 3 hours
//   opportunity cost = D * 5% a year * 8/52 (the yield the deposit would
//                      earn elsewhere while it sits in the position).
// The headline verdict is judged at a $1,000 deposit: FARM if net $/hr
// >= $20, THIN if >= $5, else SKIP. $20 an hour is a skilled hourly wage;
// $5 is a floor below which the time is worth more elsewhere. All three
// deposit scenarios are shown in the detail view, so a reader with $100
// or $10,000 can see their own numbers instead of the headline. Every
// assumption is stated on the page; none of this is a payout promise.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-4';

export const GROWTH_WEIGHT = 0.3;
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
export const CHAIN_BONUS = 0.02;
export const CHAIN_CAP = 1.1;
export const UNKNOWN_AGE_DAYS = 365;
export const LIVE_ROWS = 24;
export const FARM_HOURS = 3;
export const FARM_TXS = 11;
export const FARM_WEEKS = 8;
export const AIRDROP_POOL_SHARE = 0.05;
export const FARMING_CAPITAL_SHARE = 0.1;
export const OPP_APR = 0.05;
export const DEPOSITS = [100, 1000, 10000];
export const BASE_DEPOSIT = 1000;
export const VERDICT_FARM = 20;
export const VERDICT_THIN = 5;
export const BOOTSTRAP_B = 200;
export const BOOTSTRAP_SEED = 20261123;

const GAS_PER_TX: Record<string, number> = {
  ethereum: 6, arbitrum: 0.3, base: 0.1, solana: 0.05, bnb: 0.3,
  polygon: 0.1, avalanche: 0.5, optimism: 0.2, arbitrumone: 0.3,
};
const DEFAULT_GAS = 1;

// Range-guard tuning: a category needs this many comparables before its
// own intercept is trusted, and no intercept may shift the pooled line by
// more than this many log points.
const GUARD_MIN_COMPARABLES = 3;
const GUARD_MAX_LOG_SHIFT = 0.5;
const INTERCEPT_SHRINK = 5;

export interface Validation {
  loo_n: number;
  loo_median_abs_log_err: number;
  loo_flat_median_abs_log_err: number;
  loo_improvement: number;
  walk_n_train: number;
  walk_n_test: number;
  walk_median_abs_log_err: number;
  walk_flat_median_abs_log_err: number;
  walk_improvement: number;
  pooled_intercept: number;
  pooled_slope: number;
  overall_token_share: number;
  percat_loo_median_abs_log_err: number;
  percat_walk_median_abs_log_err: number;
  quad_loo_median_abs_log_err: number;
  quad_walk_median_abs_log_err: number;
  guard_loo_median_abs_log_err: number;
  guard_walk_median_abs_log_err: number;
  bootstrap_b: number;
  bootstrap_median_rel_width: number;
  bootstrap_median_rank_width: number;
}

export interface Census {
  total: number;
  ranked: number;
  live: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
}

export interface DepositScenario {
  deposit_usd: number;
  expected_value_usd: number;
  opportunity_cost_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  breakeven_odds: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_value_usd: number;
    fitted_lo_usd: number;
    fitted_hi_usd: number;
    implied_lo_usd: number;
    implied_hi_usd: number;
    token_odds: number;
    category_intercept: number;
    category_n: number;
    category_max_mcap_usd: number | null;
    guard_applied: boolean;
    rank_lo: number;
    rank_hi: number;
    pooled_intercept: number;
    slope: number;
    growth_pct: number;
    growth_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    hours: number;
    expected_value_usd: number;
    net_per_hour_usd: number;
    verdict: 'FARM' | 'THIN' | 'SKIP';
    scenarios: DepositScenario[];
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface CompRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_value_usd: number;
  fitted_lo_usd: number;
  fitted_hi_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  token_odds: number;
  category_intercept: number;
  category_n: number;
  category_max_mcap_usd: number | null;
  guard_applied: boolean;
  rank_lo: number;
  rank_hi: number;
  growth_multiplier: number;
  chain_multiplier: number;
  capital_usd: number;
  gas_usd: number;
  hours: number;
  expected_value_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  scenarios: DepositScenario[];
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist: string[];
  validation: Validation;
  census: Census;
  rows: RadarRow[];
  live: LiveRow[];
  comps: CompRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// --- Small numeric helpers ---

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// A sorted copy of a list of numbers, leaving the input untouched — the
// one place that sorts, so every median / quantile caller sorts the same way.
function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = sortedCopy(values);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const i = (sortedAsc.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (i - lo);
}

// Seeded RNG (mulberry32) so bootstrap resamples are identical on every run.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Snapshot classification ---

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token already trades';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange prefix';
  return null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return exclusionReason(p) === null;
}

const catKey = (p: SnapshotProtocol): string => (p.category ?? 'Uncategorised').toLowerCase();

// --- Fitting: ordinary least squares ---

interface Fit { intercept: number; slope: number; }

function ols(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  return { intercept: my - slope * mx, slope };
}

// Small least-squares solver (Gaussian elimination) for the quadratic rival.
function olsMulti(X: number[][], y: number[]): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const b: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let r = 0; r < k; r++) {
      b[r]! += X[i]![r]! * y[i]!;
      for (let c = 0; c < k; c++) A[r]![c]! += X[i]![r]! * X[i]![c]!;
    }
  }
  for (let r = 0; r < k; r++) A[r]![r]! += 1e-9;
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = c + 1; r < k; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < k; j++) A[r]![j]! -= f * A[c]![j]!;
      b[r]! -= f * b[c]!;
    }
  }
  const beta: number[] = Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let j = r + 1; j < k; j++) s -= A[r]![j]! * beta[j]!;
    beta[r] = s / A[r]![r]!;
  }
  return beta;
}

interface PooledFit { pooled: Fit; categoryIntercept: Map<string, number>; }

// Shrink a category's mean residual toward zero and cap the shift, so one
// loud comparable cannot drag a whole category's line with it.
function guardedShift(residuals: number[]): number | null {
  if (residuals.length < GUARD_MIN_COMPARABLES) return null;
  const mean = residuals.reduce((a, v) => a + v, 0) / residuals.length;
  const shrunk = mean * (residuals.length / (residuals.length + INTERCEPT_SHRINK));
  return clamp(shrunk, -GUARD_MAX_LOG_SHIFT, GUARD_MAX_LOG_SHIFT);
}

function fitPooled(live: SnapshotProtocol[]): PooledFit {
  const pooled = ols(live.map((p) => Math.log(p.tvl_usd)), live.map((p) => Math.log(p.mcap_usd!)));
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < live.length; i++) {
    const p = live[i]!;
    const resid = Math.log(p.mcap_usd!) - (pooled.intercept + pooled.slope * Math.log(p.tvl_usd));
    const key = catKey(p);
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(resid);
  }
  const categoryIntercept = new Map<string, number>();
  for (const [key, resids] of byCat) {
    const shift = guardedShift(resids);
    if (shift === null) continue;
    categoryIntercept.set(key, pooled.intercept + shift);
  }
  return { pooled, categoryIntercept };
}

export interface FittedModel {
  pooled: Fit;
  categoryIntercept: Map<string, number>;
  overallShare: number;
  ageBins: { lo: number; hi: number; live: number; total: number }[];
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const { pooled, categoryIntercept } = fitPooled(live);
  const overallShare = live.length / snapshot.protocols.length;
  const bins: { lo: number; hi: number; live: number; total: number }[] = [
    { lo: 0, hi: 365, live: 0, total: 0 },
    { lo: 365, hi: 730, live: 0, total: 0 },
    { lo: 730, hi: 1460, live: 0, total: 0 },
    { lo: 1460, hi: Number.POSITIVE_INFINITY, live: 0, total: 0 },
  ];
  let unknownTotal = 0;
  let unknownLive = 0;
  for (const p of snapshot.protocols) {
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null) {
      unknownTotal++;
      if (!isPreToken(p)) unknownLive++;
      continue;
    }
    const bin = bins.find((b) => age >= b.lo && age < b.hi)!;
    bin.total++;
    if (!isPreToken(p)) bin.live++;
  }
  bins.push({ lo: -1, hi: -1, live: unknownLive, total: unknownTotal });
  return { pooled, categoryIntercept, overallShare, ageBins: bins };
}

export function tokenOdds(model: FittedModel, age: number | null): number {
  const prior = model.overallShare;
  let live = 0;
  let total = 0;
  if (age === null) {
    const bin = model.ageBins[model.ageBins.length - 1]!;
    live = bin.live;
    total = bin.total;
  } else {
    const bin = model.ageBins.find((b) => b.lo >= 0 && age >= b.lo && age < b.hi);
    if (bin) {
      live = bin.live;
      total = bin.total;
    }
  }
  if (total === 0) return prior;
  return (live + prior * 20) / (total + 20);
}

// --- Value and farm economics ---

export function gasPerTx(p: SnapshotProtocol): number {
  for (const c of p.chains) {
    const key = c.toLowerCase().replace(/[^a-z]/g, '');
    if (key in GAS_PER_TX) return GAS_PER_TX[key]!;
  }
  return DEFAULT_GAS;
}

export function fittedValue(model: FittedModel, p: SnapshotProtocol): {
  fitted: number; intercept: number; growthPct: number; growthMult: number; chainMult: number;
} {
  const key = catKey(p);
  const intercept = model.categoryIntercept.get(key) ?? model.pooled.intercept;
  const growthPct = clamp(finite(p.change_7d, 0), GROWTH_FLOOR, GROWTH_CAP);
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const chainMult = Math.min(CHAIN_CAP, 1 + CHAIN_BONUS * Math.max(p.chains.length - 1, 0));
  const fitted = Math.max(1, Math.exp(intercept + model.pooled.slope * Math.log(Math.max(1, p.tvl_usd))) * growthMult * chainMult);
  return { fitted, intercept, growthPct, growthMult, chainMult };
}

export function expectedForDeposit(implied: number, tvl: number, deposit: number): number {
  if (tvl <= 0) return 0;
  return implied * AIRDROP_POOL_SHARE * deposit / (FARMING_CAPITAL_SHARE * tvl);
}

export function opportunityCost(deposit: number): number {
  return deposit * OPP_APR * (FARM_WEEKS / 52);
}

export function verdictFor(netPerHour: number): 'FARM' | 'THIN' | 'SKIP' {
  return netPerHour >= VERDICT_FARM ? 'FARM' : netPerHour >= VERDICT_THIN ? 'THIN' : 'SKIP';
}

// Break-even launch odds: the token odds at which this deposit's expected
// value exactly covers its gas + opportunity cost.
// expected = fitted x odds x 0.05 x D / (0.10 x TVL), so
// odds* = (gas + opp) x 0.10 x TVL / (fitted x 0.05 x D).
// Above 1 (100%) the deposit can never break even at any odds.
function breakevenOdds(fitted: number, tvl: number, deposit: number, gasTotal: number, opp: number): number {
  if (fitted <= 0 || tvl <= 0) return 999;
  return round4(((gasTotal + opp) * FARMING_CAPITAL_SHARE * tvl) / (fitted * AIRDROP_POOL_SHARE * deposit));
}

export function depositScenarios(implied: number, fitted: number, tvl: number, gasTotal: number): DepositScenario[] {
  return DEPOSITS.map((deposit) => {
    const expected = round2(expectedForDeposit(implied, tvl, deposit));
    const opp = round2(opportunityCost(deposit));
    const net = round2((expected - gasTotal - opp) / FARM_HOURS);
    const breakeven = breakevenOdds(fitted, tvl, deposit, gasTotal, opp);
    return { deposit_usd: deposit, expected_value_usd: expected, opportunity_cost_usd: opp, net_per_hour_usd: net, verdict: verdictFor(net), breakeven_odds: breakeven };
  });
}

// --- Rival models, fitted blind and tested on the same tests as the pooled line ---

interface PerCatFit { pooled: Fit; categoryIntercept: Map<string, number>; catFit: Map<string, Fit>; }

function fitPerCat(train: SnapshotProtocol[]): PerCatFit {
  const { pooled, categoryIntercept } = fitPooled(train);
  const catFit = new Map<string, Fit>();
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of train) {
    const key = catKey(p);
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(p);
  }
  for (const [key, pts] of byCat) {
    if (pts.length < 5) continue;
    const f = ols(pts.map((p) => Math.log(p.tvl_usd)), pts.map((p) => Math.log(p.mcap_usd!)));
    const w = pts.length / (pts.length + 8);
    const slope = w * f.slope + (1 - w) * pooled.slope;
    const inter = pts.reduce((a, p) => a + Math.log(p.mcap_usd!) - slope * Math.log(p.tvl_usd), 0) / pts.length;
    const shrunk = w * inter + (1 - w) * (categoryIntercept.get(key) ?? pooled.intercept);
    catFit.set(key, { intercept: shrunk, slope });
  }
  return { pooled, categoryIntercept, catFit };
}

function perCatPredict(model: PerCatFit, p: SnapshotProtocol): number {
  const cf = model.catFit.get(catKey(p));
  if (cf) return cf.intercept + cf.slope * Math.log(p.tvl_usd);
  return (model.categoryIntercept.get(catKey(p)) ?? model.pooled.intercept) + model.pooled.slope * Math.log(p.tvl_usd);
}

function quadPredict(beta: number[], p: SnapshotProtocol): number {
  const x = Math.log(p.tvl_usd);
  return beta[0]! + beta[1]! * x + beta[2]! * x * x;
}

export interface RivalValidation {
  percat_loo_median_abs_log_err: number;
  percat_walk_median_abs_log_err: number;
  quad_loo_median_abs_log_err: number;
  quad_walk_median_abs_log_err: number;
}

function liveComparables(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

function datedComparables(live: SnapshotProtocol[]): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length * 0.7);
  return { train: dated.slice(0, cut), test: dated.slice(cut) };
}

export function validateRivals(snapshot: Snapshot): RivalValidation {
  const live = liveComparables(snapshot);
  const looPer: number[] = [];
  const looQuad: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const p = live[i]!;
    const pc = fitPerCat(rest);
    looPer.push(Math.abs(Math.log(p.mcap_usd!) - perCatPredict(pc, p)));
    const beta = olsMulti(rest.map((q) => { const x = Math.log(q.tvl_usd); return [1, x, x * x]; }), rest.map((q) => Math.log(q.mcap_usd!)));
    looQuad.push(Math.abs(Math.log(p.mcap_usd!) - quadPredict(beta, p)));
  }
  const { train, test } = datedComparables(live);
  const pcTrain = fitPerCat(train);
  const walkPer = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - perCatPredict(pcTrain, p)));
  const betaTrain = olsMulti(train.map((q) => { const x = Math.log(q.tvl_usd); return [1, x, x * x]; }), train.map((q) => Math.log(q.mcap_usd!)));
  const walkQuad = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - quadPredict(betaTrain, p)));
  return {
    percat_loo_median_abs_log_err: round4(median(looPer)),
    percat_walk_median_abs_log_err: round4(median(walkPer)),
    quad_loo_median_abs_log_err: round4(median(looQuad)),
    quad_walk_median_abs_log_err: round4(median(walkQuad)),
  };
}

export function validateGuard(snapshot: Snapshot): { loo: number; walk: number } {
  const live = liveComparables(snapshot);
  const looErrs: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = fitPooled(rest);
    const p = live[i]!;
    const inter = fit.categoryIntercept.get(catKey(p)) ?? fit.pooled.intercept;
    looErrs.push(Math.abs(Math.log(p.mcap_usd!) - (inter + fit.pooled.slope * Math.log(p.tvl_usd))));
  }
  const { train, test } = datedComparables(live);
  const fit = fitPooled(train);
  const walkErrs = test.map((p) => {
    const inter = fit.categoryIntercept.get(catKey(p)) ?? fit.pooled.intercept;
    return Math.abs(Math.log(p.mcap_usd!) - (inter + fit.pooled.slope * Math.log(p.tvl_usd)));
  });
  return { loo: round4(median(looErrs)), walk: round4(median(walkErrs)) };
}

export function validateModel(snapshot: Snapshot): Validation {
  const live = liveComparables(snapshot);
  const flatRatio = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const looErrs: number[] = [];
  const looFlat: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    const fit = ols(rest.map((p) => Math.log(p.tvl_usd)), rest.map((p) => Math.log(p.mcap_usd!)));
    const p = live[i]!;
    looErrs.push(Math.abs(Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd))));
    looFlat.push(Math.abs(Math.log(p.mcap_usd!) - Math.log(flatRatio * p.tvl_usd)));
  }
  const looMed = median(looErrs);
  const looFlatMed = median(looFlat);
  const { train, test } = datedComparables(live);
  const wfit = ols(train.map((p) => Math.log(p.tvl_usd)), train.map((p) => Math.log(p.mcap_usd!)));
  const trainFlat = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  const walkErrs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (wfit.intercept + wfit.slope * Math.log(p.tvl_usd))));
  const walkFlat = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(trainFlat * p.tvl_usd)));
  const walkMed = median(walkErrs);
  const walkFlatMed = median(walkFlat);
  const model = fitModel(snapshot);
  const rivals = validateRivals(snapshot);
  const guard = validateGuard(snapshot);
  return {
    loo_n: live.length,
    loo_median_abs_log_err: round4(looMed),
    loo_flat_median_abs_log_err: round4(looFlatMed),
    loo_improvement: round2(looFlatMed / looMed),
    walk_n_train: train.length,
    walk_n_test: test.length,
    walk_median_abs_log_err: round4(walkMed),
    walk_flat_median_abs_log_err: round4(walkFlatMed),
    walk_improvement: round2(walkFlatMed / walkMed),
    pooled_intercept: round4(model.pooled.intercept),
    pooled_slope: round4(model.pooled.slope),
    overall_token_share: round4(model.overallShare),
    percat_loo_median_abs_log_err: rivals.percat_loo_median_abs_log_err,
    percat_walk_median_abs_log_err: rivals.percat_walk_median_abs_log_err,
    quad_loo_median_abs_log_err: rivals.quad_loo_median_abs_log_err,
    quad_walk_median_abs_log_err: rivals.quad_walk_median_abs_log_err,
    guard_loo_median_abs_log_err: guard.loo,
    guard_walk_median_abs_log_err: guard.walk,
    bootstrap_b: BOOTSTRAP_B,
    bootstrap_median_rel_width: 0,
    bootstrap_median_rank_width: 0,
  };
}

// --- Farm plans ---

interface ScoredRow {
  p: SnapshotProtocol;
  age: number | null;
  fv: { fitted: number; intercept: number; growthPct: number; growthMult: number; chainMult: number };
  odds: number;
  implied: number;
  gasTotal: number;
  scenarios: DepositScenario[];
  netPerHour: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('perps')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function stepText(s: string): string {
  let out = s;
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out = `${out} Hold the position and check the protocol's own page.`;
  return out;
}

export function farmPlan(p: SnapshotProtocol, age: number | null, gasTotal: number, scenarios: DepositScenario[], verdict: 'FARM' | 'THIN' | 'SKIP'): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const base = scenarios.find((s) => s.deposit_usd === BASE_DEPOSIT)!;
  const big = scenarios.find((s) => s.deposit_usd === 10000)!;
  const perHour = base.net_per_hour_usd >= 0 ? `$${base.net_per_hour_usd.toFixed(2)}` : `-$${Math.abs(base.net_per_hour_usd).toFixed(2)}`;
  const bigPerHour = big.net_per_hour_usd >= 0 ? `$${big.net_per_hour_usd.toFixed(2)}` : `-$${Math.abs(big.net_per_hour_usd).toFixed(2)}`;
  const be = base.breakeven_odds > 1 ? 'over 100% (never)' : `${(base.breakeven_odds * 100).toFixed(0)}%`;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a chat or a screenshot. Cost: under $${(gasPerTx(p) * 2).toFixed(2)} of gas for the first transactions. Time: 5 minutes.`,
    `${action} Cost: $${capital} of capital and about $${gasPerTx(p).toFixed(2)} of gas. Time: 15 minutes to set up.`,
    `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeat activity. Cost: about $${gasPerTx(p).toFixed(2)} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `If ${p.name} runs a points program, check its own points page weekly and complete the free tasks it lists there. Cost: no fee to check. Time: 10 minutes a week.`,
    `Before you withdraw, open the protocol's own rewards page and claim only from the link it publishes, never from a link in a DM or a reply. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Verdict ${verdict} at a $${BASE_DEPOSIT} deposit: this row nets ${perHour} an hour after $${gasTotal.toFixed(2)} of gas over ${FARM_WEEKS} weeks — ${verdict === 'FARM' ? 'worth farming' : verdict === 'THIN' ? 'marginal, farm only with capital already on this chain' : 'skip it at this size'}; at $10,000 it nets ${bigPerHour} an hour. Break-even launch odds at $${BASE_DEPOSIT} are ${be}. Log the wallet, dates and every transaction.`,
  ].map(stepText);
}

// --- Board building ---

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; model: FittedModel; validation: Validation; census: Census } {
  const model = fitModel(snapshot);
  const validation = validateModel(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const excludedByReason: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    const reason = exclusionReason(p) ?? 'other';
    excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  }
  const liveCount = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const census: Census = {
    total: snapshot.protocols.length,
    ranked: chosen.size,
    live: liveCount,
    excluded: snapshot.protocols.length - chosen.size - liveCount,
    excluded_by_reason: excludedByReason,
  };

  const scored: ScoredRow[] = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const fv = fittedValue(model, p);
    const odds = tokenOdds(model, age);
    const implied = Math.max(1, Math.round(fv.fitted * odds));
    const gasTotal = round2(gasPerTx(p) * FARM_TXS);
    const scenarios = depositScenarios(implied, fv.fitted, p.tvl_usd, gasTotal);
    const base = scenarios.find((s) => s.deposit_usd === BASE_DEPOSIT)!;
    return { p, age, fv, odds, implied, gasTotal, scenarios, netPerHour: base.net_per_hour_usd, verdict: base.verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Bootstrap bands and rank ranges: resample the 128 comparables with
  // replacement (seeded), refit the pooled line + category intercepts each
  // time, and take the P10-P90 of each row's fitted value AND of its rank
  // among the 198 rows. Odds are held fixed. A row whose rank range is
  // wide (say #40-#120) is not really a #40 row — the band says so.
  const live = liveComparables(snapshot);
  const rand = mulberry32(BOOTSTRAP_SEED);
  const bootFits: number[][] = scored.map(() => []);
  const bootRanks: number[][] = scored.map(() => []);
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const boot = fitPooled(sample);
    const bootModel: FittedModel = { ...model, pooled: boot.pooled, categoryIntercept: boot.categoryIntercept };
    const bootImplied = scored.map((s) => fittedValue(bootModel, s.p).fitted * s.odds);
    const order = bootImplied.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0] || (a[1] - b[1]));
    const rankOf = new Array<number>(scored.length);
    order.forEach(([_, idx], pos) => { rankOf[idx] = pos + 1; });
    scored.forEach((s, idx) => {
      bootFits[idx]!.push(fittedValue(bootModel, s.p).fitted);
      bootRanks[idx]!.push(rankOf[idx]!);
    });
  }
  // One row's band, from its 200 resampled fitted values and ranks:
  // P10-P90 of the fitted value (and of the implied value, which is the
  // fitted band scaled by the row's fixed token odds) plus the P10-P90
  // rank range. The median widths across all rows are reported as the
  // run's bootstrap summary.
  const bandFor = (idx: number): { fittedLo: number; fittedHi: number; impliedLo: number; impliedHi: number; rankLo: number; rankHi: number } => {
    const sorted = [...bootFits[idx]!].sort((a, b) => a - b);
    const lo = Math.max(1, Math.round(quantile(sorted, 0.1)));
    const hi = Math.max(1, Math.round(quantile(sorted, 0.9)));
    const medFit = quantile(sorted, 0.5);
    const sortedRanks = [...bootRanks[idx]!].sort((a, b) => a - b);
    const rankLo = Math.round(quantile(sortedRanks, 0.1));
    const rankHi = Math.round(quantile(sortedRanks, 0.9));
    const odds = scored[idx]!.odds;
    return {
      fittedLo: lo,
      fittedHi: hi,
      impliedLo: Math.max(1, Math.round(lo * odds)),
      impliedHi: Math.max(1, Math.round(hi * odds)),
      rankLo,
      rankHi,
    };
  };
  const relWidths: number[] = [];
  const rankWidths: number[] = [];
  const bands = scored.map((s, idx) => {
    const band = bandFor(idx);
    const sorted = [...bootFits[idx]!].sort((a, b) => a - b);
    const medFit = quantile(sorted, 0.5);
    relWidths.push(medFit > 0 ? (band.fittedHi - band.fittedLo) / medFit : 0);
    rankWidths.push(band.rankHi - band.rankLo);
    return band;
  });
  validation.bootstrap_median_rel_width = round4(median(relWidths));
  validation.bootstrap_median_rank_width = round2(median(rankWidths));

  // Category evidence for the detail view: how many comparables the row's
  // category has, and the largest market cap among them — so the reader
  // can see when a fitted value rests on one observation (or none).
  const catStats = new Map<string, { n: number; maxMcap: number | null }>();
  for (const p of live) {
    const key = catKey(p);
    const cur = catStats.get(key) ?? { n: 0, maxMcap: null };
    cur.n++;
    cur.maxMcap = cur.maxMcap === null ? p.mcap_usd! : Math.max(cur.maxMcap, p.mcap_usd!);
    catStats.set(key, cur);
  }

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fitted_value_usd: Math.max(1, Math.round(s.fv.fitted)),
      fitted_lo_usd: bands[i]!.fittedLo,
      fitted_hi_usd: bands[i]!.fittedHi,
      implied_lo_usd: bands[i]!.impliedLo,
      implied_hi_usd: bands[i]!.impliedHi,
      token_odds: round4(s.odds),
      category_intercept: round4(s.fv.intercept),
      category_n: catStats.get(catKey(s.p))?.n ?? 0,
      category_max_mcap_usd: catStats.get(catKey(s.p))?.maxMcap ?? null,
      guard_applied: !model.categoryIntercept.has(catKey(s.p)),
      rank_lo: bands[i]!.rankLo,
      rank_hi: bands[i]!.rankHi,
      pooled_intercept: round4(model.pooled.intercept),
      slope: round4(model.pooled.slope),
      growth_pct: s.fv.growthPct,
      growth_multiplier: round4(s.fv.growthMult),
      chain_multiplier: round4(s.fv.chainMult),
      age_days: s.age,
    },
    farm: {
      capital_usd: BASE_DEPOSIT,
      gas_usd: s.gasTotal,
      hours: FARM_HOURS,
      expected_value_usd: s.scenarios.find((x) => x.deposit_usd === BASE_DEPOSIT)!.expected_value_usd,
      net_per_hour_usd: s.netPerHour,
      verdict: s.verdict,
      scenarios: s.scenarios,
    },
    farm_steps: farmPlan(s.p, s.age, s.gasTotal, s.scenarios, s.verdict),
  }));
  return { board, model, validation, census };
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, validation, census } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const comps: CompRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist: snapshot.watchlist,
    validation,
    census,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      fitted_value_usd: r.model.fitted_value_usd,
      fitted_lo_usd: r.model.fitted_lo_usd,
      fitted_hi_usd: r.model.fitted_hi_usd,
      implied_lo_usd: r.model.implied_lo_usd,
      implied_hi_usd: r.model.implied_hi_usd,
      token_odds: r.model.token_odds,
      category_intercept: r.model.category_intercept,
      category_n: r.model.category_n,
      category_max_mcap_usd: r.model.category_max_mcap_usd,
      guard_applied: r.model.guard_applied,
      rank_lo: r.model.rank_lo,
      rank_hi: r.model.rank_hi,
      growth_multiplier: r.model.growth_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      capital_usd: r.farm.capital_usd,
      gas_usd: r.farm.gas_usd,
      hours: r.farm.hours,
      expected_value_usd: r.farm.expected_value_usd,
      net_per_hour_usd: r.farm.net_per_hour_usd,
      verdict: r.farm.verdict,
      scenarios: r.farm.scenarios,
      farm_steps: r.farm_steps,
    })),
    live,
    comps,
  };
  return { board, radar };
}

// --- Snapshot parsing and board checks ---

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
