/**
 * ForecastLab — browser helpers built on nightodds.js, shared by:
 *   - the admin chart maker ("Fill from site data" sources)
 *   - the post-election recap and pre-election outlook on TSR Elects
 * Needs (loaded before): groupcalc.js, electsim.js, basecalc.js, tsrelects.js, nightodds.js.
 *
 *   FL_load(base, {elections})      -> D  { base, results, geo, timelines }      (base = '' on the site root, '../' from a subfolder)
 *   FL_prep(D, id)                  -> P  ballot-by-ballot context for one timeline (or null: no ballots / no timeline)
 *   FL_run(P, {sims,max,all})       -> [{ k, frac, lead:{id:p} }]  model checkpoints through the count
 *   FL_recap(D, id, {sims})         -> recap object for a finished election (or null)   +  FL_recapHTML(R, nameOf, colorOf)
 *   FL_preview(args)                -> { ctx, o }  forecast before any ballot is in      +  FL_previewHTML(x, nameOf, colorOf)
 *   FL_sources                      -> data sources for the chart maker: { id, label, needs, build(D, arg, env) -> spec patch }
 */
const FL_CACHE = {};
const FL_get = url => FL_CACHE[url] || (FL_CACHE[url] = fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
const FL_tick = () => new Promise(r => setTimeout(r, 0));
const FL_esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function FL_load(base = '', opt = {}) {
  const [results, geo, idx] = await Promise.all([opt.elections ? opt.elections : FL_get(base + 'data/tsrelects-results.json'), FL_get(base + 'data/groups.geojson'), FL_get(base + 'data/timelines/index.json')]);
  return { base, results: Array.isArray(results) ? results : (results && results.elections) || [], geo, timelines: (idx && idx.timelines) || [] };
}

/** Everything needed to replay one election's ballots through the model. Null when the timeline has no ballot list (older ones only have snapshots). */
async function FL_prep(D, id) {
  const meta = D.timelines.find(t => t.id === id); if (!meta) return null;
  const [tl, pf] = await Promise.all([FL_get(D.base + `data/timelines/${id}.json`), FL_get(D.base + `data/elections/${id}.json`)]);
  if (!tl || !tl.ballots || !tl.ballots.length) return null;
  const ctx = NO_prepare({ pf, geo: D.geo, elections: D.results.filter(e => e.id !== id && e.date < meta.date), date: meta.date, keys: tl.candidates });
  const b = tl.ballots.slice().sort((x, y) => x.t.localeCompare(y.t)), first = x => ctx.toId[ctx.canon(x.r[0])] || x.r[0], fin = {};
  b.forEach(x => { const i = first(x); fin[i] = (fin[i] || 0) + 1; });
  const ord = Object.entries(fin).sort((a, c) => c[1] - a[1]), tie = !!(ord[1] && ord[1][1] === ord[0][1]);
  return { id, meta, tl, pf, ctx, b, first, fin, win: tie ? null : ord[0][0], tie };
}

/** Checkpoint ballot numbers: `max` evenly spaced from the model's first usable ballot up to (not including) the last one. */
function FL_ks(n, max) {
  const lo = NO_TUNE.minN, hi = n - 1; if (hi < lo) return [];
  const m = Math.min(max, hi - lo + 1), out = []; for (let i = 0; i < m; i++) out.push(Math.round(lo + (hi - lo) * (m === 1 ? 0 : i / (m - 1))));
  return [...new Set(out)];
}
async function FL_run(P, { sims = 400, max = 12, all = false } = {}) {
  const n = P.b.length, ks = all ? Array.from({ length: Math.max(0, n - NO_TUNE.minN) }, (_, i) => NO_TUNE.minN + i) : FL_ks(n, max), set = new Set(ks), groups = {}, pts = [];
  for (let i = 0; i < n; i++) {
    const x = P.b[i], g = String(x.g), id = P.first(x); (groups[g] = groups[g] || {})[id] = (groups[g][id] || 0) + 1;
    if (set.has(i + 1)) { const o = NO_run(P.ctx, NO_counts(groups, P.ctx), { sims }); pts.push({ k: i + 1, frac: (i + 1) / n, lead: o.lead }); if (pts.length % 3 === 0) await FL_tick(); }
  }
  return pts;
}

/** Recap of a finished, ballot-by-ballot election: how sure the model was along the way, how the lead moved, where the result differed from the forecast. */
async function FL_recap(D, id, { sims = 500 } = {}) {
  const P = await FL_prep(D, id); if (!P || !P.win) return null;
  const n = P.b.length, pts = await FL_run(P, { sims, all: true }), win = P.win, ctx = P.ctx;
  const pAt = f => { if (!pts.length) return null; const k = f * n; return pts.reduce((b, p) => Math.abs(p.k - k) < Math.abs(b.k - k) ? p : b).lead[win]; };
  const trough = pts.reduce((b, p) => (p.lead[win] < b.p ? { k: p.k, p: p.lead[win] } : b), { k: 0, p: 2 });
  const cum = {}, groups = {}, changes = []; let prev = null;
  P.b.forEach((x, i) => { const id2 = P.first(x), g = String(x.g); cum[id2] = (cum[id2] || 0) + 1; (groups[g] = groups[g] || {})[id2] = (groups[g][id2] || 0) + 1;
    const ord = Object.entries(cum).sort((a, c) => c[1] - a[1]); if (ord[1] && ord[1][1] === ord[0][1]) return; const ld = ord[0][0]; if (prev && ld !== prev && i + 1 >= 2) changes.push({ k: i + 1, t: x.t, from: prev, to: ld }); prev = ld; });
  const o0 = NO_run(ctx, NO_counts({}, ctx), { sims: 2000 }), actual = P.fin[win] / n, forecast = o0.share[win].mean;
  const grp = Object.entries(groups).map(([g, v]) => { const c = Object.values(v).reduce((a, b) => a + b, 0), a = (v[win] || 0) / c, f = (ctx.M.mu[g] && ctx.M.mu[g][win]) || 0; return { g, n: c, act: a, fc: f, d: a - f }; }).filter(x => x.n >= 2).sort((a, c) => Math.abs(c.d) - Math.abs(a.d));
  return { id, title: P.meta.title, n, win, ids: ctx.ids, pts, p25: pAt(.25), p50: pAt(.5), p75: pAt(.75), trough, changes, forecastShare: forecast, forecastLo: o0.share[win].lo, forecastHi: o0.share[win].hi, actualShare: actual, preP: o0.lead[win], groups: grp, fin: P.fin };
}
function FL_recapHTML(R, nameOf, colorOf) {
  const pc = p => p == null ? '—' : NO_pct(p) + '%', nm = id => FL_esc(nameOf(id)), W = 260, H = 44, xs = k => 4 + (k - NO_TUNE.minN) / Math.max(1, R.n - NO_TUNE.minN) * (W - 8), ys = p => H - 4 - p * (H - 8);
  const spark = R.pts.length > 1 ? `<svg class="rc-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chance the eventual winner finished first, ballot by ballot"><line x1="0" x2="${W}" y1="${ys(.5)}" y2="${ys(.5)}" stroke="var(--line)" stroke-dasharray="3 3"/><polyline fill="none" stroke="${FL_esc(colorOf(R.win))}" stroke-width="2.4" stroke-linejoin="round" points="${R.pts.map(p => xs(p.k).toFixed(1) + ',' + ys(p.lead[R.win]).toFixed(1)).join(' ')}"/></svg>` : '';
  const dif = Math.round((R.actualShare - R.forecastShare) * 100), lo = Math.round(R.forecastLo * 100), hi = Math.round(R.forecastHi * 100);
  const ch = R.changes.length ? R.changes.map(c => `<li><b>Ballot ${c.k}</b> — ${nm(c.to)} passes ${nm(c.from)}</li>`).join('') : '<li>The same candidate led from the first ballots to the last.</li>';
  const grp = R.groups.slice(0, 3).map(g => `<li>Group ${FL_esc(g.g)}: ${nm(R.win)} ${Math.round(g.act * 100)}% vs ${Math.round(g.fc * 100)}% forecast <span class="rc-${g.d > .02 ? 'up' : g.d < -.02 ? 'dn' : 'eq'}">${g.d > 0 ? '+' : ''}${Math.round(g.d * 100)}</span> <small>(${g.n} ballots)</small></li>`).join('');
  return `<div class="rc-head"><h3>Election recap</h3><small>${R.n} ballots · first-choice model</small></div>`
    + `<div class="rc-top"><div class="rc-tile"><span>Before any vote</span><b>${pc(R.preP)}</b><small>chance ${nm(R.win)} finishes first</small></div><div class="rc-tile"><span>A quarter in</span><b>${pc(R.p25)}</b></div><div class="rc-tile"><span>Halfway</span><b>${pc(R.p50)}</b></div><div class="rc-tile"><span>Three quarters</span><b>${pc(R.p75)}</b></div>${spark ? `<div class="rc-spark-wrap">${spark}<small>Lowest point: ${pc(R.trough.p)} after ballot ${R.trough.k}</small></div>` : ''}</div>`
    + `<div class="rc-cols"><div><h4>Forecast vs result</h4><p>${nm(R.win)} finished with <b>${Math.round(R.actualShare * 100)}%</b> of first-choice ballots against a pre-count forecast of <b>${Math.round(R.forecastShare * 100)}%</b> (${lo}–${hi}% range): <span class="rc-${dif > 2 ? 'up' : dif < -2 ? 'dn' : 'eq'}">${dif > 0 ? '+' : ''}${dif} pts</span>.</p><h4>Biggest group gaps</h4><ul>${grp || '<li>Not enough ballots per group.</li>'}</ul></div>`
    + `<div><h4>${R.changes.length === 1 ? '1 lead change' : R.changes.length + ' lead changes'}</h4><ul>${ch}</ul></div></div>` + FL_shareBar(R.title + ': ' + nameOf(R.win) + ' wins', Object.entries(R.fin).sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => ({ name: nameOf(k), color: colorOf(k), value: Math.round(v / R.n * 100) })), 'Share of first-choice ballots');
}

