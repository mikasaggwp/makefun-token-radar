// Token Radar — model "radar-5", rewritten from scratch in this session.
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
//   fitted  = exp(a + b * ln(TVL) + c * ln(TVL)^2)      (one pooled curve)
//   odds    = P(a token ever lists), age-bin base blended with the
//             protocol's category token rate (shrunk, k=10)
//   implied = fitted * odds
//
//   The curve is a quadratic log-log fit of ln(market cap) on ln(TVL)
//   over the 128 live protocols with a positive market cap (16 live
//   records carry a zero market cap and are left out). It is the single
//   pooled curve — no per-category slopes, no growth multiplier, no chain
//   bonus — because each of those was tested on the same held-out tests
//   and failed to earn its place:
//   * Per-category lines (slope + intercept per category, shrunk toward
//     the pooled line): LOO 1.682, and on the held-out splits they win one
//     and lose another badly (recent 1.2636 vs random 2.0838) — with 1-15
//     comparables per category the slopes are noise. Dropped.
//   * Category intercepts on the quadratic (the radar-4 guard): the
//     four-test average is 1.4260 against the plain quadratic's 1.2839 —
//     the intercepts add noise to the curve. Dropped.
//   * Growth weight: a grid over 0-0.45 on the quadratic shows weight 0
//     wins every test (LOO 1.2167, walk-forward 1.0382, held-recent
//     1.4042, held-random 1.4764; weight 0.3 is worse on all four:
//     1.2308 / 1.0605 / 1.4227 / 1.4948), and the residual correlation
//     with 7-day growth is -0.14 — growth points the wrong way. No
//     growth adjustment is applied.
//   * Chain bonus: the evidence is mixed and the two largest tests say
//     drop it — LOO 1.2167 at 0 vs 1.2836 at 2% per chain, walk-forward
//     1.0382 vs 1.0788, held-recent ties at 1.4042, and only the 25-row
//     held-random split favours the bonus (1.4764 vs 1.4093). No chain
//     bonus is applied.
//   The curve's deviation from the pooled line is small across the
//   board's TVL range (median |deviation| 0.029 log; smallest -0.045,
//   largest +0.058; no row above 0.3) and it is monotone increasing over
//   the whole range (vertex at ln TVL -10.7, far below the $5M floor),
//   so there is no wild extrapolation to guard against.
//
//   odds: the age-bin base is radar-4's (share of peer protocols in the
//   same age bin that record a token, smoothed toward the overall share
//   with a 20-protocol pseudo-count), blended with the protocol's own
//   category token rate, shrunk toward the age-bin base with k=10.
//   Measured on a 5-fold cross-validation over all 758 protocols
//   (seeded, deterministic, computed inside the run): Brier 0.2164 and
//   log-loss 0.6231, against the age-bin-only model with the same
//   corrected prior 0.2171 and 0.6254 — and against radar-4 as shipped,
//   whose prior was the share of protocols with a positive market cap
//   (128/758 = 17%) instead of the share that record a token (416/758
//   = 55%), 0.2216 and 0.6358. A logistic on log(age) was also tested
//   and is worse on the same cross-validation — the age effect is a step
//   around two years, not a smooth log curve.
//   No name is special-cased.
//
// Validation is done inside the run, on the snapshot itself, and the
// numbers are printed on the dashboard — measured, not claimed. Four
// tests, all on the same splits for every model, so the rivals are
// compared on identical footing:
//   leave-one-out (n=128), walk-forward (oldest 70% train -> newest 30%
//   test, by listed date), held-out recent (newest 20% of dated
//   comparables as test, everything else as train), held-out random
//   (seeded 80/20 split, seed 20261124). Median absolute log error,
//   lower is better. The held-out splits are the honest arbiter: the
//   model never sees those rows while fitting, and the tuning (which
//   rival wins) was decided on them, not on the in-sample fit.
// Measured on this snapshot by the run itself (median abs log error):
//   scoring quadratic   LOO 1.2167, walk 1.0382, held-recent 1.4042, held-random 1.4764
//   pooled line         LOO 1.2234, walk 1.2271, held-recent 1.4029, held-random 1.4775
//   pooled + guard      LOO 1.28,   walk 1.1559, held-recent 1.7883, held-random 1.5307
//   per-category lines  LOO 1.682,  walk 1.1559, held-recent 1.2636, held-random 2.0838
//   quadratic + guard   LOO 1.28,   walk 1.0779, held-recent 1.7794, held-random 1.5668
// Four-test averages: quadratic 1.2839, pooled line 1.3327, pooled +
// guard 1.4387, per-category 1.5463, quadratic + guard 1.4260 — the
// plain quadratic wins the average, the walk-forward test, and the
// leave-one-out test; the pooled line edges it on held-recent by 0.0013
// and per-category lines win held-recent outright, so the win is real
// but not a sweep, and the dashboard says so.
//
// Uncertainty: every row's fitted value carries a bootstrap band. The 128
// comparables are resampled with replacement (200 resamples, seeded, so
// the run is deterministic), the curve is refit each time, and the band is
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
// D / (10% of TVL), capped at 25% of the pool — one farmer cannot be
// credited with most of a public pool. (The cap does not bind on this
// snapshot: the largest deposit is 2% of the smallest protocol's farming
// capital, so no row's numbers change; it is in the code so the formula
// cannot credit one farmer with most of a pool on any snapshot.)
//   expected(D)      = implied * 0.05 * min(D / (0.10 * TVL), 0.25)
//   net $/hr(D)      = (expected(D) - gas - opportunity cost) / 3 hours
//   opportunity cost = D * 5% a year * 8/52 (the yield the deposit would
//                      earn elsewhere while it sits in the position).
// A deposit whose break-even launch odds exceed 100% can never pay at any
// odds — it is flagged never_breaks_even and its verdict is SKIP whatever
// the arithmetic says. The headline verdict is judged at a $1,000
// deposit: FARM if net $/hr >= $20, THIN if >= $5, else SKIP. $20 an hour
// is a skilled hourly wage; $5 is a floor below which the time is worth
// more elsewhere. All three deposit scenarios are shown in the detail
// view, so a reader with $100 or $10,000 can see their own numbers
// instead of the headline. Every assumption is stated on the page; none
// of this is a payout promise.

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

