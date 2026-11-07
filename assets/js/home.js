/* Homepage logic: Control Room stage + Wire, election-night windows, trackers hub, approval/timeline panels. Needs main.js, tsrelects.js, electionnight.js, callalert.js, nightfx.js. */
initSiteChrome();

/* ---- The Control Room + The Wire ---- */
const J = u => fetch(u).then(r => r.json());
const shortTitle = t => String(t || '').replace(/ Election$/, '');
const WIRE = [];
let WIRECTL = null;
function wireAdd(tag, text, href, extra) { WIRE.push(Object.assign({ tag, text, href }, extra || {})); }
function startWire(night) {
  const box = document.getElementById('wire'), el = document.getElementById('wireItem'), dots = document.getElementById('wireDots');
  if (!WIRE.length) return;
  // election night leads with the calls, then the count, then the story behind it; the everyday items follow
  const order = ['Call', 'Results', 'Odds', 'Groups', 'Turnout', 'Polls', 'Replay', 'Forecast', 'Desk', 'Ratings', 'Status'], rank = w => { const k = order.indexOf(w.tag); return k < 0 ? 99 : k; };
  const sort = () => WIRE.sort((a, b) => rank(a) - rank(b)), paintDots = () => { dots.innerHTML = WIRE.length > 14 ? '' : WIRE.map(() => '<i></i>').join(''); };
  let i = 0, hold = false, paused = false;
  const show = () => { const w = WIRE[i];
    el.innerHTML = `<b class="${esc(w.kind || '')}">${esc(w.tag)}</b>${esc(w.text)}${w.flip ? '<span class="flip">FLIP</span>' : ''}`; el.href = w.href;
    el.onclick = w.call && window.CA_open ? e => { e.preventDefault(); CA_open(w.call); } : null;
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); };
  sort(); paintDots(); box.hidden = false; box.classList.toggle('night', !!night); show();
  // live updates swap the election-night items in place; a brand-new call jumps the Wire to it and slams the bar gold
  WIRECTL = { replace(items, jumpId) {
    for (let k = WIRE.length - 1; k >= 0; k--) if (WIRE[k].kind) WIRE.splice(k, 1);
    items.forEach(w => WIRE.push(w)); sort(); paintDots();
    const j = jumpId ? WIRE.findIndex(w => w.call === jumpId) : -1; i = j >= 0 ? j : Math.min(i, WIRE.length - 1); show();
    if (j >= 0) { box.classList.remove('slam'); void box.offsetWidth; box.classList.add('slam'); setTimeout(() => box.classList.remove('slam'), 2500); } } };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  box.addEventListener('mouseenter', () => hold = true); box.addEventListener('mouseleave', () => hold = false); box.addEventListener('focusin', () => hold = true); box.addEventListener('focusout', () => hold = false);
  const pb = document.getElementById('wirePause'); pb.hidden = false;
  pb.onclick = () => { paused = !paused; pb.textContent = paused ? '▶' : '❚❚'; pb.setAttribute('aria-label', paused ? 'Resume rotation' : 'Pause rotation'); };
  setInterval(() => { if (hold || paused || WIRE.length < 2 || box.classList.contains('slam')) return; el.classList.add('out'); setTimeout(() => { i = (i + 1) % WIRE.length; show(); el.classList.remove('out'); }, 350); }, night ? 5500 : 5000);
}

/* ---- The Stage: one live window at a time, chosen from a channel rail ---- */
const GRADE_BG = g => ({ a: '#1f9d63', b: '#4a8fd9', c: '#d79a1e', d: '#d9631e', f: '#c0262d' }[String(g)[0].toLowerCase()] || '#8a8a82');
const photoOf = TSR_candidatePhoto;

async function chReplay(tl) {
  const list = (tl.timelines || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date)); if (!list.length) return null;
  const url = id => 'elects/replay?e=' + encodeURIComponent(id), latest = list[0];
  wireAdd('Replay', `Relive the ${shortTitle(latest.title)} count, vote by vote`, url(latest.id));
  return { id: 'replay', title: 'Election Replay', sub: 'Watch the count unfold', kick: 'Election Replay', head: 'Watch every vote come in', cta: { href: url(latest.id), label: 'Open the replay' },
    body: `<a class="sp-screen" href="${url(latest.id)}" aria-label="Open the Election Replay"><span class="pill"><b>▶</b> ${esc(shortTitle(latest.title))}</span></a>`,
    note: `<span>Also:</span>${list.slice(1, 4).map(m => `<a href="${url(m.id)}">${esc(shortTitle(m.title).replace(/ 20\d\d/, ''))}</a>`).join('')}<a href="elects/replay">All replays →</a>`,
    onShow(p) { const f = document.createElement('iframe'); f.src = 'elects/replay?embed=1'; f.title = 'Election Replay preview'; f.tabIndex = -1; f.setAttribute('aria-hidden', 'true'); p.querySelector('.sp-screen').prepend(f); },
    onHide(p) { const f = p.querySelector('iframe'); if (f) f.remove(); } };
}

