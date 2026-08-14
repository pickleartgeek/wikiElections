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

/* ---------- TSR Elects real-results overrides ---------- */
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
