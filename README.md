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
| `index.html` | wikiElections main page + RCP-style hub. **Active** mode: breaking-news banner, "LIVE" box, and a donut chart of the current race's all-pollster composite. **Off-cycle** mode: a scrollable carousel of RCP-style donuts — moderator-approval ratings if `data/approval-polls.json` has entries, otherwise recent-race polling snapshots as an honest fallback. |
| `activities.html` | Decision Desk TSR "about us" page — the team, how calls are made, and (as of this pass) the **BaseCalc & ProbCalc** subsection (`#probcalc`): DDTSR's own multi-pollster composite average, trend chart, and win-probability model. This is the aggregator; it pools every pollster tracking a race, Spinner Insights included. |
| `polls.html` | **Spinner Insights** — a single polling outlet, not an aggregator. One bar-chart card per poll SI actually released, divided into election sections, each with a click-to-expand spreadsheet (share % + implied vote count). Races SI never polled show an honest empty state rather than being padded out. |
| `elects/index.html?election=<id>` | TSR Elects, trimmed to an NBC-style candidate chart + turnout/reporting/est.-votes stat row + call badge + interactive map, wired to one race at a time. |
| `admin/index.html` | Admin panel — see below. |

## Fonts

- **DDTSR pages** (`index.html`, `activities.html`, `elects/`, `admin/`) use **Arimo**
  (loaded from Google Fonts) with **Aileron** as a stated fallback. Aileron isn't
  distributed on any font CDN, so it falls back further to the closest system sans
  (Helvetica Neue/Segoe/Roboto) — visually very close to it. Drop in a real
  `@font-face` block in `assets/css/style.css` if you have licensed Aileron files.
- **Spinner Insights** (`polls.html`, and the SI-flavored bits of the RCP donut/chart
  components) is meant to use **Bridge**. Bridge isn't freely redistributable, so this
  currently substitutes **Archivo Black** (headlines/numerals) + **Barlow** (table/body
  text) — both real Google Fonts with a similarly bold, modern feel. Swap
  `--font-spinner-display` / `--font-spinner-body` in `style.css` for real Bridge
  `@font-face` declarations if you have license files.

## The two calculation engines

Both live in `assets/js/`:

- **`basecalc.js`** — `BaseCalc_aggregate(polls, candidateIds)`. Weighted
  average of every poll's candidate shares. Weight is **not** just "bigger
  sample wins": each poll's `poll.weight` (pollster-assigned reliability;
  a poll run by a candidate about their own race gets a self-interest
  discount) is multiplied by a *closeness* factor —
  `1 / (1 + |sample − expected| / expected)` — where `expected` is a
  recency-weighted average of sample sizes across that race's *other*
  polls (`BaseCalc_expectedSample`, leave-one-out so an oversized poll
  can't inflate the very baseline it's judged against just by being the
  newest release). A poll whose sample matches what recent polls in that
  race typically look like gets full credit; one that's suspiciously
  oversized *or* undersized relative to that gets discounted either way.
  No randomness — this whole thing is the trend line. Candidates who
  weren't measured in a given poll (not yet declared, already dropped
  out) are excluded from *that poll's* contribution to their average
  entirely — never counted as a 0%. `BaseCalc_rollingAverage` computes
  the same thing over a trailing N-day window per poll date (still judged
  against the *full* race's expected-sample baseline, not just what's in
  that window), with flat carry-forward on days without a new poll — this
  feeds the trend chart on `activities.html#probcalc`.

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

- **`rcp-chart.js`** — `RCPChart_render(container, points, candidateIds, registry)`.
  A small dependency-free SVG line chart (time-scaled x-axis, gridlines,
  colored line + dot markers per candidate, legend with latest values) in
  the RealClearPolitics house style. Feeds off `BaseCalc_rollingAverage`'s
  output directly.

Both BaseCalc/ProbCalc were sanity-checked against known Gamma-distribution
means before being wired into the UI.

## Polling data — sourcing notes

`data/polls/*.json` (9 datasets: class6, class5-june, class5-april,
class4-april, class4-march, class5-sept, class1-sept, class2-july,
class7-july) is transcribed from real tracked TSR polling. A few candidate
cells in the source tables used merged/rowspan formatting (two candidates
sharing one "tied" percentage) that didn't survive plain-text copying
cleanly — those cells were transcribed as literal per-column values rather
than force-normalized to sum to 100%, since BaseCalc doesn't require that.
If you have the original tables handy, it's worth double-checking the
Class 6 July 26 Spinner Insights and PracticalPurpose Polling rows in
particular. Polls run by a candidate about their own race (self-polls,
tagged `(self-poll)`) are downweighted (`weight: 0.5`) the same way a real
average would discount a partisan-sponsored poll; named-individual polls
that aren't a race participant get `weight: 0.8`.

## Moderator approval polling (placeholder)

