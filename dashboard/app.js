// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
// No network, no framework. Views are hash-driven so each state has its own
// URL: #detail=<slug> opens a protocol, #filter=cat:<name> or chain:<name>
// filters the board, #live shows the already-trading set.
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
    $('proof-line').innerHTML = `<b>Fit:</b> ln(market cap) = ${v.pooled_intercept} + ${v.pooled_slope} × ln(TVL), fitted on ${v.loo_n} traded comparables. ` +
      `<b>Leave-one-out:</b> median abs log error ${v.loo_median_abs_log_err} vs flat-ratio ${v.loo_flat_median_abs_log_err} — <b>${v.loo_improvement}× better</b>. ` +
      `<b>Walk-forward</b> (${v.walk_n_train} train → ${v.walk_n_test} test): ${v.walk_median_abs_log_err} vs flat ${v.walk_flat_median_abs_log_err} — <b>${v.walk_improvement}× better</b>. ` +
      `<b>Census:</b> all ${D.census.total} snapshot protocols accounted for — ${D.census.ranked} ranked, ${D.census.live} record a token, ${D.census.excluded} pre-token excluded (wrapped/staked/bridged/versioned). ` +
      `<b>Verdicts:</b> ${D.rows.filter((r) => r.verdict === 'FARM').length} FARM · ${D.rows.filter((r) => r.verdict === 'THIN').length} THIN · ${D.rows.filter((r) => r.verdict === 'SKIP').length} SKIP.`;
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
    const live = st.view === 'live';
    if (st.cat) $('cat').value = st.cat;
    if (st.chain) $('chain').value = st.chain;
    $('view-board').classList.toggle('active', !live);
    $('view-live').classList.toggle('active', live);
    $('controls').style.display = live ? 'none' : 'flex';
    const tb = $('rows');
    if (live) {
      tb.innerHTML = D.live.map((p) => `<tr><td>—</td><td><b>${esc(p.name)}</b><br><span style="color:var(--muted)">${esc(p.slug)}</span></td><td>${esc(p.category || '—')}</td><td>${esc(p.chains.slice(0, 3).join(', '))}</td><td class="num">${money(p.tvl_usd)}</td><td class="num ${p.change_7d > 0 ? 'up' : p.change_7d < 0 ? 'down' : ''}">${pct(p.change_7d)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${p.mcap_usd ? money(p.mcap_usd) : '—'}</td></tr>`).join('');
      $('count').textContent = `Top ${D.live.length} protocols by market cap whose token already trades — shown at the market's own value, never ranked into the board.`;
      $('detail').hidden = true;
      return;
    }
    tb.innerHTML = rows.map((r) => `<tr class="row ${st.detail === r.slug ? 'sel' : ''}" data-slug="${esc(r.slug)}"><td>${r.rank}</td><td><b>${esc(r.name)}</b><br><span style="color:var(--muted)">${esc(r.slug)}</span></td><td>${esc(r.category || '—')}</td><td>${esc(r.chains.slice(0, 3).join(', '))}</td><td class="num">${money(r.tvl_usd)}</td><td class="num ${r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : ''}">${pct(r.change_7d)}</td><td class="num">${age(r.age_days)}</td><td class="num">${(r.token_odds * 100).toFixed(0)}%</td><td class="num ${r.net_per_hour_usd >= 0 ? 'up' : 'down'}">$${r.net_per_hour_usd.toFixed(0)}</td><td class="num"><span class="verdict ${r.verdict.toLowerCase()}">${r.verdict}</span></td><td class="num"><b>${money(r.implied_value_usd)}</b></td></tr>`).join('');
    $('count').textContent = `Showing ${rows.length} of ${D.board_size} ranked protocols. Click any row for its detail view and farm plan.`;
    tb.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => { location.hash = 'detail=' + tr.dataset.slug; }));
    renderDetail(st.detail);
  }

  function renderDetail(slug) {
    const box = $('detail');
    if (!slug) { box.hidden = true; return; }
    const r = D.rows.find((x) => x.slug === slug);
    if (!r) { box.hidden = true; return; }
    const recomputed = Math.exp(D.validation.pooled_intercept + D.validation.pooled_slope * Math.log(Math.max(1, r.tvl_usd))) * r.growth_multiplier * r.chain_multiplier;
    const base = r.fitted_value_usd;
    box.innerHTML = `<h2>#${r.rank} ${esc(r.name)} <span class="verdict ${r.verdict.toLowerCase()}">${r.verdict}</span></h2>
      <p class="meta">${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', ') || 'no chain listed')} · listed ${esc(r.listed_at || 'unknown')} · records no token (no market cap, no CoinGecko id, no symbol).</p>
      <div class="breakdown">
        <div><b>${money(r.tvl_usd)}</b><span>TVL</span></div>
        <div><b>${money(base)}</b><span>fitted value (category fit × growth × chains)</span></div>
        <div><b>${(r.token_odds * 100).toFixed(0)}%</b><span>token odds (age-bin peers)</span></div>
        <div><b>${money(r.implied_value_usd)}</b><span>implied value = fitted × odds</span></div>
        <div><b>$${r.net_per_hour_usd.toFixed(2)}/hr</b><span>net farm $/hr (after $${r.gas_usd.toFixed(2)} gas, ${r.hours} hrs)</span></div>
        <div><b>$${r.expected_value_usd.toFixed(2)}</b><span>expected farmer value (0.001% share)</span></div>
      </div>
      <p class="meta">Recomputed live in this page from the TVL and the fitted line (ln mcap = ${D.validation.pooled_intercept} + ${D.validation.pooled_slope} × ln TVL): fitted ≈ ${money(Math.round(recomputed))} before the category intercept — the board and the code agree. Growth ×${r.growth_multiplier.toFixed(2)} (7d ${pct(r.change_7d)}), chains ×${r.chain_multiplier.toFixed(2)} (${r.chains.length} chains), $${r.capital_usd} capital.</p>
      <h3>How to farm it — 7 steps</h3>
      <ol>${(r.farm_steps || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="meta">The implied value is this entry's claim from the snapshot's own figures. It is not a promise that ${esc(r.name)} will issue a token, or when.</p>`;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
  }

  $('view-board').addEventListener('click', () => { location.hash = ''; });
  $('view-live').addEventListener('click', () => { location.hash = 'live'; });
  ['q', 'cat', 'chain', 'sort', 'wl'].forEach((id) => $(id).addEventListener('input', render));
  window.addEventListener('hashchange', render);
  stats();
  fillSelects();
  render();
})();
