// Token Radar entry (Node 22, standard library only) — model "radar-5".
//
// Reads the sealed snapshot from /input/snapshot.json (or --input
// <file|dir>), fits the value model on the snapshot's own traded-token
// comparables in lib/radar.ts (one pooled quadratic log-log curve, with
// pooled-line, guarded-intercept, per-category and quadratic-plus-guard
// rivals fitted blind and tested on the same leave-one-out, walk-forward
// and two held-out tests, plus a 200-resample bootstrap band on every
// row's fitted value), writes the ranked board to /output/board.json,
// writes the dashboard data to /output/data.js, copies dashboard/ and
// screenshots/ to /output, and writes /output/dossier.json with
// buildDossier from vendor/makefun-board.ts.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/radar.ts';
import type { BoardRow, RadarData, Snapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SCREENSHOTS = 3;

// --- CLI parsing ---

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

// --- File copying ---

// Copy one regular file, reporting whether it was copied (dotfiles and
// non-files are skipped by the caller, not here).
function copyOneFile(from: string, name: string, to: string): boolean {
  const path = join(from, name);
  if (!statSync(path).isFile()) return false;
  copyFileSync(path, join(to, name));
  return true;
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    if (copyOneFile(from, name, to)) copied.push(name);
  }
  return copied;
}

function checkScreenshots(shots: string[]): void {
  if (shots.length < MIN_SCREENSHOTS) {
    fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
  }
}

// --- Run summary ---

function countVerdicts(board: BoardRow[]): { FARM: number; THIN: number; SKIP: number } {
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) counts[r.farm.verdict]++;
  return counts;
}

function topThree(board: BoardRow[]): string {
  return board.slice(0, 3).map((r) => `#${r.rank} ${r.name} $${r.implied_value_usd.toLocaleString('en-US')}`).join(', ');
}

function printSummary(out: string, snapshot: Snapshot, board: BoardRow[], radar: RadarData, dashFiles: string[], shots: string[]): void {
  const v = radar.validation;
  const verdicts = countVerdicts(board);
  const top3 = topThree(board);
  const neverCount = board.reduce((n, r) => n + r.farm.scenarios.filter((s) => s.never_breaks_even).length, 0);
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: census ${radar.census.total} total = ${radar.census.ranked} ranked + ${radar.census.live} record a token + ${radar.census.excluded} pre-token excluded\n` +
      `token radar: fit ln(mcap) = ${v.quad_a.toFixed(4)} + ${v.quad_b.toFixed(4)} ln(TVL) + ${v.quad_c.toFixed(4)} ln(TVL)^2; LOO median abs log err ${v.loo_median_abs_log_err} vs flat ${v.loo_flat_median_abs_log_err} (x${v.loo_improvement}); walk-forward ${v.walk_median_abs_log_err} vs flat ${v.walk_flat_median_abs_log_err} (x${v.walk_improvement})\n` +
      `token radar: held-out recent (newest ${v.held_recent_n}) ${v.held_recent_median_abs_log_err}; held-out random (n=${v.held_random_n}, seed ${v.held_random_seed}) ${v.held_random_median_abs_log_err}\n` +
      `token radar: rivals on the same four tests (LOO / walk / held-recent / held-random) — pooled line ${v.pooled_loo_median_abs_log_err} / ${v.pooled_walk_median_abs_log_err} / ${v.pooled_held_recent_median_abs_log_err} / ${v.pooled_held_random_median_abs_log_err}; guarded intercept ${v.guard_loo_median_abs_log_err} / ${v.guard_walk_median_abs_log_err} / ${v.guard_held_recent_median_abs_log_err} / ${v.guard_held_random_median_abs_log_err}; per-category lines ${v.percat_loo_median_abs_log_err} / ${v.percat_walk_median_abs_log_err} / ${v.percat_held_recent_median_abs_log_err} / ${v.percat_held_random_median_abs_log_err}; quadratic + guard ${v.quadguard_loo_median_abs_log_err} / ${v.quadguard_walk_median_abs_log_err} / ${v.quadguard_held_recent_median_abs_log_err} / ${v.quadguard_held_random_median_abs_log_err}; the plain quadratic wins the four-test average, so it scores the board\n` +
      `token radar: token odds 5-fold CV Brier ${v.odds_cv_brier}, log-loss ${v.odds_cv_logloss} vs radar-4 age-bin-only ${v.odds_v3_cv_brier} / ${v.odds_v3_cv_logloss} vs radar-4 as shipped (wrong prior) ${v.odds_v3actual_cv_brier} / ${v.odds_v3actual_cv_logloss}\n` +
      `token radar: bootstrap ${v.bootstrap_b} resamples, median P90-P10 width ${v.bootstrap_median_rel_width}x the median fitted value, median rank range ${v.bootstrap_median_rank_width} places\n` +
      `token radar: verdicts at $1,000 deposit FARM ${verdicts.FARM} / THIN ${verdicts.THIN} / SKIP ${verdicts.SKIP}; ${neverCount} deposit scenarios can never break even (odds over 100%)\n` +
      `token radar: top 3: ${top3}\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

// --- Main run ---

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  fail(`the model wrote a board the gate refuses: ${issue}`);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));
// The dashboard must be able to render from data.js alone: refuse a run
// whose data file is missing or empty instead of shipping a blank page.
if (!existsSync(join(out, 'data.js')) || statSync(join(out, 'data.js')).size < 100) {
  fail('data.js was not written');
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
checkScreenshots(shots);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

printSummary(out, snapshot, board, radar, dashFiles, shots);