export const MODEL_VERSION = 'radar-5';

export const UNKNOWN_AGE_DAYS = 365;
export const LIVE_ROWS = 24;
export const FARM_HOURS = 3;
export const FARM_TXS = 11;
export const FARM_WEEKS = 8;
export const AIRDROP_POOL_SHARE = 0.05;
export const FARMING_CAPITAL_SHARE = 0.1;
export const POOL_SHARE_CAP = 0.25;
export const OPP_APR = 0.05;
export const DEPOSITS = [100, 1000, 10000];
export const BASE_DEPOSIT = 1000;
export const VERDICT_FARM = 20;
export const VERDICT_THIN = 5;
export const BOOTSTRAP_B = 200;
export const BOOTSTRAP_SEED = 20261123;
export const HELD_RANDOM_SEED = 20261124;
export const ODDS_PSEUDO_COUNT = 20;
export const ODDS_CAT_SHRINK = 10;

const GAS_PER_TX: Record<string, number> = {
  ethereum: 6, arbitrum: 0.3, base: 0.1, solana: 0.05, bnb: 0.3,
  polygon: 0.1, avalanche: 0.5, optimism: 0.2, arbitrumone: 0.3,
};
const DEFAULT_GAS = 1;

// Range-guard tuning (rival models only — the scoring curve has no
// category term): a category needs this many comparables before its own
// intercept is trusted, and no intercept may shift the pooled line by
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
  held_recent_n: number;
  held_recent_median_abs_log_err: number;
  held_random_n: number;
  held_random_seed: number;
  held_random_median_abs_log_err: number;
  quad_a: number;
  quad_b: number;
  quad_c: number;
  pooled_loo_median_abs_log_err: number;
  pooled_walk_median_abs_log_err: number;
  pooled_held_recent_median_abs_log_err: number;
  pooled_held_random_median_abs_log_err: number;
  guard_loo_median_abs_log_err: number;
  guard_walk_median_abs_log_err: number;
  guard_held_recent_median_abs_log_err: number;
  guard_held_random_median_abs_log_err: number;
  percat_loo_median_abs_log_err: number;
  percat_walk_median_abs_log_err: number;
  percat_held_recent_median_abs_log_err: number;
  percat_held_random_median_abs_log_err: number;
  quadguard_loo_median_abs_log_err: number;
  quadguard_walk_median_abs_log_err: number;
  quadguard_held_recent_median_abs_log_err: number;
  quadguard_held_random_median_abs_log_err: number;
  odds_cv_brier: number;
  odds_cv_logloss: number;
  odds_v3_cv_brier: number;
  odds_v3_cv_logloss: number;
  odds_v3actual_cv_brier: number;
  odds_v3actual_cv_logloss: number;
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
  never_breaks_even: boolean;
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
    age_bin_odds: number;
    category_token_rate: number;
    category_n: number;
    category_max_mcap_usd: number | null;
    rank_lo: number;
    rank_hi: number;
    quad_a: number;
    quad_b: number;
    quad_c: number;
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
  age_bin_odds: number;
  category_token_rate: number;
  category_n: number;
  category_max_mcap_usd: number | null;
  rank_lo: number;
  rank_hi: number;
  quad_a: number;
  quad_b: number;
  quad_c: number;
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

