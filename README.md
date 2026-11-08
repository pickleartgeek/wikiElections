# wikiElections

A static, GitHub-Pages-ready site that merges the **wikiElections** front end
(Decision Desk TSR + Spinner Insights branding) with a trimmed, redesigned
version of the **TSRElects** live-results app. 

# Roadmap
* Working on an original article (Needed data analysis about 95% done, actually writing it is what remains) - DONE
* Moving previous DDTSR analysis articles to the site - DONE
* Extending approval polling for Impressive_Plant, wiptes167 and teammomofan. - Impressive-Plant DONE
* Building in historical moderator approval data.
* Periodically fetching BallotTSR results on select polls for up to date election results on TSRElects 


# Election IDs
One scheme everywhere: `class<N>-<YYYY>-<MM>` (e.g. `class7-2026-09`) -- seat class + the month in the election's title. It names `data/elections/<id>.json`, and is the `id` in `polls-index.json`, `tsrelects-results.json` and `plain-results.json`, `activePollsId`/`pollsId`/`electsIds` in `site-config.json`, and the `?election=` URL parameter. A same-class, same-month special gets a suffix (`class5-2026-04-special`).
Old IDs (`class7-26`, `Class 6 July`, ...) still work in links and saved admin overrides: `assets/js/election-ids.js` (`EID_LEGACY`) maps them to the new form.
`node tools/check-data.js` validates IDs, filenames, the poll index, candidate ids and poll sums -- run it before every release.

# BallotTSR sync (automatic polls + election results)
`.github/workflows/sync-ballottsr.yml` runs `tools/ballottsr-sync.js` on a schedule: **official elections every 30 min, polls every 3 h** (also runnable by hand: Actions -> Sync BallotTSR -> Run workflow). It mirrors `pickleartgeek/ElSec/ballottsr/` into `data/ballottsr/raw/` (verbatim), then parses:
* **polls** -> added to the matching `data/elections/<id>.json` as `{"source":"ballottsr"}` polls (first-round shares, sample = ballots). They are regenerated every run, so a poll's numbers keep updating while it is open; hand-entered polls are never touched. Elections whose date has passed are frozen.
* **official elections** -> `data/ballottsr/results.json` (same shape as `tsrelects-results.json`, first round per group, no race calls) which TSR Elects merges in under the hand-curated file; an election still open is shown as LIVE. Embargoed results are never published.
* `data/ballottsr/report.json` lists polls skipped/unmatched and cross-checks against hand-entered results -- read it after each election. Teach the parser new names/pollsters in `data/ballottsr/config.json`.
Run locally: `node tools/ballottsr-sync.js --kind all` (add `--source <dir>` to test against a local clone of ElSec).

# Election night (homepage)
While an election is live -- listed in `site-config.json` (`mode: active`), still open on BallotTSR, or finished within 3 days -- and has votes in, `index.html` switches to election-night mode (`assets/js/electionnight.js`):
* **The Wire** carries the night: `Call` (cream tag, click to reopen the call graphic), `Results`, `Groups`, `Turnout`, and `Polls` (final DDTSR average vs the count), ahead of the everyday items.
* **The Stage** drops the polling/ratings windows for **Race Calls** (a card per race in the call-graphic look), **Live Results**, and a **map per race**, then Election Replay.
* **First-visit call graphic** (`assets/js/callalert.js`): the first time a browser loads the homepage after a call goes up, the DDTSR call graphic pops full screen (queued if several). Remembered in `localStorage` (`wE-seenCalls`), shown once per call. A call is "fresh" while its election is live or <= 7 days old, or its `calledAt` is <= 7 days old. "Save image" exports the same PNG as the admin call-graphic tool.
* Race calls take two optional fields beside `status` / `winners`: `flip: true` (FLIP pill) and `calledAt` (ISO time). The admin "Save call" button now writes both (flip = the checkbox in the Call graphic box). `callTitle` / `callSubtitle` override the "Class N" / "moderator" text.
* **Motion** (`assets/js/nightfx.js`): each time a window comes on screen, result bars grow and percentages count up, a green/red ±% chip ticks in for about a second (versus the final DDTSR polling average; after a live update it shows the change since the last update), call cards stamp in one by one, and map groups sweep in left to right with the group counts counting up. Reduced-motion skips all of it.
* **Live refresh**: while an election is live the homepage re-reads the results every 60 s (`?refresh=SECONDS` to test). Changed numbers animate in place, map groups whose leader changed flash, the Wire swaps its items, and a call that goes up while someone is on the page pops the call graphic immediately and slams the Wire gold. If the count starts while someone is already on the page, it reloads once into election-night mode.
* Preview any time: `index.html?demo=night` pretends the newest election is live and never touches the seen-memory.

# Project layout
```
index.html, ddtsr.html, polls.html, approval.html, party-support.html, articles.html, article.html, guide.html, activities.html, admin/, elects/
data/elections/<id>.json   ONE file per election: meta + candidateIds + polls (+ optional group polling)
data/groups.geojson        the 9 group shapes + population stats
data/registries.json       candidate / party names, colors, photos
data/*.json                site-config, articles, approval, party polls, TSR Elects results
assets/js, assets/css      code and styles (home.js / home.css = the homepage; main.js = shared helpers such as esc())   |   assets/img/candidates  candidate photos   |   assets/leaflet  map library
```

