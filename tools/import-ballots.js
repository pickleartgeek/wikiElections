#!/usr/bin/env node
/**
 * Imports a ballot export (one ranked ballot per line, with the time it was cast) into a replayable timeline.
 *
 *   node tools/import-ballots.js --id class2-2026-10 --file ballots.tsv [--title "Class 2 October 2026 Special Election"] [--tz Europe/Budapest]
 *
 * Input, tab-separated, one ballot per line:   <group> <TAB> 1. u/Name (Party), 2. u/Other <TAB> 23. 10. 2026 17:28:54
 * (day. month. year hour:minute:second, in --tz). No voter names are stored -- only group, ranking and time.
 * Names are matched to registry ids (the election's candidateIds first; data/ballottsr/config.json aliases; typos up to 2 letters).
 * Output: data/timelines/<id>.json (+ an entry in data/timelines/index.json so the replay lists the election).
 */
const fs = require('fs'), path = require('path');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const ID = arg('id'), FILE = arg('file'), TZ = arg('tz', 'Europe/Budapest');
if (!ID || !FILE) { console.error('usage: --id <election id> --file <ballots.tsv> [--title T] [--tz Europe/Budapest]'); process.exit(1); }
const ROOT = path.resolve(__dirname, '..'), rj = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const registry = rj('data', 'registries.json'); let cfg = {}; try { cfg = rj('data', 'ballottsr', 'config.json'); } catch (e) {}
let el = {}; try { el = rj('data', 'elections', ID + '.json'); } catch (e) {}
const TITLE = arg('title', el.title || ID);
const key = s => String(s).toLowerCase().replace(/^u\//, '').replace(/[^a-z0-9]/g, '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
const field = (el.candidateIds || []).slice(), all = Object.keys(registry.candidates);
const resolve = name => {
  const k = key(name), al = (cfg.aliases || {})[k]; if (al) return al;
  for (const pool of [field, all]) { const exact = pool.find(id => key(registry.candidates[id].name) === k || id === k); if (exact) return exact; }
  for (const pool of [field, all]) { const near = pool.map(id => [id, lev(key(registry.candidates[id].name), k)]).sort((a, b) => a[1] - b[1])[0]; if (near && near[1] <= 2) return near[0]; }
  return null;
};
// "23. 10. 2026 17:28:54" in tz -> ISO with offset
const offsetMin = (utcMs, tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs)).map(x => [x.type, x.value])); return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 6e4; };
const toIso = s => { const m = s.match(/(\d+)\.\s*(\d+)\.\s*(\d+)\s+(\d+):(\d+):(\d+)/); if (!m) throw new Error('bad time: ' + s); const [, d, mo, y, h, mi, se] = m.map(Number); const naive = Date.UTC(y, mo - 1, d, h, mi, se); let off = offsetMin(naive, TZ); off = offsetMin(naive - off * 6e4, TZ); const p2 = n => String(n).padStart(2, '0'), sign = off >= 0 ? '+' : '-', ab = Math.abs(off); return `${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(se)}${sign}${p2(Math.floor(ab / 60))}:${p2(ab % 60)}`; };
const unresolved = new Set(), ballots = [];
fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(l => l.trim()).forEach((line, n) => {
  const cols = line.split('\t'); if (cols.length < 3 || /^group\b/i.test(cols[0])) return;
  const ranks = cols[1].split(/,\s*(?=\d+\.\s)/).map(x => x.replace(/^\s*\d+\.\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').trim()).filter(Boolean);
  const ids = ranks.map(r => { const id = resolve(r); if (!id) unresolved.add(r); return id; });
  if (ids.includes(null)) return console.error(`line ${n + 1}: skipped (unknown name in "${cols[1]}")`);
  // t is the instant (UTC ISO, offset-aware); the first-choice ids only matter for display, the full ranking is kept in r
  ballots.push({ t: toIso(cols[2].trim()), g: String(cols[0]).trim(), r: ids });
});
ballots.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
const cands = [...new Set(ballots.flatMap(b => b.r))];
const out = { id: ID, title: TITLE, source: 'ballots', tz: TZ, candidates: cands, ballots };
const dir = path.join(ROOT, 'data', 'timelines'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, ID + '.json'), JSON.stringify(out) .replace(/\},\{"t"/g, '},\n{"t"') + '\n');
let idx = { timelines: [] }; try { idx = rj('data', 'timelines', 'index.json'); } catch (e) {}
idx.timelines = (idx.timelines || []).filter(x => x.id !== ID).concat([{ id: ID, title: TITLE, date: el.electionDate || ballots[0].t.slice(0, 10), source: 'ballots' }]);
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 1) + '\n');
console.log(`${ID}: ${ballots.length} ballots, candidates ${cands.join(', ')}, ${ballots[0].t} -> ${ballots[ballots.length - 1].t}` + (unresolved.size ? `\n  UNRESOLVED: ${[...unresolved].join(', ')}` : ''));
