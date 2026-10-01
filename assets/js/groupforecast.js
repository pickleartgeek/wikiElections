/** ProbCalc Group Forecast — UI (map, win odds, trend, ranges, heatmap). Needs groupcalc.js + Leaflet + rcp-chart.js. */
let GF_map = null, GF_tok = 0;
const GF_pct = p => p >= 0.995 ? '>99%' : (p > 0 && p < 0.005) ? '<1%' : Math.round(p * 100) + '%';

async function GF_render(root, ctx) {
  const tok = ++GF_tok, { polls, ids, electionDate, opts, registry, geojson, nm, col } = ctx;
  root.innerHTML = '<div class="gf-head"><h3>ProbCalc Group Forecast</h3></div><p class="small-muted" style="padding:0 18px 18px">Running group simulations…</p>';
  const w = GC_weights(geojson);
  const R = await GC_run(polls, ids, electionDate, w, opts, 6000);
  const H = await GC_history(polls, ids, electionDate, w, opts);
  if (tok !== GF_tok) return; // a newer render superseded this one

  const S = R.state, order = [...ids].sort((a, b) => S.winProb[b] - S.winProb[a]);
  const top = order[0], tp = S.winProb[top];
  const tag = tp >= 0.85 ? 'Safe' : tp >= 0.65 ? 'Likely' : tp >= 0.55 ? 'Lean' : 'Toss-up';
  const leadOf = g => ids.reduce((a, b) => R.groups[g].winProb[b] > R.groups[g].winProb[a] ? b : a, ids[0]);
  const noGroupPolls = GC_GROUPS.filter(g => R.groups[g].fallback).length;

  root.innerHTML = `
    <div class="gf-head">
      <div><div class="gf-kicker">Decision Desk TSR</div><h3>ProbCalc Group Forecast</h3>
        <p>Every group is polled, averaged and simulated separately, then combined by voting-age population into a statewide forecast.
        Updates itself when polls change.</p></div>
      <div class="gf-live"><span class="gf-dot"></span>LIVE · ${R.sims.toLocaleString()} sims<br><small>${new Date().toLocaleTimeString()}</small><br><a class="sim-link" href="${ctx.simUrl || 'elects/simulate.html'}">▶ Simulate your own</a></div>
    </div>
    ${ctx.demo ? '<div class="gf-demo">DEMO DATA — randomly generated group polling for layout testing, not real results.</div>' : ''}
    <div class="gf-top">
      <div class="gf-win">
        <div class="gf-small">Statewide win probability</div>
        <div class="gf-big" style="color:${col(top)}">${nm(top)} <b>${GF_pct(tp)}</b></div>
        <span class="gf-tag" style="background:${col(top)}">${tag}</span>
        ${order.map(i => `<div class="prob-row"><div class="dot" style="background:${col(i)}"></div>
          <div class="name">${nm(i)} <span class="small-muted">${S.expGroups[i].toFixed(1)}/9 groups</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${S.winProb[i] * 100}%;background:${col(i)}"></div></div>
          <div class="pct">${GF_pct(S.winProb[i])}</div></div>`).join('')}
      </div>
      <div class="gf-mapcol"><div id="gfMap"></div>
        <div class="gf-maplegend">${order.map(i => `<span><i style="background:${col(i)}"></i>${nm(i)}</span>`).join('')}<span class="small-muted">Fainter = closer · dashed = no group polls (${noGroupPolls})</span></div>
        <div id="gfPanel" class="gf-panel"></div></div>
    </div>
    <div class="gf-grid">
      <div class="gf-card"><h4>Win probability over time</h4><div id="gfTrend"></div></div>
      <div class="gf-card"><h4>Statewide vote share — 90% range</h4><div id="gfRange"></div></div>
    </div>
    <div class="gf-card gf-wide"><h4>Group-by-group win probability</h4><div class="rcp-table-wrap" style="margin:0"><table class="rcp-table" id="gfHeat"></table></div></div>`;

  // group panel
  const panel = g => {
    const G = R.groups[g], o = [...ids].sort((a, b) => G.winProb[b] - G.winProb[a]);
    document.getElementById('gfPanel').innerHTML = `<div class="gf-ptitle">Group ${g} <span class="small-muted">${G.fallback ? 'no group polls — statewide fallback' : G.polls + ' group poll' + (G.polls > 1 ? 's' : '')} · ${(w[g] * 100).toFixed(1)}% of electorate</span></div>` +
      o.map(i => `<div class="prob-row"><div class="dot" style="background:${col(i)}"></div><div class="name">${nm(i)} <span class="small-muted">${(G.meanShare[i] * 100).toFixed(0)}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${G.winProb[i] * 100}%;background:${col(i)}"></div></div><div class="pct">${GF_pct(G.winProb[i])}</div></div>`).join('');
  };
  document.getElementById('gfPanel').innerHTML = '<div class="small-muted">Click a group on the map for its breakdown.</div>';

  // map
  if (GF_map) { GF_map.remove(); GF_map = null; }
  GF_map = L.map('gfMap', { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
  const style = f => { const g = String(f.properties.id), L0 = leadOf(g), p = R.groups[g].winProb[L0];
    return { fillColor: col(L0), fillOpacity: 0.2 + 0.75 * Math.min(1, Math.max(0, (p - 0.3) / 0.7)), color: '#fff', weight: 1.5, dashArray: R.groups[g].fallback ? '4 3' : null }; };
  const layer = L.geoJSON(geojson, { style, onEachFeature: (f, l) => {
    const g = String(f.properties.id), L0 = leadOf(g);
    l.bindTooltip(`Group ${g}: ${nm(L0)} ${GF_pct(R.groups[g].winProb[L0])}`, { sticky: true });
    l.on('click', () => panel(g));
  } }).addTo(GF_map);
  GF_map.fitBounds(layer.getBounds(), { padding: [10, 10] });

  // trend (straight lines via RCPChart)
  if (H.length > 1) RCPChart_render(document.getElementById('gfTrend'), H, ids, registry);
  else document.getElementById('gfTrend').innerHTML = '<div class="small-muted">A trend needs group polls from at least two different dates.</div>';

  // 90% range chart
  const rows = order.length, W = 560, hgt = 14 + rows * 36, mx = Math.max(0.3, ...order.map(i => S.p95[i])) * 1.08;
  const X = v => 150 + (v / mx) * (W - 290);
  let svg = `<svg viewBox="0 0 ${W} ${hgt}" width="100%" style="display:block;font-family:var(--font-body)">`;
  for (let v = 0; v <= mx; v += 0.1) svg += `<line x1="${X(v)}" x2="${X(v)}" y1="4" y2="${hgt - 4}" stroke="#e4e2d8"/><text x="${X(v)}" y="${hgt}" font-size="9" fill="#8a887c" text-anchor="middle">${Math.round(v * 100)}%</text>`;
  order.forEach((i, k) => { const y = 24 + k * 36;
    svg += `<text x="140" y="${y + 4}" font-size="11" font-weight="700" text-anchor="end">${nm(i)}</text>
      <line x1="${X(S.p05[i])}" x2="${X(S.p95[i])}" y1="${y}" y2="${y}" stroke="${col(i)}" stroke-width="10" stroke-linecap="round" opacity=".35"/>
      <line x1="${X(S.p05[i])}" x2="${X(S.p95[i])}" y1="${y}" y2="${y}" stroke="${col(i)}" stroke-width="2"/>
      <circle cx="${X(S.p50[i])}" cy="${y}" r="6" fill="${col(i)}" stroke="#fff" stroke-width="2"/>
      <text x="${W - 4}" y="${y + 4}" font-size="10" text-anchor="end" fill="#444">${(S.p50[i] * 100).toFixed(0)}% (${(S.p05[i] * 100).toFixed(0)}–${(S.p95[i] * 100).toFixed(0)})</text>`; });
  document.getElementById('gfRange').innerHTML = svg + '</svg>';

  // heatmap
  const hex = c => { const n = parseInt(c.replace('#', ''), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  document.getElementById('gfHeat').innerHTML = `<thead><tr><th>Group</th>${order.map(i => `<th>${nm(i)}</th>`).join('')}<th>Polls</th></tr></thead><tbody>` +
    GC_GROUPS.map(g => `<tr><td><b>Group ${g}</b> <span class="small-muted">${(w[g] * 100).toFixed(0)}%</span></td>${order.map(i => { const p = R.groups[g].winProb[i], c = hex(col(i));
      return `<td style="background:rgba(${c},${(0.08 + p * 0.85).toFixed(2)});color:${p > 0.55 ? '#fff' : 'var(--ink)'};font-weight:700;text-align:center">${GF_pct(p)}</td>`; }).join('')}
      <td class="small-muted">${R.groups[g].fallback ? 'fallback' : R.groups[g].polls}</td></tr>`).join('') + '</tbody>';
}
if (typeof window !== 'undefined') window.GF_render = GF_render;
