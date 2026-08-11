/**
 * BaseCalc
 * ---------
 * Implements the actual documented DDTSR methodology from PickleArtGeek's
 * "Understanding ProbCalc" guide (see guide.html for the full writeup and
 * a downloadable copy) rather than an invented weighting scheme:
 *
 *   for each poll p and candidate i measured in it:
 *     contribution(i, p) = (share_i * sample_p) / (daysTillElection_p * 100)
 *   alpha_i = sum of contribution(i, p) across every poll that measured i
 *   percentage_i = alpha_i / sum(all alpha)
 *
 * daysTillElection = electionDate - poll.date, in days, floored at 1 (a
 * poll released on or after the reference date is treated as 1 day out
 * rather than dividing by zero/going negative). Bigger sample = more
 * weight; a poll closer to election day = more weight (smaller divisor);
 * the *100 keeps alpha small, which is intentional -- it's what keeps
 * ProbCalc's simulations appropriately uncertain rather than falsely
 * overconfident (see guide.html, II.I.ii).
 *
 * These raw alpha_i values are exactly what ProbCalc (probcalc.js) feeds
 * into its Gamma(alpha_i, 1) simulation -- BaseCalc and ProbCalc share
 * one alpha, per the guide, rather than BaseCalc computing a plain
 * average and ProbCalc re-deriving its own separate shape parameter.
 *
 * IMPORTANT: fields not present in a given poll's `shares` (a candidate
 * who hadn't entered the race yet, or who had already dropped out) are
 * excluded from that candidate's alpha entirely -- never treated as a 0%
 * showing.
 */

/** Days between a poll's date and the reference "election day", floored at 1. */
function BaseCalc_daysUntil(pollDateStr, electionDateStr) {
  const pollT = new Date(pollDateStr).getTime();
  const electT = new Date(electionDateStr).getTime();
  const days = (electT - pollT) / (24 * 60 * 60 * 1000);
  return Math.max(days, 1);
}

/**
 * @param {Array} polls - array of poll objects {shares:{candId:share}, sample, date, pollster}
 * @param {Array<string>} candidateIds
 * @param {string} electionDate - ISO date string used as the "election day" reference
 *   for recency weighting. For a future/completed election, its actual date. For
 *   ongoing approval tracking with no election day, pass today's date (UTC) instead --
 *   see approval.html.
 * @returns {Object} { alphas: {candId: rawAlpha}, averages: {candId: pct 0-1},
 *   coverage: {candId: pollCount}, totalAlpha, n, sorted: [[candId, pct], ...] }
 */
function BaseCalc_aggregate(polls, candidateIds, electionDate) {
  const alphas = {};
  const coverage = {};
  candidateIds.forEach(id => { alphas[id] = 0; coverage[id] = 0; });

  polls.forEach(poll => {
    const daysTill = BaseCalc_daysUntil(poll.date, electionDate);
    const sample = typeof poll.sample === 'number' ? poll.sample : 50;
    candidateIds.forEach(id => {
      if (poll.shares && typeof poll.shares[id] === 'number') {
        alphas[id] += (poll.shares[id] * sample) / (daysTill * 100);
        coverage[id] += 1;
      }
    });
  });

  const totalAlpha = Object.values(alphas).reduce((a, b) => a + b, 0);
  const averages = {};
  candidateIds.forEach(id => {
    averages[id] = totalAlpha > 0 ? alphas[id] / totalAlpha : 0;
  });

  const sorted = Object.entries(averages)
    .filter(([id]) => coverage[id] > 0)
    .sort((a, b) => b[1] - a[1]);

  return { alphas, averages, coverage, totalAlpha, n: polls.length, sorted };
}

/**
 * Simple trend: average of the most recent `windowSize` polls vs. the
 * full-window average, so the UI can show movement arrows.
 */
function BaseCalc_trend(polls, candidateIds, electionDate, windowSize = 3) {
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = sortedPolls.slice(-windowSize);
  const older = sortedPolls.slice(0, Math.max(0, sortedPolls.length - windowSize));

  const recentAgg = BaseCalc_aggregate(recent, candidateIds, electionDate).averages;
  const olderAgg = older.length ? BaseCalc_aggregate(older, candidateIds, electionDate).averages : recentAgg;

  const delta = {};
  candidateIds.forEach(id => {
    delta[id] = recentAgg[id] - olderAgg[id];
  });
  return delta;
}

