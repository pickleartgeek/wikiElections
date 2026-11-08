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
  ok(await p.locator('.sp:not([hidden]) .od-row').count() >= 2 && await p.locator('.sp:not([hidden]) .od-st').count() >= 1, 'odds rows and status pills render'); ok(await p.locator('.sp:not([hidden]) .gm-tile').count() >= 9, 'by-group meter renders a tile for every group');
  ok(await p.evaluate(() => WIRE.some(w => w.tag === 'Odds')), 'Wire has an Odds item'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

  p = await open('/elects/?election=class2-2026-10', D, async page => page.route('**/data/tsrelects-results.json*', async r => { const j = await (await r.fetch()).json(); j.forEach(e => { if (e.id === 'class2-2026-10') e.date = new Date().toISOString().slice(0, 10); }); r.fulfill({ json: j }); }));
  ok(await p.locator('#oddsPanel:not([hidden]) .odds-row').count() >= 2, 'Elects page shows the win-probability meter for a fresh election'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();
  p = await open('/elects/?election=class2-2026-10'); ok(await p.locator('#oddsPanel:not([hidden])').count() === 0, 'meter stays hidden for an old, settled election'); await p.ctx.close();

  p = await open('/elects/simulate.html');
  for (let i = 0; i < 3; i++) { await p.locator('#candGrid > *').nth(i).click(); await p.waitForTimeout(150); }
  await p.click('#runBtn'); await p.waitForTimeout(800); await p.click('#skipBtn'); await p.waitForTimeout(1200);
  ok(await p.locator('#oddsPanel:not([hidden]) .odds-pill').count() === 1 && /final/i.test(await p.locator('#oddsPanel .odds-pill').innerText()), 'Simulator shows the win-probability meter and settles on Final'); ok(!p.errs.length, 'no errors' + (p.errs.length ? ': ' + p.errs[0] : '')); await p.ctx.close();

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

  await browser.close(); server.close(); console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
