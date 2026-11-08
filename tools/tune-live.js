// Parameter search for assets/js/nightodds.js with leave-one-election-out validation.
//   node tools/tune-live.js [sims=250] ['{"concMult":[1,2,3],"swingMult":[2,3]}']   (grid: every combination of the listed values; unlisted keys keep their NO_TUNE default)
// Score = lead Brier (who finishes first) + group Brier (who carries each group) averaged over every ballot checkpoint, per election.
// "LOO": for each election, pick the best setting on the OTHER elections and score it on the held-out one. If that beats the defaults, the tuning generalises.
const fs = require('fs'), path = require('path'), R = f => path.join(__dirname, '..', f);
const src = f => fs.readFileSync(R(f), 'utf8').replace(/^const (\w+) =/gm, 'var $1 =').replace(/if \(typeof window[\s\S]*$/, '');
eval(src('assets/js/groupcalc.js')); eval(src('assets/js/electsim.js')); eval(src('assets/js/basecalc.js')); eval(src('assets/js/tsrelects.js')); eval(src('assets/js/nightodds.js'));
const res = JSON.parse(fs.readFileSync(R('data/tsrelects-results.json'))), geo = JSON.parse(fs.readFileSync(R('data/groups.geojson')));
const SIMS = +process.argv[2] || 250, GRID = process.argv[3] ? JSON.parse(process.argv[3]) : {}, BASE = Object.assign({}, NO_TUNE);
const idx = JSON.parse(fs.readFileSync(R('data/timelines/index.json'))).timelines;
const EL = idx.map(t => { const tl = JSON.parse(fs.readFileSync(R(`data/timelines/${t.id}.json`))); if (!tl.ballots) return null; let pf; try { pf = JSON.parse(fs.readFileSync(R(`data/elections/${t.id}.json`))); } catch (e) { return null; }
  const b = tl.ballots.slice().sort((x, y) => x.t.localeCompare(y.t)); return { id: t.id, date: t.date, tl, pf, b }; }).filter(Boolean);
function score(e, params) {
  Object.assign(NO_TUNE, BASE, params);
  const ctx = NO_prepare({ pf: e.pf, geo, elections: res.filter(x => x.date < e.date), date: e.date, keys: e.tl.candidates }), tid = x => ctx.toId[ctx.canon(x.r[0])] || x.r[0];
  const fin = {}, gfin = {}; e.b.forEach(x => { const id = tid(x), g = String(x.g); fin[id] = (fin[id] || 0) + 1; (gfin[g] = gfin[g] || {})[id] = (gfin[g][id] || 0) + 1; });
  const ranked = Object.entries(fin).sort((a, c) => c[1] - a[1]); if (ranked[1] && ranked[0][1] === ranked[1][1]) return null; const win = ranked[0][0];
  const gwin = {}; Object.entries(gfin).forEach(([g, v]) => { const s = Object.entries(v).sort((a, c) => c[1] - a[1]); if (!s[1] || s[0][1] > s[1][1]) gwin[g] = s[0][0]; });
  const groups = {}; let L = 0, nL = 0, G = 0, nG = 0, LL = 0;
  e.b.forEach((x, i) => { const g = String(x.g), id = tid(x); (groups[g] = groups[g] || {})[id] = (groups[g][id] || 0) + 1; const n = i + 1; if (n < NO_TUNE.minN || n >= e.b.length) return;
    const o = NO_run(ctx, NO_counts(groups, ctx), { sims: SIMS });
    L += ctx.ids.reduce((a, k) => a + (o.lead[k] - (k === win ? 1 : 0)) ** 2, 0); nL++; LL += -Math.log(Math.max(0.01, o.lead[win]));
    Object.entries(gwin).forEach(([gg, w]) => { G += ctx.ids.reduce((a, k) => a + (o.groups[gg].lead[k] - (k === w ? 1 : 0)) ** 2, 0); nG++; }); });
  return { L: L / nL, G: G / nG, LL: LL / nL };
}
const keys = Object.keys(GRID), combos = keys.length ? keys.reduce((acc, k) => acc.flatMap(a => GRID[k].map(v => Object.assign({}, a, { [k]: v }))), [{}]) : [{}];
if (keys.length) combos.unshift({});   // the current defaults are always scored too
const rows = combos.map(p => { const per = EL.map(e => score(e, p)); return { p, per }; });
const tot = r => r.per.reduce((a, s) => a + (s ? s.L + s.G : 0), 0) / r.per.filter(Boolean).length;
const f = x => x.toFixed(4); rows.sort((a, b) => tot(a) - tot(b));
console.log(`${EL.length} elections, ${combos.length} settings, ${SIMS} sims\nbest (lead+group Brier, lower is better):`);
rows.slice(0, 8).forEach(r => console.log(' ', f(tot(r)), 'L', f(r.per.reduce((a, s) => a + (s ? s.L : 0), 0) / r.per.filter(Boolean).length), 'G', f(r.per.reduce((a, s) => a + (s ? s.G : 0), 0) / r.per.filter(Boolean).length), JSON.stringify(r.p)));
const def = rows.find(r => !Object.keys(r.p).length); if (def) console.log('defaults:', f(tot(def)), JSON.stringify(def.p));
if (rows.length > 1) { let loo = 0, base = 0, n = 0; EL.forEach((e, i) => { if (!rows[0].per[i]) return; const best = rows.map(r => ({ r, s: r.per.reduce((a, s, j) => a + (j !== i && s ? s.L + s.G : 0), 0) })).sort((a, b) => a.s - b.s)[0].r;
    loo += best.per[i].L + best.per[i].G; base += def.per[i].L + def.per[i].G; n++; });
  console.log(`leave-one-out: tuned ${f(loo / n)} vs defaults ${f(base / n)}  (${loo < base ? 'tuning generalises' : 'no real gain: keep defaults'})`); }
