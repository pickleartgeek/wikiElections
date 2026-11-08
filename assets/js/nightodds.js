/**
 * NightOdds — "chance to lead" for a race while the count is still coming in.
 *
 * The idea: start from the pre-election GROUP forecast (GroupCalc: poll-pooled, raked group-by-group lean + the statewide uncertainty),
 * then let the ballots that are actually in update it, group by group.
 *
 *   prior   GC_model(polls)               each group's expected vote split, one shared statewide swing, group-level noise (Dirichlet)
 *   learn   importance-weight the swing   a swing that explains the counted ballots (Dirichlet-multinomial likelihood over the 9 groups) keeps more weight,
 *                                         so groups that haven't reported yet follow what the reporting ones say
 *   finish  posterior + remaining votes   each group's posterior split is Dirichlet(prior alpha + counted); the ballots still to come are drawn from the
 *                                         historical total (TSR races are tiny and very regular: ~16-22 ballots) and spread over the groups that
 *                                         are furthest behind their usual share of the vote
 *   read    first place, majority, runoff, projected share, tipping-point group
 *
 *   NO_prepare({ pf, geo, elections, date, keys })  -> ctx   (everything that does not depend on the count)
 *   NO_counts(groups, ctx)                          -> counts { group: { id: votes } } in the ctx candidate space
 *   NO_run(ctx, counts, opts)                       -> { lead, majority, top2, runoff, share, tipping, N, expectedTotal, ess, status }
 *   NO_label(p, N)                                  -> { key, text } TV-style wording for a probability
 *   NO_historyFromTimeline(ctx, timeline, sims)     -> [{ k, lead }] the odds after every ballot (for the sparkline)
 *
 * Tuned against the nine past elections that have ballot-by-ballot timelines (tools/backtest-live.js).
 * It models FIRST-CHOICE votes: ranked-choice / STAR transfers are not simulated, so with 3+ candidates "lead" means the first-choice count.
 */
const NO_TUNE = { sharpen: 1.5, histDecay: 0.7, sims: 4000, concMult: 10, swingMult: 30, minAlpha: 0.05, tfSdMin: 1, tfSdFrac: 0.05, vapBlend: 0.2, minN: 3, priorFloor: 0.02 };
const NO_G = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function NO_lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (let j = 0; j < 6; j++) s += c[j] / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
const NO_sum = o => Object.values(o).reduce((a, b) => a + b, 0);

/** What past TSR races tell us about the size of the count: final ballots and each group's usual share of them. */
function NO_hist(elections, date, vap) {
  const Ts = [], gt = {}; let all = 0, wsum = 0, wmean = 0;
  (elections || []).filter(e => e && e.date && e.date < date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).forEach(e => {
    try {
      const race = Object.values(TSR_getRaces(TSR_getRoundData(e, 'first_round')))[0]; if (!race) return;
      const T = Object.values(race).reduce((s, v) => s + NO_sum(v), 0); if (T < 6) return;
      const w = Math.pow(NO_TUNE.histDecay, Ts.length); Ts.push(T); wsum += w; wmean += w * T; Object.entries(race).forEach(([g, v]) => { const t = NO_sum(v); gt[g] = (gt[g] || 0) + w * t; all += w * t; });
    } catch (e2) { /* skip */ }
  });
  const mean = wsum ? wmean / wsum : 20, sdS = Ts.length > 2 ? Math.sqrt(Ts.slice(0, 5).reduce((s, x) => s + (x - mean) ** 2, 0) / Math.min(5, Ts.length)) : 0;
  const wv = {}; let z = 0; NO_G.forEach(g => { wv[g] = (1 - NO_TUNE.vapBlend) * (all ? (gt[g] || 0) / all : vap[g]) + NO_TUNE.vapBlend * vap[g]; z += wv[g]; }); NO_G.forEach(g => { wv[g] /= z; });
  return { mean, sd: Math.max(NO_TUNE.tfSdMin, NO_TUNE.tfSdFrac * mean, sdS), groupShare: wv, n: Ts.length };
}