async function chForecast(cfg, registry, pidx) {
  const act = cfg.mode === 'active' && SITE_activeList(cfg).length, id = act ? SITE_activeList(cfg)[0].pollsId : pidx.elections[0].id;
  const f = await J(`data/elections/${id}.json`); if (!f.polls || !f.polls.length) return null;
  const today = todayUTCString(), done = f.electionDate && f.electionDate < today, asOf = done ? f.electionDate : today;
  const ids = BaseCalc_currentCandidates(f.polls, f.candidateIds), agg = BaseCalc_aggregate(f.polls, ids, asOf, { anticipatedTurnout: f.anticipatedTurnout });
  const top = agg.sorted.slice(0, 3), tot = agg.sorted.reduce((a, x) => a + x[1], 0) || 1, dates = f.polls.map(p => p.date).sort(), pols = new Set(f.polls.map(p => p.pollster));
  const rows = top.map(([k, v]) => { const pa = TSR_party(registry, TSR_candidateParty(registry, k)), pct = v / tot * 100;
    return `<div class="fcl-row" style="--c:${esc(TSR_candidateColor(registry, k))}"><img src="${photoOf(registry, k)}" alt=""><div><div class="fcl-name">${esc(TSR_candidateName(registry, k))}${pa && pa.name ? `<small>${esc(pa.name)}</small>` : ''}</div><div class="fcl-bar"><i style="width:${pct.toFixed(1)}%"></i></div></div><div class="fcl-pct">${Math.round(pct)}<small>%</small></div></div>`; }).join('');
  wireAdd('Forecast', `${f.title}: ${TSR_candidateName(registry, top[0][0])} ${Math.round(top[0][1] / tot * 100)}%${top[1] ? ' · ' + TSR_candidateName(registry, top[1][0]) + ' ' + Math.round(top[1][1] / tot * 100) + '%' : ''} in the polling average`, `ddtsr?election=${id}#probcalc`);
  return { id: 'forecast', title: 'Forecast', sub: 'Polling average', kick: `Decision Desk TSR · ${done ? 'Final polling average' : act ? 'Live polling average' : 'Polling average'}`, head: f.title, cta: { href: `ddtsr?election=${id}#probcalc`, label: 'Full forecast' },
    body: `<div class="fcl">${rows}</div>`, note: `<span>${f.polls.length} polls · ${pols.size} pollsters · latest ${esc(dates[dates.length - 1])}</span><a href="guide">How is this calculated?</a>` , ids };
}

