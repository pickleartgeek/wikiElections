/**
 * GroupCalc — engine behind "ProbCalc Group Forecast".
 * Polls may carry  groups: { "1": {sample, shares:{cand:share}}, ... }.
 * v2 -- partial pooling + reconciliation (fixes group results contradicting
 * the headline poll average):
 *   1. Each group's estimate is a weighted count of its own respondents
 *      (raw sample size x recency; NOT the statewide turnout kernel, which
 *      wrongly made a 1-person group sample outweigh a 5-person one),
 *      pooled with a prior equal to the statewide poll average worth
 *      GC_TUNE.priorStrength respondents. Tiny samples therefore can't
 *      swing a group to 99%.
 *   2. Group estimates are then raked (iterative proportional fitting) so the
 *      voting-age-population-weighted mean of all groups equals the statewide
 *      BaseCalc average exactly. The group forecast can no longer disagree
 *      with the average about who leads the popular vote.
 *   3. Each simulation draws ONE shared statewide swing (Dirichlet around the
 *      average, sized by the effective statewide sample) applied to every
 *      group, plus independent group-level noise. Groups move together, as
 *      real electorates do, and statewide uncertainty is not understated.
 * Groups are combined statewide weighted by VAP (data/groups.geojson).
 */
const GC_TUNE = { priorStrength: 5, designEffect: 0.8, minAlpha: 0.05, minStateN: 6 };
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

function GC_recency(polls, asOf) {
  const inv = p => 1 / BaseCalc_daysUntil(p.date, asOf);
  const mx = Math.max(1e-9, ...polls.map(inv));
  return p => inv(p) / mx;   // 1 for the freshest poll, tapering with age
}

/** Build the pooled + reconciled group model (no randomness). */
function GC_model(polls, ids, date, w, opts) {
  const asOf = opts.asOfDate || date;
  const T = GC_TUNE;
  const st = BaseCalc_aggregate(polls, ids, asOf, { anticipatedTurnout: opts.anticipatedTurnout });
  let s = {}, sum = 0;
  ids.forEach(i => { s[i] = st.averages[i] || 0; sum += s[i]; });
  ids.forEach(i => { s[i] = sum > 0 ? s[i] / sum : 1 / ids.length; });

  const rec = GC_recency(polls, asOf);
  let cState = 0;
  polls.forEach(p => { if (ids.some(i => p.shares && typeof p.shares[i] === 'number')) cState += rec(p) * (typeof p.sample === 'number' ? p.sample : 10); });
  cState = Math.max(T.minStateN, cState * T.designEffect);

  const mu = {}, info = {};
  GC_GROUPS.forEach(g => {
    const gp = GC_groupPolls(polls, g, opts.writeInIds);
    const cnt = {}; ids.forEach(i => { cnt[i] = 0; });
    gp.forEach(p => { const r = rec(p) * p.sample; ids.forEach(i => { if (typeof p.shares[i] === 'number') cnt[i] += r * p.shares[i]; }); });
    const nG = ids.reduce((a, i) => a + cnt[i], 0);
    const m = {}; let z = 0;
    ids.forEach(i => { m[i] = T.priorStrength * s[i] + cnt[i]; z += m[i]; });
    ids.forEach(i => { m[i] = z > 0 ? m[i] / z : 1 / ids.length; });
    mu[g] = m;
    info[g] = { polls: gp.length, fallback: !gp.length, n: nG, conc: Math.max(2, (T.priorStrength + nG) * T.designEffect) };
  });

  // rake so VAP-weighted group means reproduce the statewide average
  const c = {}; ids.forEach(i => { c[i] = 1; });
  for (let it = 0; it < 60; it++) {
    const m = {}; ids.forEach(i => { m[i] = 0; });
    GC_GROUPS.forEach(g => {
      let z = 0; ids.forEach(i => { z += mu[g][i] * c[i]; });
      ids.forEach(i => { m[i] += w[g] * mu[g][i] * c[i] / (z || 1); });
    });
    let err = 0;
    ids.forEach(i => { if (m[i] > 0 && s[i] > 0) { c[i] *= s[i] / m[i]; err = Math.max(err, Math.abs(m[i] - s[i])); } });
    if (err < 1e-6) break;
  }
  GC_GROUPS.forEach(g => {
    let z = 0; ids.forEach(i => { z += mu[g][i] * c[i]; });
    ids.forEach(i => { mu[g][i] = mu[g][i] * c[i] / (z || 1); });
  });
  return { s, mu, info, cState };
}

async function GC_run(polls, ids, date, w, opts = {}, sims = 6000) {
  const M = GC_model(polls, ids, date, w, opts);
  const gWins = {}, gShare = {}, st = {}, sWins = {}, carried = {};
  GC_GROUPS.forEach(g => { gWins[g] = {}; gShare[g] = {}; ids.forEach(i => { gWins[g][i] = 0; gShare[g][i] = 0; }); });
  ids.forEach(i => { st[i] = new Float32Array(sims); sWins[i] = 0; carried[i] = 0; });

  for (let s = 0; s < sims; s++) {
    // one shared statewide swing for every group this simulation
    const t = {}; let tz = 0;
    ids.forEach(i => { t[i] = PC_sampleGamma(Math.max(GC_TUNE.minAlpha, M.cState * M.s[i])); tz += t[i]; });
    const swing = {}; ids.forEach(i => { swing[i] = M.s[i] > 0 && tz > 0 ? (t[i] / tz) / M.s[i] : 1; });

    const tot = {}; ids.forEach(i => { tot[i] = 0; });
    GC_GROUPS.forEach(g => {
      let z = 0; const m = {};
      ids.forEach(i => { m[i] = M.mu[g][i] * swing[i]; z += m[i]; });
      const d = {}; let sum = 0;
      ids.forEach(i => { d[i] = PC_sampleGamma(Math.max(GC_TUNE.minAlpha, M.info[g].conc * m[i] / (z || 1))); sum += d[i]; });
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
    groups[g] = { polls: M.info[g].polls, fallback: M.info[g].fallback, n: M.info[g].n, winProb: {}, meanShare: {} };
    ids.forEach(i => { groups[g].winProb[i] = gWins[g][i] / sims; groups[g].meanShare[i] = gShare[g][i] / sims; });
  });
  const state = { winProb: {}, mean: {}, p05: {}, p50: {}, p95: {}, expGroups: {}, avg: M.s };
  ids.forEach(i => {
    const a = Array.from(st[i]).sort((x, y) => x - y);
    const q = p => a[Math.min(sims - 1, Math.floor(p * sims))];
    state.winProb[i] = sWins[i] / sims; state.mean[i] = a.reduce((x, y) => x + y, 0) / sims;
    state.p05[i] = q(0.05); state.p50[i] = q(0.5); state.p95[i] = q(0.95);
    state.expGroups[i] = carried[i] / sims;
  });
  return { ids, groups, state, weights: w, sims, model: M };
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
    const r = await GC_run(sub, present, date === undefined ? d : date, w, Object.assign({}, opts, { asOfDate: date === undefined ? d : date }), 1200);
    pts.push({ date: d, averages: r.state.winProb });
  }
  return pts;
}

if (typeof window !== 'undefined') { Object.assign(window, { GC_GROUPS, GC_hasGroups, GC_weights, GC_run, GC_history }); }