// Seeded RNG (mulberry32) so bootstrap resamples and the held-out random
// split are identical on every run.
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

// Small least-squares solver (Gaussian elimination) for the quadratic fit.
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

// The scoring curve: ln(mcap) = a + b*ln(TVL) + c*ln(TVL)^2, one pooled
// fit over the comparables. The vertex sits at ln TVL -10.7, far below
// the snapshot's $5M floor, so the curve rises across the whole board.
export type QuadFit = [number, number, number];

export function fitQuadratic(train: SnapshotProtocol[]): QuadFit {
  const beta = olsMulti(
    train.map((q) => { const x = Math.log(q.tvl_usd); return [1, x, x * x]; }),
    train.map((q) => Math.log(q.mcap_usd!)),
  );
  return [beta[0]!, beta[1]!, beta[2]!];
}

export function quadPredict(beta: QuadFit, p: SnapshotProtocol): number {
  const x = Math.log(Math.max(1, p.tvl_usd));
  return beta[0] + beta[1] * x + beta[2] * x * x;
}

interface PooledFit { pooled: Fit; categoryIntercept: Map<string, number>; }

// Shrink a category's mean residual toward zero and cap the shift, so one
// loud comparable cannot drag a whole category's line with it. (Rival
// models only — the scoring curve has no category term.)
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

function pooledPredict(fit: PooledFit, p: SnapshotProtocol): number {
  return (fit.categoryIntercept.get(catKey(p)) ?? fit.pooled.intercept) + fit.pooled.slope * Math.log(p.tvl_usd);
}

function pooledLinePredict(fit: PooledFit, p: SnapshotProtocol): number {
  return fit.pooled.intercept + fit.pooled.slope * Math.log(p.tvl_usd);
}

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

interface QuadGuardFit { beta: QuadFit; shift: Map<string, number>; }

function fitQuadGuard(train: SnapshotProtocol[]): QuadGuardFit {
  const beta = fitQuadratic(train);
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const resid = Math.log(p.mcap_usd!) - quadPredict(beta, p);
    const key = catKey(p);
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(resid);
  }
  const shift = new Map<string, number>();
  for (const [key, resids] of byCat) {
    const s = guardedShift(resids);
    if (s === null) continue;
    shift.set(key, s);
  }
  return { beta, shift };
}

function quadGuardPredict(model: QuadGuardFit, p: SnapshotProtocol): number {
  return quadPredict(model.beta, p) + (model.shift.get(catKey(p)) ?? 0);
}

// --- Token odds: age-bin base blended with the category token rate ---

export interface OddsModel {
  overallShare: number;
  // Age bins: [lo, hi) in days; the last bin is the unknown-age group.
  ageBins: { lo: number; hi: number; live: number; total: number }[];
  catLive: Map<string, number>;
  catTotal: Map<string, number>;
}

const AGE_BINS: { lo: number; hi: number }[] = [
  { lo: 0, hi: 365 },
  { lo: 365, hi: 730 },
  { lo: 730, hi: 1460 },
  { lo: 1460, hi: Number.POSITIVE_INFINITY },
];