/** Forecast with no ballots counted: win chances, expected shares and the by-group outlook from the pre-election polls alone. */
function FL_preview({ pf, geo, elections, date, keys = [], sims = 3000 }) {
  const ctx = NO_prepare({ pf, geo, elections: (elections || []).filter(e => e.date < date), date, keys }), o = NO_run(ctx, NO_counts({}, ctx), { sims });
  return { ctx, o };
}
function FL_previewHTML(x, nameOf, colorOf) {
  const { ctx, o } = x, rank = ctx.ids.slice().sort((a, b) => o.lead[b] - o.lead[a]), top = rank.slice(0, 4), fav = rank[0], T = Math.round(ctx.hist.mean), nm = id => FL_esc(nameOf(id));
  const need = rank.slice(1, 4).filter(id => o.lead[id] > .003).map(id => { const gap = (o.share[fav].mean - o.share[id].mean) * 100, sw = gap / 2, bal = Math.ceil(gap / 100 * T / 2);
    return `<div class="nd-row"><i style="background:${FL_esc(colorOf(id))}"></i><span class="nd-nm">${nm(id)}</span><span class="nd-tx">trails ${nm(fav)} by <b>${gap.toFixed(1)}</b> pts in the average — needs a swing of about <b>${sw.toFixed(1)}</b> pts (~${bal} of ~${T} expected ballots) to tie</span></div>`; }).join('');
  const share = FL_shareBar('Pre-election outlook: ' + (x.title || ''), top.map(k => ({ name: nameOf(k), color: colorOf(k), value: Math.round(o.lead[k] * 100) })), 'Chance to finish first, before any ballots');
  return `<div class="odds-head"><h3>Pre-election outlook</h3><small>no ballots in · ~${T} expected</small><span class="odds-pill ${o.status.key}">${o.status.text === 'Too early' ? 'Forecast' : FL_esc(o.status.text)}</span></div>`
    + `<div class="odds-meter" role="img" aria-label="Chance to finish first: ${top.map(k => FL_esc(nameOf(k)) + ' ' + NO_pct(o.lead[k]) + '%').join(', ')}">${top.map(k => `<i style="width:${(o.lead[k] * 100).toFixed(1)}%;background:${FL_esc(colorOf(k))}"></i>`).join('')}</div>`
    + top.map(k => `<div class="odds-row" style="--c:${FL_esc(colorOf(k))}"><span class="nm"><i></i>${nm(k)}<small>${Math.round(o.share[k].mean * 100)}% expected (${Math.round(o.share[k].lo * 100)}–${Math.round(o.share[k].hi * 100)})</small></span><span class="pc">${NO_pct(o.lead[k])}%</span></div>`).join('')
    + (need ? `<div class="nd"><div class="nd-h"><b>What it takes</b><span>before a single ballot is cast</span></div>${need}</div>` : '')
    + NO_groupsHTML(o, nameOf, colorOf) + `<p class="odds-note">${o.runoff > .05 && ctx.ids.length > 2 ? `${Math.round(o.runoff * 100)}% chance nobody tops 50% · ` : ''}Built only from the pre-election polls and past turnout; it updates the moment ballots are counted. A model estimate, not a prediction of the exact result.</p>` + share;
}

