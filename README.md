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