/**
 * Rolling N-day average, RCP-style: for each date a poll was released,
 * average every poll whose date falls within [date - windowDays, date].
 * On days with no poll, the line holds flat at the last computed value
 * (carry-forward) rather than dropping out or interpolating.
 *
 * @returns {Array<{date, averages: {candId: pct}}>} one point per unique poll date, sorted ascending
 */
function BaseCalc_rollingAverage(polls, candidateIds, electionDate, windowDays = 3) {
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));
  const uniqueDates = [...new Set(sortedPolls.map(p => p.date))].sort((a, b) => new Date(a) - new Date(b));
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const points = [];
  let lastAverages = null;

  uniqueDates.forEach(dateStr => {
    const asOf = new Date(dateStr).getTime();
    const windowPolls = sortedPolls.filter(p => {
      const t = new Date(p.date).getTime();
      return t <= asOf && t > asOf - windowMs;
    });
    if (windowPolls.length > 0) {
      lastAverages = BaseCalc_aggregate(windowPolls, candidateIds, electionDate).averages;
    }
    points.push({ date: dateStr, averages: lastAverages || {} });
  });

  return points;
}

/**
 * Determine which candidates are still "active" as of the most recent
 * poll in the dataset. A candidate who only shows up in older polls but
 * is absent from the latest poll date has most likely dropped out (or
 * hasn't declared) and should be excluded from current standings/
 * averages/win-probability -- even though their earlier numbers are
 * real and should still show up in the raw poll table and trend chart
 * up to the point they stopped being polled.
 */
function BaseCalc_currentCandidates(polls, candidateIds) {
  if (!polls.length) return candidateIds;
  const mostRecentDate = polls.reduce((latest, p) => (new Date(p.date) > new Date(latest) ? p.date : latest), polls[0].date);
  const latestPolls = polls.filter(p => p.date === mostRecentDate);
  const active = new Set();
  latestPolls.forEach(p => { Object.keys(p.shares || {}).forEach(k => active.add(k)); });
  const filtered = candidateIds.filter(id => active.has(id));
  return filtered.length ? filtered : candidateIds; // safety net: never return an empty field
}

/**
 * Write-in polling methodology discount: real-world polling consistently
 * overstates write-in support relative to actual ballot-box performance --
 * a respondent will happily tell a pollster "I'm writing them in," then
 * doesn't bother when it's an actual ballot. Returns a deep-cloned poll
 * list with each flagged candidate's reported share scaled down by
 * `factor` before it ever reaches BaseCalc/ProbCalc, so the discount
 * flows through the average, the trend chart, and the win-probability
 * model consistently. Everyone else's shares are untouched. Meant for
 * DDTSR's composite view only -- leave a pollster's own raw releases
 * (e.g. Spinner Insights' poll cards) unmodified, since those are a
 * historical record of what was actually reported.
 */
function BaseCalc_applyWriteInDiscount(polls, writeInIds, factor = 0.55) {
  if (!writeInIds || !writeInIds.length) return polls;
  return polls.map(poll => {
    if (!poll.shares) return poll;
    const shares = Object.assign({}, poll.shares);
    writeInIds.forEach(id => {
      if (typeof shares[id] === 'number') shares[id] = shares[id] * factor;
    });
    return Object.assign({}, poll, { shares });
  });
}

if (typeof window !== 'undefined') {
  window.BaseCalc_daysUntil = BaseCalc_daysUntil;
  window.BaseCalc_aggregate = BaseCalc_aggregate;
  window.BaseCalc_trend = BaseCalc_trend;
  window.BaseCalc_rollingAverage = BaseCalc_rollingAverage;
  window.BaseCalc_currentCandidates = BaseCalc_currentCandidates;
  window.BaseCalc_applyWriteInDiscount = BaseCalc_applyWriteInDiscount;
}
