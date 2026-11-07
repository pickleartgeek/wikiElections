/**
 * Overrides layer.
 * ------------------
 * GitHub Pages is static — there's no server to write files. So the
 * in-site Admin panel stores edits (poll additions, race calls,
 * turnout/reporting numbers, site mode) in the browser's
 * localStorage under OVR_KEY, and every page merges those overrides
 * on top of the checked-in JSON files at load time.
 *
 * This means admin edits are visible immediately to whoever made
 * them (and persist across their visits), but are NOT visible to
 * other visitors until the site owner uses "Export updated JSON"
 * in the admin panel and commits the downloaded file(s) to the repo.
 * The admin panel explains this; see admin/index.html.
 */
const OVR_KEY = 'wikiElections_overrides_v1';

function OVR_load() {
  try {
    const raw = localStorage.getItem(OVR_KEY);
    return raw ? OVR_migrateIds(JSON.parse(raw)) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Re-key overrides saved under pre-rename election IDs (class7-26, 'Class 6 July', ...) to the
 * canonical class<N>-<YYYY>-<MM> form. Idempotent; writes back once if anything changed.
 */
function OVR_migrateIds(o) {
  if (!o || typeof o !== 'object' || typeof EID_canon !== 'function') return o || {};
  let changed = false;
  ['elections', 'results', 'pollsAdded', 'tsrResults'].forEach(k => {
    const src = o[k]; if (!src || typeof src !== 'object') return;
    const out = {};
    Object.keys(src).forEach(id => {
      const c = EID_canon(id); if (c !== id) changed = true;
      out[c] = (c in out) ? (Array.isArray(out[c]) ? out[c].concat(src[id]) : OVR_deepMerge(out[c], src[id])) : src[id];
    });
    o[k] = out;
  });
  const sc = o.siteConfig;
  if (sc && typeof sc === 'object') {
    ['activePollsId'].forEach(k => { if (sc[k] && EID_canon(sc[k]) !== sc[k]) { sc[k] = EID_canon(sc[k]); changed = true; } });
    if (Array.isArray(sc.electsIds)) { const n = sc.electsIds.map(EID_canon); if (n.join() !== sc.electsIds.join()) { sc.electsIds = n; changed = true; } }
    if (Array.isArray(sc.activeElections)) sc.activeElections.forEach(e => { if (e && e.pollsId && EID_canon(e.pollsId) !== e.pollsId) { e.pollsId = EID_canon(e.pollsId); changed = true; } });
  }
  if (changed) { try { localStorage.setItem(OVR_KEY, JSON.stringify(o)); } catch (e) {} }
  return o;
}

function OVR_save(obj) {
  localStorage.setItem(OVR_KEY, JSON.stringify(obj));
}

function OVR_clearAll() {
  localStorage.removeItem(OVR_KEY);
}

/** Deep-ish merge helper: override object's keys win, arrays are replaced wholesale. */
function OVR_deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(override)) return override;
  if (typeof override !== 'object') return override;
  const result = Object.assign({}, base);
  Object.keys(override).forEach(k => {
    if (typeof override[k] === 'object' && !Array.isArray(override[k]) && typeof base[k] === 'object' && base[k] !== null) {
      result[k] = OVR_deepMerge(base[k], override[k]);
    } else {
      result[k] = override[k];
    }
  });
  return result;
}

function OVR_getSiteConfig(baseConfig) {
  const ovr = OVR_load();
  return OVR_deepMerge(baseConfig, ovr.siteConfig);
}

function OVR_getElection(baseElection, electionId) {
  const ovr = OVR_load();
  const e = ovr.elections && ovr.elections[electionId];
  return OVR_deepMerge(baseElection, e);
}

function OVR_getResults(baseResults, electionId) {
  const ovr = OVR_load();
  const r = ovr.results && ovr.results[electionId];
  return OVR_deepMerge(baseResults, r);
}

function OVR_getPolls(basePollsFile, electionId) {
  const ovr = OVR_load();
  const extra = (ovr.pollsAdded && ovr.pollsAdded[electionId]) || [];
  return {
    electionId: basePollsFile.electionId,
    polls: basePollsFile.polls.concat(extra)
  };
}

function OVR_setSiteConfig(partial) {
  const ovr = OVR_load();
  ovr.siteConfig = OVR_deepMerge(ovr.siteConfig || {}, partial);
  OVR_save(ovr);
}

function OVR_setElection(electionId, partial) {
  const ovr = OVR_load();
  ovr.elections = ovr.elections || {};
  ovr.elections[electionId] = OVR_deepMerge(ovr.elections[electionId] || {}, partial);
  OVR_save(ovr);
}

function OVR_setResults(electionId, partial) {
  const ovr = OVR_load();
  ovr.results = ovr.results || {};
  ovr.results[electionId] = OVR_deepMerge(ovr.results[electionId] || {}, partial);
  OVR_save(ovr);
}

function OVR_addPoll(electionId, poll) {
  const ovr = OVR_load();
  ovr.pollsAdded = ovr.pollsAdded || {};
  ovr.pollsAdded[electionId] = ovr.pollsAdded[electionId] || [];
  ovr.pollsAdded[electionId].push(poll);
  OVR_save(ovr);
}