/** Everything that doesn't depend on the count: candidate space, group prior, history. `keys` = candidate ids seen in the results. */
function NO_prepare({ pf, geo, elections, date, keys = [] }) {
  const vap = GC_weights(geo), canon = id => String(id).toLowerCase().replace(/\d+$/, ''), polls = pf && pf.polls || [];
  let ids = polls.length ? BaseCalc_currentCandidates(polls, pf.candidateIds) : [];
  const toId = {}; ids.forEach(i => { toId[canon(i)] = i; });
  keys.forEach(k => { if (k !== 'wi' && !toId[canon(k)]) { toId[canon(k)] = k; ids = ids.concat(k); } });
  keys.forEach(k => { if (!toId[canon(k)]) toId[canon(k)] = k; });
  let M;
  if (polls.length && ids.length) M = GC_model(polls, ids, pf.electionDate || date, vap, { anticipatedTurnout: pf.anticipatedTurnout });
  else { const s = {}, mu = {}, info = {}; ids.forEach(i => { s[i] = 1 / (ids.length || 1); }); NO_G.forEach(g => { mu[g] = Object.assign({}, s); info[g] = { conc: 3 }; }); M = { s, mu, info, cState: 6 }; }
  return { ids, toId, canon, M, hist: NO_hist(elections, date, vap), vap, hasPolls: polls.length > 0 };
}

function NO_counts(groups, ctx) {
  const c = {}; NO_G.forEach(g => { c[g] = {}; });
  Object.entries(groups || {}).forEach(([g, vs]) => { if (!c[g]) return; Object.entries(vs).forEach(([k, v]) => { if (k === 'wi') return; const id = ctx.toId[ctx.canon(k)] || k; c[g][id] = (c[g][id] || 0) + v; }); });
  return c;
}

function NO_wquant(vals, ws, q) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]), tot = ws.reduce((a, b) => a + b, 0) || 1; let acc = 0;
  for (const i of idx) { acc += ws[i] / tot; if (acc >= q) return vals[i]; } return vals[idx[idx.length - 1]];
}