export function fitOddsDated(snapshot: Snapshot): OddsModel {
  const protocols = snapshot.protocols;
  const live = protocols.filter((p) => !isPreToken(p)).length;
  const overallShare = live / protocols.length;
  const ageBins = AGE_BINS.map((b) => ({ ...b, live: 0, total: 0 }));
  let unknownTotal = 0;
  let unknownLive = 0;
  const catLive = new Map<string, number>();
  const catTotal = new Map<string, number>();
  for (const p of protocols) {
    const key = catKey(p);
    catTotal.set(key, (catTotal.get(key) ?? 0) + 1);
    if (!isPreToken(p)) catLive.set(key, (catLive.get(key) ?? 0) + 1);
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age === null) {
      unknownTotal++;
      if (!isPreToken(p)) unknownLive++;
      continue;
    }
    const bin = ageBins.find((b) => age >= b.lo && age < b.hi)!;
    bin.total++;
    if (!isPreToken(p)) bin.live++;
  }
  ageBins.push({ lo: -1, hi: -1, live: unknownLive, total: unknownTotal });
  return { overallShare, ageBins, catLive, catTotal };
}

function ageBinOdds(model: OddsModel, age: number | null): number {
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
  return (live + prior * ODDS_PSEUDO_COUNT) / (total + ODDS_PSEUDO_COUNT);
}

export function tokenOddsParts(model: OddsModel, age: number | null, category: string | null): { odds: number; ageBinOdds: number; categoryRate: number } {
  const base = ageBinOdds(model, age);
  const key = (category ?? 'Uncategorised').toLowerCase();
  const n = model.catTotal.get(key) ?? 0;
  const live = model.catLive.get(key) ?? 0;
  const catRate = (live + model.overallShare * ODDS_CAT_SHRINK) / (n + ODDS_CAT_SHRINK);
  const w = n / (n + ODDS_CAT_SHRINK);
  return { odds: w * catRate + (1 - w) * base, ageBinOdds: base, categoryRate: catRate };
}

export function tokenOdds(model: OddsModel, age: number | null, category: string | null): number {
  return tokenOddsParts(model, age, category).odds;
}

// --- Value and farm economics ---

export function gasPerTx(p: SnapshotProtocol): number {
  for (const c of p.chains) {
    const key = c.toLowerCase().replace(/[^a-z]/g, '');
    if (key in GAS_PER_TX) return GAS_PER_TX[key]!;
  }
  return DEFAULT_GAS;
}

// The fitted value is the curve alone: no growth multiplier, no chain
// bonus — both were tested and dropped (see the header comment).
export function fittedValue(beta: QuadFit, p: SnapshotProtocol): number {
  return Math.max(1, Math.exp(quadPredict(beta, p)));
}

// A farmer's share of the airdrop pool, capped at a quarter of the pool.
export function poolShare(tvl: number, deposit: number): number {
  if (tvl <= 0) return 0;
  return Math.min(deposit / (FARMING_CAPITAL_SHARE * tvl), POOL_SHARE_CAP);
}

export function expectedForDeposit(implied: number, tvl: number, deposit: number): number {
  return implied * AIRDROP_POOL_SHARE * poolShare(tvl, deposit);
}

export function opportunityCost(deposit: number): number {
  return deposit * OPP_APR * (FARM_WEEKS / 52);
}

export function verdictFor(netPerHour: number): 'FARM' | 'THIN' | 'SKIP' {
  return netPerHour >= VERDICT_FARM ? 'FARM' : netPerHour >= VERDICT_THIN ? 'THIN' : 'SKIP';
}

// Break-even launch odds: the token odds at which this deposit's expected
// value exactly covers its gas + opportunity cost.
// expected = fitted x odds x 0.05 x share, so
// odds* = (gas + opp) / (fitted x 0.05 x share).
// Above 1 (100%) the deposit can never break even at any odds.
function breakevenOdds(fitted: number, tvl: number, deposit: number, gasTotal: number, opp: number): number {
  const share = poolShare(tvl, deposit);
  if (fitted <= 0 || share <= 0) return 999;
  return round4((gasTotal + opp) / (fitted * AIRDROP_POOL_SHARE * share));
}