`polls.html` has a "Moderator Approval — 90-Day Rolling Average" section
using the same `RCPChart_render` engine, per spec (90-day window instead of
3-day). No real approval-poll numbers (Approve/Disapprove tracking for a
sitting moderator) were included in what you sent, so it currently renders
an empty state rather than fabricated data. Once you have real approval
polls, the natural place to wire them in is a new `data/approval-polls.json`
(same `{pollster, date, sample, weight, shares:{approve, disapprove}}` shape
as everything else) plus a `BaseCalc_rollingAverage(polls, ['approve',
'disapprove'], 90)` call feeding `RCPChart_render` — say the word and I'll
wire it up for real.

## Data layout

```
data/
  site-config.json           site-wide mode (active / off-cycle), banner text, activePollsId
  registries.json            candidateRegistry + partyRegistry (real TSR handles, colors, parties,
                              plus a `photo` field per candidate -- see Candidate photos below)
  approval-polls.json        moderator job-approval polling scaffold (empty until real data exists)
  tsrelects-results.json     the real TSR Elects dataset — array of elections, each with
                              first_round / runoff_round, each round holding one or more
                              named races (group -> candidateKey -> votes) plus optional
                              race_calls keyed by race name
  geo/groups.geojson          shared district/group boundaries (groups 1–9) used by every election
  polls-index.json            list of every polling dataset, most recent first
  elections/<id>.json         per-poll-dataset metadata (title, candidateIds) — 9 of these
  polls/<id>.json             raw poll entries for that dataset — 9 of these
candidates/
  registry/images/*.svg       colored initials-circle avatar per candidate (used for normal
                                identification: elects/index.html chart, tables, dropdowns)
  registry/photos/*.svg       transparent-background silhouette per candidate, used specifically
                                for the white-filtered RCP "photo on the bar" treatment
```

### Candidate photos

Each candidate in `data/registries.json` has a `photo` field (relative to
`candidates/registry/`). Anywhere the site needs the RCP-style "photo on the
bar" look (currently: the DDTSR composite bars on `activities.html`), it
loads that file with the `white-filter-img` CSS class
(`assets/css/style.css`), which applies `filter: brightness(0) invert(1)` --
turns any image into a solid white cutout. **Supported formats: png, jpg,
webp, svg** — just point `photo` at a real photo file with a transparent
background (png/webp/svg) for a true silhouette, or a plain jpg for a flat
white block. No code changes needed, the filter is format-agnostic.


**`elects/index.html` reads live results straight from `data/tsrelects-results.json` and
`data/registries.json`** — nothing about a specific election is hardcoded. It picks the most
recent election by date by default, or a specific one via `?election=<id>` (URL-encode
spaces, e.g. `?election=Class%206%20July`). For elections with a runoff round that's
actually been held, it defaults to showing the runoff; otherwise the first round. Rounds
with more than one named race (e.g. Class 2 July's runoff round) get tabs.

**`polls.html` reads from `data/polls-index.json` + `data/elections/<id>.json` +
`data/polls/<id>.json`** — a separate, forward-looking feature (pre-election polling
averages and win probabilities) from the official TSR Elects count, with its own 9
tracked elections spanning 2025–2026.

### Updating results as an election develops

Just edit `data/tsrelects-results.json` directly (add/adjust vote counts, flip
`race_calls[raceName]` to `{"status":"winner","winner":"<key>"}` or
`{"status":"runoff","winner":"<key>"}`, add a `runoff_round` once one is held) and commit.
Or use the admin panel for a live preview first — see below.

### Adding a brand-new polling dataset

Add `data/elections/<newid>.json` (`id`, `title`, `subtitle`, `candidateIds`) and
`data/polls/<newid>.json` (`{electionId, polls:[{id, pollster, date, sample, weight,
shares:{candKey: 0-1}}]}`), then add `<newid>` to `data/polls-index.json`. Any candidate
key not yet in `data/registries.json` needs an entry there (name/color/party) and an
avatar under `candidates/registry/images/<key>.svg` — copy an existing one and adjust,
or ask me to generate it.

### Adding a brand-new TSR Elects election

Append a new election object to the array in `data/tsrelects-results.json` (same shape as
the existing ones — `id`, `title`, `date`, `turnout`, `precincts_reporting`,
`precincts_total`, `first_round.races`, optional `runoff_round`). If it introduces new
candidates, add them to `data/registries.json` under `candidates` (and `parties` if it's a
new party) and generate an avatar SVG for each new candidate key under
`candidates/registry/images/`.

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
- Pick an election → round → race, then edit turnout / precincts
  reporting / precincts total for that round.
- **Call a race** — set status to `Winner` (called outright) or `Runoff`
  (leader advances), pick the candidate, save. TSR Elects then shows the
  matching badge and tags that candidate's bar in the chart.
- **Edit vote counts** group-by-group for the selected race (feeds the
  NBC chart and the map on `elects/index.html`).
- Export the full merged `tsrelects-results.json` to commit your changes
  permanently.
- Separately, **add a poll** to any of the 9 tracked polling datasets (feeds
  BaseCalc/ProbCalc on `polls.html` for that election).

## Known environment caveat

The map's basemap tiles come from CARTO (`basemaps.cartocdn.com`) over the
network — that part needs internet access same as any web map. The district
polygons/colors themselves are drawn from the local `.geojson` and render
fine even if the tile layer can't load.