function NO_run(ctx, counts, opts = {}) {
  const T = Object.assign({}, NO_TUNE, opts), ids = ctx.ids, k = ids.length, M = ctx.M, S = T.sims;
  const nG = {}, nGc = {}; let N = 0; const nTot = ids.map(() => 0);
  NO_G.forEach(g => { nGc[g] = ids.map((i, j) => counts[g] && counts[g][i] || 0); nG[g] = nGc[g].reduce((a, b) => a + b, 0); N += nG[g]; nGc[g].forEach((v, j) => { nTot[j] += v; }); });
  let seed = 2166136261; JSON.stringify([ids, nGc]).split('').forEach(ch => { seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619); });
  const r = ES_rng(seed >>> 0), H = ctx.hist;
  const leadW = ids.map(() => 0), majW = ids.map(() => 0), top2W = ids.map(() => 0), shW = [], runoffW = { v: 0 }, remG = {}, tipG = {}; NO_G.forEach(g => { remG[g] = 0; tipG[g] = 0; });
  const gLeadW = {}, gMajW = {}; NO_G.forEach(g => { gLeadW[g] = ids.map(() => 0); gMajW[g] = 0; });
  const ws = new Float64Array(S), shares = ids.map(() => new Float64Array(S)), lead = new Int16Array(S);
  const logws = new Float64Array(S); let maxLw = -Infinity; const sims = [];
  for (let s = 0; s < S; s++) {
    // one statewide swing shared by every group (prior), as in GroupCalc
    const tg = ids.map((i, j) => ES_gamma(Math.max(T.minAlpha, T.swingMult * M.cState * M.s[i]), r)), tz = tg.reduce((a, b) => a + b, 0) || 1;
    const swing = ids.map((i, j) => M.s[i] > 0 ? tg[j] / tz / M.s[i] : 1);
    let lw = 0; const alpha = {};
    NO_G.forEach(g => {
      const m = ids.map((i, j) => (M.mu[g][i] || 0) * swing[j]), z = m.reduce((a, b) => a + b, 0) || 1, conc = Math.max(2, (M.info[g].conc || 4) * T.concMult);
      alpha[g] = m.map(x => Math.max(T.minAlpha, conc * x / z + T.priorFloor));
      if (nG[g] > 0) { const A = alpha[g].reduce((a, b) => a + b, 0); lw += NO_lgamma(A) - NO_lgamma(A + nG[g]); alpha[g].forEach((a, j) => { lw += NO_lgamma(a + nGc[g][j]) - NO_lgamma(a); }); }
    });
    logws[s] = lw; if (lw > maxLw) maxLw = lw; sims.push(alpha);
  }
  let sw = 0, sw2 = 0;
  for (let s = 0; s < S; s++) { ws[s] = Math.exp(logws[s] - maxLw); sw += ws[s]; sw2 += ws[s] * ws[s]; }
  const ess = sw * sw / (sw2 || 1);
  // total ballots that will have been cast, and which groups still have votes to give
  const wv = H.groupShare;
  for (let s = 0; s < S; s++) {
    const alpha = sims[s], p = {};
    NO_G.forEach(g => { const d = alpha[g].map((a, j) => ES_gamma(a + nGc[g][j], r)), z = d.reduce((a, b) => a + b, 0) || 1; p[g] = d.map(x => x / z); });
    // total ballots: history says ~H.mean; when the % reporting is known, only the unreported share of that is still to come (100% reporting = the count is final)
    let Tf = N; if (!opts.final) { const rep = opts.reporting > 0 ? Math.min(1, opts.reporting) : null, m = rep == null ? H.mean : N + (1 - rep) * H.mean, sd = rep == null ? H.sd : H.sd * (1 - rep);
      Tf = 0; for (let tries = 0; tries < 8 && Tf < N; tries++) Tf = Math.round(m + sd * ES_norm(r)); if (Tf < N) Tf = N + (rep != null && rep >= 1 ? 0 : r() < 0.5 ? 0 : 1); }
    const R = Tf - N, rem = NO_G.map(g => Math.max(0.3, Tf * wv[g] - nG[g])), remZ = rem.reduce((a, b) => a + b, 0), tot = nTot.slice(), addG = {};
    const gTot = {}; NO_G.forEach(g => { addG[g] = 0; gTot[g] = nGc[g].slice(); });
    for (let v = 0; v < R; v++) {
      let u = r() * remZ, gi = 0; while (gi < 8 && u > rem[gi]) { u -= rem[gi]; gi++; } const g = NO_G[gi]; addG[g]++;
      let uc = r(), j = 0; const pg = p[g]; while (j < k - 1 && uc > pg[j]) { uc -= pg[j]; j++; } tot[j]++; gTot[g][j]++;
    }
    const T2 = tot.reduce((a, b) => a + b, 0) || 1; let best = 0, bv = -1, second = -1, sv = -1;
    tot.forEach((v, j) => { shares[j][s] = v / T2; const tb = v + r() * 0.01; if (tb > bv) { second = best; sv = bv; bv = tb; best = j; } else if (tb > sv) { second = j; sv = tb; } });
    lead[s] = best; const w = ws[s];
    leadW[best] += w; top2W[best] += w; if (second >= 0 && k > 1) top2W[second] += w; if (tot[best] / T2 > 0.5) majW[best] += w; else runoffW.v += w;
    NO_G.forEach(g => { let gb = 0, gv = -1; gTot[g].forEach((v, j) => { const tb = v + r() * 0.01; if (tb > gv) { gv = tb; gb = j; } }); gLeadW[g][gb] += w; gMajW[g] += w * (gTot[g][gb] / (gTot[g].reduce((a, b) => a + b, 0) || 1) > 0.5 ? 1 : 0); });
    NO_G.forEach(g => { remG[g] += w * addG[g]; if (k > 1 && addG[g]) { const o = lead[s] === 0 ? 1 : 0, tr = second >= 0 ? second : o; tipG[g] += w * addG[g] * (p[g][tr] - p[g][best]); } });
  }
  const out = { ids, N, final: !!opts.final, expectedTotal: opts.final || opts.reporting >= 1 ? N : opts.reporting > 0 ? N + (1 - opts.reporting) * H.mean : H.mean, ess, sims: S, lead: {}, majority: {}, top2: {}, share: {}, runoff: runoffW.v / sw, remaining: {}, tipping: null, cState: M.cState };
  ids.forEach((id, j) => { out.lead[id] = leadW[j] / sw; out.majority[id] = majW[j] / sw; out.top2[id] = Math.min(1, top2W[j] / sw);
    out.share[id] = { mean: shares[j].reduce((a, v, s) => a + v * ws[s], 0) / sw, lo: NO_wquant(Array.from(shares[j]), Array.from(ws), .1), hi: NO_wquant(Array.from(shares[j]), Array.from(ws), .9) }; });
  NO_G.forEach(g => { out.remaining[g] = remG[g] / sw; });
  const fav = ids.reduce((b, id) => out.lead[id] > out.lead[b] ? id : b, ids[0]);
  const tp = NO_G.map(g => [g, tipG[g] / sw]).sort((a, b) => b[1] - a[1])[0]; if (tp && tp[1] > 0.05) out.tipping = { group: tp[0], expectedVotes: out.remaining[tp[0]], gain: tp[1] };
  out.groups = {}; NO_G.forEach(g => { const lead = {}; ids.forEach((id, j) => { lead[id] = gLeadW[g][j] / sw; }); const top = ids.reduce((b, id) => lead[id] > lead[b] ? id : b, ids[0]);
    out.groups[g] = { counted: nG[g], expected: remG[g] / sw + nG[g], lead, top, p: lead[top], counts: ids.map((id, j) => nGc[g][j]), none: nG[g] === 0 }; });
  const sharp = (o, ks) => { const g = T.sharpen; if (!g || g === 1) return; const z = ks.reduce((a, k) => a + Math.pow(o[k], g), 0) || 1; ks.forEach(k => { o[k] = Math.pow(o[k], g) / z; }); };
  sharp(out.lead, ids); NO_G.forEach(g => sharp(out.groups[g].lead, ids)); NO_G.forEach(g => { const gg = out.groups[g]; gg.top = ids.reduce((b, id) => gg.lead[id] > gg.lead[b] ? id : b, ids[0]); gg.p = gg.lead[gg.top]; });
  out.favorite = fav; out.status = NO_label(out.lead[fav], N); return out;
}


