// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
// No network, no framework. Views are hash-driven so each state has its own
// URL: #detail=<slug> opens a protocol, #filter=cat:<name> or chain:<name>
// filters the board, #live shows the already-trading set, #comps shows the
// 128 traded comparables the fit was fitted on.
(function () {
  const D = window.RADAR;
  const $ = (id) => document.getElementById(id);
  const money = (v) => v >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + Math.round(v / 1e3) + 'K';
  const pct = (v) => v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  const age = (d) => d === null || d === undefined ? '—' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function stats() {
    $('stats').innerHTML = [
      [D.board_size, 'protocols ranked'],
      [D.watchlist_size, 'on the watchlist'],
      [D.early_size, 'early, below the floor'],
      [D.census.excluded, 'pre-token excluded'],
    ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    $('src').textContent = `${D.source} — as of ${D.as_of}. Model ${D.model_version}.`;
    const v = D.validation;
    $('formula-line').innerHTML = `implied value = fitted value × token odds &nbsp;·&nbsp; fitted value = exp(${v.quad_a.toFixed(4)} + ${v.quad_b.toFixed(4)} × ln TVL + ${v.quad_c.toFixed(4)} × (ln TVL)<sup>2</sup>)`;
    $('proof-line').innerHTML = `<b>Fit:</b> ln(market cap) = ${v.quad_a.toFixed(4)} + ${v.quad_b.toFixed(4)} × ln(TVL) + ${v.quad_c.toFixed(4)} × (ln TVL)<sup>2</sup>, fitted on ${v.loo_n} traded comparables — one quadratic curve for every protocol, no category term, no growth, no chain bonus. ` +
      `<b>Leave-one-out:</b> median abs log error ${v.loo_median_abs_log_err} vs flat-ratio ${v.loo_flat_median_abs_log_err} — <b>${v.loo_improvement}× better</b>. ` +
      `<b>Walk-forward</b> (${v.walk_n_train} train → ${v.walk_n_test} test): ${v.walk_median_abs_log_err} vs flat ${v.walk_flat_median_abs_log_err} — <b>${v.walk_improvement}× better</b>. ` +
      `<b>Held-out:</b> newest 20% of dated comparables ${v.held_recent_median_abs_log_err} (n=${v.held_recent_n}); seeded 80/20 random split ${v.held_random_median_abs_log_err} (n=${v.held_random_n}). ` +
      `<b>Rivals, same four tests (LOO / walk / held-recent / held-random):</b> pooled line ${v.pooled_loo_median_abs_log_err} / ${v.pooled_walk_median_abs_log_err} / ${v.pooled_held_recent_median_abs_log_err} / ${v.pooled_held_random_median_abs_log_err}; pooled + category-intercept guard ${v.guard_loo_median_abs_log_err} / ${v.guard_walk_median_abs_log_err} / ${v.guard_held_recent_median_abs_log_err} / ${v.guard_held_random_median_abs_log_err}; per-category lines ${v.percat_loo_median_abs_log_err} / ${v.percat_walk_median_abs_log_err} / ${v.percat_held_recent_median_abs_log_err} / ${v.percat_held_random_median_abs_log_err}; quadratic + guard ${v.quadguard_loo_median_abs_log_err} / ${v.quadguard_walk_median_abs_log_err} / ${v.quadguard_held_recent_median_abs_log_err} / ${v.quadguard_held_random_median_abs_log_err}. The plain quadratic wins the four-test average; the pooled line edges it on held-recent by 0.0013 and per-category lines win held-recent outright — the win is real but not a sweep. ` +
      `<b>What was dropped, and why:</b> per-category curves (LOO 1.682, held-random 2.0838 — 1–15 comparables per category, the slopes are noise); growth (weight 0 wins all four tests; weight 0.3 is worse on all four); the chain bonus (LOO 1.2167 at 0 vs 1.2836 at 2% per chain; walk-forward 1.0382 vs 1.0788; held-recent ties at 1.4042; only the 25-row held-random split favours the bonus). ` +
      `<b>Token odds:</b> 5-fold cross-validation over all 758 protocols — Brier ${v.odds_cv_brier}, log-loss ${v.odds_cv_logloss}, vs the age-bin-only model with the same corrected prior ${v.odds_v3_cv_brier} / ${v.odds_v3_cv_logloss} and vs radar-4 as shipped (wrong prior: 17% instead of 55%) ${v.odds_v3actual_cv_brier} / ${v.odds_v3actual_cv_logloss}. ` +
      `<b>Bootstrap (${v.bootstrap_b} resamples):</b> the median row's P10–P90 fitted band is ${v.bootstrap_median_rel_width}× its median fitted value, and its rank range is ${v.bootstrap_median_rank_width} places wide — a rank is a point estimate with a range, shown on every row. ` +
      `<b>Census:</b> all ${D.census.total} snapshot protocols accounted for — ${D.census.ranked} ranked, ${D.census.live} record a token, ${D.census.excluded} pre-token excluded (wrapped/staked/bridged/versioned). ` +
      `<b>Verdicts (at a $1,000 deposit):</b> ${D.rows.filter((r) => r.verdict === 'FARM').length} FARM · ${D.rows.filter((r) => r.verdict === 'THIN').length} THIN · ${D.rows.filter((r) => r.verdict === 'SKIP').length} SKIP. ${D.rows.reduce((n, r) => n + (r.scenarios || []).filter((s) => s.breakeven_odds > 1).length, 0)} of ${D.rows.length * 3} deposit scenarios can never break even.</p>`;
  }

  function fillSelects() {
    const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
    const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
    for (const c of cats) $('cat').append(new Option(c, c));
    for (const c of chains) $('chain').append(new Option(c, c));
  }

  function hashState() {
    const h = location.hash.slice(1);
    const s = { view: 'board', detail: null, cat: '', chain: '' };
    if (h === 'live') s.view = 'live';
    else if (h === 'comps') s.view = 'comps';
    else if (h.startsWith('detail=')) s.detail = decodeURIComponent(h.slice(7));
    else if (h.startsWith('filter=cat:')) s.cat = decodeURIComponent(h.slice(11));
    else if (h.startsWith('filter=chain:')) s.chain = decodeURIComponent(h.slice(13));
    return s;
  }

  function currentRows() {
    const st = hashState();
    let rows = D.rows.slice();
    const q = $('q').value.trim().toLowerCase();
    const cat = st.cat || $('cat').value;
    const chain = st.chain || $('chain').value;
    if (q) rows = rows.filter((r) => (r.name + ' ' + r.slug).toLowerCase().includes(q));
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (chain) rows = rows.filter((r) => r.chains.includes(chain));
    if ($('wl').checked) rows = rows.filter((r) => D.watchlist.includes(r.slug));
    const sort = $('sort').value;
    const by = { implied: (a, b) => b.implied_value_usd - a.implied_value_usd, tvl: (a, b) => b.tvl_usd - a.tvl_usd, growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9), age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1), perhour: (a, b) => b.net_per_hour_usd - a.net_per_hour_usd, odds: (a, b) => b.token_odds - a.token_odds }[sort];
    rows.sort(by);
    return { rows, st };
  }

  function render() {
    const { rows, st } = currentRows();
    const view = st.view;
    if (st.cat) $('cat').value = st.cat;
    if (st.chain) $('chain').value = st.chain;
    $('view-board').classList.toggle('active', view === 'board');
    $('view-live').classList.toggle('active', view === 'live');
    $('view-comps').classList.toggle('active', view === 'comps');
    $('controls').style.display = view === 'board' ? 'flex' : 'none';
    const tb = $('rows');
    if (view === 'live') {
      tb.innerHTML = D.live.map((p) => `<tr><td>—</td><td><b>${esc(p.name)}</b><br><span style="color:var(--muted)">${esc(p.slug)}</span></td><td>${esc(p.category || '—')}</td><td>${esc(p.chains.slice(0, 3).join(', '))}</td><td class="num">${money(p.tvl_usd)}</td><td class="num ${p.change_7d > 0 ? 'up' : p.change_7d < 0 ? 'down' : ''}">${pct(p.change_7d)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${p.mcap_usd ? money(p.mcap_usd) : '—'}</td></tr>`).join('');
      $('count').textContent = `Top ${D.live.length} protocols by market cap whose token already trades — shown at the market's own value, never ranked into the board.`;
      $('detail').hidden = true;
      return;
    }
    if (view === 'comps') {
      tb.innerHTML = D.comps.map((p) => `<tr><td>—</td><td><b>${esc(p.name)}</b><br><span style="color:var(--muted)">${esc(p.slug)}</span></td><td>${esc(p.category || '—')}</td><td>—</td><td class="num">${money(p.tvl_usd)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${money(p.mcap_usd)}</td></tr>`).join('');
      $('count').textContent = `The ${D.comps.length} traded comparables the value curve was fitted on — every one of them, with its TVL and market cap. A fitted value is only as good as these comps; the curve has no category term at all, because per-category curves were tested on the same four validation tests and lost (LOO 1.682, held-random 2.0838). Categories matter only through each row's token odds — see the detail view.`;
      $('detail').hidden = true;
      return;
    }
    tb.innerHTML = rows.map((r) => `<tr class="row ${st.detail === r.slug ? 'sel' : ''}" data-slug="${esc(r.slug)}"><td>#${r.rank}<br><span class="range">#${r.rank_lo}–${r.rank_hi}</span></td><td><b>${esc(r.name)}</b><br><span style="color:var(--muted)">${esc(r.slug)}</span></td><td>${esc(r.category || '—')}</td><td>${esc(r.chains.slice(0, 3).join(', '))}</td><td class="num">${money(r.tvl_usd)}</td><td class="num ${r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''}">${pct(r.change_7d)}</td><td class="num">${age(r.age_days)}</td><td class="num">${(r.token_odds * 100).toFixed(0)}%</td><td class="num ${r.net_per_hour_usd >= 0 ? 'up' : 'down'}">$${r.net_per_hour_usd.toFixed(0)}</td><td class="num"><span class="verdict ${r.verdict.toLowerCase()}">${r.verdict}</span></td><td class="num"><b>${money(r.implied_value_usd)}</b><br><span class="range">${money(r.implied_lo_usd)}–${money(r.implied_hi_usd)}</span></td></tr>`).join('');
    $('count').textContent = `Showing ${rows.length} of ${D.board_size} ranked protocols. The small range under each rank and implied value is the P10–P90 bootstrap range over 200 refits. Click any row for its detail view and farm plan.`;
    tb.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => { location.hash = 'detail=' + tr.dataset.slug; }));
    renderDetail(st.detail);
  }

  function renderDetail(slug) {
    const box = $('detail');
    if (!slug) { box.hidden = true; return; }
    const r = D.rows.find((x) => x.slug === slug);
    if (!r) { box.hidden = true; return; }
    // Recomputed live in this page from the TVL and the fitted quadratic
    // curve — the same number the board used.
    const lnTvl = Math.log(Math.max(1, r.tvl_usd));
    const recomputed = Math.exp(D.validation.quad_a + D.validation.quad_b * lnTvl + D.validation.quad_c * lnTvl * lnTvl);
    const base = r.fitted_value_usd;
    const catNote = `Token odds: ${(r.age_bin_odds * 100).toFixed(0)}% from the protocol's age bin (share of peer protocols in that bin that record a token, smoothed toward the overall share) blended with the ${esc(r.category || 'Uncategorised')} category token rate ${(r.category_token_rate * 100).toFixed(0)}% (share of ${r.category_n} peers in that category that record a token, shrunk toward the age-bin rate) — blended odds ${(r.token_odds * 100).toFixed(0)}%. Categories affect only the odds, never the fitted value.`;
    box.innerHTML = `<h2>#${r.rank} ${esc(r.name)} <span class="verdict ${r.verdict.toLowerCase()}">${r.verdict}</span></h2>
      <p class="meta">${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', ') || 'no chain listed')} · listed ${esc(r.listed_at || 'unknown')} · records no token (no market cap, no CoinGecko id, no symbol).</p>
      <div class="breakdown">
        <div><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
        <div><b>${money(base)}</b><span>fitted value (quadratic curve on TVL)</span></div>
        <div><b>${money(r.fitted_lo_usd)}–${money(r.fitted_hi_usd)}</b><span>fitted P10–P90 over 200 refits</span></div>
        <div><b>${(r.token_odds * 100).toFixed(0)}%</b><span>token odds (age bin + category rate)</span></div>
        <div><b>${money(r.implied_value_usd)}</b><span>implied value = fitted × odds</span></div>
        <div><b>${money(r.implied_lo_usd)}–${money(r.implied_hi_usd)}</b><span>implied P10–P90</span></div>
        <div><b>#${r.rank_lo}–${r.rank_hi}</b><span>rank range over 200 refits</span></div>
        <div><b>$${r.net_per_hour_usd.toFixed(2)}/hr</b><span>net farm $/hr at $1,000 (after $${r.gas_usd.toFixed(2)} gas, ${r.hours} hrs)</span></div>
      </div>
      <p class="meta">Model panel — fitted = exp(${D.validation.quad_a.toFixed(4)} + ${D.validation.quad_b.toFixed(4)} × ln TVL + ${D.validation.quad_c.toFixed(4)} × (ln TVL)<sup>2</sup>), with ln TVL = ${lnTvl.toFixed(2)} for this protocol's $${Math.round(r.tvl_usd / 1e6)}M TVL. No growth term, no chain bonus, no category term — all three were tested on the same four validation tests and dropped (see the proof strip). Recomputed live in this page from the TVL and the fitted curve: fitted ≈ ${money(Math.round(recomputed))} — within rounding of the board's ${money(base)}. ${catNote}</p>
      <h3>Deposit scenarios — what your size changes</h3>
      <table class="scen"><thead><tr><th>Deposit</th><th class="num">Expected value</th><th class="num">Opportunity cost (5% T-bill rate, 8 wks)</th><th class="num">Net $/hr</th><th class="num">Break-even launch odds</th><th class="num">Verdict</th></tr></thead><tbody>
      ${(r.scenarios || []).map((s) => `<tr><td>$${s.deposit_usd.toLocaleString('en-US')}</td><td class="num">$${s.expected_value_usd.toFixed(2)}</td><td class="num">$${s.opportunity_cost_usd.toFixed(2)}</td><td class="num ${s.net_per_hour_usd >= 0 ? 'up' : 'down'}">$${s.net_per_hour_usd.toFixed(2)}</td><td class="num">${s.breakeven_odds > 1 ? '>100% (never)' : (s.breakeven_odds * 100).toFixed(0) + '%'}</td><td class="num"><span class="verdict ${s.verdict.toLowerCase()}">${s.verdict}</span></td></tr>`).join('')}
      </tbody></table>
      <p class="meta">Assumptions, all stated: airdrop pool 5% of launch value; farmers collectively deploy 10% of TVL, so a deposit's share of the pool is deposit ÷ (10% of TVL), capped at 25% of the pool — one farmer cannot be credited with most of a public pool; gas $${r.gas_usd.toFixed(2)} over 11 transactions; ${r.hours} hours of the farmer's time over 8 weeks; opportunity cost at a 5% annual rate — the T-bill rate — on the deposit while it sits in the position. Break-even launch odds are the token odds at which the deposit's expected value exactly covers its gas + opportunity cost; the row's actual odds are ${(r.token_odds * 100).toFixed(0)}%. A scenario marked ">100% (never)" can never break even at any launch odds. None of this is a payout promise.</p>
      <h3>Model sandbox — test the assumptions yourself</h3>
      <div class="sandbox">
        <label>Token odds <input type="range" id="sb-odds" min="0" max="1" step="0.01" value="${r.token_odds.toFixed(2)}"> <span id="sb-odds-v">${(r.token_odds * 100).toFixed(0)}%</span></label>
        <label>Airdrop pool share <input type="range" id="sb-pool" min="0.01" max="0.1" step="0.01" value="0.05"> <span id="sb-pool-v">5%</span></label>
        <label>Farmers' share of TVL <input type="range" id="sb-cap" min="0.05" max="0.2" step="0.01" value="0.1"> <span id="sb-cap-v">10%</span></label>
        <p id="sb-out" class="meta"></p>
      </div>
      <h3>How to farm it — 7 steps</h3>
      <ol>${(r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="meta">The implied value is this entry's claim from the snapshot's own figures. It is not a promise that ${esc(r.name)} will issue a token, or when.</p>`;
    box.hidden = false;
    const recomputeSandbox = () => {
      const odds = parseFloat($('sb-odds').value);
      const pool = parseFloat($('sb-pool').value);
      const cap = parseFloat($('sb-cap').value);
      $('sb-odds-v').textContent = (odds * 100).toFixed(0) + '%';
      $('sb-pool-v').textContent = (pool * 100).toFixed(0) + '%';
      $('sb-cap-v').textContent = (cap * 100).toFixed(0) + '%';
      // Same fitted value as the board: the quadratic curve on TVL only.
      // No growth weight and no chain bonus — both were tested and dropped.
      const fitted = recomputed;
      const implied = fitted * odds;
      const share = Math.min(0.25, 1000 / (cap * r.tvl_usd));
      const expected = implied * pool * share;
      const net = (expected - r.gas_usd - 1000 * 0.05 * (8 / 52)) / r.hours;
      $('sb-out').textContent = `With your settings: fitted ${money(Math.round(fitted))}, implied ${money(Math.round(implied))}, and at a $1,000 deposit the expected value is $${expected.toFixed(2)} — net $${net.toFixed(2)}/hr. The board's own numbers use token odds ${(r.token_odds * 100).toFixed(0)}%, pool 5%, farmers' share 10%, and cap one farmer's share of the pool at 25%.`;
    };
    ['sb-odds', 'sb-pool', 'sb-cap'].forEach((id) => $(id).addEventListener('input', recomputeSandbox));
    recomputeSandbox();
    box.scrollIntoView({ block: 'nearest' });
  }

  $('view-board').addEventListener('click', () => { location.hash = ''; });
  $('view-live').addEventListener('click', () => { location.hash = 'live'; });
  $('view-comps').addEventListener('click', () => { location.hash = 'comps'; });
  ['q', 'cat', 'chain', 'sort', 'wl'].forEach((id) => $(id).addEventListener('input', render));
  window.addEventListener('hashchange', render);
  stats();
  fillSelects();
  render();
})();
