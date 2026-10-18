# Release checklist

- [ ] Map Maker stays unreleased: no `elects/mapmaker*` files; nav/card entries are commented out in `index.html` and `elects/index.html` (and the nav block of every page). Uncomment together with the page when it ships.
- [ ] `tools/backtest.js` is a dev script — delete it from the public deploy if you don't want it served.
- [ ] `admin/` is gated by a client-side passphrase only; it is not secure. Don't put anything private in it.
- [ ] Overrides saved in the admin live in the browser (localStorage). Export `tsrelects-results.json` / polls and commit them to `data/` before release.
- [ ] Hard-refresh after deploying (GitHub Pages caches assets for ~10 min).
- [ ] Spot-check: index, ddtsr, polls, pollsters, elects/, elects/simulate in light + dark + phone width.