export function depositScenarios(implied: number, fitted: number, tvl: number, gasTotal: number): DepositScenario[] {
  return DEPOSITS.map((deposit) => {
    const expected = round2(expectedForDeposit(implied, tvl, deposit));
    const opp = round2(opportunityCost(deposit));
    const net = round2((expected - gasTotal - opp) / FARM_HOURS);
    const breakeven = breakevenOdds(fitted, tvl, deposit, gasTotal, opp);
    const never = breakeven > 1;
    return {
      deposit_usd: deposit,
      expected_value_usd: expected,
      opportunity_cost_usd: opp,
      net_per_hour_usd: net,
      verdict: never ? 'SKIP' : verdictFor(net),
      breakeven_odds: breakeven,
      never_breaks_even: never,
    };
  });
}

// --- Validation: four tests, same splits for every model ---

function liveComparables(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

function datedComparables(live: SnapshotProtocol[]): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length * 0.7);
  return { train: dated.slice(0, cut), test: dated.slice(cut) };
}

function heldRecentSplit(live: SnapshotProtocol[]): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const test = dated.slice(Math.floor(dated.length * 0.8));
  const testSlugs = new Set(test.map((p) => p.slug));
  return { train: live.filter((p) => !testSlugs.has(p.slug)), test };
}

function heldRandomSplit(live: SnapshotProtocol[]): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const rand = mulberry32(HELD_RANDOM_SEED);
  const idx = live.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const nTest = Math.floor(live.length * 0.2);
  const testSet = new Set(idx.slice(0, nTest));
  return {
    train: live.filter((_, i) => !testSet.has(i)),
    test: live.filter((_, i) => testSet.has(i)),
  };
}

type PredictFn<T> = (fit: T, p: SnapshotProtocol) => number;

function errOf<T>(fit: T, predict: PredictFn<T>, p: SnapshotProtocol): number {
  return Math.abs(Math.log(p.mcap_usd!) - predict(fit, p));
}

interface ModelTests {
  loo: number;
  walk: number;
  heldRecent: number;
  heldRandom: number;
}

function testModel<T>(snapshot: Snapshot, fitMaker: (train: SnapshotProtocol[]) => T, predict: PredictFn<T>): ModelTests {
  const live = liveComparables(snapshot);
  const looErrs: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const rest = live.filter((_, j) => j !== i);
    looErrs.push(errOf(fitMaker(rest), predict, live[i]!));
  }
  const { train, test } = datedComparables(live);
  const walkFit = fitMaker(train);
  const walkErrs = test.map((p) => errOf(walkFit, predict, p));
  const recent = heldRecentSplit(live);
  const recentFit = fitMaker(recent.train);
  const recentErrs = recent.test.map((p) => errOf(recentFit, predict, p));
  const random = heldRandomSplit(live);
  const randomFit = fitMaker(random.train);
  const randomErrs = random.test.map((p) => errOf(randomFit, predict, p));
  return {
    loo: round4(median(looErrs)),
    walk: round4(median(walkErrs)),
    heldRecent: round4(median(recentErrs)),
    heldRandom: round4(median(randomErrs)),
  };
}