/* ---------- data sources for the chart maker ---------- */
const FL_today = () => new Date().toISOString().slice(0, 10);
const FL_dayShift = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const FL_pretty = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const FL_cleanName = s => String(s || '').replace(/\s*\(.*\)\s*$/, '').replace(/^u\//i, '').trim();
async function FL_mods(base) { const a = await FL_get(base + 'data/approval-polls.json'); return Object.entries((a && a.moderators) || {}).map(([k, m]) => Object.assign({ key: k }, m)).filter(m => (m.polls || []).length); }
function FL_net(polls, d) { const ps = polls.filter(p => p.date <= d); if (!ps.length) return null; const g = BaseCalc_aggregate(ps, ['approve', 'disapprove'], d, { normalize: false }); return ((g.averages.approve || 0) - (g.averages.disapprove || 0)) * 100; }
async function FL_partySeries(base) {
  const pp = await FL_get(base + 'data/party-polls.json'), polls = (pp && pp.polls) || []; if (!polls.length) return null;
  const ids = [...new Set(polls.flatMap(p => Object.keys(p.shares || {})))], dates = [...new Set(polls.map(p => p.date))].sort(), asOf = FL_today();
  if (dates[dates.length - 1] < asOf) dates.push(asOf);
  const rows = dates.map(d => ({ d, a: BaseCalc_aggregate(polls.filter(p => p.date <= d), ids, d, {}).averages })), last = rows[rows.length - 1].a;
  return { ids: ids.filter(i => (last[i] || 0) > .02).sort((a, b) => (last[b] || 0) - (last[a] || 0)).slice(0, 6), rows, asOf };
}
const FL_sources = [
  { id: 'mod-net', label: 'Moderator net approval — now (bars)', needs: null, async build(D, _, env) {
    const mods = (await FL_mods(D.base)).filter(m => m.status !== 'former'), d = FL_today(), rows = mods.map(m => ({ m, v: FL_net(m.polls, d) })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
    return { type: 'hbar', title: 'Moderator net approval', sub: `Approve minus disapprove, weighted poll average as of ${FL_pretty(d)}`, source: 'Spinner Insights Census', unit: '', decimals: 0, cats: rows.map(r => r.m.name), catColors: [], series: [{ name: 'Net approval', color: '#2d6cdf', values: rows.map(r => Math.round(r.v)) }] }; } },
  { id: 'mod-change', label: 'Moderator net approval — 30 days ago vs now (dots)', needs: null, async build(D) {
    const mods = (await FL_mods(D.base)).filter(m => m.status !== 'former'), d = FL_today(), d0 = FL_dayShift(d, -30), rows = mods.map(m => ({ m, a: FL_net(m.polls, d0), b: FL_net(m.polls, d) })).filter(r => r.a != null && r.b != null).sort((x, y) => y.b - x.b);
    return { type: 'dumbbell', title: 'Moderator approval, month on month', sub: 'Net approval (approve minus disapprove), 30 days ago vs now', source: 'Spinner Insights Census', unit: '', decimals: 0, cats: rows.map(r => r.m.name), catColors: [], series: [{ name: FL_pretty(d0), color: '#8a8f9c', values: rows.map(r => Math.round(r.a)) }, { name: 'Now', color: '#c6285a', values: rows.map(r => Math.round(r.b)) }] }; } },
  { id: 'party-time', label: 'Party support over time (lines)', needs: null, async build(D, _, env) {
    const S = await FL_partySeries(D.base); if (!S) return null;
    return { type: 'line', title: 'Party support over time', sub: 'Weighted average of party ID polls', source: 'Spinner Insights Census', unit: '%', decimals: 0, min: 0, max: '', cats: S.rows.map(r => FL_pretty(r.d).replace(/ \d{4}$/, '')), catColors: [], series: S.ids.map(id => ({ name: env.partyName(id), color: env.partyColor(id), values: S.rows.map(r => Math.round((r.a[id] || 0) * 1000) / 10) })) }; } },
  { id: 'party-area', label: 'Party support over time (stacked area)', needs: null, async build(D, _, env) {
    const S = await FL_partySeries(D.base); if (!S) return null;
    return { type: 'area', title: 'Where party support sits', sub: 'Weighted average of party ID polls, top parties', source: 'Spinner Insights Census', unit: '%', decimals: 0, min: '', max: '', cats: S.rows.map(r => FL_pretty(r.d).replace(/ \d{4}$/, '')), catColors: [], series: S.ids.map(id => ({ name: env.partyName(id), color: env.partyColor(id), values: S.rows.map(r => Math.round((r.a[id] || 0) * 1000) / 10) })) }; } },
  { id: 'party-now', label: 'Party support — now (results bars)', needs: null, async build(D, _, env) {
    const S = await FL_partySeries(D.base); if (!S) return null; const last = S.rows[S.rows.length - 1].a;
    return { type: 'rcp', title: 'Party support', sub: `Weighted average as of ${FL_pretty(S.asOf)}`, source: 'Spinner Insights Census', unit: '%', decimals: 1, cats: S.ids.map(env.partyName), catColors: S.ids.map(env.partyColor), series: [{ name: 'Support', color: '#2d6cdf', values: S.ids.map(id => Math.round((last[id] || 0) * 1000) / 10) }] }; } },
  { id: 'winprob', label: 'Win probability through an election night (lines)', needs: 'timeline', async build(D, id, env) {
    const P = await FL_prep(D, id); if (!P) return null; const pts = await FL_run(P, { sims: 400, all: true }), last = pts[pts.length - 1], ids = P.ctx.ids.slice().sort((a, b) => last.lead[b] - last.lead[a]).slice(0, 4);
    return { type: 'line', title: 'Chance to finish first', sub: `${P.meta.title}, after each ballot`, source: 'Decision Desk TSR win probability', unit: '%', decimals: 0, min: 0, max: 100, showValues: false, cats: pts.map(p => String(p.k)), catColors: [], series: ids.map(i => ({ name: env.candName(i), color: env.candColor(i), values: pts.map(p => Math.round(p.lead[i] * 100)) })) }; } },
  { id: 'rcv', label: 'Ranked-choice transfers (Sankey)', needs: 'rcv', async build(D, id, env) {
    const bt = await FL_get(D.base + 'data/ballottsr/parsed/official.json'), e = bt && (bt.elections || []).find(x => x.id === id); if (!e || !e.rounds) return null;
    const idOf = {}; (e.opts || []).forEach(o => { idOf[o.name] = o.id; }); const nodeName = (n, r) => FL_cleanName(n) + ' · R' + r, flows = [], colors = {};
    const col = n => (idOf[n] && env.candColor(idOf[n])) || null;
    for (let r = 0; r < e.rounds.length - 1; r++) {
      const A = e.rounds[r], B = e.rounds[r + 1], gone = Object.keys(A.tallies).filter(k => !(k in B.tallies)), gain = {}; Object.keys(B.tallies).forEach(k => { gain[k] = B.tallies[k] - A.tallies[k]; });
      Object.keys(B.tallies).forEach(k => { const keep = Math.min(A.tallies[k], B.tallies[k]); if (keep > 0) flows.push({ from: nodeName(k, r + 1), to: nodeName(k, r + 2), value: keep }); });
      const exh = (B.exhausted || 0) - (A.exhausted || 0), pool = gone.reduce((s, k) => s + A.tallies[k], 0); let need = Object.values(gain).reduce((s, v) => s + Math.max(0, v), 0) + Math.max(0, exh);
      gone.forEach(gk => { const share = pool ? A.tallies[gk] / pool : 1; Object.keys(B.tallies).forEach(k => { if (gain[k] > 0) flows.push({ from: nodeName(gk, r + 1), to: nodeName(k, r + 2), value: Math.round(gain[k] * share * 100) / 100 }); }); if (exh > 0) flows.push({ from: nodeName(gk, r + 1), to: 'Exhausted', value: Math.round(exh * share * 100) / 100 }); });
    }
    Object.keys(e.rounds[0].tallies).forEach(k => { const c = col(k); if (c) for (let r = 1; r <= e.rounds.length; r++) colors[nodeName(k, r)] = c; }); colors['Exhausted'] = '#8a8f9c';
    return { type: 'sankey', boxed: true, kicker: 'Ranked-choice', title: e.title.replace(/^Official\s+/, ''), sub: 'Where each eliminated candidate\'s ballots went, round by round', source: 'BallotTSR official tally', unit: '', decimals: 0, flows, nodeColors: colors }; } }
];
async function FL_sourceArgs(D, kind) {
  if (kind === 'timeline') return D.timelines.filter(t => t.source === 'ballots').map(t => ({ id: t.id, label: t.title }));
  if (kind === 'rcv') { const bt = await FL_get(D.base + 'data/ballottsr/parsed/official.json'); return ((bt && bt.elections) || []).filter(e => e.method === 'rcv' && e.rounds && e.rounds.length > 1).map(e => ({ id: e.id, label: e.title + ' (' + e.date + ')' })); }
  return [];
}

/* ---------- share buttons (copy link / save image) ---------- */
function FL_shareBar(title, rows, sub, unit = '%') {
  if (typeof GM_shareCard === 'undefined') return '';
  const data = { title, sub, unit, rows: rows.map(r => ({ name: r.name, color: r.color, value: r.value })) };
  return `<div class="fl-share"><button type="button" data-fl-share="link">🔗 Copy link</button><button type="button" data-fl-share="img" data-fl="${FL_esc(JSON.stringify(data))}">🖼 Save image</button><span class="fl-share-msg" role="status" aria-live="polite"></span></div>`;
}
if (typeof document !== 'undefined') document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-fl-share]'); if (!b) return; const msg = b.parentNode.querySelector('.fl-share-msg'), say = t => { if (msg) { msg.textContent = t; setTimeout(() => { msg.textContent = ''; }, 2500); } };
  if (b.dataset.flShare === 'link') { try { await navigator.clipboard.writeText(location.href); say('Link copied'); } catch (err) { prompt('Copy this link:', location.href); } return; }
  try {
    const d = JSON.parse(b.dataset.fl), spec = { type: 'rcp', title: '', sub: d.sub || '', unit: d.unit, decimals: 0, source: 'Decision Desk TSR', cats: d.rows.map(r => r.name), catColors: d.rows.map(r => r.color), series: [{ name: 'Value', color: '#888', values: d.rows.map(r => r.value) }] };
    const blob = await GM_shareCard({ title: d.title, kicker: 'Decision Desk TSR', date: new Date().toISOString().slice(0, 10), spec }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tsr-' + String(d.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); say('Image saved');
  } catch (err) { console.warn(err); say('Could not make the image'); }
});

if (typeof window !== 'undefined') Object.assign(window, { FL_shareBar, FL_load, FL_prep, FL_run, FL_ks, FL_recap, FL_recapHTML, FL_preview, FL_previewHTML, FL_sources, FL_sourceArgs, FL_get, FL_cleanName });
