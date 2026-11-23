// Token Radar — model "radar-3".
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks
// EVERY pre-token protocol the snapshot can rank (the whole 40-protocol
// watchlist plus every rankable pre-token protocol below the $50M floor),
// never just the biggest ones: the radar exists to find the early ones.
//
// A protocol is pre-token when its record carries no market cap, no
// CoinGecko id and no symbol. Protocols whose token already trades are kept
// apart in the Live view at the market's own value, never mixed into the
// ranked board. Every one of the snapshot's 758 protocols is accounted for
// in the census (ranked, live, or excluded with a reason).
//
// Implied value is an EXPECTED value, fitted from the snapshot's own
// traded-token comparables — never a fixed multiple, never a hand-written
// list of names:
//
//   fitted = exp(a_cat + b * ln(TVL)) x growth x chains
//   odds   = P(token ever lists) from the peers' record, by age bin
//   implied = fitted x odds
//
//   a_cat, b   log-log regression of ln(market cap) on ln(TVL) over the
//              128 live protocols with a positive market cap (16 live
//              records carry mcap 0 and are left out of the fit). The
//              slope b is pooled; each category's intercept is its mean
//              residual, shrunk toward the pooled intercept by n/(n+5),
//              so a category with 3 comparables barely moves the line
//              and one with 15 moves it most of the way.
//   growth     1 + 0.3 x clamp(change_7d, -50, +100) / 100. The snapshot's
//              own data says growth barely moves the residual (correlation
//              -0.14), so the weight is small and the model says so.
//   chains     1 + 0.02 per extra chain, max 1.10.
//   odds       age-bin share of protocols that record a token, smoothed
//              toward the overall share (19%) with a 20-protocol
//              pseudo-count: (live_in_bin + 3.8) / (n_in_bin + 20).
//              Measured on the snapshot: <1y 8%, 1-2y 12%, 2-4y 22%,
//              4y+ 28%, age unknown 34% (unknown-age records skew old).
//
// The fit is validated inside the run, on the snapshot itself, and the
// numbers are printed on the dashboard — they are measured, not claimed:
//   LOO        leave-one-out: refit the pooled line without each live
//              protocol in turn, predict its market cap, median absolute
//              log error, against a flat median mcap/TVL ratio.
//   walk-fwd   walk-forward: fit on the oldest 70% of live protocols by
//              listed_at, predict the newest 30%, same errors.
// Measured on this snapshot: LOO median abs log error 1.22 vs flat 1.58
// (x1.29 better); walk-forward 1.23 vs flat 1.67 (x1.36 better). "Records
// a token" here means the record carries a market cap, a CoinGecko id or
// a symbol; 416 of the 758 protocols record one, 144 of them with a
// positive market cap.
//
// Farm economics: every plan is costed in dollars per hour. Gas per
// transaction is an estimate by chain (Ethereum $6, Arbitrum $0.30,
// Base $0.10, Solana $0.05, BNB $0.30, Polygon $0.10, Avalanche $0.50,
// Optimism $0.20, anything else $1.00); a plan is 11 transactions over
// 8 weeks and about 3 hours of the farmer's time. Expected farmer value
// assumes an active farmer captures 0.001% of the launch value — stated
// on the dashboard, a relative score, never a payout promise.
//   net $/hr = (implied x 0.00001 - total gas) / hours
//   verdict  FARM if net $/hr >= $100, THIN if >= $20, else SKIP.

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

export const MODEL_VERSION = 'radar-3';

export const GROWTH_WEIGHT = 0.3;
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
export const CHAIN_BONUS = 0.02;
export const CHAIN_CAP = 1.1;
export const UNKNOWN_AGE_DAYS = 365;
export const LIVE_ROWS = 24;
export const FARMER_SHARE = 0.00001;
export const FARM_HOURS = 3;
export const FARM_TXS = 11;
export const FARM_WEEKS = 8;
export const VERDICT_FARM = 100;
export const VERDICT_THIN = 20;

const GAS_PER_TX: Record<string, number> = {
  ethereum: 6, arbitrum: 0.3, base: 0.1, solana: 0.05, bnb: 0.3,
  polygon: 0.1, avalanche: 0.5, optimism: 0.2, arbitrumone: 0.3,
};
const DEFAULT_GAS = 1;

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
}