async function chMap(registry, elections, geo, pick) {
  let e, race;   // pick = { e, race, short }: the map for one specific live race (election night); otherwise the latest election with results
  if (pick) { e = pick.e; race = pick.race; } else {
    const els = elections.filter(x => Object.keys(TSR_getRaces(TSR_getRoundData(x, 'first_round'))).length).sort((a, b) => new Date(b.date) - new Date(a.date)); e = els[0]; if (!e) return null;
    race = Object.values(TSR_getRaces(TSR_getRoundData(e, 'first_round')))[0];
  }
  const polys = f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
  const fs = geo.features.filter(f => f.geometry && f.geometry.type !== 'Point');
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  fs.forEach(f => polys(f).forEach(p => p.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }))));
  const W = 420, H = 450, pad = 6, c = Math.cos(((y0 + y1) / 2) * Math.PI / 180), k = Math.min((W - 2 * pad) / ((x1 - x0) * c), (H - 2 * pad) / (y1 - y0));
  const ox = pad + (W - 2 * pad - (x1 - x0) * c * k) / 2, oy = pad + (H - 2 * pad - (y1 - y0) * k) / 2;
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), pal = ['#2f80ed', '#f2994a', '#27ae60', '#9b51e0', '#f2c94c', '#00b8d9', '#eb5757'], used = [], cmap = {}, tot = TSR_raceTotals(race);
  Object.entries(tot).filter(q => q[1] > 0).sort((a, b) => b[1] - a[1]).forEach(([q]) => { let col = TSR_candidateColor(registry, q); if (!/^#[0-9a-f]{6}$/i.test(col)) col = '#888888';
    if (used.some(u => dist(rgb(col), rgb(u)) < 70)) col = pal.map(pc => [pc, Math.min(...used.map(u => dist(rgb(pc), rgb(u))))]).sort((x, y) => y[1] - x[1])[0][0]; used.push(col); cmap[q] = col; });
  const wins = {};
  const paths = fs.map(f => { const v = race[String(f.properties.id)], d = polys(f).map(p => p.map(r => r.map((pt, i) => `${i ? 'L' : 'M'}${(ox + (pt[0] - x0) * c * k).toFixed(1)} ${(oy + (y1 - pt[1]) * k).toFixed(1)}`).join('') + 'Z').join('')).join('');
    let fill = '#2a2e3a', op = 1;
    if (v) { const s = Object.entries(v).sort((a, b) => b[1] - a[1]), t = s.reduce((a, x) => a + x[1], 0);
      if (s[0] && !(s[1] && s[1][1] === s[0][1])) { fill = cmap[s[0][0]]; op = .6 + .4 * (s[0][1] / t); wins[s[0][0]] = (wins[s[0][0]] || 0) + 1; } else fill = '#8f95a3'; }
    return `<path d="${d}" fill="${esc(fill)}" fill-opacity="${op.toFixed(2)}" data-fill="${esc(fill)}" data-op="${op.toFixed(2)}"/>`; }).join('');
  const names = Object.keys(tot).filter(q => tot[q] > 0).sort((a, b) => tot[b] - tot[a]).slice(0, 3);
  return { id: pick ? 'map-' + e.id : 'map', title: pick ? pick.short + ' Map' : 'Results Map', sub: 'Group by group', kick: pick ? 'Results map' : 'Map Maker', head: shortTitle(e.title), cta: { href: 'elects/mapmaker', label: 'Make your own map' },
    body: `<div class="mpv"><div class="mpv-svg"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${esc(e.title)}">${paths}</svg></div><ul class="mpv-leg">${names.map(q => { const pa = TSR_party(registry, TSR_candidateParty(registry, q)); return `<li><i style="background:${esc(cmap[q])}"></i><span class="nm">${esc(TSR_candidateName(registry, q))}<small>${pa && pa.name ? esc(pa.name) + ' · ' : ''}${tot[q]} votes</small></span><span class="ct"><span data-count="${wins[q] || 0}">${wins[q] || 0}</span><small>groups</small></span></li>`; }).join('')}</ul></div>`,
    note: `<span>Download any result as a clean SVG or PNG.</span>` };
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8l5 5.2L19.8 6.4"/></svg>';
let NIGHT = { boards: [], night: [], calls: [] };

/** Election night, window 1: one card per race — the call graphic's look for called races, a dark "no call yet" card for the rest. */
async function chCalls(N, registry) {
  const cards = []; let called = 0, total = 0;
  N.night.forEach(b => b.races.forEach(r => {
    total++;
    const lead = r.sorted.filter(x => x[1] > 0)[0], link = `elects/?election=${encodeURIComponent(b.id)}`, call = N.calls.find(c => c.id === r.callId);
    const face = x => `<div class="cl-face"><img src="${esc(x.photo)}" alt=""><b style="color:${esc(CG_lum(x.color) > .55 ? CG_mix(x.color, .5) : x.color)}">${esc(x.partyLabel)}</b></div>`;
    if (call) {
      called++;
      const two = call.kind === 'autorunoff' && call.candidates.length > 1, cols = call.candidates.map(x => CG_deepen(x.color)), bg = two ? `linear-gradient(100deg,${cols[0]},${cols[1] || cols[0]})` : cols[0];
      const share = r.totals[r.winners[0]] ? EN_pct(r.totals[r.winners[0]], r.votes) : null, g = r.wins[r.winners[0]];
      cards.push(`<a class="cl-card${two ? ' two' : ''}" href="${link}" data-call="${esc(call.id)}" style="--bg:${esc(bg)}" aria-label="${esc(b.short)} race call: ${esc(call.candidates.map(x => x.name).join(' and '))}"><div class="cl-top">${esc(call.title)}<small>${esc(call.subtitle)}</small></div>
        <div class="cl-pills">${call.flip ? '<span class="cl-pill flip">⟲ FLIP</span>' : ''}<span class="cl-pill">${CHECK_SVG}${two ? 'Projected autorunoff' : 'Projected winner'}</span></div>
        <div class="cl-faces">${call.candidates.map(face).join(two ? '<i class="cl-plus"></i>' : '')}</div>
        <div class="cl-name">${two ? `${esc(call.candidates[0].name)}<i>and</i>${esc(call.candidates[1].name)}` : esc(call.candidates[0].name)}</div>
        <div class="cl-meta">${[share != null ? share + '% of the vote' : '', g ? `${g} of ${r.groupTotal} groups` : ''].filter(Boolean).join(' · ')}</div></a>`);
    } else if (lead) {
      const c = EN_candidate(registry, lead[0], './'), adv = r.kind === 'advance', g = r.wins[lead[0]];
      cards.push(`<a class="cl-card open" href="${link}"><div class="cl-top">${esc(b.short)}<small>${esc(b.roundLabel)}</small></div>
        <div class="cl-pills"><span class="cl-pill wait">${adv ? 'Advances to runoff' : r.tied ? 'Too close to call' : 'No call yet'}</span></div>
        <div class="cl-faces">${face(c)}</div><div class="cl-name">${esc(c.name)}</div>
        <div class="cl-meta">${r.tied ? 'Tied at ' : 'Leads with '}${EN_pct(lead[1], r.votes)}%${g ? ` · ${g} of ${r.groupTotal} groups` : ''}</div></a>`);
    }
  }));
  if (!cards.length) return null;
  return { id: 'calls', title: 'Race Calls', sub: `${called} of ${total} called`, kick: 'Decision Desk TSR · Projections', head: called === total ? (total > 1 ? 'Every race has been called' : 'The race has been called') : `${called} of ${total} race${total === 1 ? '' : 's'} called`,
    cta: { href: 'elects/', label: 'All results' }, body: `<div class="cl">${cards.join('')}</div>`,
    note: `<span>Projections by Decision Desk TSR from the official count${called ? ' · tap a call for its graphic' : ''}.</span>`,
    onShow(p) { p.querySelectorAll('[data-call]').forEach(a => { a.onclick = e => { if (window.CA_open) { e.preventDefault(); CA_open(a.dataset.call); } }; }); } };
}

/** Election night, window 2: the count — top three per race with share, votes, reporting and turnout. Bars grow, numbers count up, and a ±% chip ticks in
 *  (change since the last live update when the count moved, otherwise versus the final DDTSR polling average). */
const PREVSHARES = {};
const deltaText = d => d > 0 ? '▲ +' + d : d < 0 ? '▼ −' + Math.abs(d) : '– 0';
async function chResults(N, registry, pm = {}) {
  const blocks = N.night.flatMap(b => b.races.filter(r => r.votes > 0).map(r => {
    const top = r.sorted.filter(x => x[1] > 0).slice(0, 3), win = new Set(r.kind === 'winner' ? r.winners.slice(0, 1) : r.kind === 'autorunoff' ? r.winners : []);
    const key = b.id + '|' + r.name, cur = {}; r.sorted.forEach(([k, v]) => { cur[k] = EN_pct(v, r.votes); });
    const prev = PREVSHARES[key], moved = !!prev && Object.keys(cur).some(k => Math.abs(cur[k] - (prev[k] || 0)) >= 1); PREVSHARES[key] = cur;
    const ps = pm[b.id] ? EN_pollShares(pm[b.id], b) : null;
    const delta = k => moved ? { d: cur[k] - (prev[k] || 0), lab: 'since update' } : ps && ps[TSR_canonId(k)] != null ? { d: cur[k] - ps[TSR_canonId(k)], lab: 'vs polls' } : null;
    const rows = top.map(([k, v]) => { const pa = TSR_party(registry, TSR_candidateParty(registry, k)), dl = delta(k), w = (v / r.votes * 100).toFixed(1);
      return `<div class="rs-row" style="--c:${esc(TSR_candidateColor(registry, k))}"><img src="${photoOf(registry, k)}" alt=""><div><div class="rs-nm">${esc(TSR_candidateName(registry, k))}${win.has(k) ? `<span class="rs-ck" title="Projected">${CHECK_SVG}</span>` : ''}${pa && pa.name ? `<small>${esc(pa.shortName || pa.name)}</small>` : ''}</div><div class="rs-bar"><i data-w="${w}" style="width:${w}%"></i></div></div>`
        + (dl ? `<div class="rs-delta ${dl.d > 0 ? 'up' : dl.d < 0 ? 'dn' : 'zero'}" data-to="${dl.d}"><b>${deltaText(dl.d)}</b><small>${dl.lab}</small></div>` : '<div></div>')
        + `<div class="rs-pct"><span data-count="${cur[k]}">${cur[k]}</span><sup>%</sup><small>${v} vote${v === 1 ? '' : 's'}</small></div></div>`; }).join('');
    const bits = [b.reportingPct != null ? `${b.reportingPct}% reporting` : '', b.turnout != null ? `turnout ${b.turnout}%` : ''].filter(Boolean).join(' · ');
    return `<div class="rs-block"><div class="rs-head"><h4>${esc(b.short)} · ${esc(b.roundLabel)}</h4><span>${esc(bits)}</span>${r.kind === 'winner' ? `<span class="rs-call${r.flip ? ' flip' : ''}">✓ ${r.flip ? 'FLIP · ' : ''}PROJECTED</span>` : r.kind === 'autorunoff' ? '<span class="rs-call">✓ AUTORUNOFF</span>' : ''}</div>${rows}</div>`; }));
  if (!blocks.length) return null;
  const when = N.night.some(b => b.live);
  return { id: 'results', title: when ? 'Live Results' : 'Results', sub: 'The count so far', kick: `TSR Elects · ${when ? 'Live results' : 'Final results'}`, head: N.night.length > 1 ? 'Where the count stands' : N.night[0].title, cta: { href: 'elects/', label: 'Full results' },
    body: `<div class="rs">${blocks.join('')}</div>`, note: `<span>Share of the vote across every group · ▲▼ change ${blocks.join('').includes('since update') ? 'since the last update' : 'versus the final DDTSR polling average'}.</span><a href="elects/simulate">Run your own election night →</a>` };
}

/** Election night, window 3: chance to lead — the DDTSR group forecast (NightOdds) updated by the ballots in. Same rows as the count, so bars, counters and the ±pt chip animate the same way.
 *  First-choice model: ranked-choice / STAR transfers are not simulated. Too early (<3 ballots) it says so instead of guessing. */
const ODDS_CTX = {}, PREVODDS = {}; let ODDS_WIRE = [];
async function chOdds(N, registry, pm = {}, geo, elections) {
  if (!window.NO_run || !geo) return null;
  ODDS_WIRE = [];
  const blocks = N.night.flatMap(b => b.races.filter(r => r.votes > 0).map(r => {
    const pf = pm[b.id], ids = r.sorted.map(x => x[0]), ck = b.id + '|' + r.name;
    const ctx = ODDS_CTX[ck] || (ODDS_CTX[ck] = NO_prepare({ pf, geo, elections: elections.filter(e => e.id !== b.id && e.date < b.date), date: b.date, keys: ids }));
    const o = NO_run(ctx, NO_counts(r.groups, ctx), { sims: 2500, final: !b.live }), early = o.N < NO_TUNE.minN, called = !!r.kind, prev = PREVODDS[ck]; PREVODDS[ck] = Object.assign({}, o.lead);
    const rank = ctx.ids.slice().sort((x, y) => o.lead[y] - o.lead[x]), top = rank.slice(0, 4), fav = o.favorite, lab = called ? { key: 'call', text: 'Called' } : o.status, pct = NO_pct(o.lead[fav]);
    const moved = !!prev && ctx.ids.some(k => Math.abs(o.lead[k] - (prev[k] || 0)) >= 0.01);
    const rows = top.map(k => { const p = o.lead[k], pa = TSR_party(registry, TSR_candidateParty(registry, k)), dl = moved && !early ? Math.round((p - (prev[k] || 0)) * 100) : null, w = (p * 100).toFixed(1), shown = NO_pct(p);
      return `<div class="rs-row od-row" style="--c:${esc(TSR_candidateColor(registry, k))}"><img src="${photoOf(registry, k)}" alt=""><div><div class="rs-nm">${esc(TSR_candidateName(registry, k))}${pa && pa.name ? `<small>${esc(pa.shortName || pa.name)}</small>` : ''}</div><div class="rs-bar"><i data-w="${w}" style="width:${w}%"></i></div></div>`
        + (dl != null ? `<div class="rs-delta ${dl > 0 ? 'up' : dl < 0 ? 'dn' : 'zero'}" data-to="${dl}"><b>${deltaText(dl)}</b><small>since update</small></div>` : '<div></div>')
        + `<div class="rs-pct"><span${/^\d+$/.test(shown) ? ` data-count="${shown}"` : ''}>${shown}</span><sup>%</sup><small>${o.share[k] ? Math.round(o.share[k].mean * 100) + '% proj. share' : ''}</small></div></div>`; }).join('');
    const bits = [`${o.N} ballot${o.N === 1 ? '' : 's'} ${o.final ? 'counted' : `in · ~${Math.round(o.expectedTotal)} expected`}`, o.runoff > 0.05 && ids.length > 2 ? `${Math.round(o.runoff * 100)}% chance nobody tops 50%` : '', o.tipping ? `Group ${o.tipping.group} decides it` : ''].filter(Boolean).join(' · ');
    if (!early) ODDS_WIRE.push({ tag: 'Odds', kind: 'odds', href: `elects/?election=${encodeURIComponent(b.id)}`, text: `${TSR_candidateName(registry, fav)} has a ${pct}% chance to lead ${b.short}${b.races.length > 1 ? ' · ' + r.name.replace(/ (First Round|Runoff)$/, '') : ''} — ${lab.text.toLowerCase()}${moved && prev ? ` (${Math.round((o.lead[fav] - (prev[fav] || 0)) * 100) >= 0 ? '+' : '−'}${Math.abs(Math.round((o.lead[fav] - (prev[fav] || 0)) * 100))} pts)` : ''}` });
    const meter = early ? '' : `<div class="od-meter" aria-hidden="true">${top.map(k => `<i style="width:${(o.lead[k] * 100).toFixed(1)}%;background:${esc(TSR_candidateColor(registry, k))}"></i>`).join('')}</div>`;
    return `<div class="rs-block"><div class="rs-head"><h4>${esc(b.short)} · ${esc(b.roundLabel)}</h4><span class="od-st od-${lab.key}">${esc(lab.text)}</span></div>${early ? `<p class="od-early">Only ${o.N} ballot${o.N === 1 ? '' : 's'} counted so far — too early for a meaningful chance. Odds appear from ${NO_TUNE.minN} ballots.</p>` : meter + rows}<div class="od-bits">${esc(bits)}</div></div>`; }));
  if (!blocks.length) return null;
  return { id: 'odds', title: 'Win Probability', sub: 'Chance to lead', kick: 'DDTSR · Group forecast + the count', head: 'Who finishes first?', cta: { href: 'ddtsr#probcalc', label: 'How it works' },
    body: `<div class="rs od">${blocks.join('')}</div>`, note: `<span>Pre-election group forecast updated by every counted ballot. First-choice votes only; small electorates swing fast. A model estimate, not a call — calls come from the desk.</span>` };
}

async function chRatings() {
  const d = await PG_load('./'), ranked = d.pollsters.filter(p => p.grade && p.grade.n >= 2 && !p.grade.provisional).sort((a, b) => b.grade.score - a.grade.score).slice(0, 5);
  const rows = ranked.length >= 3 ? ranked : d.pollsters.filter(p => p.grade).sort((a, b) => b.grade.score - a.grade.score).slice(0, 5); if (!rows.length) return null;
  wireAdd('Ratings', `${rows[0].name} tops the pollster ratings with a ${rows[0].grade.grade}`, 'pollsters');
  return { id: 'ratings', title: 'Pollster Ratings', sub: 'Who called it', kick: 'Spinner Insights', head: 'Who actually called it?', cta: { href: 'pollsters', label: 'All grades' },
    body: `<ol class="rl">${rows.map((p, i) => `<li><a href="pollster?p=${PG_slug(p.name)}"><span class="rl-rank">${i + 1}</span><span class="rl-name">${esc(p.name)}</span><span class="rl-meta">${p.grade.n} poll${p.grade.n === 1 ? '' : 's'}</span><span class="rl-grade" style="background:${GRADE_BG(p.grade.grade)}">${esc(p.grade.grade)}</span></a></li>`).join('')}</ol>`,
    note: `<span>Graded on how close each outlet landed to the logged result.</span><a href="polls">Spinner Insights polls →</a>` };
}

async function chApproval(registry) {
  const base = await J('data/approval-polls.json'), data = OVR_getApprovalData(base), today = todayUTCString();
  const rows = Object.entries(data.moderators || {}).filter(([, m]) => m.polls.length).map(([k, m]) => { const agg = BaseCalc_aggregate(m.polls, ['approve', 'disapprove'], m.frozenAsOf || today, { normalize: false });
    return { k, name: (m.role || m.name), net: ((agg.averages.approve || 0) - (agg.averages.disapprove || 0)) * 100, seat: m.terms ? m.seat : '' }; }).sort((a, b) => b.net - a.net).slice(0, 5);
  if (!rows.length) return null;
  const mx = Math.max(60, ...rows.map(r => r.net)), ph = k => { const c = registry.candidates && registry.candidates[k]; return c && c.photo ? `assets/img/candidates/${c.photo}` : 'assets/img/bust-silhouette.svg'; };
  return { id: 'approval', title: 'Moderator Approval', sub: 'Net approval ranking', kick: 'CENSUS polling', head: 'How the mods are doing', cta: { href: 'approval', label: 'Full tracker' },
    body: `<ol class="rl al">${rows.map((r, i) => `<li><a href="approval?mod=${encodeURIComponent(r.k)}"><span class="rl-rank">${i + 1}</span><img src="${ph(r.k)}" alt=""><span class="rl-name">${esc(r.name)}</span><span class="al-bar"><i style="width:${Math.max(4, r.net / mx * 100).toFixed(0)}%"></i></span><span class="al-net">${r.net >= 0 ? '+' : '−'}${Math.abs(r.net).toFixed(0)}</span></a></li>`).join('')}</ol>`,
    note: `<span>Net approval = approve minus disapprove, ProbCalc-weighted as of today.</span>` };
}

let STAGE = null;
function buildStage(chs) {
  const stage = document.getElementById('stage'), rail = document.getElementById('stageRail'), view = document.getElementById('stageView');
  if (!chs.length) { stage.hidden = true; return; }
  rail.innerHTML = chs.map((c, i) => `<button type="button" class="rail-tab" role="tab" id="tab-${c.id}" aria-controls="sp-${c.id}" aria-selected="false" tabindex="-1" data-i="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><b>${esc(c.title)}</b><small>${esc(c.sub)}</small><span class="bar"></span></button>`).join('');
  view.innerHTML = chs.map(c => `<div class="sp" id="sp-${c.id}" role="tabpanel" aria-labelledby="tab-${c.id}" hidden><div class="sp-head"><div><span class="sp-kick">${esc(c.kick)}</span><h3>${esc(c.head)}</h3></div><a class="sp-cta" href="${c.cta.href}">${esc(c.cta.label)} →</a></div><div class="sp-body">${c.body}</div><div class="sp-note">${c.note || ''}</div></div>`).join('');
  const tabs = [...rail.children], panels = [...view.children], reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cur = -1, auto = !reduce && chs.length > 1;
  const syncPb = () => { const b = stage.querySelector('.stage-pause'); if (b) { b.textContent = auto ? '❚❚ Pause' : '▶ Autoplay'; b.setAttribute('aria-label', auto ? 'Pause automatic channel changes' : 'Resume automatic channel changes'); } };
  function show(i) {
    if (cur === i) return;
    if (cur >= 0) { panels[cur].hidden = true; tabs[cur].setAttribute('aria-selected', 'false'); tabs[cur].tabIndex = -1; chs[cur].onHide && chs[cur].onHide(panels[cur]); }
    cur = i; panels[i].hidden = false; tabs[i].setAttribute('aria-selected', 'true'); tabs[i].tabIndex = 0; chs[i].onShow && chs[i].onShow(panels[i]); if (window.NightFX) NightFX.play(panels[i]);
    stage.classList.remove('auto'); void stage.offsetWidth; if (auto) stage.classList.add('auto');
  }
  tabs.forEach((t, i) => { t.onclick = () => { auto = false; syncPb(); stage.classList.remove('auto'); show(i); };
    t.onkeydown = e => { const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!d) return; e.preventDefault(); const n = (cur + d + chs.length) % chs.length; auto = false; syncPb(); stage.classList.remove('auto'); show(n); tabs[n].focus(); }; });
  rail.addEventListener('animationend', e => { if (e.animationName === 'railFill' && auto) show((cur + 1) % chs.length); });
  ['mouseenter', 'focusin'].forEach(ev => stage.addEventListener(ev, () => stage.classList.add('hold')));
  ['mouseleave', 'focusout'].forEach(ev => stage.addEventListener(ev, () => stage.classList.remove('hold')));
  if (auto) {
    const pb = document.createElement('button'); pb.type = 'button'; pb.className = 'stage-pause'; pb.textContent = '❚❚ Pause'; pb.setAttribute('aria-label', 'Pause automatic channel changes');
    pb.onclick = () => { auto = !auto; pb.textContent = auto ? '❚❚ Pause' : '▶ Autoplay'; pb.setAttribute('aria-label', auto ? 'Pause automatic channel changes' : 'Resume automatic channel changes'); stage.classList.remove('auto'); void stage.offsetWidth; if (auto) stage.classList.add('auto'); };
    stage.appendChild(pb);
  }
  // live refresh: swap a window's contents in place (not the Replay), flag map groups whose leader changed, replay the motion if it's on screen
  STAGE = { update(next) {
    next.forEach(nc => { const i = chs.findIndex(c => c.id === nc.id); if (i < 0 || nc.id === 'replay') return;
      const p = panels[i], oldFill = [...p.querySelectorAll('.mpv-svg path')].map(x => x.dataset.fill);
      chs[i] = nc; p.querySelector('.sp-kick').textContent = nc.kick; p.querySelector('h3').textContent = nc.head; p.querySelector('.sp-body').innerHTML = nc.body; p.querySelector('.sp-note').innerHTML = nc.note || '';
      tabs[i].querySelector('b').textContent = nc.title; tabs[i].querySelector('small').textContent = nc.sub;
      if (oldFill.length) p.querySelectorAll('.mpv-svg path').forEach((x, k) => { if (oldFill[k] && oldFill[k] !== x.dataset.fill) x.dataset.chg = '1'; });
      if (cur === i) { nc.onShow && nc.onShow(p); if (window.NightFX) NightFX.play(p); } }); } };
  show(0);
}

