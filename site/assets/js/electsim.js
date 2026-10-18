/**
 * ElectSim — engine for the Custom Election Simulator (elects/simulate).
 * Candidates whose registry ids differ only by a trailing number (nzb, nzb1) are ONE candidate.
 * Strength comes from past TSR Elects results (recency-weighted, shrunk toward the candidate's party),
 * turnout from historical votes / electorate, runoff when nobody tops 50%.
 */
const ES_canon = id => String(id).toLowerCase().replace(/\d+$/, '');
function ES_rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const ES_norm = r => { const u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function ES_binom(n, p, r) { if (n <= 0 || p <= 0) return 0; if (p >= 1) return n; let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; }
function ES_gamma(a, r) { if (a < 1) return ES_gamma(a + 1, r) * Math.pow(r() || 1e-9, 1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = ES_norm(r); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = r(); if (Math.log(u || 1e-9) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v; } }
const ES_sig = x => 1 / (1 + Math.exp(-x));

/** Learn strengths, group affinities and turnout from tsrelects-results.json. */
function ES_learn(results, registry, geojson, today = new Date(), plain = []) {
  const R = registry.candidates, obsC = {}, obsP = {}, groupV = {}, rates = [], ratios = [], elects = [];
  const wOf = d => Math.pow(0.5, Math.max(0, (today - new Date(d)) / 2.6e9 / 6)); // half-life 6 months
  results.forEach(e => {
    const w = wOf(e.date); let firstTotal = 0;
    Object.entries(e).forEach(([rk, rd]) => {
      if (!rd || !rd.races || /runoff|final/i.test(rk)) return;
      Object.values(rd.races).forEach(race => {
        const tot = {}, grp = {};
        Object.entries(race).forEach(([g, vs]) => Object.entries(vs).forEach(([c, v]) => { const k = ES_canon(c); tot[k] = (tot[k] || 0) + v; (grp[k] = grp[k] || {})[g] = (grp[k][g] || 0) + v; }));
        const T = Object.values(tot).reduce((a, b) => a + b, 0), n = Object.keys(tot).length; if (T < 6 || n < 2) return;
        firstTotal = Math.max(firstTotal, T);
        Object.keys(tot).forEach(k => {
          const x = Math.log((tot[k] / T + 0.02) * n), idv = Object.keys(race[Object.keys(race)[0]] || {}).find(c => ES_canon(c) === k) || k;
          (obsC[k] = obsC[k] || []).push({ w, x, share: tot[k] / T });
          const p = (R[idv] || {}).party || 'ua'; (obsP[p] = obsP[p] || []).push({ w, x });
          const gv = groupV[k] = groupV[k] || { v: {}, T: {}, S: [] }; gv.S.push([tot[k], T]);
          Object.keys(race).forEach(g => { const gt = Object.values(race[g]).reduce((a, b) => a + b, 0); gv.T[g] = (gv.T[g] || 0) + gt; gv.v[g] = (gv.v[g] || 0) + (grp[k][g] || 0); });
        });
      });
    });
    if (firstTotal) elects.push({ w, votes: firstTotal, turnout: e.turnout, date: e.date });
    const ro = e.runoff_round && Object.values(e.runoff_round.races || {})[0];
    if (ro && firstTotal) { const t = Object.values(ro).reduce((a, g) => a + Object.values(g).reduce((x, y) => x + y, 0), 0); if (t) ratios.push(t / firstTotal); }
  });
  // Older elections logged without groups: statewide totals only (no group lean, no turnout %).
  plain.forEach(e => {
    const w = wOf(e.date), tot = {}, pty = {};
    e.first.forEach(x => { const k = ES_canon(x.c); tot[k] = (tot[k] || 0) + x.v; pty[k] = x.p || 'ua'; });
    const T = Object.values(tot).reduce((a, b) => a + b, 0), n = Object.keys(tot).length;
    if (T >= 6 && n >= 2) {
      Object.keys(tot).forEach(k => { const x = Math.log((tot[k] / T + 0.02) * n); (obsC[k] = obsC[k] || []).push({ w, x, share: tot[k] / T }); (obsP[pty[k]] = obsP[pty[k]] || []).push({ w, x }); });
      elects.push({ w, votes: T, date: e.date });
      if (e.runoff) { const t = e.runoff.reduce((a, x) => a + x.v, 0); if (t) ratios.push(t / T); }
    }
  });
  const wm = (a, f) => a.reduce((s, o) => s + o.w * f(o), 0) / a.reduce((s, o) => s + o.w, 0);
  const party = {}; Object.entries(obsP).forEach(([p, a]) => { party[p] = a.reduce((s, o) => s + o.w * o.x, 0) / (a.reduce((s, o) => s + o.w, 0) + 2); });
  // Electorate size from the NEWEST election only: turnout % was redefined (older % were estimates), raw vote counts are unchanged.
  const last = elects.filter(e => e.turnout > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
  const E = last ? Math.round(last.votes / (last.turnout / 100)) : 1450;
  const rt = elects.map(e => ({ w: e.w, r: Math.min(.95, e.votes / E) })), mu = wm(rt, o => o.r);
  const sd = Math.max(0.15 * mu, Math.sqrt(wm(rt, o => (o.r - mu) ** 2))); // spread in raw-vote terms, scale-free
  const weights = GC_weights(geojson), ids = Object.keys(weights);
  return { obsC, obsP, party, groupV, E, mu, sd, weights, rho: ratios.length ? ratios.reduce((a, b) => a + b) / ratios.length : 0.97, geoIds: ids };
}

/** score = shrunk blend of the candidate's own record and their (chosen) party's record. */
function ES_score(L, canon, party) {
  const a = L.obsC[canon] || [], pw = L.party[party] ?? L.party.ua ?? 0, k = 1.5;
  const sw = a.reduce((s, o) => s + o.w, 0);
  return { score: (a.reduce((s, o) => s + o.w * o.x, 0) + k * pw) / (sw + k), n: a.length, sw };
}
function ES_affinity(L, canon, g) {
  const gv = L.groupV[canon]; if (!gv || !gv.T[g]) return 0;
  const S = Math.max(0.01, gv.S.reduce((s, x) => s + x[0], 0) / gv.S.reduce((s, x) => s + x[1], 0)); // floor: candidates with 0 past votes used to give NaN
  const a = 0.6 * Math.log(((gv.v[g] + 6 * S) / (gv.T[g] + 6)) / S);
  return isFinite(a) ? Math.max(-.8, Math.min(.8, a)) : 0;
}
/** Turnout model: Beta(rate) around the recency-weighted historical mean. scenario: -1 low, 0 typical, 1 high. */
function ES_turnoutParams(L, scenario = 0, E = L.E) {
  const mu = Math.min(.9, Math.max(L.mu * .3, L.mu + scenario * L.sd)), k = mu * (1 - mu) / (L.sd ** 2) - 1;
  return { mu, a: mu * k, b: (1 - mu) * k, E, sd: L.sd };
}
function ES_split(total, w, ids) { const raw = ids.map(g => w[g] * total), fl = raw.map(Math.floor); let rem = total - fl.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rem-- > 0) fl[i]++; }); return Object.fromEntries(ids.map((g, i) => [g, fl[i]])); }