/* ---------- Approval / track-record poll additions ---------- */
// Shape: ovr.approvalPollsAdded[kind][key] = [poll, poll, ...]
// kind is 'moderators' or 'questions', key is the moderator/question id.

function OVR_addApprovalPoll(kind, key, poll) {
  const ovr = OVR_load();
  ovr.approvalPollsAdded = ovr.approvalPollsAdded || {};
  ovr.approvalPollsAdded[kind] = ovr.approvalPollsAdded[kind] || {};
  ovr.approvalPollsAdded[kind][key] = ovr.approvalPollsAdded[kind][key] || [];
  ovr.approvalPollsAdded[kind][key].push(poll);
  OVR_save(ovr);
}

function OVR_setApprovalStatus(kind, key, status, extra) {
  const ovr = OVR_load();
  ovr.approvalStatus = ovr.approvalStatus || {};
  ovr.approvalStatus[kind] = ovr.approvalStatus[kind] || {};
  ovr.approvalStatus[kind][key] = extra ? Object.assign({ status }, extra) : status;
  OVR_save(ovr);
}

/**
 * Moderator terms. An approval entry may carry `terms` (chronological): {id, seat, label?, role?, status:'current'|'former', end?, electionId?}.
 * A poll may carry `term` (a term id); an untagged poll belongs to the current term, so new Census polls land on the seat held now.
 * Returns a copy of the entry viewing ONE term (default: the latest term that has polls): polls/role/seat are that term's, and
 *   carryOver  -- the person now holds a different (current) term than the one shown
 *   pending    -- label of the current term when it has no polls yet
 *   frozenAsOf -- when the viewed term is over, the date its approval is frozen at
 * Entries without `terms` are returned unchanged.
 */
function OVR_viewTerm(entry, termId) {
  if (!entry || !Array.isArray(entry.terms) || !entry.terms.length) return entry;
  const all = entry.allPolls || entry.polls, terms = entry.terms;
  const cur = terms.filter(t => t.status === 'current').pop() || null;
  const tid = p => p.term || (cur && cur.id) || terms[terms.length - 1].id;
  const n = {}, last = {};
  all.forEach(p => { const t = tid(p); p._t = t; n[t] = (n[t] || 0) + 1; if (!last[t] || p.date > last[t]) last[t] = p.date; });
  let target = termId && terms.find(t => t.id === termId);
  if (!target) target = terms.filter(t => n[t.id]).sort((a, b) => (last[a.id] || '').localeCompare(last[b.id] || '') || ((b.role ? 1 : 0) - (a.role ? 1 : 0)) || terms.indexOf(a) - terms.indexOf(b)).pop() || cur || terms[terms.length - 1];
  const out = Object.assign({}, entry), over = target.status === 'former';
  out.allPolls = all; out.polls = all.filter(p => tid(p) === target.id);
  out.terms = terms.map(t => Object.assign({}, t, { n: n[t.id] || 0, last: last[t.id] || '' }));
  if (target.role && !over) out.role = target.role; else delete out.role;   // an office title replaces the handle only while it is the current term
  if (target.candidateKey) out.candidateKey = target.candidateKey;
  out.seat = target.label || target.seat; out.termId = target.id; out.termStatus = target.status;
  out.carryOver = !!cur && cur.id !== target.id;
  out.pending = out.carryOver && !n[cur.id] ? (cur.label || cur.seat) : '';
  out.status = (over && !cur) || entry.status === 'former' ? 'former' : 'current';
  out.frozenAsOf = over ? (target.end || last[target.id] || '') : '';
  out.termEnd = over ? (target.end || '') : '';
  return out;
}

/** Merge added polls + status overrides on top of the checked-in approval-polls.json. */
function OVR_setApprovalTerms(key, terms) {
  const ovr = OVR_load();
  ovr.approvalTerms = ovr.approvalTerms || {};
  if (terms && terms.length) ovr.approvalTerms[key] = terms; else delete ovr.approvalTerms[key];
  OVR_save(ovr);
}

/** raw=true skips the per-term view, returning the plain merged data (what the admin exports). */
function OVR_getApprovalData(base, raw) {
  const ovr = OVR_load();
  const added = ovr.approvalPollsAdded || {};
  const statusOvr = ovr.approvalStatus || {};
  const termsOvr = ovr.approvalTerms || {};
  const result = { moderators: {}, questions: {} };
  ['moderators', 'questions'].forEach(kind => {
    const baseGroup = base[kind] || {};
    result[kind] = {};
    Object.keys(baseGroup).forEach(key => {
      const entry = JSON.parse(JSON.stringify(baseGroup[key]));
      entry.polls = entry.polls.concat((added[kind] && added[kind][key]) || []);
      if (kind === 'moderators' && termsOvr[key]) entry.terms = JSON.parse(JSON.stringify(termsOvr[key]));
      const so = statusOvr[kind] && statusOvr[kind][key];
      if (so && typeof so === 'object') { ['status', 'role', 'termEnd'].forEach(f => { if (so[f]) entry[f] = so[f]; else if (f !== 'status' && so[f] === '') delete entry[f]; }); }
      else if (so) entry.status = so;
      result[kind][key] = kind === 'moderators' && !raw ? OVR_viewTerm(entry) : entry;
    });
  });
  return result;
}

