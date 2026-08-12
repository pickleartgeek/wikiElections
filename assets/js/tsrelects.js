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
