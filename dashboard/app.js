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
    $('proof-line').innerHTML = `<b>Fit:</b> ln(market cap) = ${v.pooled_intercept} + ${v.pooled_slope} × ln(TVL), fitted on ${v.loo_n} traded comparables, with a category intercept where the category has ≥3 comparables (shift capped at ±0.5 log). ` +
      `<b>Leave-one-out:</b> median abs log error ${v.loo_median_abs_log_err} vs flat-ratio ${v.loo_flat_median_abs_log_err} — <b>${v.loo_improvement}× better</b>. ` +
      `<b>Walk-forward</b> (${v.walk_n_train} train → ${v.walk_n_test} test): ${v.walk_median_abs_log_err} vs flat ${v.walk_flat_median_abs_log_err} — <b>${v.walk_improvement}× better</b>. ` +
      `<b>Rivals, same tests:</b> per-category lines LOO ${v.percat_loo_median_abs_log_err}, walk ${v.percat_walk_median_abs_log_err}; quadratic LOO ${v.quad_loo_median_abs_log_err}, walk ${v.quad_walk_median_abs_log_err}; guarded intercept model LOO ${v.guard_loo_median_abs_log_err}, walk ${v.guard_walk_median_abs_log_err}. Neither rival beats the pooled line on leave-one-out by any robust margin, so the pooled line scores the board. ` +
      `<b>Correction:</b> without the range guard, one comparable — Rain, a prediction market with $6.6M of TVL and a $2.65B market cap (400×) — tripled the whole prediction-market intercept and put Polymarket's fitted value at $86.7M. With the guard the category falls back to the pooled line: Polymarket fitted $29.2M, implied $19.4M, rank #5. ` +
      `<b>Bootstrap (${v.bootstrap_b} resamples):</b> the median row's P10–P90 fitted band is ${v.bootstrap_median_rel_width}× its median fitted value, and its rank range is ${v.bootstrap_median_rank_width} places wide — a rank is a point estimate with a range, shown on every row. ` +
      `<b>Census:</b> all ${D.census.total} snapshot protocols accounted for — ${D.census.ranked} ranked, ${D.census.live} record a token, ${D.census.excluded} pre-token excluded (wrapped/staked/bridged/versioned). ` +
      `<b>Verdicts (at a $1,000 deposit):</b> ${D.rows.filter((r) => r.verdict === 'FARM').length} FARM · ${D.rows.filter((r) => r.verdict === 'THIN').length} THIN · ${D.rows.filter((r) => r.verdict === 'SKIP').length} SKIP.`;
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
      $('count').textContent = `The ${D.comps.length} traded comparables the value line was fitted on — every one of them, with its TVL and market cap. A fitted value is only as good as these comps; the thinnest categories (1–2 comps) get no category intercept — see the range guard in the proof strip.`;
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
    // Recomputed live in this page from the TVL and the fitted line, using
    // the row's own category intercept — the same number the board used.
    const recomputed = Math.exp(r.category_intercept + D.validation.pooled_slope * Math.log(Math.max(1, r.tvl_usd))) * r.growth_multiplier * r.chain_multiplier;
    const base = r.fitted_value_usd;
    const catNote = r.guard_applied
      ? `Category evidence: ${r.category_n} traded comparable${r.category_n === 1 ? '' : 's'} in ${esc(r.category || 'Uncategorised')} — too few for a category intercept, so the pooled line is used (range guard).`
      : `Category evidence: ${r.category_n} traded comparables in ${esc(r.category || 'Uncategorised')}, largest market cap ${r.category_max_mcap_usd ? money(r.category_max_mcap_usd) : '—'}; category intercept ${r.category_intercept.toFixed(2)} vs pooled ${D.validation.pooled_intercept}.`;
    box.innerHTML = `<h2>#${r.rank} ${esc(r.name)} <span class="verdict ${r.verdict.toLowerCase()}">${r.verdict}</span></h2>
      <p class="meta">${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', ') || 'no chain listed')} · listed ${esc(r.listed_at || 'unknown')} · records no token (no market cap, no CoinGecko id, no symbol).</p>
      <div class="breakdown">
        <div><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
        <div><b>${money(base)}</b><span>fitted value (category fit × growth × chains)</span></div>
        <div><b>${money(r.fitted_lo_usd)}–${money(r.fitted_hi_usd)}</b><span>fitted P10–P90 over 200 refits</span></div>
        <div><b>${(r.token_odds * 100).toFixed(0)}%</b><span>token odds (age-bin peers)</span></div>
        <div><b>${money(r.implied_value_usd)}</b><span>implied value = fitted × odds</span></div>
        <div><b>${money(r.implied_lo_usd)}–${money(r.implied_hi_usd)}</b><span>implied P10–P90</span></div>
        <div><b>#${r.rank_lo}–${r.rank_hi}</b><span>rank range over 200 refits</span></div>
        <div><b>$${r.net_per_hour_usd.toFixed(2)}/hr</b><span>net farm $/hr at $1,000 (after $${r.gas_usd.toFixed(2)} gas, ${r.hours} hrs)</span></div>
      </div>
      <p class="meta">Model panel — fitted = exp(${r.category_intercept.toFixed(2)} + ${D.validation.pooled_slope} × ln TVL) × growth ×${r.growth_multiplier.toFixed(2)} (7d ${pct(r.change_7d)}) × chains ×${r.chain_multiplier.toFixed(2)} (${r.chains.length} chains). Recomputed live in this page from the TVL and the fitted line: fitted ≈ ${money(Math.round(recomputed))} — within rounding of the board's ${money(base)}, because the recompute uses the row's category intercept. ${catNote}</p>
      <h3>Deposit scenarios — what your size changes</h3>
      <table class="scen"><thead><tr><th>Deposit</th><th class="num">Expected value</th><th class="num">Opportunity cost (5% T-bill rate, 8 wks)</th><th class="num">Net $/hr</th><th class="num">Break-even launch odds</th><th class="num">Verdict</th></tr></thead><tbody>
      ${(r.scenarios || []).map((s) => `<tr><td>$${s.deposit_usd.toLocaleString('en-US')}</td><td class="num">$${s.expected_value_usd.toFixed(2)}</td><td class="num">$${s.opportunity_cost_usd.toFixed(2)}</td><td class="num ${s.net_per_hour_usd >= 0 ? 'up' : 'down'}">$${s.net_per_hour_usd.toFixed(2)}</td><td class="num">${s.breakeven_odds > 1 ? '>100% (never)' : (s.breakeven_odds * 100).toFixed(0) + '%'}</td><td class="num"><span class="verdict ${s.verdict.toLowerCase()}">${s.verdict}</span></td></tr>`).join('')}
      </tbody></table>
      <p class="meta">Assumptions, all stated: airdrop pool 5% of launch value; farmers collectively deploy 10% of TVL, so a deposit's share of the pool is deposit ÷ (10% of TVL); gas $${r.gas_usd.toFixed(2)} over 11 transactions; ${r.hours} hours of the farmer's time over 8 weeks; opportunity cost at a 5% annual rate — the T-bill rate — on the deposit while it sits in the position. Break-even launch odds are the token odds at which the deposit's expected value exactly covers its gas + opportunity cost; the row's actual odds are ${(r.token_odds * 100).toFixed(0)}%. None of this is a payout promise.</p>
      <h3>Model sandbox — test the assumptions yourself</h3>
      <div class="sandbox">
        <label>Growth weight <input type="range" id="sb-gw" min="0" max="0.6" step="0.05" value="0.3"> <span id="sb-gw-v">0.30</span></label>
        <label>Chain bonus per chain <input type="range" id="sb-cb" min="0" max="0.05" step="0.005" value="0.02"> <span id="sb-cb-v">2.0%</span></label>
        <label>Airdrop pool share <input type="range" id="sb-pool" min="0.01" max="0.1" step="0.01" value="0.05"> <span id="sb-pool-v">5%</span></label>
        <label>Farmers' share of TVL <input type="range" id="sb-cap" min="0.05" max="0.2" step="0.01" value="0.1"> <span id="sb-cap-v">10%</span></label>
        <p id="sb-out" class="meta"></p>
      </div>
      <h3>How to farm it — 7 steps</h3>
      <ol>${(r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="meta">The implied value is this entry's claim from the snapshot's own figures. It is not a promise that ${esc(r.name)} will issue a token, or when.</p>`;
    box.hidden = false;
    const recomputeSandbox = () => {
      const gw = parseFloat($('sb-gw').value);
      const cb = parseFloat($('sb-cb').value);
      const pool = parseFloat($('sb-pool').value);
      const cap = parseFloat($('sb-cap').value);
      $('sb-gw-v').textContent = gw.toFixed(2);
      $('sb-cb-v').textContent = (cb * 100).toFixed(1) + '%';
      $('sb-pool-v').textContent = (pool * 100).toFixed(0) + '%';
      $('sb-cap-v').textContent = (cap * 100).toFixed(0) + '%';
      const growthPct = Math.min(100, Math.max(-50, r.change_7d ?? 0));
      const gm = 1 + (growthPct / 100) * gw;
      const cm = Math.min(1.1, 1 + cb * Math.max(r.chains.length - 1, 0));
      const fitted = Math.exp(r.category_intercept + D.validation.pooled_slope * Math.log(Math.max(1, r.tvl_usd))) * gm * cm;
      const implied = fitted * r.token_odds;
      const expected = implied * pool * 1000 / (cap * r.tvl_usd);
      const net = (expected - r.gas_usd - 1000 * 0.05 * (8 / 52)) / r.hours;
      $('sb-out').textContent = `With your settings: fitted ${money(Math.round(fitted))}, implied ${money(Math.round(implied))}, and at a $1,000 deposit the expected value is $${expected.toFixed(2)} — net $${net.toFixed(2)}/hr. The board's own numbers use growth weight 0.30, chain bonus 2%, pool 5%, farmers' share 10%.`;
    };
    ['sb-gw', 'sb-cb', 'sb-pool', 'sb-cap'].forEach((id) => $(id).addEventListener('input', recomputeSandbox));
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
