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
 * Turnout-proximity sample weight. A poll's raw sample size used to win
 * outright just by being the biggest -- that rewards an outlier poll that
 * over-samples relative to how many people actually show up. Instead,
 * weight a poll highest when its sample size is closest to the election's
 * anticipatedTurnout (a weighted-average-style kernel centered on the
 * expected electorate size), and taper off the further a poll's sample
 * over- or under-shoots that figure. Falls back to the raw sample size
 * (old behavior) when no anticipatedTurnout is configured for the race.
 */
function BaseCalc_turnoutWeight(sample, anticipatedTurnout) {
  const n = typeof sample === 'number' ? sample : 50;
  if (!anticipatedTurnout || anticipatedTurnout <= 0) return n;
  const ratio = n / anticipatedTurnout;
  const sigma = 0.5; // width of the "matches turnout" sweet spot, in ratio-space
  const kernel = Math.exp(-((ratio - 1) * (ratio - 1)) / (2 * sigma * sigma));
  return anticipatedTurnout * kernel;
}

/**
 * @param {Array} polls - array of poll objects {shares:{candId:share}, sample, date, pollster}
 * @param {Array<string>} candidateIds
 * @param {string} electionDate - ISO date string used as the "election day" reference
 *   for recency weighting. For a future/completed election, its actual date. For
 *   ongoing approval tracking with no election day, pass today's date (UTC) instead --
 *   see approval.html.
 * @param {Object} [opts]
 * @param {number} [opts.anticipatedTurnout] - expected raw turnout for the race. When
 *   set, poll weight is BaseCalc_turnoutWeight(sample, anticipatedTurnout) instead of
 *   the raw sample size, so a poll sampled closest to the size of the actual electorate
 *   counts most -- not just whichever poll happened to sample the most people.
 * @param {boolean} [opts.normalize=true] - when true (elections), every candidate's
 *   alpha is divided by the total alpha across all candidateIds, so the reported
 *   percentages sum to ~100% (correct for "share of the vote"). When false (approval
 *   tracking, or any set of independently-measured yes/no options), each id's average
 *   is its own alpha-weighted share instead, so approve/disapprove don't get forced to
 *   sum to 100 -- the remainder is implicitly "no opinion / not asked".
 * @param {function} [opts.weightMultiplierFn] - optional (poll) => number in [0,1],
 *   multiplied into that poll's weight on top of everything else. Used by
 *   BaseCalc_rollingAverage to fade a poll out gradually near the edge of its
 *   window instead of a hard cliff at the window boundary.
 * @returns {Object} { alphas: {candId: rawAlpha}, averages: {candId: pct 0-1},
 *   coverage: {candId: pollCount}, totalAlpha, n, sorted: [[candId, pct], ...] }
 */
function BaseCalc_aggregate(polls, candidateIds, electionDate, opts = {}) {
  const { anticipatedTurnout, normalize = true, weightMultiplierFn } = opts;
  const alphas = {};
  const weightSums = {};
  const coverage = {};
  candidateIds.forEach(id => { alphas[id] = 0; weightSums[id] = 0; coverage[id] = 0; });

  polls.forEach(poll => {
    const daysTill = BaseCalc_daysUntil(poll.date, electionDate);
    let weight = BaseCalc_turnoutWeight(poll.sample, anticipatedTurnout);
    if (weightMultiplierFn) weight *= weightMultiplierFn(poll);
    candidateIds.forEach(id => {
      if (poll.shares && typeof poll.shares[id] === 'number') {
        alphas[id] += (poll.shares[id] * weight) / (daysTill * 100);
        weightSums[id] += weight / (daysTill * 100);
        coverage[id] += 1;
      }
    });
  });

  const totalAlpha = Object.values(alphas).reduce((a, b) => a + b, 0);
  const averages = {};
  candidateIds.forEach(id => {
    if (normalize) {
      averages[id] = totalAlpha > 0 ? alphas[id] / totalAlpha : 0;
    } else {
      averages[id] = weightSums[id] > 0 ? alphas[id] / weightSums[id] : 0;
    }
  });

  const sorted = Object.entries(averages)
    .filter(([id]) => coverage[id] > 0)
    .sort((a, b) => b[1] - a[1]);

  return { alphas, averages, coverage, weightSums, totalAlpha, n: polls.length, sorted };
}

/**
 * Simple trend: average of the most recent `windowSize` polls vs. the
 * full-window average, so the UI can show movement arrows.
 */
function BaseCalc_trend(polls, candidateIds, electionDate, windowSize = 3, opts = {}) {
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent = sortedPolls.slice(-windowSize);
  const older = sortedPolls.slice(0, Math.max(0, sortedPolls.length - windowSize));

  const recentAgg = BaseCalc_aggregate(recent, candidateIds, electionDate, opts).averages;
  const olderAgg = older.length ? BaseCalc_aggregate(older, candidateIds, electionDate, opts).averages : recentAgg;

  const delta = {};
  candidateIds.forEach(id => {
    delta[id] = recentAgg[id] - olderAgg[id];
  });
  return delta;
}

/**
 * A poll's "still in the window" strength as a function of its age (in
 * days) as of the day being plotted: full weight (1) for the first
 * `mainDays`, then a linear taper down to 0 across the following
 * `fadeDays` -- instead of the old hard cliff where a poll counted fully
 * right up until windowDays and then vanished completely the next day.
 * That cliff made the rolling line jump/step whenever a poll aged out;
 * the taper lets it ease out smoothly instead.
 */