export function validateModel(snapshot: Snapshot): Validation {
  const live = liveComparables(snapshot);
  const flatRatio = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const looErrs: number[] = [];
  const looFlat: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const p = live[i]!;
    const beta = fitQuadratic(live.filter((_, j) => j !== i));
    looErrs.push(Math.abs(Math.log(p.mcap_usd!) - quadPredict(beta, p)));
    looFlat.push(Math.abs(Math.log(p.mcap_usd!) - Math.log(flatRatio * p.tvl_usd)));
  }
  const looMed = median(looErrs);
  const looFlatMed = median(looFlat);
  const { train, test } = datedComparables(live);
  const wBeta = fitQuadratic(train);
  const trainFlat = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  const walkErrs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - quadPredict(wBeta, p)));
  const walkFlat = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(trainFlat * p.tvl_usd)));
  const walkMed = median(walkErrs);
  const walkFlatMed = median(walkFlat);
  const recent = heldRecentSplit(live);
  const recentBeta = fitQuadratic(recent.train);
  const recentMed = median(recent.test.map((p) => Math.abs(Math.log(p.mcap_usd!) - quadPredict(recentBeta, p))));
  const random = heldRandomSplit(live);
  const randomBeta = fitQuadratic(random.train);
  const randomMed = median(random.test.map((p) => Math.abs(Math.log(p.mcap_usd!) - quadPredict(randomBeta, p))));
  const beta = fitQuadratic(live);

  const pooled = testModel(snapshot, fitPooled, pooledLinePredict);
  const guard = testModel(snapshot, fitPooled, pooledPredict);
  const percat = testModel(snapshot, fitPerCat, perCatPredict);
  const quadguard = testModel(snapshot, fitQuadGuard, quadGuardPredict);
  const odds = validateOdds(snapshot);

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
    held_recent_n: recent.test.length,
    held_recent_median_abs_log_err: round4(recentMed),
    held_random_n: random.test.length,
    held_random_seed: HELD_RANDOM_SEED,
    held_random_median_abs_log_err: round4(randomMed),
    // Full precision on purpose: the dashboard recomputes every row's
    // fitted value live from these three numbers, so rounding them to 4
    // decimals would move fitted values by up to ~2% (quad_c acts on
    // ln(TVL)^2, about 400). Display code formats them to 4 decimals;
    // the stored values stay exact.
    quad_a: beta[0],
    quad_b: beta[1],
    quad_c: beta[2],
    pooled_loo_median_abs_log_err: pooled.loo,
    pooled_walk_median_abs_log_err: pooled.walk,
    pooled_held_recent_median_abs_log_err: pooled.heldRecent,
    pooled_held_random_median_abs_log_err: pooled.heldRandom,
    guard_loo_median_abs_log_err: guard.loo,
    guard_walk_median_abs_log_err: guard.walk,
    guard_held_recent_median_abs_log_err: guard.heldRecent,
    guard_held_random_median_abs_log_err: guard.heldRandom,
    percat_loo_median_abs_log_err: percat.loo,
    percat_walk_median_abs_log_err: percat.walk,
    percat_held_recent_median_abs_log_err: percat.heldRecent,
    percat_held_random_median_abs_log_err: percat.heldRandom,
    quadguard_loo_median_abs_log_err: quadguard.loo,
    quadguard_walk_median_abs_log_err: quadguard.walk,
    quadguard_held_recent_median_abs_log_err: quadguard.heldRecent,
    quadguard_held_random_median_abs_log_err: quadguard.heldRandom,
    odds_cv_brier: odds.brier,
    odds_cv_logloss: odds.logloss,
    odds_v3_cv_brier: odds.v3Brier,
    odds_v3_cv_logloss: odds.v3Logloss,
    odds_v3actual_cv_brier: odds.v3ActualBrier,
    odds_v3actual_cv_logloss: odds.v3ActualLogloss,
    bootstrap_b: BOOTSTRAP_B,
    bootstrap_median_rel_width: 0,
    bootstrap_median_rank_width: 0,
  };
}

// --- Token-odds cross-validation (5-fold, seeded) ---

// The radar-4 odds AS SHIPPED: age-bin base only, but smoothed toward the
// wrong prior — the share of protocols with a positive market cap
// (128/758 = 17%) instead of the share that record a token (416/758 =
// 55%). The bins count protocols that record a token as live, so the
// prior and the bins come from different populations. It is kept here
// as a rival so the fix is measured, not asserted.
function v3ActualOddsFor(train: SnapshotProtocol[], asOf: string, p: SnapshotProtocol): number {
  const overall = train.filter((q) => q.mcap_usd !== null && q.mcap_usd > 0).length / train.length;
  const age = ageDays(asOf, p.listed_at);
  let live = 0;
  let total = 0;
  if (age === null) {
    const unk = train.filter((q) => ageDays(asOf, q.listed_at) === null);
    live = unk.filter((q) => !isPreToken(q)).length;
    total = unk.length;
  } else {
    const bin = AGE_BINS.find((b) => age >= b.lo && age < b.hi);
    if (bin) {
      const grp = train.filter((q) => {
        const a = ageDays(asOf, q.listed_at);
        return a !== null && a >= bin.lo && a < bin.hi;
      });
      live = grp.filter((q) => !isPreToken(q)).length;
      total = grp.length;
    }
  }
  if (total === 0) return overall;
  return (live + overall * ODDS_PSEUDO_COUNT) / (total + ODDS_PSEUDO_COUNT);
}

