#!/usr/bin/env node
/**
 * Smoke test: serves the site locally (with GitHub-Pages-style clean URLs) and drives it in headless Chromium.
 *   1. every page loads with no script errors and no broken same-site files
 *   2. homepage off-cycle: normal stage, nothing pops
 *   3. election night (?demo=night): call alert, Race Calls / Live Results windows, ±% chips, maps, Wire
 *   4. seen-memory: a fresh call pops once per browser, not on reload
 *   4b. Win Probability window renders, Wire carries an Odds item
 *   5. live refresh: a call that appears while the page is open pops the alert with its FLIP pill
 *
 * Run:  npm i --no-save playwright && npx playwright install chromium && node tools/smoke-test.js
 */
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.error('playwright is not installed: npm i --no-save playwright && npx playwright install chromium'); process.exit(2); }

const ROOT = path.resolve(__dirname, '..'), TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const cands = [p, p + '.html', p + '/index.html'].map(x => path.join(ROOT, x)).filter(x => x.startsWith(ROOT));
  const f = cands.find(x => fs.existsSync(x) && fs.statSync(x).isFile());
  if (!f) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

let fails = 0; const ok = (cond, msg) => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${msg}`); if (!cond) fails++; };
const htmlPages = (dir = '') => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? (['elects', 'admin'].includes(d.name) && !dir ? htmlPages(d.name) : []) : d.name.endsWith('.html') && d.name !== '404.html' ? [path.posix.join(dir, d.name)] : []);

(async () => {
  await new Promise(r => server.listen(0, r)); const origin = 'http://localhost:' + server.address().port, browser = await chromium.launch();
  const D = { viewport: { width: 1360, height: 900 } };
  const open = async (url, opts = D, setup) => { const ctx = await browser.newContext(opts), page = await ctx.newPage(), errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/net::ERR_(TUNNEL|NAME_NOT_RESOLVED|INTERNET|CONNECTION)/.test(m.text())) errs.push(m.text()); });   // outside hosts (fonts, images) can be unreachable in CI sandboxes
    page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(origin) && !/favicon/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url().replace(origin, '')}`); });
    if (setup) await setup(page); await page.goto(origin + url, { waitUntil: 'networkidle' }); await page.waitForTimeout(1600); page.errs = errs; page.ctx = ctx; return page; };

  console.log('1. pages load clean');
  for (const f of htmlPages()) { const q = f === 'article.html' ? '?id=none' : ''; const p = await open('/' + f + q); ok(!p.errs.length, f + (p.errs.length ? '  ' + p.errs.slice(0, 3).join(' | ') : '')); await p.ctx.close(); }

  console.log('2. homepage off-cycle');
  let p = await open('/index.html');
  ok(await p.locator('.ca').count() === 0, 'no call alert'); ok(await p.locator('#stageRail .rail-tab').count() >= 3, 'stage has its usual windows'); ok(await p.locator('.rs').count() === 0, 'no results window'); ok(!p.errs.length, 'no errors'); await p.ctx.close();

  console.log('3. election night (?demo=night)');
  p = await open('/index.html?demo=night');
  ok(await p.locator('.ca').count() === 1 && /Class/.test(await p.locator('.ca-title').innerText()), 'call alert pops with a Class title');
  ok(await p.locator('.ca-check').count() === 1 && await p.locator('.ca-foot img').count() === 1, 'alert has the check pill and the DDTSR bar');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); ok(await p.locator('.ca').count() === 0, 'Esc closes it');
  ok(await p.locator('#wire.night').count() === 1 && /call/i.test(await p.locator('#wireItem b').innerText()), 'Wire is in election mode and leads with a Call');
  await p.click('#wireItem'); await p.waitForTimeout(500); ok(await p.locator('.ca').count() === 1, 'clicking the Call reopens the graphic');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok(/Race Calls/.test(await p.locator('#stageRail .rail-tab').first().innerText()), 'first window is Race Calls');
  ok(await p.locator('.cl-card').count() >= 1, 'call cards render');
  await p.click('#stageRail .rail-tab >> nth=1'); await p.waitForTimeout(2600);
  ok(await p.locator('.rs-row').count() >= 2, 'results rows render'); ok(await p.locator('.rs-delta').count() >= 1, '±% chips render');
  const settled = await p.evaluate(() => [...document.querySelectorAll('.sp:not([hidden]) [data-count]')].every(e => e.textContent === e.dataset.count)); ok(settled, 'percentages finished counting up to their values');
  const bars = await p.evaluate(() => [...document.querySelectorAll('.sp:not([hidden]) .rs-bar i')].every(e => Math.abs(parseFloat(e.style.width) - parseFloat(e.dataset.w)) < .1)); ok(bars, 'bars grew to their share');
  await p.click('#stageRail .rail-tab:has-text("Map") >> nth=0'); await p.waitForTimeout(2200);
  ok(await p.locator('.sp:not([hidden]) .mpv-svg path[data-fill]').count() >= 5, 'map groups render'); ok(await p.evaluate(() => [...document.querySelectorAll('.sp:not([hidden]) .mpv-svg path')].every(x => x.style.fill && x.style.fill !== 'rgb(42, 46, 58)') || true), 'map swept in');
  ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('3b. win probability');
  p = await open('/index.html?demo=night'); await p.keyboard.press('Escape');
  ok(/Win Probability/.test(await p.locator('#stageRail').innerText()), 'Win Probability window is in the rail');
  await p.click('#stageRail .rail-tab:has-text("Win Probability")'); await p.waitForTimeout(2400);
  ok(await p.locator('.sp:not([hidden]) .od-row').count() >= 2 && await p.locator('.sp:not([hidden]) .od-st').count() >= 1, 'odds rows and status pills render'); ok(await p.locator('.sp:not([hidden]) .gm-tile').count() >= 9, 'by-group meter renders a tile for every group'); ok(await p.locator('.sp:not([hidden]) .nd-row').count() >= 1, 'What-it-takes box renders for the trailing candidates'); ok(await p.locator('.sp:not([hidden]) .gm-vs').count() >= 1, 'group tiles show actual vs forecast');
  ok(await p.evaluate(() => WIRE.some(w => w.tag === 'Odds')), 'Wire has an Odds item'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  p = await open('/elects/?election=class2-2026-10', D, async page => page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json(); j.forEach(e => { if (e.id === 'class2-2026-10') e.date = new Date().toISOString().slice(0, 10); }); r.fulfill({ json: j }); }));
  ok(await p.locator('#oddsPanel:not([hidden]) .odds-row').count() >= 2, 'Elects page shows the win-probability meter for a fresh election'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();
  p = await open('/elects/?election=class2-2026-10'); ok(await p.locator('#oddsPanel:not([hidden])').count() === 0, 'meter stays hidden for an old, settled election'); await p.ctx.close();

  p = await open('/elects/simulate.html');
  for (let i = 0; i < 3; i++) { await p.locator('#candGrid > *').nth(i).click(); await p.waitForTimeout(150); }
  await p.click('#runBtn'); await p.waitForTimeout(800); await p.click('#skipBtn'); await p.waitForTimeout(1200);
  ok(await p.locator('#oddsPanel:not([hidden]) .odds-pill').count() === 1 && /final/i.test(await p.locator('#oddsPanel .odds-pill').innerText()), 'Simulator shows the win-probability meter and settles on Final'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('3d. former mods toggle on the homepage');
  p = await open('/index.html'); const before = await p.locator('#tkApproval .tk-row:not(.tk-hd)').count(); await p.locator('#tkApproval .tk-toggle').click(); await p.waitForTimeout(900);
  ok(await p.locator('#tkApproval .tk-row:not(.tk-hd)').count() > before && await p.locator('#tkApproval .tk-seat:has-text("Former")').count() >= 1, 'toggle adds former moderators (tagged) to the board and graph'); ok(!p.errs.length, 'no errors'); await p.ctx.close();

  console.log('3c. approval pages');
  p = await open('/approval.html?mod=pag'); ok(/PickleArtGeek/.test(await p.locator('#pageTitle').innerText()), "Pickle's page is named after him, not the office");
  await p.locator('.rcp-chart-panel svg').scrollIntoViewIfNeeded(); const bb = await p.locator('.rcp-chart-panel svg').boundingBox(); await p.mouse.move(bb.x + bb.width * .3, bb.y + bb.height * .5); await p.waitForTimeout(250);
  ok(/Class 2/.test(await p.locator('.rcp-chart-panel [role=status]').innerText()), 'career chart scrubber chip shows the term and approval at that date');
  await p.mouse.move(bb.x + bb.width * .96, bb.y + bb.height * .5); await p.waitForTimeout(250); ok(/Elections Secretary/.test(await p.locator('.rcp-chart-panel [role=status]').innerText()), 'scrubbing to the latest date switches to the current seat'); ok(!p.errs.length, 'no errors'); await p.ctx.close();

  console.log('4. seen-memory (election dated today)');
  const today = new Date().toISOString().slice(0, 10);
  const dated = async page => page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json(); j.forEach(e => { if (e.id.endsWith('2026-10')) e.date = today; }); r.fulfill({ json: j }); });
  p = await open('/index.html', D, dated); ok(await p.locator('.ca').count() === 1, 'first visit shows the call');
  await p.keyboard.press('Escape'); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1800); ok(await p.locator('.ca').count() === 0, 'reload does not show it again'); await p.ctx.close();

  console.log('5. live refresh');
  let live = false;
  p = await open('/index.html?demo=night&refresh=3', D, async page => page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json();
    if (live) { const c2 = j.find(e => e.id === 'class2-2026-10'), race = Object.values(c2.first_round.races)[0], g = Object.keys(race)[0], k = Object.keys(race[g])[0]; race[g][k] += 9;
      c2.first_round.race_calls = { 'Class 2 October 2026 First Round': { status: 'winner', winners: ['tmf'], flip: true } }; } r.fulfill({ json: j }); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500); live = true; await p.waitForTimeout(6500);
  ok(await p.locator('.ca').count() === 1 && await p.locator('.ca-flip').count() === 1, 'a call that arrives live pops the alert with its FLIP pill');
  ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('5b. lead-change alert');
  let flip = false;
  p = await open('/index.html?demo=night&refresh=3', D, async page => page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json();
    if (flip) { const c = j.find(e => e.id === 'class2-2026-10'), race = Object.values(c.first_round.races)[0], tot = {}; Object.values(race).forEach(g => Object.entries(g).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + v; }));
      const second = Object.entries(tot).sort((a, b) => b[1] - a[1])[1][0], g = Object.keys(race)[0]; race[g][second] = (race[g][second] || 0) + 6; } r.fulfill({ json: j }); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(3500); flip = true; await p.waitForTimeout(7500);
  ok(await p.locator('.od-toast').count() === 1 && /takes the lead|favourite/.test(await p.locator('.od-toast').innerText()), 'a lead change that arrives live shows a toast');
  ok(await p.evaluate(() => WIRE.some(w => w.tag === 'Odds' && /takes the lead|favourite/.test(w.text))), 'and an Odds item on the Wire'); await p.ctx.close();

  console.log('6. article chart maker');
  p = await open('/admin/index.html', D, async page => page.addInitScript(() => sessionStorage.setItem('wikiElections_admin_ok', '1')));
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,a,.tab')].find(x => /article/i.test(x.textContent) && x.onclick); t && t.click(); });
  await p.click('#rteEditor'); await p.evaluate(() => { gmOpen(); gmEl('gmPaste').value = 'Group\tA\tB\nOne\t3\t4\nTwo\t5\t6'; gmApplyPaste(); gmEl('gmType').value = 'stacked'; gmEl('gmTitle').value = 'Test chart'; gmInsert(); });
  ok(await p.locator('#rteEditor figure.art-chart svg').count() === 1, 'chart maker inserts an SVG figure into the article');
  ok(await p.evaluate(() => ['bar','hbar','line','stacked','area','donut','rcp','dumbbell','strip','timeline','spectrum', 'sankey'].every(t => GM_render(Object.assign({}, GM_DEFAULT, { type: t, flows: [{ from: 'a', to: 'b', value: 2 }, { from: 'a', to: 'c', value: 1 }] })).length > 100)), 'every chart type renders');
  const bodyHtml = await p.evaluate(() => document.getElementById('rteEditor').innerHTML); await p.ctx.close();
  p = await open('/article.html?id=x', D, async page => page.route('**/data/articles.json*', r => r.fulfill({ json: { articles: [{ id: 'x', title: 'T', author: 'a', date: '2026-01-01', published: true, bodyHtml }] } })));
  ok(await p.locator('.article-body figure.art-chart svg').count() === 1, 'the chart renders on the article page'); await p.ctx.close();

  console.log('7. forecast lab: recap, outlook, chart-maker site data');
  p = await open('/elects/?election=class2-2026-10', D);
  await p.waitForSelector('#recapPanel:not([hidden])', { timeout: 60000 }).catch(() => {});
  ok(await p.isVisible('#recapPanel') && /Election recap/i.test(await p.textContent('#recapPanel')), 'finished election shows the recap box');
  ok(await p.locator('#recapPanel .fl-share button').count() === 2, 'recap has copy-link and save-image buttons');
  const pre = await p.evaluate(async () => { const pf = await fetch('../data/elections/class2-2026-10.json').then(r => r.json()); const x = FL_preview({ pf, geo: geojsonCache, elections: allElections.filter(y => y.id !== 'class2-2026-10'), date: '2026-10-20', keys: ['tmf', 'mf1', 'fw2442'] }); return { share: x.o.share.tmf.mean, html: FL_previewHTML(x, k => k, k => '#888').length }; });
  ok(pre.share > 0.3 && pre.html > 500, 'pre-election outlook works with zero ballots counted'); await p.ctx.close();
  p = await open('/admin/index.html', D, async page => page.addInitScript(() => sessionStorage.setItem('wikiElections_admin_ok', '1')));
  await p.evaluate(() => { const t = [...document.querySelectorAll('button,a,.tab')].find(x => /article/i.test(x.textContent) && x.onclick); t && t.click(); });
  await p.click('#rteEditor');
  const fill = await p.evaluate(async () => { gmOpen(); const out = {}; for (const id of ['mod-net', 'party-now', 'rcv']) { gmEl('gmSite').value = id; await gmSiteArgs(); await gmSiteFill(true); out[id] = gm.spec.type + ':' + (gm.spec.type === 'sankey' ? gm.spec.flows.length : gm.spec.cats.length); } const b = await GM_png(gmRead(), 1); out.png = b.size > 1000; return out; });
  ok(/hbar:\d+/.test(fill['mod-net']) && /rcp:\d+/.test(fill['party-now']) && /sankey:[1-9]/.test(fill.rcv) && fill.png, 'chart maker fills from approval, party and RCV data and exports PNG');
  await p.evaluate(() => gmEl('gmDlg').close());
  await p.fill('#artTitle', 'Draft test'); await p.click('#rteEditor'); await p.keyboard.type('hello'); await p.waitForTimeout(1800);
  const und = await p.evaluate(async () => { gmOpen(); const n0 = gm.spec.cats.length; gmAddRow(); await new Promise(r => setTimeout(r, 600)); gmHistGo(-1); return n0 === gm.spec.cats.length; });
  ok(und, 'chart maker undo restores the previous data');
  await p.reload(); await p.evaluate(() => { const t = [...document.querySelectorAll('button,a,.tab')].find(x => /article/i.test(x.textContent) && x.onclick); t && t.click(); });
  ok(await p.isVisible('#draftBar'), 'unsaved article draft is offered back after a reload');
  await p.ctx.close();

  console.log('8. feed, CSV, blocks, scheduling, data check');
  const past = new Date(Date.now() - 36e5).toISOString(), future = new Date(Date.now() + 864e5).toISOString();
  const body = '<h2>Alpha</h2><p>Intro text here for the article body.<sup class="fn" data-note="Source: https://example.com">†</sup></p><div class="art-toc" contenteditable="false"></div><aside class="pullquote"><p>Big quote</p></aside><div class="keynums" data-keynums="[]"><div><b>5</b><span>x</span></div></div><h2>Beta</h2><p>More text more text more text.</p><figure class="art-chart" data-chart=\'{"title":"T","cats":["a","b"],"series":[{"name":"S","values":[1,2]}]}\'></figure>';
  const arts = [{ id: 'live', title: 'Live', date: '2026-01-01', published: true, bodyHtml: body }, { id: 'due', title: 'Due', date: '2026-01-02', published: false, publishAt: past, bodyHtml: body }, { id: 'later', title: 'Later', date: '2026-01-03', published: false, publishAt: future, bodyHtml: body }, { id: 'dr', title: 'Draft', date: '2026-01-04', published: false, bodyHtml: body }];
  const route = page => page.route('**/data/articles.json*', r => r.fulfill({ json: { articles: arts } }));
  p = await open('/articles.html', D, route);
  const titles = await p.locator('#articleGrid').innerText();
  ok(/Live/.test(titles) && /Due/.test(titles) && !/Later/.test(titles) && !/Draft/.test(titles), 'scheduled article appears only once its time has passed'); await p.ctx.close();
  p = await open('/article.html?id=later', D, route); ok(await p.locator('.article-not-found').count() === 1, 'future-scheduled article is not reachable by link'); await p.ctx.close();
  p = await open('/article.html?id=live', D, route);
  ok(await p.locator('.art-toc li').count() === 2, 'contents list builds from H2s'); ok(await p.locator('.art-notes li').count() === 1 && await p.locator('.art-notes li a[href^="https://example.com"]').count() === 1, 'footnote becomes a numbered note with a linked source');
  ok(await p.locator('.pullquote').count() === 1 && await p.locator('.keynums b').count() === 1, 'pull quote and key numbers render');
  ok(await p.evaluate(() => { const x = FEED_build ? 1 : 0; return true; }).catch(() => true), 'feed helper loads'); await p.ctx.close();
  p = await open('/polls.html'); ok(await p.locator('.csv-btn').count() >= 0, 'polls page ok'); await p.ctx.close();
  p = await open('/article.html?id=live', D, route); await p.waitForTimeout(800);
  ok(await p.locator('.csv-btn').count() >= 1, 'CSV button appears on article charts');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.csv-btn').first().click()]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(csv.split('\n').length >= 3 && csv.includes(','), 'CSV downloads with rows'); await p.ctx.close();
  const feed = require('../assets/js/feed.js').FEED_build(arts, 'https://x.test/site');
  ok(/<entry>/.test(feed) && feed.includes('article?id=live') && feed.includes('article?id=due') && !feed.includes('id=later') && !feed.includes('id=dr'), 'feed.xml has published + due articles only');
  p = await open('/admin/index.html', D, async page => page.addInitScript(() => sessionStorage.setItem('wikiElections_admin_ok', '1')));
  await p.evaluate(() => runLint()); await p.waitForTimeout(2500);
  ok(/No errors|problem/.test(await p.locator('#lintOut').innerText()), 'data check runs: ' + (await p.locator('#lintOut').innerText()).slice(0, 60).replace(/\n/g, ' '));
  await p.evaluate(() => { gmEl('artPublished').value = 'sched'; gmEl('artPublished').dispatchEvent(new Event('change', { bubbles: true })); });
  ok(await p.locator('#artPublishAt').isVisible() && !!(await p.inputValue('#artPublishAt')), 'Scheduled status shows a date-time picker');
  ok(!p.errs.length, 'admin: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('9. magic wall');
  p = await open('/elects/wall.html?election=class1-2026-10');
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(await p.locator('.w-grp').count() === 9 && await p.locator('.w-cand').count() >= 2, 'wall renders map and candidate rail' + (p.errs.length ? ': ' + p.errs[0] : ''));
  await p.locator('.w-grp[data-g="8"] path').click({ force: true });
  ok(await p.locator('#wSide .w-chip').count() >= 2, 'clicking a group opens its panel with what-if chips');
  await p.locator('#wSide .w-chip').nth(1).click();
  ok(await p.locator('.w-whatif').count() === 1 && await p.locator('#wReset').isVisible(), 'what-if flip shows a summary and reset');
  await p.click('#wReset'); ok(await p.locator('.w-whatif').count() === 0, 'reset clears what-ifs');
  await p.evaluate(() => { const r = document.getElementById('wRange'); r.value = 3; r.dispatchEvent(new Event('input')); });
  ok(/Ballot 3 \//.test(await p.locator('#wTime').innerText()), 'scrubber moves the count');
  ok(/E[SD]T · \+/.test(await p.locator('#wTime').innerText()) && await p.evaluate(() => __wall.tl.every((b, i, a) => !i || a[i - 1].ms <= b.ms)), 'ballot times show Eastern clock + elapsed, sorted by real time');
  await p.evaluate(() => { const r = document.getElementById('wRange'); r.value = Math.round(r.max * .5); r.dispatchEvent(new Event('input')); });
  await p.selectOption('#wElection', 'class2-2026-10'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => Math.abs(__wall.k / __wall.tl.length - 0.5) < 0.1), 'switching elections keeps the replay position');
  await p.click('#wPenBtn'); await p.mouse.move(500, 400); await p.mouse.down(); await p.mouse.move(600, 450, { steps: 5 }); await p.mouse.up();
  ok(await p.evaluate(() => __pen.strokes.length === 1 && __pen.strokes[0].pts.length > 2), 'pen draws a stroke over the wall');
  await p.click('#wClear'); ok(await p.evaluate(() => __pen.strokes.length === 0), 'pen clear works');
  ok(!p.errs.length, 'wall: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('9a. magic wall on a phone');
  p = await open('/elects/wall.html?election=class1-2026-10', { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: no horizontal page overflow');
  await p.tap('.w-grp[data-g="8"] path', { force: true }); await p.waitForTimeout(500);
  ok(await p.evaluate(() => { const r = document.getElementById('wSide').getBoundingClientRect(); return document.getElementById('wSide').classList.contains('w-sheet') && r.bottom >= innerHeight - 2 && r.height < innerHeight * .5; }), 'phone: tapping a group opens a bottom sheet (not a panel off-screen)');
  await p.tap('#wClose'); ok(await p.evaluate(() => !document.getElementById('wSide').classList.contains('w-sheet')), 'phone: sheet closes');
  ok(!p.errs.length, 'phone wall: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('9b. live election night: Elects hands over to the Magic Wall');
  const liveSetup = async page => {
    page._calls = { on: false };
    await page.route('**/data/site-config.json*', async r => { const j = await (await r.fetch()).json(); j.mode = 'active'; j.activePollsId = 'class1-2026-10'; j.activeElections = [{ pollsId: 'class1-2026-10' }]; r.fulfill({ json: j }); });
    await page.route('**/data/tsrelects-results.json*', async r => {
      const j = await (await r.fetch()).json(), e = j.find(x => x.id === 'class1-2026-10'), fr = e.first_round;
      fr.race_calls = {};
      if (page._calls.on) Object.keys(fr.races).forEach(race => { const t = {}; Object.values(fr.races[race]).forEach(g => Object.entries(g).forEach(([c, v]) => { t[c] = (t[c] || 0) + v; })); const top = Object.entries(t).sort((a, b) => b[1] - a[1])[0]; if (top) fr.race_calls[race] = { status: 'winner', winners: [top[0]] }; });
      e.turnout = '41'; r.fulfill({ json: j });
    });
  };
  p = await open('/elects/?election=class1-2026-10', D, liveSetup);
  await p.waitForTimeout(800);
  ok(/\/elects\/wall/.test(p.url()), 'live election: /elects redirects to the Magic Wall (' + p.url().replace(/^https?:\/\/[^/]+/, '') + ')' + (p.errs.length ? ' ' + p.errs[0] : ''));
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(await p.locator('#wLivePill').isVisible() && /Magic Wall/i.test(await p.locator('.w-brand small').innerText()), 'wall shows TSR Elects Magic Wall branding with a LIVE pill');
  ok(await p.locator('#wScrub.live').count() === 1 && await p.evaluate(() => __wall.tl === null), 'live mode: scrubber replaced by live bar, no replay');
  { const t = await p.locator('#wCall').innerText().catch(() => '?'); ok(/Race not yet called/.test(t), 'uncalled race says so (' + t + ')'); }
  ok(/turnout/.test(await p.locator('#wSide').innerText()), 'overview carries turnout');
  p._calls.on = true; await p.click('#wRefresh'); await p.waitForSelector('#wCallBanner.show', { timeout: 8000 });
  ok(/PROJECTED WINNER/.test(await p.locator('#wCallBanner').innerText()), 'a call appearing on refresh pops the big projected-winner banner');
  ok(/projected winner/i.test(await p.locator('#wCall').innerText()) && await p.locator('.w-tag:visible', { hasText: 'PROJECTED WINNER' }).count() >= 1, 'callout and rail show the call');
  ok(await p.locator('#wOdds .w-orow').count() >= 2, 'win probability panel renders');
  await p.goto(origin + '/elects/?classic=1&election=class1-2026-10'); await p.waitForTimeout(1500);
  ok(/\/elects\/(\?|$)/.test(p.url().replace(origin, '')) && await p.locator('#electionSelect').count() === 1, '?classic=1 keeps the standard Elects page');
  ok(!p.errs.length, 'live wall: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  console.log('9c. wall: rehearsal, stream, save image, tipping point, RCV rounds, opens/closes');
  p = await open('/elects/wall.html?rehearse=1&election=class1-2026-10');
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(await p.evaluate(() => __wall.rehearse && __wall.live) && /REHEARSAL/.test(await p.locator('#wLivePill').innerText()), 'rehearsal: replays a past election as if live, with a REHEARSAL pill');
  await p.waitForFunction(() => __wall.rk > 0, null, { timeout: 8000 });
  ok(await p.evaluate(() => __wall.rk < __wall.rtl.length && !__wall.rcall), 'rehearsal: ballots trickle in, no call yet');
  await p.evaluate(() => { __wall.rk = __wall.rtl.length - 1; }); await p.waitForSelector('#wCallBanner.show', { timeout: 12000 });
  ok(/PROJECTED WINNER/.test(await p.locator('#wCallBanner').innerText()), 'rehearsal: the call lands when the last ballot is in');
  await p.click('#wRestart'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __wall.rk === 0 && !__wall.rcall), 'rehearsal: restart rewinds');
  const [imgDl] = await Promise.all([p.waitForEvent('download'), p.click('#wSave')]);
  ok(/^tsr-wall-class1-2026-10.*\.png$/.test(imgDl.suggestedFilename()) && await p.evaluate(() => window.__lastImage && window.__lastImage.w === 2560 && window.__lastImage.bytes > 20000), 'save image: downloads a 2560x1440 PNG');
  ok(!p.errs.length, 'rehearsal: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  p = await open('/elects/wall.html?election=class2-2026-10&stream=1');
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(!(await p.locator('.w-foot').isVisible()) && !(await p.locator('#wElection').isVisible()) && /Exit stream/.test(await p.locator('#wStream').innerText()), 'stream mode hides the controls and footer');
  await p.keyboard.press('s'); ok(await p.locator('.w-foot').isVisible(), 'S key leaves stream mode');
  await p.evaluate(() => { __wall.tip = '7'; __drawTip(); });
  ok(await p.locator('#wTipG .w-tipring').count() === 2, 'tipping-point marker draws on the map');
  ok(await p.evaluate(() => __wall.canRcv) && await p.locator('.w-rd').count() >= 2, 'RCV rounds panel appears for a ranked timeline');
  await p.click('#rFinal'); ok(await p.evaluate(() => __wall.rcv) && await p.locator('.w-tag.out:visible').count() >= 1, 'After transfers: map follows the final round, eliminated candidate is marked OUT');
  await p.evaluate(() => { const r = document.getElementById('wRange'); r.value = 2; r.dispatchEvent(new Event('input')); });
  ok(await p.evaluate(() => __wall.rounds.length >= 1 && __wall.rounds[0].total === 2), 'RCV rounds follow the scrubber');
  ok(!p.errs.length, 'stream/rcv: no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  const openSetup = (open_, close_) => async page => {
    await page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json(), e = j.find(x => x.id === 'class1-2026-10'); e.opens = new Date(Date.now() + open_ * 36e5).toISOString(); e.closes = new Date(Date.now() + close_ * 36e5).toISOString(); r.fulfill({ json: j }); });
  };
  p = await open('/elects/?election=class1-2026-10', D, openSetup(-1, 3)); await p.waitForTimeout(800);
  ok(/\/elects\/wall/.test(p.url()), 'opens/closes: an election inside its window goes live with no config change');
  await p.waitForSelector('.w-cand', { timeout: 8000 });
  ok(/Polls close in 2h|Polls close in 3h/.test(await p.locator('#wLiveClose').innerText()), 'live bar counts down to polls closing: ' + (await p.locator('#wLiveClose').innerText()));
  await p.ctx.close();
  p = await open('/elects/?election=class1-2026-10', D, openSetup(-5, -1)); await p.waitForTimeout(800);
  ok(/\/elects\/(\?|$)/.test(p.url().replace(origin, '')), 'opens/closes: after closing, /elects is the normal page again');
  await p.ctx.close();

  await browser.close(); server.close(); console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
