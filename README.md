# wikiElections

A static, GitHub-Pages-ready site that merges the **wikiElections** front end
(Decision Desk TSR + Spinner Insights branding) with a trimmed, redesigned
version of the **TSRElects** live-results app. No build step — it's plain
HTML/CSS/JS and can be served as-is from the repo root.

## Deploying

1. Push this folder's contents to a repo (or a `docs/` folder / `gh-pages`
   branch).
2. In repo Settings → Pages, point GitHub Pages at that folder/branch.
3. Done — everything uses relative paths, so it also works if you open
   `index.html` straight off disk or serve it from a sub-path.

Leaflet is vendored locally in `assets/vendor/leaflet/` (not loaded from a
CDN), so the map has one less external dependency to break.

## Site map

| Page | What it is |
|---|---|
| `index.html` | wikiElections main page. Shows the flashing red breaking-news banner + "LIVE" box in **active** mode, or a quiet off-cycle strip/card in **off-cycle** mode. |
| `activities.html` | Decision Desk TSR "about us" page (the team, how calls are made). |
| `polls.html?race=<id>` | Spinner Insights polls: RealClearPolling-style bar chart, **BaseCalc** (poll average) panel, **ProbCalc** (win probability) panel, and the raw poll table. |
| `elects/index.html?race=<id>` | TSR Elects, trimmed to an NBC-style candidate chart + turnout/reporting/est.-votes stat row + call badge + interactive map, wired to one race at a time. |
| `admin/index.html` | Admin panel — see below. |

If `?race=` is omitted, pages default to `class6`.

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

Both were sanity-checked against known Gamma-distribution means before
being wired into the UI.

## Data layout

```
data/
  site-config.json        site-wide mode (active / off-cycle), banner text
  elections/
    _index.json            list of election ids the admin panel knows about
    class6.json             one election's metadata, groups, candidateIds, call state
  polls/class6.json         raw poll entries (pollster, date, sample, weight, shares)
  results/class6.json       vote counts per group per candidate
  geo/class6.geojson        district/group boundaries for the map
candidates/class6/
  brg.json, nlk.json, ...   one file per candidate: name, party, color, image path
  images/*.svg              generated colour-avatar placeholders
```

### Adding a brand-new election

The admin panel can only **edit an existing election** (per spec). To spin
up a new one:

1. Copy `data/elections/class6.json` → `data/elections/<newid>.json` and
   edit `id`, `title`, `candidateIds`, `groups`, etc.
2. Add `data/polls/<newid>.json` and `data/results/<newid>.json` (same
   shapes as the class6 ones).
3. Add `data/geo/<newid>.geojson` (or point `geojson` in the election file
   at a shared one).
4. Add one JSON + one SVG per candidate under `candidates/<newid>/`.
5. Add `<newid>` to the `elections` array in `data/elections/_index.json`
   so the admin panel picks it up.
6. Link to it with `polls.html?race=<newid>` / `elects/index.html?race=<newid>`.

## Admin mode

`admin/index.html` is gated by a passphrase (default `ddtsr`, set via
`ADMIN_PASS` near the top of that file's script). **This is a convenience
UI gate, not real security** — anyone who knows the passphrase, or opens
dev tools, can get in. Keep the URL unlisted if that matters to you.

Because GitHub Pages has no backend, admin edits are written to
`localStorage` (`assets/js/overrides.js`) and are layered on top of the
checked-in JSON at page-load time in every page. That means:

- Changes are visible immediately to whoever made them, on that browser.
- They are **not** visible to other visitors until you use the
  **Export …json** button in each admin section and commit the downloaded
  file over the matching file in `/data/`.
- **Clear all local overrides** wipes them from that browser only; it
  never touches the repo.

From the admin panel you can:
- Flip the site between **active** / **off-cycle** mode and edit the
  breaking-banner text.
- Edit an existing election's turnout / % reporting / est. votes in /
  est. votes total.
- **Call a race** — pick a winner and a method (`Called outright` or
  `Auto-runoff projection`), with an optional internal note. TSR Elects
  then shows a winner badge on the chart.
- **Add a poll** to an existing election (feeds BaseCalc/ProbCalc on the
  next load of `polls.html`).
- **Adjust results** vote-by-vote, group by group (feeds the NBC chart
  and the map on `elects/index.html`).

## Known environment caveat

The map's basemap tiles come from CARTO (`basemaps.cartocdn.com`) over the
network — that part needs internet access same as any web map. The district
polygons/colors themselves are drawn from the local `.geojson` and render
fine even if the tile layer can't load.