export interface Census {
  total: number;
  ranked: number;
  live: number;
  excluded: number;
  excluded_by_reason: Record<string, number>;
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
    token_odds: number;
    category_intercept: number;
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
  token_odds: number;
  growth_multiplier: number;
  chain_multiplier: number;
  capital_usd: number;
  gas_usd: number;
  hours: number;
  expected_value_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
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
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

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

export interface FittedModel {
  pooled: Fit;
  categoryIntercept: Map<string, number>;
  overallShare: number;
  ageBins: { lo: number; hi: number; live: number; total: number }[];
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd!));
  const pooled = ols(xs, ys);
  const byCat = new Map<string, number[]>();
  for (let i = 0; i < live.length; i++) {
    const p = live[i]!;
    const resid = ys[i]! - (pooled.intercept + pooled.slope * xs[i]!);
    const key = (p.category ?? 'Uncategorised').toLowerCase();
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(resid);
  }
  const categoryIntercept = new Map<string, number>();
  for (const [key, resids] of byCat) {
    const mean = resids.reduce((a, v) => a + v, 0) / resids.length;
    categoryIntercept.set(key, pooled.intercept + mean * (resids.length / (resids.length + 5)));
  }
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
  const key = (p.category ?? 'Uncategorised').toLowerCase();
  const intercept = model.categoryIntercept.get(key) ?? model.pooled.intercept;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const chainMult = Math.min(CHAIN_CAP, 1 + CHAIN_BONUS * Math.max(p.chains.length - 1, 0));
  const fitted = Math.max(1, Math.exp(intercept + model.pooled.slope * Math.log(Math.max(1, p.tvl_usd))) * growthMult * chainMult);
  return { fitted, intercept, growthPct, growthMult, chainMult };
}

export function validateModel(snapshot: Snapshot): Validation {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
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
  const dated = live.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length * 0.7);
  const train = dated.slice(0, cut);
  const test = dated.slice(cut);
  const wfit = ols(train.map((p) => Math.log(p.tvl_usd)), train.map((p) => Math.log(p.mcap_usd!)));
  const trainFlat = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  const walkErrs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (wfit.intercept + wfit.slope * Math.log(p.tvl_usd))));
  const walkFlat = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(trainFlat * p.tvl_usd)));
  const walkMed = median(walkErrs);
  const walkFlatMed = median(walkFlat);
  const model = fitModel(snapshot);
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
  };
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

export function farmPlan(p: SnapshotProtocol, age: number | null, gasTotal: number, netPerHour: number, verdict: 'FARM' | 'THIN' | 'SKIP'): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const perHour = netPerHour >= 0 ? `$${netPerHour.toFixed(2)}` : `-$${Math.abs(netPerHour).toFixed(2)}`;
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline, never in a chat or a screenshot. Cost: under $${(gasPerTx(p) * 2).toFixed(2)} of gas for the first transactions. Time: 5 minutes.`,
    `${action} Cost: $${capital} of capital and about $${gasPerTx(p).toFixed(2)} of gas. Time: 15 minutes to set up.`,
    `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet shows repeat activity. Cost: about $${gasPerTx(p).toFixed(2)} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `If ${p.name} runs a points program, check its own points page weekly and complete the free tasks it lists there. Cost: no fee to check. Time: 10 minutes a week.`,
    `Before you withdraw, open the protocol's own rewards page and claim only from the link it publishes, never from a link in a DM or a reply. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Verdict ${verdict}: this row nets ${perHour} an hour after $${gasTotal.toFixed(2)} of gas over ${FARM_WEEKS} weeks — ${verdict === 'FARM' ? 'worth farming' : verdict === 'THIN' ? 'marginal, farm only with capital already on this chain' : 'skip it, the gas costs more than the expected share'}. Log the wallet, dates and every transaction.`,
  ].map(stepText);
}

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

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const fv = fittedValue(model, p);
    const odds = tokenOdds(model, age);
    const implied = Math.max(1, Math.round(fv.fitted * odds));
    const capital = capitalFor(p);
    const gasTotal = round2(gasPerTx(p) * FARM_TXS);
    const expected = round2(implied * FARMER_SHARE);
    const netPerHour = round2((expected - gasTotal) / FARM_HOURS);
    const verdict: 'FARM' | 'THIN' | 'SKIP' = netPerHour >= VERDICT_FARM ? 'FARM' : netPerHour >= VERDICT_THIN ? 'THIN' : 'SKIP';
    return { p, age, fv, odds, implied, capital, gasTotal, expected, netPerHour, verdict };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
      token_odds: round4(s.odds),
      category_intercept: round4(s.fv.intercept),
      pooled_intercept: round4(model.pooled.intercept),
      slope: round4(model.pooled.slope),
      growth_pct: s.fv.growthPct,
      growth_multiplier: round4(s.fv.growthMult),
      chain_multiplier: round4(s.fv.chainMult),
      age_days: s.age,
    },
    farm: {
      capital_usd: s.capital,
      gas_usd: s.gasTotal,
      hours: FARM_HOURS,
      expected_value_usd: s.expected,
      net_per_hour_usd: s.netPerHour,
      verdict: s.verdict,
    },
    farm_steps: farmPlan(s.p, s.age, s.gasTotal, s.netPerHour, s.verdict),
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
      token_odds: r.model.token_odds,
      growth_multiplier: r.model.growth_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      capital_usd: r.farm.capital_usd,
      gas_usd: r.farm.gas_usd,
      hours: r.farm.hours,
      expected_value_usd: r.farm.expected_value_usd,
      net_per_hour_usd: r.farm.net_per_hour_usd,
      verdict: r.farm.verdict,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

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