/** Prior from a ready-made group forecast: mu[g][id] = expected split in group g, weights[g] = each group's share of the electorate, total = { mean, sd } of ballots. Candidate ids are used as-is. */
function NO_prepareFrom({ ids, mu, weights, total, conc = 30, cState = 10 }) {
  const s = {}; ids.forEach(i => { s[i] = NO_G.reduce((a, g) => a + (weights[g] || 0) * (mu[g][i] || 0), 0); });
  const z = ids.reduce((a, i) => a + s[i], 0) || 1; ids.forEach(i => { s[i] /= z; });
  const info = {}; NO_G.forEach(g => { info[g] = { conc }; }); const toId = {}; ids.forEach(i => { toId[i] = i; });
  const wz = NO_G.reduce((a, g) => a + (weights[g] || 0), 0) || 1, gs = {}; NO_G.forEach(g => { gs[g] = (weights[g] || 0) / wz; });
  return { ids, toId, canon: x => x, M: { s, mu, info, cState }, hist: { mean: total.mean, sd: Math.max(1, total.sd), groupShare: gs, n: 0 }, vap: gs, hasPolls: false };
}

/** Simulator prior (elects/simulate.html): the simulator's own pre-election expectation per group, built from the same score + group affinity it draws the election from (no shocks). */
function NO_prepareSim({ L, cands, T }) {
  const mu = {};
  NO_G.forEach(g => { const lg = cands.map(c => ES_TUNE.scale * ES_score(L, c.canon, c.party).score + ES_TUNE.aff * ES_affinity(L, c.canon, g)), m = Math.max(...lg), ex = lg.map(x => Math.exp(x - m)), z = ex.reduce((a, b) => a + b);
    mu[g] = {}; cands.forEach((c, i) => { mu[g][c.id] = ex[i] / z; }); });
  return NO_prepareFrom({ ids: cands.map(c => c.id), mu, weights: L.weights, total: { mean: T.mu * T.E, sd: T.sd * T.E } });
}

