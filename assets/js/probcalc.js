/**
 * ProbCalc
 * ---------
 * Win-probability engine.
 *
 * Method: for each candidate i, fit a Gamma(alpha_i, beta=1) shape
 * parameter from the weighted polling average (same weighting as
 * BaseCalc). To simulate one election, draw an independent
 * X_i ~ Gamma(alpha_i, 1) for every candidate via inverse-CDF sampling
 * (draw u ~ Uniform(0,1), solve P(alpha_i, x) = u for x), then
 * normalize X_i / sum(X) across candidates. Because independent
 * Gamma(alpha_i, 1) draws normalize to a Dirichlet(alpha) sample,
 * this reproduces realistic vote-share uncertainty that shrinks as
 * alpha (~effective polling weight) grows, and it is skewed exactly
 * like a real Dirichlet posterior instead of a symmetric normal
 * approximation. Repeat N times; win probability = win count / N.
 */

/* ---------- log-gamma (Lanczos approximation) ---------- */
function PC_gammln(x) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - PC_gammln(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/* ---------- regularized lower incomplete gamma P(a, x) ---------- */
function PC_gammaP(a, x) {
  if (x < 0 || a <= 0) return 0;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series expansion
    let sum = 1 / a;
    let term = sum;
    let n = a;
    for (let i = 0; i < 500; i++) {
      n += 1;
      term *= x / n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - PC_gammln(a));
  } else {
    // continued fraction for Q(a,x), then P = 1 - Q
    const FPMIN = 1e-300;
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    const q = Math.exp(-x + a * Math.log(x) - PC_gammln(a)) * h;
    return 1 - q;
  }
}

/**
 * Inverse of the regularized lower incomplete gamma function:
 * given p in (0,1) and shape a, find x such that P(a, x) = p.
 * (This x IS a draw from Gamma(a, 1) when p ~ Uniform(0,1) --
 * standard inverse-CDF / inverse-transform sampling.)
 *
 * Initial guess via Wilson-Hilferty, refined with Newton-Raphson
 * against the incomplete gamma function itself.
 */
function PC_invGammaP(p, a) {
  if (p <= 0) return 0;
  if (p >= 1) return a + 20 * Math.sqrt(a) + 20;

  // Wilson-Hilferty approximation for the initial guess
  const g = PC_gammln(a);
  let x;
  if (a > 1) {
    const pp = p < 0.5 ? p : 1 - p;
    const t = Math.sqrt(-2 * Math.log(pp));
    let z = -0.322232431088 + t * (-1 + t * (-0.342242088547 +
      t * (-0.0204231210245 + t * -0.0000453642210148)));
    z = z / (0.0993484626060 + t * (0.588581570495 +
      t * (0.531103462366 + t * (0.103537752850 + t * 0.0038560700634))));
    z = t + z;
    if (p < 0.5) z = -z;
    const term = 1 - 1 / (9 * a) + z * Math.sqrt(1 / (9 * a));
    x = a * term * term * term;
    if (x < 0) x = a * Math.exp(g / a); // fallback safety
  } else {
    // small-shape fallback
    const t = Math.exp((Math.log(p) + g + Math.log(a)) / a);
    x = t;
  }
  if (!isFinite(x) || x <= 0) x = a;

  // Newton-Raphson refinement using P(a,x) and its derivative
  // dP/dx = x^(a-1) e^-x / Gamma(a)
  for (let i = 0; i < 12; i++) {
    const Px = PC_gammaP(a, x);
    const deriv = Math.exp((a - 1) * Math.log(x) - x - g);
    if (deriv === 0 || !isFinite(deriv)) break;
    let dx = (Px - p) / deriv;
    // damp large steps to keep x positive & stable
    if (dx > x * 0.9) dx = x * 0.9;
    if (dx < -x * 0.9) dx = -x * 0.9;
    x -= dx;
    if (Math.abs(dx) < 1e-10 * (x + 1e-10)) break;
  }
  return Math.max(x, 1e-12);
}

/** Draw one Gamma(alpha, 1) sample via inverse-CDF sampling. */
function PC_sampleGamma(alpha) {
  if (alpha <= 0) return 0;
  const u = Math.random();
  return PC_invGammaP(u, alpha);
}

/**
 * Turn BaseCalc's real alpha values (the guide's documented
 * `(share * sample) / (daysTillElection * 100)` sum, see basecalc.js)
 * directly into ProbCalc's Gamma shape parameters -- BaseCalc and
 * ProbCalc share one alpha, per PickleArtGeek's guide, rather than
 * ProbCalc re-deriving a separate scaled version of it. beta is fixed
 * at 1 throughout, also per the guide.
 */
function PC_computeAlphas(polls, candidateIds, electionDate) {
  const agg = BaseCalc_aggregate(polls, candidateIds, electionDate);
  const alphas = {};
  candidateIds.forEach(id => {
    // floor so a candidate with ~0 measured alpha still has a nonzero (tiny) shot
    alphas[id] = Math.max(0.01, agg.alphas[id]);
  });
  return { alphas, averages: agg.averages, totalAlpha: agg.totalAlpha };
}

/**
 * Run the full Monte Carlo simulation.
 * @returns {Object} winProb {candId: 0-1}, meanShare {candId: 0-1}, simulations
 */
function ProbCalc_run(polls, candidateIds, electionDate, simulations = 20000) {
  const { alphas, averages, totalAlpha } = PC_computeAlphas(polls, candidateIds, electionDate);

  const wins = {};
  const shareSum = {};
  candidateIds.forEach(id => { wins[id] = 0; shareSum[id] = 0; });

  for (let s = 0; s < simulations; s++) {
    const draws = {};
    let total = 0;
    candidateIds.forEach(id => {
      const g = PC_sampleGamma(alphas[id]); // beta = 1
      draws[id] = g;
      total += g;
    });
    let bestId = candidateIds[0];
    let bestShare = -1;
    candidateIds.forEach(id => {
      const share = total > 0 ? draws[id] / total : 0;
      shareSum[id] += share;
      if (share > bestShare) { bestShare = share; bestId = id; }
    });
    wins[bestId] += 1;
  }

  const winProb = {};
  const meanShare = {};
  candidateIds.forEach(id => {
    winProb[id] = wins[id] / simulations;
    meanShare[id] = shareSum[id] / simulations;
  });

  return { winProb, meanShare, alphas, pollAverages: averages, totalAlpha, simulations };
}

if (typeof window !== 'undefined') {
  window.PC_gammaP = PC_gammaP;
  window.PC_invGammaP = PC_invGammaP;
  window.PC_sampleGamma = PC_sampleGamma;
  window.PC_computeAlphas = PC_computeAlphas;
  window.ProbCalc_run = ProbCalc_run;
}