async function renderDeskStrip(arts) {
  const list = OVR_getArticles(arts.articles || []).filter(a => a.published).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3); if (!list.length) return;
  document.getElementById('deskGrid').innerHTML = list.map(a => `<a class="strip-item" href="article?id=${encodeURIComponent(a.id)}"><span class="k">${esc(a.date || '')}${a.author ? ' · ' + esc(a.author) : ''}</span><h3>${esc(a.title)}</h3>${a.byline ? `<p>${esc(a.byline)}</p>` : ''}</a>`).join('');
  document.getElementById('deskStrip').hidden = false; wireAdd('Desk', list[0].title, `article?id=${encodeURIComponent(list[0].id)}`);
}

const ok = p => p.catch(e => { console.warn('stage channel failed', e); return null; });
async function nightPanels({ N, registry, geo, elections, pm }) {
  const maps = N.night.flatMap(b => b.races.filter(r => r.votes > 0).map(r => ({ e: b.e, race: r.groups, short: b.short }))).slice(0, 2);
  return (await Promise.all([ok(chCalls(N, registry)), ok(chResults(N, registry, pm)), ok(chOdds(N, registry, pm, geo, elections)), ...maps.map(m => ok(chMap(registry, elections, geo, m)))])).filter(Boolean);
}
const nightSig = N => JSON.stringify(N.night.map(b => [b.id, b.reporting, b.turnout, b.races.map(r => [r.totals, r.callId, r.groups])]));

