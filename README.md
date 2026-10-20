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

# Project layout
```
index.html, ddtsr.html, polls.html, approval.html, party-support.html, articles.html, article.html, guide.html, activities.html, admin/, elects/
data/elections/<id>.json   ONE file per election: meta + candidateIds + polls (+ optional group polling)
data/groups.geojson        the 9 group shapes + population stats
data/registries.json       candidate / party names, colors, photos
data/*.json                site-config, articles, approval, party polls, TSR Elects results
assets/js, assets/css      code and styles   |   assets/img/candidates  candidate photos   |   assets/leaflet  map library
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
