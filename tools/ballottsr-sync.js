#!/usr/bin/env node
/**
 * BallotTSR -> wikiElections sync + parser.   Zero dependencies (Node 18+).
 *
 *   node tools/ballottsr-sync.js [--kind polls|elections|all] [--force] [--source <url|dir>] [--site <dir>]
 *
 * 1. MIRROR   copies ElSec's ballottsr/index.json + polls/*.json verbatim into data/ballottsr/raw/
 *             (closed files that haven't changed are not re-downloaded).
 *               kind=polls      -> non-official polls          (scheduled every 3 hours)
 *               kind=elections  -> official elections          (scheduled every 30 minutes)
 * 2. PARSE    turns the raw files into site data:
 *               polls     -> appended to data/elections/<id>.json as {source:"ballottsr"} polls
 *                            (first-round shares, sample = ballots), plus data/ballottsr/parsed/polls.json
 *               elections -> data/ballottsr/results.json  (same shape as tsrelects-results.json: first-round
 *                            votes per group) + data/ballottsr/parsed/official.json (rounds, props, winners)
 *             data/ballottsr/report.json lists everything skipped or unmatched, and why.
 * Race CALLS are never automatic -- they stay an editorial decision in tsrelects-results.json.
 * Results flagged resultsEmbargoed are never published.
 */
const fs = require('fs'), path = require('path');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); if (i < 0) return d; const v = argv[i + 1]; return (v && !v.startsWith('--')) ? v : true; };
const SITE = path.resolve(arg('site', path.join(__dirname, '..')));
const KIND = arg('kind', 'all'), FORCE = !!arg('force', false);
const TODAY = String(arg('today', new Date().toISOString().slice(0, 10)));
const P = (...a) => path.join(SITE, ...a), BT = (...a) => P('data', 'ballottsr', ...a);

const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function writeIfChanged(file, obj, raw) {
  const text = raw != null ? raw : JSON.stringify(obj, null, 2) + '\n';
  let old = null; try { old = fs.readFileSync(file, 'utf8'); } catch (e) {}
  if (old === text) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return true;
}

const cfg = readJSON(BT('config.json'));
const SOURCE = String(arg('source', cfg.source)).replace(/\/$/, '');