/** Live refresh while an election is on: re-read the results every minute (?refresh=SECONDS to test), animate what moved, and pop the alert for a brand-new call. */
function startNightRefresh(ctx, seconds) {
  let busy = false, sig = nightSig(NIGHT);
  setInterval(async () => {
    if (document.hidden || busy) return; busy = true;
    try {
      const bust = '?t=' + Date.now();
      const [hand, bt] = await Promise.all([J('data/tsrelects-results.json' + bust), J('data/ballottsr/results.json' + bust).catch(() => ({ elections: [] }))]);
      const elections = EN_merge(hand, bt), N = EN_build({ elections, registry: ctx.registry, cfg: ctx.cfg, demo: ctx.demo });
      if (!N.night.length) return;
      if (!NIGHT.night.length) { location.reload(); return; }                    // the count has just started: rebuild the page in election-night mode
      const next = nightSig(N); if (next === sig) return; sig = next;
      const known = new Set(NIGHT.calls.map(c => c.id)), fresh = N.calls.filter(c => c.fresh && !known.has(c.id));
      NIGHT = N; CA_setCalls(N.calls);
      STAGE.update(await nightPanels({ N, registry: ctx.registry, geo: ctx.geo, elections, pm: ctx.pm }));
      WIRECTL.replace(EN_wireItems(N.night, ctx.registry, ctx.pm).concat(ODDS_WIRE), fresh[0] && fresh[0].id);
      fresh.forEach(c => CA_push(c));
    } catch (e) { console.warn('live refresh failed', e); } finally { busy = false; }
  }, seconds * 1000);
}

