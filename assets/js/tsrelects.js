/**
 * TSRElects data helpers.
 * ------------------------
 * Works directly against the real TSR Elects results.json schema:
 * an array of elections, each with first_round / runoff_round, each
 * round holding one or more named races (group -> candidateKey ->
 * votes), plus optional race_calls keyed by race name.
 */

function TSR_normalizeKey(k) {
  return String(k).toLowerCase().replace(/\d+$/, '');
}

function TSR_candidate(registry, key) {
  return (registry.candidates && registry.candidates[key]) || { name: key, color: '#888888', party: null };
}
function TSR_candidateName(registry, key) { return TSR_candidate(registry, key).name; }
function TSR_candidateColor(registry, key) { return TSR_candidate(registry, key).color; }
function TSR_candidateParty(registry, key) { return TSR_candidate(registry, key).party; }
function TSR_party(registry, partyKey) {
  return (registry.parties && registry.parties[partyKey]) || null;
}

function TSR_electionType(e) {
  if (e.type) return e.type;
  if (e.party === 'Special' || e.party === 'Regular') return e.party;
  return 'Regular';
}

/** Sum of every vote in a round object (used to tell if a runoff round has actually been held yet). */
function TSR_roundVoteSum(roundData) {
  if (!roundData) return 0;
  const races = roundData.races || {};
  let sum = 0;
  Object.values(races).forEach(raceData => {
    Object.values(raceData).forEach(groupVotes => {
      Object.values(groupVotes).forEach(v => { sum += v; });
    });
  });
  return sum;
}

/** Pick a sensible default round: the runoff if it's actually been held, otherwise the first round. */
function TSR_defaultRoundKey(election) {
  if (election.runoff_round && TSR_roundVoteSum(election.runoff_round) > 0) return 'runoff_round';
  return 'first_round';
}

function TSR_getRoundData(election, roundKey) {
  if (roundKey === 'runoff_round') return election.runoff_round;
  return election.first_round || election; // legacy fallback: races live at election root
}

function TSR_getRaces(roundData) {
  return (roundData && (roundData.races || roundData)) || {};
}

function TSR_getRaceCall(roundData, raceName) {
  if (!roundData) return null;
  const calls = roundData.race_calls || roundData.calls || null;
  return (calls && calls[raceName]) || null;
}

/**
 * Race calls used to support exactly one "winner" id. A runoff call can
 * legitimately advance more than one candidate (e.g. a multi-seat runoff,
 * or a close race where two candidates are both called through), so this
 * normalizes a call's advancing candidate(s) into an array regardless of
 * whether the data uses the newer `winners: [...]` array or the older
 * single `winner: "id"` string -- callers should always use this instead
 * of reading `call.winner` directly.
 */
function TSR_callWinners(call) {
  if (!call) return [];
  if (Array.isArray(call.winners)) return call.winners.filter(Boolean);
  if (call.winner) return [call.winner];
  return [];
}

/** Totals per candidate across every group for one race. */
function TSR_raceTotals(raceData) {
  const totals = {};
  Object.values(raceData || {}).forEach(groupVotes => {
    Object.entries(groupVotes).forEach(([k, v]) => { totals[k] = (totals[k] || 0) + v; });
  });
  return totals;
}

function TSR_darkenHex(hex, t) {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * (1 - t))},${Math.round(g * (1 - t))},${Math.round(b * (1 - t))})`;
}
function TSR_lightenHex(hex, t) {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

/** Map fill color for a group: blends toward white for close margins, darkens for blowouts. */
function TSR_marginColor(registry, groupVotes) {
  if (!groupVotes) return '#e5e4dc';
  const total = Object.values(groupVotes).reduce((a, b) => a + b, 0);
  if (!total) return '#e5e4dc';
  const sorted = Object.entries(groupVotes).sort((a, b) => b[1] - a[1]);
  const margin = (sorted[0][1] - (sorted[1] ? sorted[1][1] : 0)) / total;
  const base = TSR_candidateColor(registry, sorted[0][0]);
  const MID = 0.35;
  return margin < MID
    ? TSR_lightenHex(base, (1 - margin / MID) * 0.45)
    : TSR_darkenHex(base, ((margin - MID) / (1 - MID)) * 0.30);
}

/** Reporting % and a rough "estimated total votes" from precincts reporting / total. */
function TSR_estimateVotes(roundData, election, votesInSoFar) {
  const reporting = roundData?.precincts_reporting ?? election.precincts_reporting ?? null;
  const total = roundData?.precincts_total ?? election.precincts_total ?? null;
  const reportingPct = (reporting != null && total) ? (reporting / total) * 100 : reporting;
  const estTotal = (reportingPct && reportingPct > 0) ? Math.round(votesInSoFar / (reportingPct / 100)) : votesInSoFar;
  return { reportingPct, estTotal };
}

/* ---------- Shift maps: change in vote share (percentage points) between two elections ---------- */
// Candidates whose ids differ only by a trailing number (nzb / nzb1) are the same candidate.
const TSR_canonId = id => String(id).toLowerCase().replace(/\d+$/, '');
const TSR_fmtShift = d => d == null ? '—' : (d >= 0 ? '+' : '-') + Math.abs(d).toFixed(2);

/** mode: 'candidate' | 'party'. newRace/oldRace: { groupId: { candidateId: votes } }.
 *  Returns { buckets, rep, groups: {gid: {nn, on, d: {bucket: {n, o, d}}}}, state: {nn, on, d} } where n/o are share % and d = n - o. */
function TSR_shift(registry, mode, newRace, oldRace, partyOf) {
  const key = (id, po) => mode === 'party' ? ((po && po(id)) || (registry.candidates[id] || {}).party || 'ua') : TSR_canonId(id);
  const agg = (race, po) => {
    const g = {}, st = {}, rep = {}; let sn = 0;
    Object.entries(race || {}).forEach(([gid, votes]) => {
      const gg = g[gid] = { n: 0, v: {} };
      Object.entries(votes).forEach(([id, v]) => { const k = key(id, po); gg.v[k] = (gg.v[k] || 0) + v; gg.n += v; st[k] = (st[k] || 0) + v; sn += v; rep[k] = rep[k] || id; });
    });
    return { g, st, sn, rep };
  };
  const N = agg(newRace, partyOf), O = agg(oldRace), rep = Object.assign({}, O.rep, N.rep);
  const buckets = [...new Set([...Object.keys(N.st), ...Object.keys(O.st)])].sort((a, b) => (N.st[b] || 0) - (N.st[a] || 0));
  const cell = (nv, nn, ov, on) => { const n = nn ? nv / nn * 100 : null, o = on ? ov / on * 100 : null; return { n, o, d: n != null && o != null ? n - o : null }; };
  const groups = {};
  new Set([...Object.keys(N.g), ...Object.keys(O.g)]).forEach(gid => {
    const a = N.g[gid] || { n: 0, v: {} }, b = O.g[gid] || { n: 0, v: {} }, d = {};
    buckets.forEach(k => { d[k] = cell(a.v[k] || 0, a.n, b.v[k] || 0, b.n); });
    groups[gid] = { nn: a.n, on: b.n, d };
  });
  const sd = {}; buckets.forEach(k => { sd[k] = cell(N.st[k] || 0, N.sn, O.st[k] || 0, O.sn); });
  return { buckets, rep, groups, state: { nn: N.sn, on: O.sn, d: sd } };
}
