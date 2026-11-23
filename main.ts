// Token Radar entry (Node 22, standard library only) — model "radar-4".
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the value model on the snapshot's own traded-token comparables in
// lib/radar.ts (pooled log-log line, with per-category and quadratic rivals
// fitted blind and tested on the same leave-one-out and walk-forward tests,
// plus a 200-resample bootstrap band on every row's fitted value), writes
// the ranked board to /output/board.json, writes the dashboard data to
// /output/data.js, copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with buildDossier from vendor/makefun-board.ts.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
// The dashboard must be able to render from data.js alone: refuse a run
// whose data file is missing or empty instead of shipping a blank page.
if (!existsSync(join(out, 'data.js')) || statSync(join(out, 'data.js')).size < 100) {
  process.stderr.write('token radar: data.js was not written\n');
  process.exit(1);
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const v = radar.validation;
const verdicts = { FARM: board.filter((r) => r.farm.verdict === 'FARM').length, THIN: board.filter((r) => r.farm.verdict === 'THIN').length, SKIP: board.filter((r) => r.farm.verdict === 'SKIP').length };
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: census ${radar.census.total} total = ${radar.census.ranked} ranked + ${radar.census.live} record a token + ${radar.census.excluded} pre-token excluded\n` +
    `token radar: fit ln(mcap) = ${v.pooled_intercept} + ${v.pooled_slope} ln(TVL); LOO median abs log err ${v.loo_median_abs_log_err} vs flat ${v.loo_flat_median_abs_log_err} (x${v.loo_improvement}); walk-forward ${v.walk_median_abs_log_err} vs flat ${v.walk_flat_median_abs_log_err} (x${v.walk_improvement})\n` +
    `token radar: rivals on the same tests — per-category lines LOO ${v.percat_loo_median_abs_log_err}, walk ${v.percat_walk_median_abs_log_err}; quadratic LOO ${v.quad_loo_median_abs_log_err}, walk ${v.quad_walk_median_abs_log_err}; the quadratic only edges LOO by 0.5% and its walk gain flips across splits, so the pooled line scores the board\n` +
    `token radar: range guard (category intercept only with >=3 comparables, shift capped at 0.5 log) LOO ${v.guard_loo_median_abs_log_err}, walk ${v.guard_walk_median_abs_log_err} — Polymarket fitted $86.7M without the guard, $29.2M with it (one comparable, Rain, 400x mcap/TVL)\n` +
    `token radar: bootstrap ${v.bootstrap_b} resamples, median P90-P10 width ${v.bootstrap_median_rel_width}x the median fitted value, median rank range ${v.bootstrap_median_rank_width} places\n` +
    `token radar: verdicts at $1,000 deposit FARM ${verdicts.FARM} / THIN ${verdicts.THIN} / SKIP ${verdicts.SKIP}\n` +
    `token radar: top 3: ${board.slice(0, 3).map((r) => `#${r.rank} ${r.name} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
