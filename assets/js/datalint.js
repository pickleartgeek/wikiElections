/* "Check my data" — browser port of the checks in tools/check-data.js plus article checks.
   DL_run(getJson, articles) -> Promise<{errs, warns, note}>   (getJson(path) fetches a data file) */
async function DL_run(getJson, articles) {
  const errs = [], warns = [], err = m => errs.push(m), warn = m => warns.push(m);
  const PAT = /^class(\d+)-(\d{4})-(\d{2})(?:-[a-z0-9]+)?$/;
  const safe = async p => { try { return await getJson(p); } catch (e) { err(`Could not load ${p}`); return null; } };
  const [reg, idxF, results, plainF, cfg, tlIdx] = await Promise.all(['data/registries.json', 'data/polls-index.json', 'data/tsrelects-results.json', 'data/plain-results.json', 'data/site-config.json', 'data/timelines/index.json'].map(safe));
  const cands = (reg && reg.candidates) || {}, idx = (idxF && idxF.elections) || [], plain = (plainF && plainF.elections) || [];
  const res = Array.isArray(results) ? results : [];
  const dup = (a, w) => { const s = new Set(); a.forEach(x => { if (s.has(x)) err(`${w}: duplicate id "${x}"`); s.add(x); }); };
  idx.forEach(e => { if (!PAT.test(e.id)) err(`polls-index: "${e.id}" is not class<N>-<YYYY>-<MM>`); });
  res.forEach(e => { if (!PAT.test(e.id)) err(`results: "${e.id}" is not class<N>-<YYYY>-<MM>`); });
  dup(idx.map(e => e.id), 'polls-index'); dup(res.map(e => e.id), 'results'); dup(plain.map(e => e.id), 'plain-results');

  // each polled election: file exists, ids match, candidates known, poll shares sane
  for (const e of idx) {
    const f = await safe(`data/elections/${e.id}.json`); if (!f) continue;
    if (f.id !== e.id) err(`${e.id}.json: "id" is "${f.id}"`);
    if (f.electionId !== e.id) err(`${e.id}.json: "electionId" is "${f.electionId}"`);
    const known = new Set([...(f.candidateIds || []), ...(f.writeInIds || [])]);
    known.forEach(c => { if (!cands[c]) err(`${e.id}: candidate "${c}" is missing from registries.json`); });
    (f.polls || []).forEach((p, i) => {
      const s = Object.values(p.shares || {}).reduce((a, b) => a + b, 0);
      if (s < 0.9 || s > 1.05) warn(`${e.id} poll #${i + 1} (${p.pollster || '?'} ${p.date || ''}): shares add up to ${(s * 100).toFixed(1)}%`);
      Object.keys(p.shares || {}).forEach(c => { if (!known.has(c)) warn(`${e.id} poll #${i + 1}: share for "${c}", who isn't listed for this race`); });
    });
    if (!(f.polls || []).length) warn(`${e.id}: no polls entered`);
  }
  // results: candidate keys in registry; elections with no polls / no timeline
  const tl = new Set(((tlIdx && tlIdx.timelines) || []).map(x => x.id));
  res.forEach(e => {
    const miss = new Set();
    ['first_round', 'runoff_round'].forEach(k => Object.values(((e[k] || {}).races) || {}).forEach(race => Object.values(race).forEach(row => Object.keys(row || {}).forEach(c => { if (c !== 'wi' && !cands[c]) miss.add(c); }))));
    if (miss.size) warn(`results ${e.id}: candidate key(s) not in registries.json: ${[...miss].join(', ')}`);
    if (!idx.some(x => x.id === e.id)) warn(`results ${e.id}: no polls on file for this election`);
    if (tl.size && !tl.has(e.id)) warn(`results ${e.id}: no ballot-by-ballot timeline (replay and the forecast need one)`);
  });
  // active elections in site-config
  const act = (cfg && cfg.activeElections) || [];
  act.forEach(a => { if (!idx.some(x => x.id === a.pollsId)) err(`site-config: active "${a.pollsId}" has no polls file`); });

  // articles
  const seen = new Set();
  (articles || []).forEach(a => {
    const w = `article "${a.title || a.id}"`;
    if (seen.has(a.id)) err(`${w}: duplicate id "${a.id}"`); seen.add(a.id);
    if (!a.title) err(`article ${a.id}: no title`);
    if (!a.date || isNaN(Date.parse(a.date))) warn(`${w}: missing or invalid date`);
    if (!a.bodyHtml || a.bodyHtml.replace(/<[^>]*>/g, '').trim().length < 20) warn(`${w}: body is nearly empty`);
    if (!a.published && a.publishAt && isNaN(Date.parse(a.publishAt))) err(`${w}: scheduled but the time is invalid`);
    if (!a.published && a.publishAt && Date.parse(a.publishAt) <= Date.now()) warn(`${w}: scheduled time has passed, so it is live now — export articles.json to make that permanent`);
    if (a.published && a.date && Date.parse(a.date) > Date.now() + 864e5) warn(`${w}: published but dated in the future`);
    (String(a.bodyHtml || '').match(/data-chart='[^']*'|data-chart="[^"]*"/g) || []).forEach(m => {
      try { JSON.parse(m.slice(12, -1).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')); } catch (e) { err(`${w}: a chart has broken data`); }
    });
    (String(a.bodyHtml || '').match(/<img[^>]*>/g) || []).forEach(m => { if (!/alt="[^"]+"/.test(m)) warn(`${w}: image without alt text`); });
  });
  return { errs, warns };
}