# Group polling (ProbCalc Group Forecast)
Add a `groups` object to any poll in `data/elections/<id>.json`. Groups may be omitted; unpolled groups fall back to the statewide average.
```json
{ "pollster": "Spinner Insights", "date": "2026-09-19", "sample": 11, "shares": {"tmf": 0.36, "nzb1": 0.27},
  "groups": { "1": {"sample": 3, "shares": {"tmf": 0.5, "nzb1": 0.5}}, "4": {"sample": 2, "shares": {"tmf": 1.0}} } }
```
If any poll in an election has `groups`, DDTSR's ProbCalc section switches to the Group Forecast. Preview with fake data: `ddtsr?demo=groups`.


# Simulator accuracy (tools/backtest.js)
`node tools/backtest.js [sims] ['{"scale":0.5,...}']` retrains the simulator on only the elections before each past election, simulates the real field, and compares it with what happened (leader, vote shares, turnout). Calibration knobs live in `ES_TUNE` (assets/js/electsim.js). First-round runs on 12 past races: Brier 0.72 vs 0.76 for "everyone equal", share error 9.8pp vs 9.9pp, 80% intervals cover ~66% of real shares. The ratings carry only a small real edge; races this small are mostly noise.

# Adding an election
1. Add `data/elections/<id>.json` (meta, candidateIds, polls) and list it in `data/polls-index.json`.
2. Put results in `data/tsrelects-results.json` (or let the BallotTSR sync mirror them), with `first_round.races` as group -> candidate -> votes.
3. While it runs, set `mode: active` and the election in `data/site-config.json` (`activeElections`, optional `electsIds`). The homepage switches to election-night mode once votes are in.
4. Make a call in the admin panel (Save call). Tick "This is a flip" when the seat changed hands. That stamps `flip` and `calledAt`, which is what pops the first-visit graphic.
5. Check it first: `index.html?demo=night`.

# Tests
`node tools/check-data.js` validates the data. `node tools/smoke-test.js` (needs `npm i --no-save playwright && npx playwright install chromium`) loads every page and walks the election-night flow. Both run on every push (`.github/workflows/smoke-test.yml`).

# Frozen promo files
`assets/js/toolkit-spot.js`, `assets/js/replay-spot.js` and `elects/*-spot.html` are the finished promo spots. Nothing else depends on them, so leave them alone. The rendered MP4s were removed from the repo to keep it small.

## Win probability (election night)

`assets/js/nightodds.js` turns the pre-election group forecast (GroupCalc: pooled polls, group-by-group lean, shared statewide swing) into a live "chance to lead":
every counted ballot reweights the swing (Dirichlet-multinomial likelihood over the nine groups), and the ballots still to come are drawn from recent turnout, spread over the groups furthest behind their usual share.
It shows in the homepage **Win Probability** window, as a meter under the results on the **Elects** page (live or ≤3-day-old elections only), and in the **election simulator** (`elects/simulate.html`: prior = the simulator's own forecast, updated as groups report, with a sparkline and an "how did it do" verdict once a round finishes), as **Odds** items on The Wire, and as a suggestion in the admin call panel (it never saves a call).

- **By-group meter:** each group gets its own tile (likeliest group winner, its chance, and a stacked bar of every candidate's chance to carry it). Groups with no ballots yet are dashed and labelled "forecast". Shown on the homepage window, the Elects page and the simulator; `backtest-live.js` also scores it.
- **% reporting:** when a reporting figure exists (homepage, simulator) the model only expects the unreported share of usual turnout to still arrive, so 100% reporting means the count is final. Without one it falls back to usual turnout (the backtest has no reporting data).
- First-choice votes only; ranked-choice / STAR transfers are not simulated. With under 3 ballots counted it says "Too early".
- Tuned with `node tools/tune-live.js` (grid search scored by leave-one-election-out, so a setting only wins if it helps on elections it wasn't fitted to) and checked with `node tools/backtest-live.js [sims] ['{"concMult":2}']`: replays every timeline ballot by ballot, scoring Brier / log loss against a "current leader wins" baseline and printing reliability bins. Only ~7 elections have timelines, so treat the calibration as rough and re-run it as more are added.

Tuning log: raising the weight on the poll-based prior (`concMult` 10, `swingMult` 30), weighting recent turnout more (`histDecay` .7) and a mild sharpening of the final probabilities (`sharpen` 1.5, the raw model was under-confident) took the lead Brier from 0.084 to 0.045 (naive "current leader" rule: 0.114) and the by-group Brier from 0.316 to 0.305. A stress test with the poll shares deliberately reversed still lets the count rescue the real winner by about 15 ballots. Re-run `tune-live.js` whenever more timelines are added.

Sharpening check (400 simulated elections + the 7 real ones): the lead score is best at `sharpen` 1.25–1.5 on simulated data and 1.5–2 on real data, and clearly worse at 3 (over-confident: 11% of 90%+ favourites lose). 1.5 stays the default. Try other values with `?sharpen=2` on the homepage (`?demo=night`), the Elects page or the simulator.
