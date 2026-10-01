/**
 * GroupCalc — engine behind "ProbCalc Group Forecast".
 * Polls may carry  groups: { "1": {sample, shares:{cand:share}}, ... }.
 * Each group is aggregated with BaseCalc, simulated with ProbCalc's
 * Gamma(alpha,1) draws, and groups are combined into a statewide result
 * weighted by each group's voting-age population (data/groups.geojson).
 * Groups with no polling fall back to half-strength statewide alphas.
 * Group alphas use the guide's formula literally (share in PERCENT points),
 * because group samples are tiny; statewide ProbCalc is unchanged.
 */
const GC_GROUPS = ['1','2','3','4','5','6','7','8','9'];

function GC_hasGroups(polls) { return (polls || []).some(p => p.groups && Object.keys(p.groups).length); }

function GC_weights(geojson) {
  const vap = {}; let sum = 0, n = 0;
  geojson.features.forEach(f => { const v = f.properties.TotalVAP; if (v) { vap[String(f.properties.id)] = v; sum += v; n++; } });
  const w = {}; let tot = 0;
  GC_GROUPS.forEach(g => { w[g] = vap[g] || sum / (n || 1) || 1; tot += w[g]; });
  GC_GROUPS.forEach(g => { w[g] /= tot; });
  return w;
}

function GC_groupPolls(polls, g, writeInIds) {
  const wi = (writeInIds || []).filter(Boolean);
  return polls.filter(p => p.groups && p.groups[g] && p.groups[g].shares).map(p => {
    const shares = Object.assign({}, p.groups[g].shares);
    wi.forEach(id => { if (typeof shares[id] === 'number') shares[id] *= 0.55; });
    return { date: p.date, pollster: p.pollster, sample: p.groups[g].sample || 1, shares };
  });
}

function GC_alphas(polls, ids, date, w, opts) {
  const state = BaseCalc_aggregate(polls, ids, date, opts);
  const out = {};
  GC_GROUPS.forEach(g => {
    const gp = GC_groupPolls(polls, g, opts.writeInIds);
    const alphas = {};
    if (gp.length) {
      const agg = BaseCalc_aggregate(gp, ids, date, { anticipatedTurnout: opts.anticipatedTurnout ? opts.anticipatedTurnout * w[g] : 0 });
      ids.forEach(i => { alphas[i] = Math.max(0.01, agg.alphas[i] * 100); });
    } else {
      ids.forEach(i => { alphas[i] = Math.max(0.01, state.alphas[i] * 50); });
    }
    out[g] = { alphas, polls: gp.length, fallback: !gp.length };
  });
  return out;
}

async function GC_run(polls, ids, date, w, opts = {}, sims = 6000) {
  const A = GC_alphas(polls, ids, date, w, opts);
  const gWins = {}, gShare = {}, st = {}, sWins = {}, carried = {};
  GC_GROUPS.forEach(g => { gWins[g] = {}; gShare[g] = {}; ids.forEach(i => { gWins[g][i] = 0; gShare[g][i] = 0; }); });
  ids.forEach(i => { st[i] = new Float32Array(sims); sWins[i] = 0; carried[i] = 0; });

  for (let s = 0; s < sims; s++) {
    const tot = {}; ids.forEach(i => { tot[i] = 0; });
    GC_GROUPS.forEach(g => {
      const d = {}; let sum = 0;
      ids.forEach(i => { d[i] = PC_sampleGamma(A[g].alphas[i]); sum += d[i]; });
      let best = ids[0], bs = -1;
      ids.forEach(i => { const sh = sum > 0 ? d[i] / sum : 0; gShare[g][i] += sh; tot[i] += w[g] * sh; if (sh > bs) { bs = sh; best = i; } });
      gWins[g][best]++; carried[best]++;
    });
    let best = ids[0];
    ids.forEach(i => { st[i][s] = tot[i]; if (tot[i] > tot[best]) best = i; });
    sWins[best]++;
    if (s % 500 === 499) await new Promise(r => setTimeout(r));
  }

  const groups = {};
  GC_GROUPS.forEach(g => {
    groups[g] = { polls: A[g].polls, fallback: A[g].fallback, winProb: {}, meanShare: {} };
    ids.forEach(i => { groups[g].winProb[i] = gWins[g][i] / sims; groups[g].meanShare[i] = gShare[g][i] / sims; });
  });
  const state = { winProb: {}, mean: {}, p05: {}, p50: {}, p95: {}, expGroups: {} };
  ids.forEach(i => {
    const a = Array.from(st[i]).sort((x, y) => x - y);
    const q = p => a[Math.min(sims - 1, Math.floor(p * sims))];
    state.winProb[i] = sWins[i] / sims; state.mean[i] = a.reduce((x, y) => x + y, 0) / sims;
    state.p05[i] = q(0.05); state.p50[i] = q(0.5); state.p95[i] = q(0.95);
    state.expGroups[i] = carried[i] / sims;
  });
  return { ids, groups, state, weights: w, sims };
}

/** Statewide win probability as of each poll date that has group data (feeds the trend chart). */
async function GC_history(polls, ids, date, w, opts) {
  const dates = [...new Set(polls.map(p => p.date))].sort();
  const pts = [];
  for (const d of dates) {
    const sub = polls.filter(p => p.date <= d);
    if (!GC_hasGroups(sub)) continue;
    const present = ids.filter(i => sub.some(p => (p.shares && typeof p.shares[i] === 'number') ||
      Object.values(p.groups || {}).some(x => x.shares && typeof x.shares[i] === 'number')));
    if (!present.length) continue;
    const r = await GC_run(sub, present, date === undefined ? d : date, w, opts, 1200);
    pts.push({ date: d, averages: r.state.winProb });
  }
  return pts;
}

if (typeof window !== 'undefined') { Object.assign(window, { GC_GROUPS, GC_hasGroups, GC_weights, GC_run, GC_history }); }