async function renderStage() {
  const [cfgBase, registry, pidx, tl, arts, hand, geo, bt] = await Promise.all([J('data/site-config.json'), J('data/registries.json'), J('data/polls-index.json'), J('data/timelines/index.json').catch(() => ({ timelines: [] })), J('data/articles.json').catch(() => ({ articles: [] })), J('data/tsrelects-results.json'), J('data/groups.geojson'), J('data/ballottsr/results.json').catch(() => ({ elections: [] }))]);
  const cfg = OVR_getSiteConfig(cfgBase), live = cfg.mode === 'active' && SITE_activeList(cfg).length, qs = new URLSearchParams(location.search);
  const demo = qs.get('demo') === 'night';   // preview election night off-cycle: treats the newest election as live, never touches the "seen" memory
  const elections = EN_merge(hand, bt);
  NIGHT = EN_build({ elections, registry, cfg, demo });
  try { CA_init({ calls: NIGHT.calls, base: './', demo }); } catch (e) { console.warn('call alert failed', e); }   // first visit after a call goes up: the call graphic
  const night = NIGHT.night.length > 0, pm = {};
  let chs;
  if (night) {
    // results and calls take the polling windows' place while an election is on (or just finished)
    await Promise.all(NIGHT.night.map(b => J(`data/elections/${b.id}.json`).then(f => { pm[b.id] = f; }).catch(() => {})));
    chs = [...await nightPanels({ N: NIGHT, registry, geo, elections, pm }), await ok(chReplay(tl))].filter(Boolean);
    EN_wireItems(NIGHT.night, registry, pm).concat(ODDS_WIRE).forEach(w => wireAdd(w.tag, w.text, w.href, w));
  } else {
    const got = await Promise.all([ok(chReplay(tl)), ok(chForecast(cfg, registry, pidx)), ok(chMap(registry, elections, geo)), ok(chRatings()), ok(chApproval(registry))]);
    chs = got.filter(Boolean);
    if (live) chs.sort((a, b) => (b.id === 'forecast') - (a.id === 'forecast'));          // election on, nothing counted yet: the forecast leads
  }
  await ok(renderDeskStrip(arts));
  if (!live && !night) wireAdd('Status', `${cfg.offCycle.headline} · ${cfg.offCycle.text}`, 'elects/');
  buildStage(chs); startWire(night);   // the Wire runs through election night too, carrying calls and results under the red banner
  if (live || night) startNightRefresh({ registry, geo, cfg, pm, demo }, Math.max(3, +qs.get('refresh') || 60));
}
function loadFail(el, what, retry) {
  el.innerHTML = `<div class="load-err">Couldn’t load ${what}. Check your connection and <button type="button">try again</button></div>`;
  el.querySelector('button').onclick = retry;
}
function runStage() { renderStage().catch(e => { console.warn(e); loadFail(document.getElementById('stageView'), 'the live windows', runStage); }); }
runStage();