/** Calibration knobs (fit so simulated 1v1 margins match TSR's historical two-way races). */
const ES_TUNE = { scale: 0.5, shock: 0.2, shockLow: 0.2, grp: 0.15, aff: 0.5 };

/** One full election. cands: [{id (registry id), canon, party}] -> {first, runoff?, turnout, rate} */
function ES_simulate(L, cands, T, r) {
  const gids = L.geoIds, el = ES_split(T.E, L.weights, gids);
  const rate = (() => { const x = ES_gamma(T.a, r), y = ES_gamma(T.b, r); return x / (x + y); })();
  const sc = cands.map(c => { const s = ES_score(L, c.canon, c.party); c.s = s.score; return ES_TUNE.scale * s.score + ES_norm(r) * (ES_TUNE.shock + ES_TUNE.shockLow / (1 + s.sw)); });
  const first = {}, flat = {};
  gids.forEach(g => {
    const th = Math.min(.95, Math.max(1e-4, rate * Math.exp(0.1 * ES_norm(r)))), n = ES_binom(el[g], th, r);
    const lg = cands.map((c, i) => sc[i] + ES_TUNE.aff * ES_affinity(L, c.canon, g) + ES_TUNE.grp * ES_norm(r)), m = Math.max(...lg), ex = lg.map(x => Math.exp(x - m)), s = ex.reduce((a, b) => a + b);
    const v = {}; cands.forEach(c => v[c.id] = 0); const cum = []; ex.reduce((a, x, i) => (cum[i] = a + x / s, cum[i]), 0);
    for (let i = 0; i < n; i++) { const u = r(); let j = cum.findIndex(c => u <= c); if (j < 0) j = cands.length - 1; v[cands[j].id]++; }
    first[g] = v;
  });
  const tot = id => gids.reduce((a, g) => a + first[g][id], 0), all = gids.reduce((a, g) => a + cands.reduce((s, c) => s + first[g][c.id], 0), 0);
  const rank = [...cands].sort((a, b) => tot(b.id) - tot(a.id) || r() - .5);
  const out = { first, rank: rank.map(c => c.id), turnout: all / T.E, votes: all, el };
  if (all && tot(rank[0].id) / all > .5) { out.winner = rank[0].id; out.outright = true; return out; }
  const A = rank[0], B = rank[1], rho = Math.min(1, Math.max(.85, L.rho + .03 * ES_norm(r))); out.runoff = {};
  gids.forEach(g => {
    let a = 0, b = 0; const fa = first[g][A.id], fb = first[g][B.id];
    a += ES_binom(fa, rho, r); b += ES_binom(fb, rho, r);
    cands.filter(c => c !== A && c !== B).forEach(c => { const n = ES_binom(first[g][c.id], .85 * rho, r);
      const q = ES_sig(1.2 * ((c.party !== 'ua' && c.party === A.party) - (c.party !== 'ua' && c.party === B.party)) + .5 * (A.s - B.s) + .35 * ES_norm(r)), na = ES_binom(n, q, r); a += na; b += n - na; });
    out.runoff[g] = { [A.id]: a, [B.id]: b };
  });
  const ta = gids.reduce((s, g) => s + out.runoff[g][A.id], 0), tb = gids.reduce((s, g) => s + out.runoff[g][B.id], 0);
  out.winner = ta === tb ? (r() < .5 ? A.id : B.id) : ta > tb ? A.id : B.id; return out;
}
function ES_odds(L, cands, T, n = 2000, seed = 11) {
  const r = ES_rng(seed), win = {}, sh = {}; let ro = 0, tv = [];
  cands.forEach(c => { win[c.id] = 0; sh[c.id] = 0; });
  for (let i = 0; i < n; i++) { const o = ES_simulate(L, cands, T, r); win[o.winner]++; if (o.runoff) ro++; tv.push(o.turnout);
    cands.forEach(c => sh[c.id] += gsum(o.first, c.id) / Math.max(1, o.votes)); }
  tv.sort((a, b) => a - b);
  const out = { win: {}, share: {}, runoff: ro / n, turnout: { p10: tv[Math.floor(n * .1)], p50: tv[Math.floor(n * .5)], p90: tv[Math.floor(n * .9)] } };
  cands.forEach(c => { out.win[c.id] = win[c.id] / n; out.share[c.id] = sh[c.id] / n; }); return out;
}
const gsum = (f, id) => Object.values(f).reduce((a, g) => a + (g[id] || 0), 0);
if (typeof window !== 'undefined') Object.assign(window, { ES_canon, ES_rng, ES_learn, ES_score, ES_turnoutParams, ES_simulate, ES_odds });