/** TV wording for a chance. */
function NO_label(p, N) {
  if (N < NO_TUNE.minN) return { key: 'early', text: 'Too early' };
  if (p >= 0.99) return { key: 'call', text: 'Call-ready' }; if (p >= 0.95) return { key: 'vlikely', text: 'Very likely' };
  if (p >= 0.85) return { key: 'likely', text: 'Likely' }; if (p >= 0.65) return { key: 'lean', text: 'Leaning' }; return { key: 'toss', text: 'Toss-up' };
}
/** Per-group chances as plain data: [{ g, top, p, counted, expected, none, lead }] in group order. */
const NO_groupList = o => NO_G.map(g => Object.assign({ g }, o.groups[g]));
/** The by-group meter: one tile per group with the likeliest group winner, its chance, and a stacked bar of every candidate's chance to carry that group. nameOf/colorOf map a candidate id. */
function NO_groupsHTML(o, nameOf, colorOf) {
  const e = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div class="gm"><div class="gm-t">By group <small>chance to carry each group</small></div><div class="gm-grid">${NO_groupList(o).map(x => {
    const rank = o.ids.slice().sort((a, b) => x.lead[b] - x.lead[a]).slice(0, 4);
    return `<div class="gm-tile${x.none ? ' gm-none' : ''}" title="Group ${x.g}: ${x.counted} counted, ~${Math.round(x.expected)} expected${x.none ? ' (no ballots yet: forecast only)' : ''}"><div class="gm-h"><b>Group ${x.g}</b><span>${x.none ? 'forecast' : x.counted + ' in'}</span></div>`
      + `<div class="gm-who" style="--c:${e(colorOf(x.top))}"><i></i><span>${e(nameOf(x.top))}</span><b>${NO_pct(x.p)}%</b></div>`
      + `<div class="gm-bar" aria-hidden="true">${rank.map(id => `<i style="width:${(x.lead[id] * 100).toFixed(1)}%;background:${e(colorOf(id))}"></i>`).join('')}</div></div>`; }).join('')}</div></div>`;
}
const NO_pct = p => p >= 0.995 ? '>99' : p > 0 && p < 0.005 ? '<1' : String(Math.round(p * 100));

/** Odds after every ballot of a timeline (first choice, chronological) from 3 ballots on; used for the sparkline. */
function NO_historyFromTimeline(ctx, timeline, sims = 800) {
  const b = (timeline && timeline.ballots || []).slice().sort((x, y) => x.t.localeCompare(y.t)), out = [], groups = {};
  b.forEach((x, i) => { const g = String(x.g), id = ctx.toId[ctx.canon(x.r[0])] || x.r[0]; (groups[g] = groups[g] || {})[id] = (groups[g][id] || 0) + 1;
    if (i + 1 >= NO_TUNE.minN) { const o = NO_run(ctx, NO_counts(groups, ctx), { sims }); out.push({ k: i + 1, t: x.t, lead: o.lead }); } });
  return out;
}

// ?sharpen=2 on any page overrides the sharpening for testing (1 = raw model, 1.5 = tuned default; >2 is over-confident on past data)
try { const q = new URLSearchParams(location.search).get('sharpen'); if (q != null && +q > 0 && +q <= 6) NO_TUNE.sharpen = +q; } catch (e) { /* not in a browser */ }

if (typeof window !== 'undefined') Object.assign(window, { NO_groupsHTML, NO_groupList, NO_prepareFrom, NO_prepareSim, NO_prepare, NO_counts, NO_run, NO_label, NO_pct, NO_historyFromTimeline, NO_TUNE });