async function renderHub() {
  const cfgBase = await fetch('data/site-config.json').then(r => r.json());
  const cfg = OVR_getSiteConfig(cfgBase);
  const registry = await fetch('data/registries.json').then(r => r.json());

  renderHubButtons(cfg);

  const hub = document.getElementById('rcpHub');
  if (cfg.mode === 'active' && SITE_activeList(cfg).length) {
    await renderActiveHub(hub, cfg, registry);
  } else {
    await renderOffCycleHub(hub, registry);
  }
}

function renderHubButtons(cfg) {
  const wrap = document.getElementById('hubButtons');
  const electsActive = cfg.mode === 'active';
  const electsLink = electsActive ? SITE_electsLink(cfg, '') : 'elects/';
  const electsSub = electsActive ? 'Live results, right now →' : 'Browse race history & results →';
  let html = `
      <a class="hub-btn elects" href="${electsLink}">
        <img class="hub-btn-wordmark" src="assets/img/brand/tsr-elects-full-logo-white.png" alt="TSR Elects">
        <div class="hub-btn-sub">${electsSub}</div>
      </a>`;
  html += `
      <a class="hub-btn ddtsr" href="ddtsr">
        <img class="hub-btn-wordmark" src="assets/img/brand/ddtsr-full-logo.png" alt="Decision Desk TSR">
        <div class="hub-btn-sub">BaseCalc · ProbCalc · Race Calls →</div>
      </a>
      <a class="hub-btn spin" href="polls">
        <img class="hub-btn-wordmark" src="assets/img/brand/spinner-insights-lockup.png" alt="Spinner Insights">
        <div class="hub-btn-sub">Our polling →</div>
      </a>`;
  wrap.innerHTML = html;
}

async function renderActiveHub(hub, cfg, registry) {
  const list = SITE_activeList(cfg);
  const many = list.length > 1;
  const today = todayUTCString();
  const files = await Promise.all(list.map(e => fetch(`data/elections/${e.pollsId}.json`).then(r => r.json()).then(f => ({ e, f }))));
  hub.innerHTML = `
    <h2 class="section-title">On the Radar</h2>
    <p class="hub-note">Live composite polling average (all pollsters) for ${many ? 'each of the ' + list.length + ' current races' : 'the current race'}.
      Full breakdown on <a href="ddtsr#probcalc">DDTSR's BaseCalc &amp; ProbCalc</a>.</p>
    ${files.map(({ e }, i) => `<div class="tk-card" id="tkRace${i}"${i ? ' style="margin-top:18px"' : ''}></div>`).join('')}`;
  files.forEach(({ e, f }, i) => {
    // As-of today, not the (often still-future) election date -- matches ddtsr.html's calcLoad.
    const asOfDate = f.electionDate && f.electionDate < today ? f.electionDate : today;
    TK_renderRace(document.getElementById('tkRace' + i), {
      title: f.title, polls: f.polls, ids: BaseCalc_currentCandidates(f.polls, f.candidateIds), registry, asOf: asOfDate,
      opts: { anticipatedTurnout: f.anticipatedTurnout }, href: `ddtsr?election=${e.pollsId}#probcalc`
    });
  });
}

function todayUTCString() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
}

function TSR_approvalDisplayName(entry) {
  // Some entries (currently the Elections Secretary) get a role title shown
  // in place of their handle everywhere approval data is displayed -- the
  // underlying `name` (real username, used for the photo lookup and the
  // admin panel) is untouched, this only swaps what's rendered.
  return (entry && entry.role) || (entry && entry.name) || '';
}

function renderPartyDonut(container, registry, partyPollsFile, asOf) {
  const partyIds = Object.keys(registry.parties || {}).filter(pid => SITE_partyActive(registry.parties[pid], asOf));
  const partyRegistry = { candidates: {} };
  partyIds.forEach(pid => {
    const p = registry.parties[pid];
    partyRegistry.candidates[pid] = { name: p.shortName || p.name, color: p.color };
  });
  if (!partyPollsFile.polls.length) {
    container.innerHTML = '<div class="small-muted" style="padding:16px;">No party support polling logged yet.</div>';
    return;
  }
  const agg = BaseCalc_aggregate(partyPollsFile.polls, partyIds, asOf, {});
  RCPDonut_fromAggregate(container, agg, partyRegistry, 'Generic Ballot', 'party-support');
}