// The radar-4 odds: age-bin base only, smoothed toward the overall share.
function v3OddsFor(train: SnapshotProtocol[], asOf: string, p: SnapshotProtocol): number {
  const overall = train.filter((q) => !isPreToken(q)).length / train.length;
  const age = ageDays(asOf, p.listed_at);
  let live = 0;
  let total = 0;
  if (age === null) {
    const unk = train.filter((q) => ageDays(asOf, q.listed_at) === null);
    live = unk.filter((q) => !isPreToken(q)).length;
    total = unk.length;
  } else {
    const bin = AGE_BINS.find((b) => age >= b.lo && age < b.hi);
    if (bin) {
      const grp = train.filter((q) => {
        const a = ageDays(asOf, q.listed_at);
        return a !== null && a >= bin.lo && a < bin.hi;
      });
      live = grp.filter((q) => !isPreToken(q)).length;
      total = grp.length;
    }
  }
  if (total === 0) return overall;
  return (live + overall * ODDS_PSEUDO_COUNT) / (total + ODDS_PSEUDO_COUNT);
}

// The radar-5 odds, fitted on a training set: age-bin base blended with
// the category token rate, shrunk with k=10.
function v5OddsFor(train: SnapshotProtocol[], asOf: string, p: SnapshotProtocol): number {
  const overall = train.filter((q) => !isPreToken(q)).length / train.length;
  const base = v3OddsFor(train, asOf, p);
  const key = catKey(p);
  const grp = train.filter((q) => catKey(q) === key);
  const n = grp.length;
  const live = grp.filter((q) => !isPreToken(q)).length;
  const catRate = (live + overall * ODDS_CAT_SHRINK) / (n + ODDS_CAT_SHRINK);
  const w = n / (n + ODDS_CAT_SHRINK);
  return w * catRate + (1 - w) * base;
}

export function validateOdds(snapshot: Snapshot): { brier: number; logloss: number; v3Brier: number; v3Logloss: number; v3ActualBrier: number; v3ActualLogloss: number } {
  const all = snapshot.protocols;
  const rand = mulberry32(HELD_RANDOM_SEED);
  const idx = all.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const folds: number[][] = [[], [], [], [], []];
  idx.forEach((v, i) => folds[i % 5]!.push(v));
  let brierSum = 0;
  let loglossSum = 0;
  let v3BrierSum = 0;
  let v3LoglossSum = 0;
  let v3ActualBrierSum = 0;
  let v3ActualLoglossSum = 0;
  for (const fold of folds) {
    const testSet = new Set(fold);
    const train = all.filter((_, i) => !testSet.has(i));
    const test = all.filter((_, i) => testSet.has(i));
    for (const p of test) {
      const y = isPreToken(p) ? 0 : 1;
      const pr = v5OddsFor(train, snapshot.as_of, p);
      const pr3 = v3OddsFor(train, snapshot.as_of, p);
      const prA = v3ActualOddsFor(train, snapshot.as_of, p);
      brierSum += (pr - y) * (pr - y);
      v3BrierSum += (pr3 - y) * (pr3 - y);
      v3ActualBrierSum += (prA - y) * (prA - y);
      const eps = 1e-9;
      const c = Math.min(Math.max(pr, eps), 1 - eps);
      const c3 = Math.min(Math.max(pr3, eps), 1 - eps);
      const cA = Math.min(Math.max(prA, eps), 1 - eps);
      loglossSum += y === 1 ? -Math.log(c) : -Math.log(1 - c);
      v3LoglossSum += y === 1 ? -Math.log(c3) : -Math.log(1 - c3);
      v3ActualLoglossSum += y === 1 ? -Math.log(cA) : -Math.log(1 - cA);
    }
  }
  const n = all.length;
  return {
    brier: round4(brierSum / n),
    logloss: round4(loglossSum / n),
    v3Brier: round4(v3BrierSum / n),
    v3Logloss: round4(v3LoglossSum / n),
    v3ActualBrier: round4(v3ActualBrierSum / n),
    v3ActualLogloss: round4(v3ActualLoglossSum / n),
  };
}

