// Backtest of the election-night win probability (assets/js/nightodds.js).  Run:  node tools/backtest-live.js [sims] ['{"concMult":1.5}']
// For every election with a ballot-by-ballot timeline: build the model from ONLY earlier elections + that election's polls, replay the ballots in order,
// and after every ballot ask "who finishes first, by first-choice votes?"  Scored against what really happened (Brier, log loss, reliability) and two naive baselines.
const fs = require('fs'), path = require('path'), R = f => path.join(__dirname, '..', f);
const src = f => fs.readFileSync(R(f), 'utf8').replace(/^const (\w+) =/gm, 'var $1 =').replace(/if \(typeof window[\s\S]*$/, '');
eval(src('assets/js/groupcalc.js')); eval(src('assets/js/electsim.js')); eval(src('assets/js/basecalc.js')); eval(src('assets/js/tsrelects.js')); eval(src('assets/js/nightodds.js'));
const res = JSON.parse(fs.readFileSync(R('data/tsrelects-results.json'))), geo = JSON.parse(fs.readFileSync(R('data/groups.geojson')));
const SIMS = +process.argv[2] || 600; if (process.argv[3]) Object.assign(NO_TUNE, JSON.parse(process.argv[3]));
const idx = JSON.parse(fs.readFileSync(R('data/timelines/index.json'))).timelines, rows = [], bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, hit: 0 }));
let S = { n: 0, bm: 0, bp: 0, bl: 0, ll: 0, early: { n: 0, bm: 0, bl: 0 }, mid: { n: 0, bm: 0, bl: 0 }, late: { n: 0, bm: 0, bl: 0 } };
idx.forEach(t => {
  const tl = JSON.parse(fs.readFileSync(R(`data/timelines/${t.id}.json`))); if (!tl.ballots) return; let pf; try { pf = JSON.parse(fs.readFileSync(R(`data/elections/${t.id}.json`))); } catch (e) { return; }
  const b = tl.ballots.slice().sort((x, y) => x.t.localeCompare(y.t)), ctx = NO_prepare({ pf, geo, elections: res.filter(e => e.date < t.date), date: t.date, keys: tl.candidates });
  const fin = {}; b.forEach(x => { const id = ctx.toId[ctx.canon(x.r[0])] || x.r[0]; fin[id] = (fin[id] || 0) + 1; });
  const win = Object.entries(fin).sort((x, y) => y[1] - x[1])[0][0], tie = Object.values(fin).filter(v => v === fin[win]).length > 1; if (tie) return;
  const groups = {}, run = {}; let nG = 0, tot = {};
  b.forEach((x, i) => { const g = String(x.g), id = ctx.toId[ctx.canon(x.r[0])] || x.r[0]; (groups[g] = groups[g] || {})[id] = (groups[g][id] || 0) + 1; tot[id] = (tot[id] || 0) + 1;
    const n = i + 1; if (n < NO_TUNE.minN || n >= b.length) return;
    const o = NO_run(ctx, NO_counts(groups, ctx), { sims: SIMS }), p = o.lead[win], ids = ctx.ids;
    const leader = Object.entries(tot).sort((a, c) => c[1] - a[1])[0], naive = leader[0] === win ? 0.9 : 0.1, uni = 1 / ids.length;
    const bm = (p - 1) ** 2, bl = (naive - 1) ** 2, frac = n / b.length, bucket = frac < .34 ? 'early' : frac < .67 ? 'mid' : 'late';
    // multi-class Brier on the lead distribution, plus binary Brier on every candidate for reliability
    ids.forEach(id => { const q = o.lead[id], y = id === win ? 1 : 0, k = Math.min(9, Math.floor(q * 10)); bins[k].n++; bins[k].p += q; bins[k].hit += y; S.bp += (q - y) ** 2; });
    S.n++; S.bm += bm; S.bl += bl; S.ll += -Math.log(Math.max(0.01, p)); S[bucket].n++; S[bucket].bm += bm; S[bucket].bl += bl;
    if (n === 5 || n === Math.floor(b.length / 2) || n === b.length - 3) run[n] = (p * 100).toFixed(0) + '%';
  });
  rows.push([t.id, b.length, win, Object.entries(fin).map(([k, v]) => k + ':' + v).join(' '), JSON.stringify(run), 'T~' + ctx.hist.mean.toFixed(0) + '±' + ctx.hist.sd.toFixed(0)]);
});
rows.forEach(r => console.log(r.join('  ')));
const f = x => x.toFixed(3);
console.log(`\nSUMMARY ${rows.length} elections, ${S.n} checkpoints, ${SIMS} sims`);
console.log(`P(actual winner leads)  Brier ${f(S.bm / S.n)}  (naive "current leader wins 90%": ${f(S.bl / S.n)} | coin ${f(0.25)})  log-loss ${f(S.ll / S.n)}`);
['early', 'mid', 'late'].forEach(k => console.log(`  ${k.padEnd(6)} n=${S[k].n}  model ${f(S[k].bm / S[k].n)}  naive ${f(S[k].bl / S[k].n)}`));
console.log('reliability (all candidates, all checkpoints):  predicted -> actual');
bins.forEach((x, i) => x.n && console.log(`  ${i * 10}-${i * 10 + 10}%  n=${String(x.n).padEnd(4)} predicted ${(100 * x.p / x.n).toFixed(0).padStart(3)}%  actual ${(100 * x.hit / x.n).toFixed(0).padStart(3)}%`));