async function renderOffCycleHub(hub, registry) {
  const [approvalDataBase, partyPollsBase] = await Promise.all([
    fetch('data/approval-polls.json').then(r => r.json()).catch(() => ({ moderators: {}, questions: {} })),
    fetch('data/party-polls.json').then(r => r.json()).catch(() => ({ polls: [] }))
  ]);
  const approvalData = OVR_getApprovalData(approvalDataBase);
  const partyPollsFile = OVR_getPartyPolls(partyPollsBase);
  const modKeys = Object.keys(approvalData.moderators || {})
    .filter(k => (approvalData.moderators[k].status || 'current') !== 'former');
  const formerKeys = Object.keys(approvalData.moderators || {})
    .filter(k => (approvalData.moderators[k].status || 'current') === 'former' && approvalData.moderators[k].polls.length);
  const questionKeys = Object.keys(approvalData.questions || {}).filter(k => !approvalData.questions[k].closed);
  const asOf = todayUTCString();

  if (modKeys.length > 0) {
    hub.innerHTML = `<h2 class="section-title">Moderator Approval</h2>
      <p class="hub-note">ProbCalc-weighted job approval as of today (UTC). Net approval is Approve minus Disapprove. Click a moderator for their full polling history.</p>
      <div class="tk-card" id="tkApproval"></div>
      ${formerKeys.length ? `<details class="tk-former"><summary>Former moderators <small>${formerKeys.length} · final approval at end of term</small></summary><div class="tk-card" id="tkFormer"></div></details>` : ''}
      <h2 class="section-title" style="margin-top:34px;">Community Track Record</h2>
      <p class="hub-note">Off-cycle sentiment questions, tracked the same way as moderator approval. Click any question for its full polling history.</p>
      <div id="tkQuestions"></div>
      <h2 class="section-title" style="margin-top:34px;">Party Support</h2>
      <p class="hub-note">Generic-ballot party ID, pooled across every tracked party. See the full breakdown on <a href="party-support">Party Support</a>.</p>
      <div class="tk-card" id="tkParties"></div>`;
    const palette = ['#e5484d', '#3b82f6', '#22b573', '#f2a900', '#a678e8', '#ec5f9a', '#14b8c4', '#8f9296'];
    TK_renderApproval(document.getElementById('tkApproval'), {
      asOf, registry,
      mods: modKeys.map(k => { const e = approvalData.moderators[k]; return { key: k, name: TSR_approvalDisplayName(e), photo: photoOf(registry, e.candidateKey || k), polls: e.polls, seat: e.terms ? e.seat : '', carryOver: e.carryOver, pending: e.pending, asOf: e.frozenAsOf || undefined }; }).filter(m => m.polls.length),
      colorFor: (k, i) => { const c = registry.candidates && registry.candidates[k] && registry.candidates[k].color; return c || palette[i % palette.length]; }
    });
    if (formerKeys.length) {
      const lastOf = k => approvalData.moderators[k].polls.reduce((x, p) => p.date > x ? p.date : x, '');
      const endOf = k => approvalData.moderators[k].termEnd || lastOf(k);
      TK_renderApproval(document.getElementById('tkFormer'), {
        asOf: formerKeys.map(endOf).sort().pop(), registry, frozen: true,
        mods: formerKeys.map(k => ({ key: k, name: TSR_approvalDisplayName(approvalData.moderators[k]), photo: photoOf(registry, approvalData.moderators[k].candidateKey || k), asOf: endOf(k),
          polls: approvalData.moderators[k].polls.filter(p => p.date <= endOf(k)) })),
        colorFor: (k, i) => { const c = registry.candidates && registry.candidates[k] && registry.candidates[k].color; return c || palette[i % palette.length]; }
      });
    }
    TK_renderQuestions(document.getElementById('tkQuestions'), {
      asOf, questions: questionKeys.map(k => Object.assign({ key: k }, approvalData.questions[k]))
    });
    const parties = {}; Object.keys(registry.parties || {}).forEach(pid => { parties[pid] = registry.parties[pid]; });
    TK_renderParties(document.getElementById('tkParties'), { asOf, polls: partyPollsFile.polls, parties, href: 'party-support' });
    return;
  }


  const idx = await fetch('data/polls-index.json').then(r => r.json());
  hub.innerHTML = `<h2 class="section-title">Recent Polling Snapshots</h2>
    <p class="hub-note">No moderator approval polling has been logged yet, so this scrolls through
      the final composite average for each recently-tracked race instead. Once approval polling
      exists (see <code>data/approval-polls.json</code>), this becomes an approval-rating carousel.
      Click any race for its full DDTSR breakdown.</p>
    <div class="hub-scroll" id="hubScroll"></div>`;
  const scroll = document.getElementById('hubScroll');
  // fetch every election file in parallel, then render in order
  const electionFiles = await Promise.all(idx.elections.map(e => fetch(`data/elections/${e.id}.json`).then(r => r.json())));
  for (const [i, entry] of idx.elections.entries()) {
    const election = electionFiles[i], pollsFile = structuredClone(election);
    if (!pollsFile.polls.length) continue;
    const currentIds = BaseCalc_currentCandidates(pollsFile.polls, election.candidateIds);
    const entryAsOfDate = election.electionDate && election.electionDate < asOf ? election.electionDate : asOf;
    const agg = BaseCalc_aggregate(pollsFile.polls, currentIds, entryAsOfDate, { anticipatedTurnout: election.anticipatedTurnout });
    const card = document.createElement('div');
    scroll.appendChild(card);
    RCPDonut_fromAggregate(card, agg, registry, election.title, `ddtsr?election=${entry.id}#probcalc`);
  }
}

function runHub() { renderHub().catch(e => { console.warn(e); loadFail(document.getElementById('rcpHub'), 'the trackers', runHub); }); }
runHub();
