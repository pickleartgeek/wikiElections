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
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
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

function OVR_setApprovalStatus(kind, key, status) {
  const ovr = OVR_load();
  ovr.approvalStatus = ovr.approvalStatus || {};
  ovr.approvalStatus[kind] = ovr.approvalStatus[kind] || {};
  ovr.approvalStatus[kind][key] = status;
  OVR_save(ovr);
}

/** Merge added polls + status overrides on top of the checked-in approval-polls.json. */
function OVR_getApprovalData(base) {
  const ovr = OVR_load();
  const added = ovr.approvalPollsAdded || {};
  const statusOvr = ovr.approvalStatus || {};
  const result = { moderators: {}, questions: {} };
  ['moderators', 'questions'].forEach(kind => {
    const baseGroup = base[kind] || {};
    result[kind] = {};
    Object.keys(baseGroup).forEach(key => {
      const entry = JSON.parse(JSON.stringify(baseGroup[key]));
      entry.polls = entry.polls.concat((added[kind] && added[kind][key]) || []);
      if (statusOvr[kind] && statusOvr[kind][key]) entry.status = statusOvr[kind][key];
      result[kind][key] = entry;
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