function BaseCalc_windowFade(ageDays, mainDays, fadeDays) {
  if (ageDays <= mainDays) return 1;
  if (fadeDays <= 0 || ageDays >= mainDays + fadeDays) return 0;
  return 1 - (ageDays - mainDays) / fadeDays;
}

/**
 * Rolling average, RCP-style -- computed one calendar day at a time, not
 * one point per poll. For every day between the first poll and the
 * reference date (electionDate, capped at today for ongoing tracking),
 * every poll within [day - (mainDays+fadeDays), day] is re-aggregated
 * with the same recency/turnout weighting as everywhere else, PLUS a
 * window-fade multiplier: a poll counts at full strength for `mainDays`,
 * then eases out linearly over the next `fadeDays` rather than dropping
 * out all at once. On days with no poll in range, the line holds flat at
 * the last computed value (carry-forward) rather than dropping out.
 *
 * @param {number} [mainDays=3] - days a poll counts at full weight
 * @param {number} [fadeDays=2] - additional days over which it eases out to 0
 * @returns {Array<{date, averages: {candId: pct}}>} one point per calendar day, sorted ascending
 */
function BaseCalc_rollingAverage(polls, candidateIds, electionDate, mainDays = 3, fadeDays = 2, opts = {}) {
  if (!polls.length) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalWindowMs = (mainDays + fadeDays) * dayMs;

  const firstDay = new Date(sortedPolls[0].date).getTime();
  const lastPollDay = new Date(sortedPolls[sortedPolls.length - 1].date).getTime();
  const refDay = new Date(electionDate).getTime();
  const cappedRefDay = isFinite(refDay) ? Math.min(refDay, Date.now()) : lastPollDay;
  const lastDay = Math.max(lastPollDay, cappedRefDay);

  const points = [];
  // Per-candidate carry-forward: if a candidate simply hasn't been polled
  // recently (common for these low-frequency community races -- one poll
  // every week or two is normal), their line should hold at the last real
  // reading instead of sinking toward 0 just because the *recent* window
  // happens to be empty for them specifically.
  let lastAverages = {};

  for (let t = firstDay; t <= lastDay; t += dayMs) {
    const windowPolls = sortedPolls.filter(p => {
      const ageMs = t - new Date(p.date).getTime();
      return ageMs >= 0 && ageMs <= totalWindowMs;
    });
    if (windowPolls.length > 0) {
      const fadeOpts = {
        ...opts,
        weightMultiplierFn: poll => {
          const ageDays = (t - new Date(poll.date).getTime()) / dayMs;
          return BaseCalc_windowFade(ageDays, mainDays, fadeDays);
        }
      };
      const agg = BaseCalc_aggregate(windowPolls, candidateIds, electionDate, fadeOpts);
      candidateIds.forEach(id => {
        // Only overwrite a candidate's value if the window gave them
        // meaningfully non-zero weight -- a poll can technically still be
        // inside the total window but fully faded out (weight ~0) right at
        // its edge, which used to get treated as "fresh data says 0" and
        // yank the line down. Require actual weight, not just presence.
        if (agg.weightSums[id] > 1e-9) lastAverages[id] = agg.averages[id];
      });
    }
    points.push({ date: new Date(t).toISOString().slice(0, 10), averages: { ...lastAverages } });
  }

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

/**
 * Weighted-average timeline -- one point per calendar day, but unlike
 * BaseCalc_rollingAverage this does NOT use a fixed lookback window or a
 * manual fade-out. Every poll up to and including that day is included,
 * with that day standing in as the "election date" reference for
 * BaseCalc_aggregate -- so a poll's own 1/daysTill weighting in the alpha
 * formula does all the fading for us (a poll from months back still
 * technically counts, but its contribution has already decayed toward
 * ~nothing by then). This is "what would the weighted average show if
 * today were election day", recomputed fresh for every day on the chart,
 * rather than a rolling window of only-recent polls.
 *
 * @returns {Array<{date, averages: {id: pct}}>} one point per calendar day, sorted ascending
 */
function BaseCalc_weightedTimeline(polls, candidateIds, asOfDate, opts = {}) {
  if (!polls.length) return [];
  const dayMs = 24 * 60 * 60 * 1000;
  const sortedPolls = [...polls].sort((a, b) => new Date(a.date) - new Date(b.date));

  const firstDay = new Date(sortedPolls[0].date).getTime();
  const refDay = new Date(asOfDate).getTime();
  const lastDay = isFinite(refDay) ? Math.max(refDay, firstDay) : firstDay;

  const points = [];
  for (let t = firstDay; t <= lastDay; t += dayMs) {
    const tDateStr = new Date(t).toISOString().slice(0, 10);
    const pollsSoFar = sortedPolls.filter(p => new Date(p.date).getTime() <= t);
    const agg = BaseCalc_aggregate(pollsSoFar, candidateIds, tDateStr, opts);
    points.push({ date: tDateStr, averages: { ...agg.averages } });
  }

  return points;
}

if (typeof window !== 'undefined') {
  window.BaseCalc_daysUntil = BaseCalc_daysUntil;
  window.BaseCalc_turnoutWeight = BaseCalc_turnoutWeight;
  window.BaseCalc_windowFade = BaseCalc_windowFade;
  window.BaseCalc_aggregate = BaseCalc_aggregate;
  window.BaseCalc_trend = BaseCalc_trend;
  window.BaseCalc_rollingAverage = BaseCalc_rollingAverage;
  window.BaseCalc_weightedTimeline = BaseCalc_weightedTimeline;
  window.BaseCalc_currentCandidates = BaseCalc_currentCandidates;
  window.BaseCalc_applyWriteInDiscount = BaseCalc_applyWriteInDiscount;
}