/* ---------- Party support / membership poll additions ---------- */
// Shape: ovr.partyPollsAdded = [poll, poll, ...]

function OVR_addPartyPoll(poll) {
  const ovr = OVR_load();
  ovr.partyPollsAdded = ovr.partyPollsAdded || [];
  ovr.partyPollsAdded.push(poll);
  OVR_save(ovr);
}

function OVR_getPartyPolls(basePartyPolls) {
  const ovr = OVR_load();
  const extra = ovr.partyPollsAdded || [];
  return { polls: basePartyPolls.polls.concat(extra) };
}

/* ---------- Articles (admin-written CMS content) ---------- */
// Shape: ovr.articles[id] = { ...full article object... } (new or edited)
// ovr.articleDeletes = [id, id, ...] (ids removed from the base list)

function OVR_setArticle(id, articleObj) {
  const ovr = OVR_load();
  ovr.articles = ovr.articles || {};
  ovr.articles[id] = articleObj;
  // Un-delete if it was previously marked deleted, then re-saved.
  if (ovr.articleDeletes) ovr.articleDeletes = ovr.articleDeletes.filter(x => x !== id);
  OVR_save(ovr);
}

function OVR_deleteArticle(id) {
  const ovr = OVR_load();
  ovr.articleDeletes = ovr.articleDeletes || [];
  if (!ovr.articleDeletes.includes(id)) ovr.articleDeletes.push(id);
  if (ovr.articles) delete ovr.articles[id];
  OVR_save(ovr);
}

/** Merge base articles.json with local admin edits/additions/deletions. */
function OVR_getArticles(baseArticles) {
  const ovr = OVR_load();
  const edits = ovr.articles || {};
  const deletes = ovr.articleDeletes || [];
  const merged = baseArticles
    .filter(a => !deletes.includes(a.id))
    .map(a => edits[a.id] ? OVR_deepMerge(a, edits[a.id]) : a);
  // Any edited/new article whose id isn't in the base list yet (brand new, not exported) gets appended.
  Object.keys(edits).forEach(id => {
    if (!baseArticles.some(a => a.id === id) && !deletes.includes(id)) merged.push(edits[id]);
  });
  return merged;
}
// Shape: ovr.tsrResults[electionId][roundKey] = {
//   turnout, precincts_reporting, precincts_total,
//   races: { raceName: { groupId: { candKey: votes } } },
//   race_calls: { raceName: { status, winner } }
// }

function OVR_setTsrRoundStats(electionId, roundKey, partial) {
  const ovr = OVR_load();
  ovr.tsrResults = ovr.tsrResults || {};
  ovr.tsrResults[electionId] = ovr.tsrResults[electionId] || {};
  ovr.tsrResults[electionId][roundKey] = OVR_deepMerge(ovr.tsrResults[electionId][roundKey] || {}, partial);
  OVR_save(ovr);
}

function OVR_setTsrRaceCall(electionId, roundKey, raceName, callObj) {
  OVR_setTsrRoundStats(electionId, roundKey, { race_calls: { [raceName]: callObj } });
}

function OVR_setTsrGroupVotes(electionId, roundKey, raceName, groupId, votesObj) {
  OVR_setTsrRoundStats(electionId, roundKey, { races: { [raceName]: { [groupId]: votesObj } } });
}

/** Apply every stored tsrResults override on top of the real (fetched) elections array. */
function OVR_getTsrElections(baseElections) {
  const ovr = OVR_load();
  const overridesByElection = ovr.tsrResults || {};
  if (Object.keys(overridesByElection).length === 0) return baseElections;

  return baseElections.map(election => {
    const eOvr = overridesByElection[election.id];
    if (!eOvr) return election;
    const cloned = JSON.parse(JSON.stringify(election));
    ['first_round', 'runoff_round'].forEach(roundKey => {
      const roundOvr = eOvr[roundKey];
      if (!roundOvr || !cloned[roundKey]) return;
      if (roundOvr.turnout !== undefined) cloned[roundKey].turnout = roundOvr.turnout;
      if (roundOvr.precincts_reporting !== undefined) cloned[roundKey].precincts_reporting = roundOvr.precincts_reporting;
      if (roundOvr.precincts_total !== undefined) cloned[roundKey].precincts_total = roundOvr.precincts_total;
      if (roundOvr.race_calls) {
        cloned[roundKey].race_calls = Object.assign({}, cloned[roundKey].race_calls, roundOvr.race_calls);
      }
      if (roundOvr.races) {
        Object.entries(roundOvr.races).forEach(([raceName, groups]) => {
          if (!cloned[roundKey].races[raceName]) return;
          Object.entries(groups).forEach(([groupId, votes]) => {
            cloned[roundKey].races[raceName][groupId] = Object.assign(
              {}, cloned[roundKey].races[raceName][groupId], votes
            );
          });
        });
      }
    });
    return cloned;
  });
}
