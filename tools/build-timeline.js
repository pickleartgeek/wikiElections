#!/usr/bin/env node
/**
 * Rebuilds a vote-by-vote election-night timeline from git history.
 * Every commit that touched data/tsrelects-results.json while an election was being counted is a dated snapshot of
 * the group results at that moment, so the snapshots together are a real timeline of how the night unfolded.
 *
 *   node tools/build-timeline.js --id class7-2026-09 --since 2026-09-20 --until 2026-10-02 [--ids class7-2026-09,class7-26] [--rev origin/main]
 *
 * Run it from a full clone (not a shallow one: `git fetch --unshallow`). Output: data/timelines/<id>.json
 * Commits whose JSON didn't parse are skipped; identical neighbours are merged; candidate keys are folded onto the
 * election's final keys (tmf1 -> tmf, nzb -> nzb1 ...). Only the first round is tracked.
 */
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const ID = arg('id'); if (!ID) { console.error('usage: --id <election id> [--since D] [--until D] [--ids a,b] [--rev origin/main] [--keep-until ISO --final-at ISO [--steps \"ISO=cand,...\"]]'); process.exit(1); }
const REV = arg('rev', 'HEAD'), IDS = (arg('ids', ID)).split(','), SINCE = arg('since'), UNTIL = arg('until'), ROOT = path.resolve(__dirname, '..');
const FILE = 'data/tsrelects-results.json', git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const norm = k => String(k).toLowerCase().replace(/\d+$/, '');
const findEl = d => (Array.isArray(d) ? d : d.elections || []).find(e => IDS.includes(e.id));

const revs = git('log', REV, ...(SINCE ? ['--since=' + SINCE] : []), ...(UNTIL ? ['--until=' + UNTIL] : []), '--format=%H|%aI', '--', FILE).trim().split('\n').filter(Boolean).reverse();
if (!revs.length) { console.error('no commits found in that window (shallow clone?)'); process.exit(1); }
const snaps = []; let bad = 0;
revs.forEach(r => {
  const [h, t] = r.split('|'); let el;
  try { el = findEl(JSON.parse(git('show', `${h}:${FILE}`))); } catch (e) { bad++; return; }
  if (!el || !el.first_round) return;
  snaps.push({ t, rev: h.slice(0, 7), precincts: el.precincts_reporting, turnout: el.turnout, races: JSON.parse(JSON.stringify((el.first_round.races) || {})) });
});
if (!snaps.length) { console.error('election not found in those commits'); process.exit(1); }
// Optional: late edits (corrections entered after the count ended) can be replaced by the election's current, hand-checked
// state: --keep-until <ISO> drops every snapshot after that time, --final-at <ISO> appends the working-tree file's state at that time.
const KEEP = arg('keep-until'), FINAL_AT = arg('final-at');
if (KEEP) while (snaps.length && Date.parse(snaps[snaps.length - 1].t) > Date.parse(KEEP)) snaps.pop();
if (FINAL_AT) { const el = findEl(JSON.parse(fs.readFileSync(path.join(ROOT, FILE), 'utf8')));
  if (el && el.first_round) {
    const finalRaces = JSON.parse(JSON.stringify(el.first_round.races || {})), base = snaps[snaps.length - 1], push = (t, races) => snaps.push({ t, rev: 'current', precincts: el.precincts_reporting, turnout: el.turnout, races });
    // --steps "ISO=cand,ISO=cand": when each late vote for that candidate was cast (instead of all at --final-at); must be in time order
    const steps = (arg('steps') || '').split(',').filter(Boolean).map(x => { const [t, k] = x.split('='); return { t, k }; });
    let curRaces = JSON.parse(JSON.stringify(base.races));
    steps.forEach(st => { outer: for (const [race, gv] of Object.entries(finalRaces)) for (const [g, v] of Object.entries(gv)) {
      const have = ((curRaces[race] || {})[g] || {}); for (const [k, n] of Object.entries(v)) if (norm(k) === norm(st.k) && n > (have[k] || 0)) { curRaces = JSON.parse(JSON.stringify(curRaces)); ((curRaces[race] = curRaces[race] || {})[g] = curRaces[race][g] || {})[k] = (have[k] || 0) + 1; push(st.t, curRaces); break outer; } } });
    push(FINAL_AT, finalRaces);
  } }// fold keys onto the last snapshot's keys
const finalKeys = {}; Object.values(snaps[snaps.length - 1].races).forEach(gv => Object.values(gv).forEach(v => Object.keys(v).forEach(k => { finalKeys[norm(k)] = k; })));
const out = [];
snaps.forEach(s => {
  const races = {};
  Object.entries(s.races).forEach(([name, gv]) => { races[name] = {}; Object.entries(gv).forEach(([g, v]) => { const o = {}; Object.entries(v).forEach(([k, n]) => { const c = finalKeys[norm(k)] || k; o[c] = (o[c] || 0) + n; }); races[name][g] = o; }); });
  const key = JSON.stringify(races), prev = out[out.length - 1];
  if (prev && prev._k === key) { prev.precincts = s.precincts; return; }
  out.push({ t: s.t, rev: s.rev, precincts: s.precincts, turnout: s.turnout, races, _k: key });
});
out.forEach(o => delete o._k);
const dest = path.join(ROOT, 'data', 'timelines', ID + '.json'); fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify({ id: ID, source: 'git-history', note: 'Snapshots of data/tsrelects-results.json taken at each commit; times are when results were entered.', snapshots: out }, null, 1) + '\n');
console.log(`${ID}: ${out.length} snapshots (${bad} unparseable commits skipped) from ${out[0].t} to ${out[out.length - 1].t} -> ${path.relative(ROOT, dest)}`);
