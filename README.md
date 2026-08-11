# wikiElections

A static, GitHub-Pages-ready site that merges the **wikiElections** front end
(Decision Desk TSR + Spinner Insights branding) with a trimmed, redesigned
version of the **TSRElects** live-results app.
## Site map   

| Page | What it is |
|---|---|
| `index.html` | wikiElections main page. Shows the flashing red breaking-news banner + "LIVE" box in **active** nmode, or a quiet off-cycle strip/card in **off-cycle** mode. |
| `activities.html` | Decision Desk TSR "about us" page (the team, how calls are made). |
| `polls.html?race=<id>` | Spinner Insights polls: RealClearPolling-style bar chart, **BaseCalc** (poll average) panel, **ProbCalc** (win probability) panel, and the raw poll table. |
| `elects/index.html?race=<id>` | TSR Elects, trimmed to an NBC-style candidate chart + turnout/reporting/est.-votes stat row + call badge + interactive map, wired to one race at a time. |

## The two calculation engines

Both live in `assets/js/`:

- **`basecalc.js`** — `BaseCalc_aggregate(polls, candidateIds)`. Plain
  weighted average of every poll's candidate shares. Weight per poll =
  `poll.weight * sqrt(poll.sample)`, so a pollster's declared reliability
  and its sample size both matter. No randomness — this is the trend line.

- **`probcalc.js`** — `ProbCalc_run(polls, candidateIds, simulations)`.
  Turns the same weighted average into a Gamma shape parameter per
  candidate: `alpha_i = BaseCalc_share_i * concentration` (concentration
  scales with total effective polling weight), **beta fixed at 1**. Each
  simulated election draws one `Gamma(alpha_i, 1)` variate per candidate
  via genuine **inverse-CDF sampling** (`PC_invGammaP`: Wilson-Hilferty
  initial guess, refined by Newton-Raphson against the regularized
  incomplete gamma function, computed via the standard series/continued-
  fraction split). Normalizing independent `Gamma(alpha_i, 1)` draws
  produces a `Dirichlet(alpha)` sample, which is what makes the simulated
  vote shares realistic (skewed, not just a symmetric bell curve) and
  makes win probability tighten automatically as polling volume/weight
  grows. Winner of each simulated draw is tallied; win probability = wins
  / simulations.
