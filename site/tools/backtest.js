// Backtest of the Custom Election Simulator.  Run:  node tools/backtest.js
// For every past election, retrain on ONLY earlier elections, simulate the real field, compare with what happened.
const fs = require('fs'), path = require('path'), R = f => path.join(__dirname, '..', f);
eval(fs.readFileSync(R('assets/js/groupcalc.js'), 'utf8').replace(/const GC_GROUPS/, 'var GC_GROUPS').replace(/if \(typeof window[\s\S]*$/, ''));
eval(fs.readFileSync(R('assets/js/electsim.js'), 'utf8').replace(/const (\w+) =/g, 'var $1 =').replace(/if \(typeof window[\s\S]*$/, ''));
const res = JSON.parse(fs.readFileSync(R('data/tsrelects-results.json'))), reg = JSON.parse(fs.readFileSync(R('data/registries.json'))),
  geo = JSON.parse(fs.readFileSync(R('data/groups.geojson'))), plain = JSON.parse(fs.readFileSync(R('data/plain-results.json'))).elections;
const SIMS = +process.argv[2] || 800, E_NOW = 1160;
if (process.argv[3]) Object.assign(ES_TUNE, JSON.parse(process.argv[3]));

// every past first-round-style race: { name, date, field: [{id, canon, party, votes}] }
const races = [];
res.forEach(e => Object.entries(e).forEach(([rk, rd]) => { if (!rd || !rd.races || /runoff|final/i.test(rk)) return;
  Object.entries(rd.races).forEach(([rn, race]) => { const t = {}; Object.values(race).forEach(g => Object.entries(g).forEach(([c, v]) => t[c] = (t[c] || 0) + v));
    const T = Object.values(t).reduce((a, b) => a + b, 0); if (T < 10 || Object.keys(t).length < 3) return;
    races.push({ name: e.title || e.id, date: e.date, key: rn, field: Object.entries(t).filter(([c]) => c !== 'wi').map(([c, v]) => ({ id: c, canon: ES_canon(c), party: (reg.candidates[c] || {}).party || 'ua', votes: v })) }); }); }));
plain.forEach(e => races.push({ name: e.name, date: e.date, key: e.id, field: e.first.map(x => ({ id: x.c, canon: ES_canon(x.c), party: x.p || 'ua', votes: x.v })) }));
const seen = new Set(), targets = races.filter(r => { const k = r.date + r.field.map(f => f.canon).sort().join(); if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => a.date.localeCompare(b.date)).filter(r => races.filter(x => x.date < r.date).length >= 3);

let rows = [], B = { m: 0, u: 0 }, hit = 0, cov = 0, covN = 0, bs = 0, bu = 0, mae = 0, maeU = 0, nShares = 0, tcov = 0;
targets.forEach(t => {
  const L = ES_learn(res.filter(e => e.date < t.date), reg, geo, new Date(t.date), plain.filter(e => e.date < t.date));
  const k = L.E / E_NOW; L.mu *= k; L.sd *= k; L.E = E_NOW;
  const T = ES_turnoutParams(L, 0), r = ES_rng(3), cs = t.field.map(f => ({ id: f.id, canon: f.canon, party: f.party }));
  const sh = cs.map(() => []), lead = cs.map(() => 0), tv = [];
  for (let i = 0; i < SIMS; i++) { const o = ES_simulate(L, cs, T, r), tot = cs.map(c => Object.values(o.first).reduce((s, g) => s + g[c.id], 0)), n = tot.reduce((a, b) => a + b, 0) || 1;
    tot.forEach((v, j) => sh[j].push(v / n)); lead[tot.indexOf(Math.max(...tot))]++; tv.push(n); }
  const V = t.field.reduce((a, f) => a + f.votes, 0), act = t.field.map(f => f.votes / V), n = cs.length, aLead = act.indexOf(Math.max(...act));
  const p = lead.map(x => x / SIMS), brier = p.reduce((s, x, j) => s + (x - (j === aLead ? 1 : 0)) ** 2, 0), brierU = cs.reduce((s, _, j) => s + (1 / n - (j === aLead ? 1 : 0)) ** 2, 0);
  const mean = sh.map(a => a.reduce((x, y) => x + y) / SIMS); if (process.env.DBG && (n <= 4 || t.name === "Class 2 Election")) console.log(t.name, t.field.map((f, j) => f.id + ' act ' + act[j].toFixed(2) + ' sim ' + mean[j].toFixed(2) + ' score ' + ES_score(L, f.canon, f.party).score.toFixed(2)).join(' | ')); let m1 = 0, m2 = 0, c80 = 0;
  sh.forEach((a, j) => { const s = [...a].sort((x, y) => x - y); m1 += Math.abs(mean[j] - act[j]); m2 += Math.abs(1 / n - act[j]); if (act[j] >= s[Math.floor(SIMS * .1)] && act[j] <= s[Math.floor(SIMS * .9)]) c80++; });
  if (process.env.DBG2) console.log(t.name, 'zero-vote sims', tv.filter(x => x === 0).length, 'mean votes', (tv.reduce((a, b) => a + b) / SIMS).toFixed(1), 'E', L.E, 'mu', L.mu.toFixed(4), 'sdmu', L.sd.toFixed(4));
  tv.sort((a, b) => a - b); const tin = V >= tv[Math.floor(SIMS * .1)] && V <= tv[Math.floor(SIMS * .9)];
  const top = p.indexOf(Math.max(...p)); hit += top === aLead; bs += brier; bu += brierU; mae += m1; maeU += m2; nShares += n; cov += c80; tcov += tin;
  rows.push([t.date, t.name.slice(0, 30), n, t.field[aLead].id, t.field[top].id, (p[aLead] * 100).toFixed(0) + '%', brier.toFixed(2), brierU.toFixed(2), (100 * m1 / n).toFixed(1), (100 * m2 / n).toFixed(1), c80 + '/' + n, tin ? 'in' : 'OUT']);
});
console.log('date       election                       n  actual-lead  model-fav  P(actual)  Brier(model/uniform)  share MAE pp(model/uniform)  80%-cov  votes');
rows.forEach(r => console.log(`${r[0]}  ${r[1].padEnd(30)} ${r[2]}  ${r[3].padEnd(11)} ${r[4].padEnd(10)} ${r[5].padStart(5)}   ${r[6]} / ${r[7]}              ${r[8]} / ${r[9]}              ${r[10]}   ${r[11]}`));
console.log(`\nSUMMARY over ${targets.length} elections (${SIMS} sims each)`);
console.log(`favourite led first round: ${hit}/${targets.length}  | Brier ${(bs / targets.length).toFixed(3)} vs uniform ${(bu / targets.length).toFixed(3)}`);
console.log(`share MAE: ${(100 * mae / nShares).toFixed(2)}pp vs uniform ${(100 * maeU / nShares).toFixed(2)}pp | 80% interval coverage: ${(100 * cov / nShares).toFixed(0)}% | total votes inside 80% range: ${tcov}/${targets.length}`);
