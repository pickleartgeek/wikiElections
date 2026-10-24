# Release checklist

- [x] Map Maker is released: `elects/mapmaker.html`, linked from the nav of every page and the tool cards on `index.html`.
- [ ] `tools/backtest.js` is a dev script — delete it from the public deploy if you don't want it served.
- [ ] `admin/` is gated by a client-side passphrase only; it is not secure. Don't put anything private in it.
- [ ] Overrides saved in the admin live in the browser (localStorage). Export `tsrelects-results.json` / polls and commit them to `data/` before release.
- [ ] Check `data/ballottsr/report.json` (unmapped names / cross-check mismatches) after each election.
- [ ] Run `node tools/check-data.js` (must print OK).
- [ ] Hard-refresh after deploying (GitHub Pages caches assets for ~10 min).
- [ ] Spot-check: index, ddtsr, polls, pollsters, elects/, elects/simulate in light + dark + phone width.
