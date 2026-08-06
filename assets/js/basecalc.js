/**
 * BaseCalc
 * ---------
 * Poll aggregation only. Same weighting model as ProbCalc's alpha step,
 * but with no Gamma sampling: this just produces a weighted-average
 * polling line per candidate, RealClearPolling-style.
 *
 * weight used for a given poll = poll.weight * sqrt(poll.sample)
 * (a pollster-assigned reliability weight, scaled by sample size so
 * a 130-person poll counts for more than a 60-person poll of the
 * same weight class).
 */

function BaseCalc_effectiveWeight(poll) {
  const w = typeof poll.weight === 'number' ? poll.weight : 1;
  const n = typeof poll.sample === 'number' ? poll.sample : 50;
  return w * Math.sqrt(n);
}

/**
 * @param {Array} polls - array of poll objects {shares:{candId:share}, weight, sample, date, pollster}
 * @param {Array<string>} candidateIds
 * @returns {Object} { averages: {candId: pct 0-1}, totalWeight, n, sorted: [[candId, pct], ...] }
 */
function BaseCalc_aggregate(polls, candidateIds) {
  const sums = {};
  candidateIds.forEach(id => (sums[id] = 0));
  let totalWeight = 0;

  polls.forEach(poll => {
    const w = BaseCalc_effectiveWeight(poll);
    totalWeight += w;
    candidateIds.forEach(id => {
      const share = poll.shares && typeof poll.shares[id] === 'number' ? poll.shares[id] : 0;
      sums[id] += share * w;
    });
  });

  const averages = {};
  candidateIds.forEach(id => {
    averages[id] = totalWeight > 0 ? sums[id] / totalWeight : 0;
  });

  const sorted = Object.entries(averages).sort((a, b) => b[1] - a[1]);

  return { averages, totalWeight, n: polls.length, sorted };
}

/**
 * Simple trend: average of the most recent `windowSize` polls vs. the
 * full-window average, so the UI can show movement arrows.
 */
function BaseCalc_trend(polls, candidateIds, windowSize = 3) {
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = sortedPolls.slice(-windowSize);
  const older = sortedPolls.slice(0, Math.max(0, sortedPolls.length - windowSize));

  const recentAgg = BaseCalc_aggregate(recent, candidateIds).averages;
  const olderAgg = older.length ? BaseCalc_aggregate(older, candidateIds).averages : recentAgg;

  const delta = {};
  candidateIds.forEach(id => {
    delta[id] = recentAgg[id] - olderAgg[id];
  });
  return delta;
}

if (typeof window !== 'undefined') {
  window.BaseCalc_aggregate = BaseCalc_aggregate;
  window.BaseCalc_trend = BaseCalc_trend;
  window.BaseCalc_effectiveWeight = BaseCalc_effectiveWeight;
}
