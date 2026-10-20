// Data sanity check. Run:  node tools/check-data.js     (exits 1 on any error)
// Verifies election IDs are canonical (class<N>-<YYYY>-<MM>) and consistent across every data file,
// that every candidate id exists in registries.json, and that poll shares look sane.
const fs = require('fs'), path = require('path');
const R = f => path.join(__dirname, '..', f), J = f => JSON.parse(fs.readFileSync(R(f), 'utf8'));
const PAT = /^class(\d+)-(\d{4})-(\d{2})(?:-[a-z0-9]+)?$/;
const errs = [], warns = [];
const err = m => errs.push(m), warn = m => warns.push(m);

const reg = J('data/registries.json'), idx = J('data/polls-index.json').elections, results = J('data/tsrelects-results.json'),
  plain = J('data/plain-results.json').elections, cfg = J('data/site-config.json');
const files = fs.readdirSync(R('data/elections')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));

const checkId = (id, where) => { if (!PAT.test(id)) err(`${where}: "${id}" is not class<N>-<YYYY>-<MM>`); };
const LEGACY = new Set(['class1-sept','class2-july','class3-jan','class4-april','class4-march','class5-april','class5-june','class5-sept','class6','class7-26','class7-july']);
const stale = files.filter(id => LEGACY.has(id));
stale.forEach(id => warn(`data/elections/${id}.json is a pre-rename leftover -- safe to delete (git rm)`));
files.splice(0, files.length, ...files.filter(id => !LEGACY.has(id)));
files.forEach(id => checkId(id, 'data/elections filename'));
idx.forEach(e => { checkId(e.id, 'polls-index'); if (!files.includes(e.id)) err(`polls-index: "${e.id}" has no data/elections/${e.id}.json`); });
files.forEach(id => { if (!idx.some(e => e.id === id)) err(`data/elections/${id}.json is missing from polls-index.json`); });
results.forEach(e => checkId(e.id, 'tsrelects-results'));
plain.forEach(e => checkId(e.id, 'plain-results'));
const dup = (a, w) => { const s = new Set(); a.forEach(x => { if (s.has(x)) err(`${w}: duplicate id "${x}"`); s.add(x); }); };
dup(results.map(e => e.id), 'tsrelects-results'); dup(plain.map(e => e.id), 'plain-results'); dup(idx.map(e => e.id), 'polls-index');
plain.forEach(e => { if (results.some(r => r.id === e.id)) warn(`plain-results "${e.id}" also exists in tsrelects-results (simulator uses the grouped record)`); });
(cfg.activeElections || []).forEach(a => { if (!files.includes(a.pollsId)) err(`site-config: active "${a.pollsId}" has no election file`); });
if (cfg.activePollsId && !files.includes(cfg.activePollsId)) err(`site-config: activePollsId "${cfg.activePollsId}" has no election file`);

files.forEach(id => {
  const e = J(`data/elections/${id}.json`);
  if (e.id !== id) err(`${id}.json: "id" is "${e.id}"`);
  if (e.electionId !== id) err(`${id}.json: "electionId" is "${e.electionId}"`);
  const m = PAT.exec(id), d = e.electionDate && new Date(e.electionDate);
  if (m && d && Math.abs((d.getUTCFullYear() * 12 + d.getUTCMonth()) - (+m[2] * 12 + (+m[3] - 1))) > 1) warn(`${id}: electionDate ${e.electionDate} is more than a month from the id`);
  const known = new Set([...(e.candidateIds || []), ...(e.writeInIds || [])]);
  known.forEach(c => { if (!reg.candidates[c]) err(`${id}: candidate "${c}" missing from registries.json`); });
  (e.polls || []).forEach((p, i) => {
    const s = Object.values(p.shares || {}).reduce((a, b) => a + b, 0);
    if (s < 0.9 || s > 1.05) warn(`${id} poll #${i} (${p.pollster} ${p.date}): shares sum to ${(s * 100).toFixed(1)}%`);
    Object.keys(p.shares || {}).forEach(c => { if (!known.has(c)) warn(`${id} poll #${i}: share for "${c}" who is not in candidateIds/writeInIds`); });
  });
});
console.log(`${files.length} election files, ${results.length} results, ${plain.length} plain results checked`);
warns.forEach(w => console.log('  warn  ' + w)); errs.forEach(x => console.log('  ERROR ' + x));
console.log(errs.length ? `${errs.length} error(s)` : 'OK'); process.exit(errs.length ? 1 : 0);