async function load(rel) {
  if (/^https?:/.test(SOURCE)) {
    let err;
    for (let i = 0; i < 3; i++) {
      try { const r = await fetch(`${SOURCE}/${rel}`, { headers: { 'user-agent': 'wikiElections-sync' } }); if (!r.ok) throw new Error(`${r.status} ${rel}`); return await r.text(); }
      catch (e) { err = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
    }
    throw err;
  }
  return fs.readFileSync(path.join(SOURCE, rel), 'utf8');
}

/* ------------------------------------------------------------------ 1. mirror */
const isOfficial = x => !!x.isOfficialElection;
const wantKind = x => KIND === 'all' || (KIND === 'elections' ? isOfficial(x) : !isOfficial(x));

async function mirror(stats) {
  const idxText = await load('index.json'), idx = JSON.parse(idxText);
  if (writeIfChanged(BT('raw', 'index.json'), null, idxText)) stats.indexChanged = true;
  for (const e of idx.polls || []) {
    if (!wantKind(e)) continue;
    const local = BT('raw', e.file);
    let cur = null; try { cur = readJSON(local); } catch (err) {}
    const need = FORCE || !cur || cur.status === 'open' || cur.status !== e.status || cur.title !== e.title;
    if (!need) { stats.skipped++; continue; }
    try {
      const text = await load(e.file); JSON.parse(text);
      if (writeIfChanged(local, null, text)) { stats.fetchedChanged.push(e.id); } else stats.unchanged++;
    } catch (err) { stats.errors.push(`${e.file}: ${err.message}`); }
  }
}

/* ------------------------------------------------------------------ 2. parse helpers */
const registry = readJSON(P('data', 'registries.json'));
const norm = s => String(s).replace(/\s*\(.*$/, '').toLowerCase().replace(/^\/?u\//, '').replace(/[^a-z0-9]/g, '');   // 'u/Name (Incumbent):' -> name
/** One ballot label can name several handles ("Junglejumpersfan/Teammomofan", "A & B", "A aka B"): every alternative, normalised. */
const alts = s => [...new Set(String(s).replace(/\s*\(.*$/, '').replace(/^\s*\/?u\//i, '').split(/\s*(?:[\/|&,+]|\baka\b|\ba\.k\.a\.?|\bor\b)\s*/i).map(norm).filter(Boolean))];
const ignoreRx = (cfg.ignoreOptions || []).map(r => new RegExp(r));
const nameIndex = {};
Object.entries(registry.candidates).forEach(([id, c]) => { if (id === 'wi') return; (nameIndex[norm(c.name)] = nameIndex[norm(c.name)] || []).push(id); });
const regNames = Object.keys(nameIndex);
function lev(a, b) {
  const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
/** ballot option name -> registry id (preferring the id that is actually in this election's field). */
function resolve(name, election) {
  const A = alts(name); if (!A.length) return { id: null };
  if (A.every(n => ignoreRx.some(r => r.test(n)))) return { ignored: true };
  let ids = null;
  // pass 1 -- exact / alias / trailing-digits, over every alternative; pass 2 -- fuzzy (typos)
  for (const n of A) {
    ids = nameIndex[n];
    if (!ids && cfg.aliases && cfg.aliases[n] && registry.candidates[cfg.aliases[n]]) ids = nameIndex[norm(registry.candidates[cfg.aliases[n]].name)];
    const stripped = n.replace(/\d+$/, '');
    if (!ids && stripped !== n) ids = nameIndex[stripped];              // One-Community-3753 -> One-Community
    if (ids) break;
  }
  if (!ids) for (const n of A) {
    const stripped = n.replace(/\d+$/, '');
    const hit = regNames.find(rn => rn.length >= 8 && (lev(n, rn) <= 2 || lev(stripped, rn) <= 2));   // Fillipinowonderer2442 -> Filipinowanderer2442
    if (hit) { ids = nameIndex[hit]; break; }
  }
  if (!ids) return { id: null };
  const field = election ? [...(election.candidateIds || []), ...(election.writeInIds || [])] : [];
  const inField = ids.find(i => field.includes(i));
  return inField ? { id: inField, inField: true } : { id: ids[0], inField: false };
}
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
const classOf = t => { const m = /class\s*(\d+)/i.exec(t || ''); return m ? +m[1] : null; };
const daysBetween = (a, b) => (new Date(a) - new Date(b)) / 864e5;
const pollster = p => {
  for (const r of cfg.pollsterRules || []) {
    if (r.title && new RegExp(r.title, 'i').test(p.title)) return r.pollster;
    if (r.createdBy && r.createdBy.toLowerCase() === String(p.createdBy).toLowerCase()) return r.pollster;
  }
  return p.createdBy;
};
function readRaw() {
  const dir = BT('raw', 'polls'); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => readJSON(path.join(dir, f)));
}
function loadElections() {
  const dir = P('data', 'elections');
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({ file: path.join(dir, f), data: readJSON(path.join(dir, f)) }));
}
/** votes (or fractions) per option for the first round. */
function firstRound(poll) {
  const t = poll.tally || {}, n = t.totalBallots || 0, out = {};
  poll.options.forEach(o => {
    out[o.id] = (t.rounds && t.rounds[0]) ? (t.rounds[0].tallies[o.id] || 0) : ((t.finalPct && t.finalPct[o.id]) || 0) * n / 100;
  });
  return out;
}
const r4 = x => Math.round(x * 10000) / 10000;

/* ------------------------------------------------------------------ 3. polls -> elections/<id>.json */
function parsePolls(raw, report, stats) {
  const elections = loadElections(), parsed = [], byElection = {};
  raw.filter(p => !isOfficial(p)).forEach(p => {
    const rec = { id: p.id, title: p.title, createdBy: p.createdBy, date: isoDate(p.createdAt), method: p.method, status: p.status, ballots: (p.tally || {}).totalBallots || 0, included: false };
    const skip = why => { rec.reason = why; parsed.push(rec); if (!/^not a class|hypothetical|embargo|already held|no ballots/.test(why)) report.skippedPolls.push(`${p.id} "${p.title}": ${why}`); };
    const cls = classOf(p.title);
    if (p.resultsEmbargoed) return skip('embargoed');
    if (p.propositionsOnly || !p.tally || !rec.ballots) return skip('no ballots yet');
    if (cls == null) return skip('not a class race poll');
    if (/hypothetical|mock/i.test(p.title)) return skip('hypothetical / mock');
    if (!['fptp', 'rcv'].includes(p.method)) return skip(`method ${p.method} not supported for race polls`);
    // the upcoming election of that class: latest-dated file not already over when the poll was made
    const cands = elections.filter(e => classOf(e.data.title) === cls && daysBetween(e.data.electionDate, rec.date) >= -2 && daysBetween(e.data.electionDate, rec.date) <= cfg.pollWindowDays)
      .sort((a, b) => new Date(a.data.electionDate) - new Date(b.data.electionDate));
    if (!cands.length) return skip(`no election file for Class ${cls} around ${rec.date}`);
    const el = cands[0], votes = firstRound(p), n = rec.ballots;
    // history is frozen: once an election's date has passed, its hand-curated poll list is never touched
    if (daysBetween(TODAY, el.data.electionDate) > 1) return skip(`election ${el.data.id} already held (history frozen)`);
    const shares = {}, unmapped = [], considered = p.options.filter(o => !resolve(o.name, el.data).ignored);
    let ok = 0;
    p.options.forEach(o => {
      const r = resolve(o.name, el.data);
      if (r.ignored) return;
      if (r.id && r.inField) { shares[r.id] = r4(votes[o.id] / n); ok++; } else unmapped.push(o.name + (r.id ? ` (=${r.id}, not in this field)` : ''));
    });
    if (ok < 2 || ok / considered.length < 0.8) return skip(`options don't match ${el.data.id} field: ${unmapped.join(', ')}`);
    if (unmapped.length) report.unmapped.push(`${p.id} -> ${el.data.id}: ${unmapped.join(', ')}`);
    const entry = { id: 'bt-' + p.id.replace(/^poll_t3_/, '').replace(/_\d+$/, ''), pollster: pollster(p), date: rec.date, sample: n, weight: 1.0, shares, source: 'ballottsr', sourceId: p.id, status: p.status, method: p.method, permalink: p.permalink };
    if (cfg.includeGroups && p.tally.groupPct) {
      entry.groups = {};
      Object.entries(p.tally.groupPct).forEach(([g, pct]) => {
        const gs = {}; p.options.forEach(o => { const r = resolve(o.name, el.data); if (r.id && r.inField) gs[r.id] = r4((pct[o.id] || 0) / 100); });
        entry.groups[g] = { sample: p.tally.groupBallotCount[g], shares: gs };
      });
    }
    rec.included = true; rec.electionId = el.data.id; rec.pollster = entry.pollster; rec.shares = shares; parsed.push(rec);
    (byElection[el.data.id] = byElection[el.data.id] || []).push(entry);
  });
  // merge into each election file: drop previous auto polls + superseded hand-entered snapshots, add fresh ones
  elections.forEach(e => {
    const fresh = (byElection[e.data.id] || []).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const kept = (e.data.polls || []).filter(p => p.source !== 'ballottsr' && !(cfg.supersede || []).includes(p.id));
    const next = Object.assign({}, e.data, { polls: kept.concat(fresh) });
    if (!same(next, e.data)) { writeIfChanged(e.file, next); stats.electionFiles.push(e.data.id); }
  });
  writeIfChanged(BT('parsed', 'polls.json'), { polls: parsed.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)) });
  stats.pollsIncluded = parsed.filter(p => p.included).length;
}

/* ------------------------------------------------------------------ 4. official elections -> results overlay */
function parseElections(raw, report, stats) {
  const elections = loadElections(), results = [], official = [];
  let baseResults = []; try { baseResults = readJSON(P('data', 'tsrelects-results.json')); } catch (e) {}
  raw.filter(isOfficial).forEach(p => {
    const t = p.tally || {}, nm = Object.fromEntries(p.options.map(o => [o.id, o.name]));
    const rec = { id: p.id, title: p.title, createdBy: p.createdBy, date: isoDate(p.createdAt), method: p.method, status: p.status, ballots: t.totalBallots || 0 };
    if (p.resultsEmbargoed) { report.skippedElections.push(`${p.id} "${p.title}": resultsEmbargoed -- not published`); return; }
    const cls = classOf(p.title);
    const el = cls == null ? null : elections.filter(e => classOf(e.data.title) === cls && Math.abs(daysBetween(e.data.electionDate, rec.date)) <= 45)
      .sort((a, b) => Math.abs(daysBetween(a.data.electionDate, rec.date)) - Math.abs(daysBetween(b.data.electionDate, rec.date)))[0];
    const field = el ? el.data : null;
    rec.opts = p.options.map(o => ({ name: o.name, id: field ? resolve(o.name, field).id : null, firstRound: (t.rounds && t.rounds[0] ? t.rounds[0].tallies[o.id] : (t.finalPct && t.finalPct[o.id] != null ? Math.round(t.finalPct[o.id] * rec.ballots / 100) : null)) }));
    if (t.rounds) rec.rounds = t.rounds.map(r => ({ round: r.round, tallies: Object.fromEntries(Object.entries(r.tallies).map(([k, v]) => [nm[k], v])), exhausted: r.exhausted }));
    if (t.winnerId) rec.winner = nm[t.winnerId];
    if (p.propositions && p.propositions.length) rec.propositions = p.propositions.map(x => ({ number: x.number, name: x.name, author: x.author, result: (p.propositionResults || {})[x.id] || null }));
    if (p.propositionsOnly || !t.groupPct || cls == null) { rec.kind = cls == null ? 'referendum/other' : 'propositions'; official.push(rec); return; }
    rec.kind = 'race';
    const id = field ? field.id : `class${cls}-${rec.date.slice(0, 4)}-${rec.date.slice(5, 7)}`;
    const title = field ? field.title : p.title;
    const race = {}, bad = [];
    Object.entries(t.groupBallotCount).forEach(([g, count]) => {
      race[g] = {};
      p.options.forEach(o => {
        const r = resolve(o.name, field); if (r.ignored) return;
        if (!r.id) { if (!bad.includes(o.name)) bad.push(o.name); return; }
        race[g][r.id] = Math.round(((t.groupPct[g] || {})[o.id] || 0) * count / 100);
      });
    });
    if (bad.length) report.unmapped.push(`${p.id} -> ${id}: ${bad.join(', ')}`);
    const live = p.status !== 'closed', nGroups = Object.keys(race).length;
    const entry = { id, title, date: field ? field.electionDate : rec.date, party: 'Regular', precincts_reporting: live ? nGroups : 100, precincts_total: live ? 9 : 100,
      source: 'ballottsr', ...(live ? { live: true } : {}), first_round: { races: { [title.replace(/ (Mod )?Election$/, '') + ' First Round']: race } } };
    results.push(entry); rec.resultId = id; official.push(rec);
    // sanity check against the hand-curated results when both exist
    const base = baseResults.find(b => b.id === id);
    if (base) {
      const tot = o => { const x = {}; Object.values(o).forEach(g => Object.entries(g).forEach(([k, v]) => x[k] = (x[k] || 0) + v)); return x; };
      const a = tot(Object.values(entry.first_round.races)[0]), b = tot(Object.values((base.first_round || {}).races || {})[0] || {});
      const diffs = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => (a[k] || 0) !== (b[k] || 0)).map(k => `${k}: ballottsr ${a[k] || 0} vs site ${b[k] || 0}`);
      const known = (cfg.knownDiscrepancies || {})[id];
      report.crossChecks.push(`${id}: ${diffs.length ? (known ? 'known difference (' + known + ') ' : 'MISMATCH ') + diffs.join('; ') : 'first-round totals match tsrelects-results.json'}`);
    }
  });
  results.sort((a, b) => b.date.localeCompare(a.date));
  stats.resultsChanged = writeIfChanged(BT('results.json'), { _comment: 'AUTO-GENERATED by tools/ballottsr-sync.js from official BallotTSR elections. Same shape as tsrelects-results.json (first round only, no race calls). Entries already present in tsrelects-results.json take precedence.', elections: results });
  writeIfChanged(BT('parsed', 'official.json'), { elections: official.sort((a, b) => b.date.localeCompare(a.date)) });
  stats.officialCount = official.length;
}

/* debug:  node tools/ballottsr-sync.js --resolve "Junglejumpersfan/Teammomofan" --election class2-2026-10 */
if (arg('resolve', false)) {
  let el = null; const id = arg('election', null);
  if (id && id !== true) el = readJSON(P('data', 'elections', id + '.json'));
  console.log(JSON.stringify({ name: arg('resolve'), alternatives: alts(arg('resolve')), result: resolve(String(arg('resolve')), el) })); process.exit(0);
}

/* ------------------------------------------------------------------ main */
(async () => {
  const stats = { skipped: 0, unchanged: 0, fetchedChanged: [], errors: [], electionFiles: [], indexChanged: false };
  const report = { unmapped: [], skippedPolls: [], skippedElections: [], crossChecks: [] };
  await mirror(stats);
  const raw = readRaw();
  if (KIND !== 'elections') parsePolls(raw, report, stats);
  if (KIND !== 'polls') parseElections(raw, report, stats);
  // report keeps the other kind's findings when only one kind runs
  let prev = {}; try { prev = readJSON(BT('report.json')); } catch (e) {}
  const merged = KIND === 'all' ? report : Object.assign({}, prev, KIND === 'polls' ? { unmapped: report.unmapped, skippedPolls: report.skippedPolls } : { skippedElections: report.skippedElections, crossChecks: report.crossChecks });
  ['unmapped', 'skippedPolls', 'skippedElections', 'crossChecks'].forEach(k => { merged[k] = merged[k] || []; });
  writeIfChanged(BT('report.json'), merged);
  // meta only moves when something real changed (keeps git history quiet)
  const changed = stats.fetchedChanged.length || stats.electionFiles.length || stats.resultsChanged;
  if (changed) {
    let meta = {}; try { meta = readJSON(BT('meta.json')); } catch (e) {}
    const now = new Date().toISOString();
    if (KIND !== 'elections' && (stats.electionFiles.length || stats.fetchedChanged.some(id => !raw.find(r => r.id === id && isOfficial(r))))) meta.pollsChangedAt = now;
    if (KIND !== 'polls' && (stats.resultsChanged || stats.fetchedChanged.some(id => raw.find(r => r.id === id && isOfficial(r))))) meta.electionsChangedAt = now;
    writeIfChanged(BT('meta.json'), meta);
  }
  console.log(`[ballottsr] kind=${KIND} source=${SOURCE}`);
  console.log(`  mirror: ${stats.fetchedChanged.length} changed, ${stats.unchanged} unchanged, ${stats.skipped} skipped (closed)${stats.indexChanged ? ', index updated' : ''}`);
  if (KIND !== 'elections') console.log(`  polls: ${stats.pollsIncluded} included in elections; files changed: ${stats.electionFiles.join(', ') || 'none'}`);
  if (KIND !== 'polls') console.log(`  elections: ${stats.officialCount} official parsed; results.json ${stats.resultsChanged ? 'updated' : 'unchanged'}`);
  merged.crossChecks.forEach(x => console.log('  check: ' + x));
  if (merged.unmapped.length) console.log(`  ${merged.unmapped.length} poll(s) with unmapped names (see data/ballottsr/report.json)`);
  if (stats.errors.length) { console.error('  ERRORS:\n   ' + stats.errors.join('\n   ')); process.exitCode = 1; }
})().catch(e => { console.error('[ballottsr] FAILED:', e.message); process.exit(1); });