// --- Farm plans ---

interface ScoredRow {
  p: SnapshotProtocol;
  age: number | null;
  fitted: number;
  oddsParts: { odds: number; ageBinOdds: number; categoryRate: number };
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
  const be = base.never_breaks_even ? 'over 100% (never breaks even at any launch odds)' : `${(base.breakeven_odds * 100).toFixed(0)}%`;
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

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; model: { beta: QuadFit; odds: OddsModel }; validation: Validation; census: Census } {
  const beta = fitQuadratic(liveComparables(snapshot));
  const odds = fitOddsDated(snapshot);
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
    const fitted = fittedValue(beta, p);
    const oddsParts = tokenOddsParts(odds, age, p.category);
    const implied = Math.max(1, Math.round(fitted * oddsParts.odds));
    const gasTotal = round2(gasPerTx(p) * FARM_TXS);
    const scenarios = depositScenarios(implied, fitted, p.tvl_usd, gasTotal);
    const base = scenarios.find((s) => s.deposit_usd === BASE_DEPOSIT)!;
    return { p, age, fitted, oddsParts, implied, gasTotal, scenarios, netPerHour: base.net_per_hour_usd, verdict: base.verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // Bootstrap bands and rank ranges: resample the 128 comparables with
  // replacement (seeded), refit the quadratic curve each time, and take
  // the P10-P90 of each row's fitted value AND of its rank among the 198
  // rows. Odds are held fixed. A row whose rank range is wide (say
  // #40-#120) is not really a #40 row — the band says so.
  const live = liveComparables(snapshot);
  const rand = mulberry32(BOOTSTRAP_SEED);
  const bootFits: number[][] = scored.map(() => []);
  const bootRanks: number[][] = scored.map(() => []);
  for (let b = 0; b < BOOTSTRAP_B; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < live.length; i++) sample.push(live[Math.floor(rand() * live.length)]!);
    const bootBeta = fitQuadratic(sample);
    const bootImplied = scored.map((s) => fittedValue(bootBeta, s.p) * s.oddsParts.odds);
    const order = bootImplied.map((v, i) => [v, i] as [number, number]).sort((a, b) => b[0] - a[0] || (a[1] - b[1]));
    const rankOf = new Array<number>(scored.length);
    order.forEach(([_, idx], pos) => { rankOf[idx] = pos + 1; });
    scored.forEach((s, idx) => {
      bootFits[idx]!.push(fittedValue(bootBeta, s.p));
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
    const sortedRanks = [...bootRanks[idx]!].sort((a, b) => a - b);
    const rankLo = Math.round(quantile(sortedRanks, 0.1));
    const rankHi = Math.round(quantile(sortedRanks, 0.9));
    const odds = scored[idx]!.oddsParts.odds;
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
      fitted_value_usd: Math.max(1, Math.round(s.fitted)),
      fitted_lo_usd: bands[i]!.fittedLo,
      fitted_hi_usd: bands[i]!.fittedHi,
      implied_lo_usd: bands[i]!.impliedLo,
      implied_hi_usd: bands[i]!.impliedHi,
      token_odds: round4(s.oddsParts.odds),
      age_bin_odds: round4(s.oddsParts.ageBinOdds),
      category_token_rate: round4(s.oddsParts.categoryRate),
      category_n: catStats.get(catKey(s.p))?.n ?? 0,
      category_max_mcap_usd: catStats.get(catKey(s.p))?.maxMcap ?? null,
      rank_lo: bands[i]!.rankLo,
      rank_hi: bands[i]!.rankHi,
      // Full precision, same reason as in validateModel: the dashboard
      // recomputes from these numbers, so they must be exact.
      quad_a: beta[0],
      quad_b: beta[1],
      quad_c: beta[2],
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
  return { board, model: { beta, odds }, validation, census };
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
      age_bin_odds: r.model.age_bin_odds,
      category_token_rate: r.model.category_token_rate,
      category_n: r.model.category_n,
      category_max_mcap_usd: r.model.category_max_mcap_usd,
      rank_lo: r.model.rank_lo,
      rank_hi: r.model.rank_hi,
      quad_a: r.model.quad_a,
      quad_b: r.model.quad_b,
      quad_c: r.model.quad_c,
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
