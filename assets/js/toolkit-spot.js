/* wikiElections — "The toolkit" 38s motion-graphics spot, drawn deterministically on a canvas.
 * ToolkitSpot.init({base:'../'}) -> Promise ; ToolkitSpot.draw(ctx, t, W, H). Data is real (see toolkit-spot-data.json,
 * data/groups.geojson, data/timelines/class1-2026-10.json). Same engine drives the on-site player and the MP4. */
(function (g) {
  const DUR = 35.6, DW = 1920, DH = 1080;
  const PINK = '#ca1957', PINK_D = '#8f1243', INK = '#0b0c10', MINT = '#48c392', PAPER = '#f6f3ec', LINE = '#262a35';
  const DISPLAY = '"Archivo Black","Arial Black",sans-serif', BODY = '"Public Sans","Helvetica Neue",Arial,sans-serif';
  const OC = '#0f6aa6', DV = '#e6bd3c';
  // scene boundaries
  const B = { sp0: 3.2, rp0: 7.4, pg0: 10.4, party0: 13.8, sim0: 19.6, map0: 23.0, art0: 26.0, wire0: 29.0, out0: 31.8 };
  const R = { ready: false, data: null, geo: null, ballots: null, imgs: {}, layout: null };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const eOut = x => 1 - Math.pow(1 - x, 3), eOut5 = x => 1 - Math.pow(1 - x, 5);
  const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const eBack = x => { const c1 = 1.8, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const lerp = (a, b, x) => a + (b - a) * x;
  const rnd = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function init(opts) {
    const base = (opts && opts.base) || '../';
    const img = (k, src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { R.imgs[k] = i; res(); }; i.onerror = rej; i.src = base + src; });
    const font = (name, url, w) => new FontFace(name, `url(${url})`, { weight: w }).load().then(f => { document.fonts.add(f); });
    return Promise.all([
      fetch(base + 'assets/js/toolkit-spot-data.json').then(r => r.json()).then(j => R.data = j),
      fetch(base + 'data/groups.geojson').then(r => r.json()).then(j => R.geo = j),
      fetch(base + 'data/timelines/class1-2026-10.json').then(r => r.json()).then(j => R.ballots = j.ballots.map(b => ({ t: Date.parse(b.t), c: b.r[0] }))),
      fetch(base + 'assets/img/brand/spot/layout.json').then(r => r.json()).then(j => R.layout = j),
      img('tsp', 'assets/img/parties/tsp.png'), img('udc', 'assets/img/parties/udc.png'), img('ndtsr', 'assets/img/parties/ndtsr.png'), img('pps', 'assets/img/parties/pps.png'),
      img('we', 'assets/img/brand/spot/we-mark.png'), img('rtext', 'assets/img/brand/spot/replay-text-white.png'),
      font('Archivo Black', base + 'assets/fonts/archivo-black-latin-400-normal.woff2', '400'),
      font('Public Sans', base + 'assets/fonts/public-sans-latin-800-normal.woff2', '800'),
      font('Public Sans', base + 'assets/fonts/public-sans-latin-600-normal.woff2', '600'),
    ]).then(() => { buildGeo(); R.ready = true; });
  }

  /* ---------- geometry (9 voting groups) ---------- */
  function buildGeo() {
    const feats = R.geo.features; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const walk = co => { if (typeof co[0] === 'number') { x0 = Math.min(x0, co[0]); x1 = Math.max(x1, co[0]); y0 = Math.min(y0, co[1]); y1 = Math.max(y1, co[1]); } else co.forEach(walk); };
    feats.forEach(f => walk(f.geometry.coordinates));
    const k = Math.cos(38.3 * Math.PI / 180), w = (x1 - x0) * k, h = y1 - y0;
    R.geoBox = { x0, y0, k, w, h, aspect: w / h };
    R.groups = feats.map(f => ({ id: +f.properties.NAME.replace(/\D/g, ''), polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates }));
  }
  function mapPath(c, grp, bx, by, bw, bh) {
    const b = R.geoBox, s = Math.min(bw / b.w, bh / b.h), ox = bx + (bw - b.w * s) / 2, oy = by + (bh - b.h * s) / 2;
    c.beginPath();
    grp.polys.forEach(poly => poly.forEach(ring => ring.forEach((p, i) => { const x = ox + (p[0] - b.x0) * b.k * s, y = oy + (b.h - (p[1] - b.y0)) * s; i ? c.lineTo(x, y) : c.moveTo(x, y); }) || c.closePath()));
    return { s, ox, oy };
  }
  function groupCentroid(grp, bx, by, bw, bh) {
    const b = R.geoBox, s = Math.min(bw / b.w, bh / b.h), ox = bx + (bw - b.w * s) / 2, oy = by + (bh - b.h * s) / 2; let sx = 0, sy = 0, n = 0;
    grp.polys.forEach(poly => poly[0].forEach(p => { sx += p[0]; sy += p[1]; n++; }));
    sx /= n; sy /= n; return [ox + (sx - b.x0) * b.k * s, oy + (b.h - (sy - b.y0)) * s];
  }

  /* ---------- drawing helpers ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
  function txt(c, s, x, y, size, color, o = {}) {
    c.font = `${o.w || ''} ${size}px ${o.f || DISPLAY}`.trim(); c.fillStyle = color; c.textAlign = o.a || 'left'; c.textBaseline = 'alphabetic';
    if ('letterSpacing' in c) c.letterSpacing = (o.ls || 0) + 'px'; c.fillText(s, x, y);
  }
  function measure(c, s, size, f, ls) { c.font = `${size}px ${f || DISPLAY}`; if ('letterSpacing' in c) c.letterSpacing = (ls || 0) + 'px'; return c.measureText(s).width; }
  function fitSize(c, s, size, maxW, f) { const w = measure(c, s, size, f); return w > maxW ? size * maxW / w : size; }
  function riseWord(c, s, x, baseY, size, color, p, o = {}) {
    const h = size; c.save(); c.beginPath(); c.rect(x - 40, baseY - h * .92, 4000, h * 1.12); c.clip();
    txt(c, s, x, baseY + (1 - eOut5(p)) * h * 1.1, size, color, o); c.restore();
  }
  function bgGrid(c, t, W, H, col) { c.save(); c.strokeStyle = col || 'rgba(255,255,255,.05)'; c.lineWidth = 2; const s = 120, off = (t * 40) % s; for (let x = -s + off; x < W; x += s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } c.restore(); }
  function darkBg(c, t, W, H, glow) {
    c.fillStyle = INK; c.fillRect(0, 0, W, H); bgGrid(c, t, W, H);
    const gr = c.createRadialGradient(W * .8, H * .15, 0, W * .8, H * .15, 1100); gr.addColorStop(0, `rgba(202,25,87,${glow == null ? .28 : glow})`); gr.addColorStop(1, 'rgba(202,25,87,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
  }
  function pinkBg(c, W, H) {
    const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, PINK); gr.addColorStop(.62, PINK_D); gr.addColorStop(1, '#5e0a2d'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.save(); c.fillStyle = 'rgba(255,255,255,.05)'; c.translate(W / 2, H / 2); c.rotate(Math.PI / 4); for (let i = -2400; i < 2400; i += 40) c.fillRect(i, -2400, 14, 4800); c.restore();
  }
  function paperBg(c, W, H) { c.fillStyle = PAPER; c.fillRect(0, 0, W, H); c.save(); c.strokeStyle = 'rgba(0,0,0,.045)'; c.lineWidth = 2; for (let x = 0; x < W; x += 120) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } c.restore(); }
  function shadowCard(c, x, y, w, h, r, fill, dark) { c.save(); c.shadowColor = dark ? 'rgba(0,0,0,.5)' : 'rgba(30,20,10,.22)'; c.shadowBlur = 56; c.shadowOffsetY = 22; rr(c, x, y, w, h, r); c.fillStyle = fill; c.fill(); c.restore(); }
  /* tool headline block, left column: vertically centred so title + description always sit as one block */
  function wrapLines(c, text, size, maxW, f) { const words = text.split(' '), out = []; let line = ''; words.forEach(w => { const test = line + w + ' '; if (measure(c, test, size, f) > maxW && line) { out.push(line.trim()); line = w + ' '; } else line = test; }); out.push(line.trim()); return out; }
  function headline(c, lt, num, tag, lines, desc, theme, sizeMax) {
    const fg = theme === 'paper' ? INK : '#fff', ac = theme === 'pink' ? '#fff' : PINK, sub = theme === 'paper' ? 'rgba(11,12,16,.72)' : 'rgba(255,255,255,.84)', maxW = 700;
    const sz = Math.min(...lines.map(l => fitSize(c, l, sizeMax || 132, maxW))), lh = sz * 1.06, dl = wrapLines(c, desc, 38, maxW, BODY), block = lines.length * lh + 50 + dl.length * 52;
    const top = Math.max(210, (DH - block) / 2 + 20);
    txt(c, `${num}  /  ${tag}`, 120, 100, 26, theme === 'paper' ? 'rgba(11,12,16,.55)' : 'rgba(255,255,255,.7)', { f: BODY, w: '800', ls: 5 });
    c.fillStyle = ac; c.fillRect(120, 128, eOut5(seg(lt, .05, .5)) * 90, 8);
    lines.forEach((ln, i) => riseWord(c, ln, 118, top + sz * .9 + i * lh, sz, i === lines.length - 1 ? ac : fg, seg(lt, .08 + i * .08, .5 + i * .08)));
    c.save(); c.globalAlpha = eOut(seg(lt, .4, .8)); const y0 = top + lines.length * lh + 40; dl.forEach((l, i) => txt(c, l, 122, y0 + 26 + i * 52, 38, sub, { f: BODY, w: '800' })); c.restore();
  }
  function wipe(c, t, a, b, W, H, dir) {
    const p = seg(t, a, b); if (p <= 0 || p >= 1) return; let x0, x1;
    if (p < .5) { x0 = 0; x1 = W * eIO(p * 2); } else { x0 = W * eIO((p - .5) * 2); x1 = W; }
    c.save(); if (dir) { c.translate(W, 0); c.scale(-1, 1); } c.fillStyle = PINK; c.fillRect(x0, 0, x1 - x0, H); c.fillStyle = '#fff'; c.fillRect(x1 - 8, 0, 8, H * (p < .5 ? 1 : 0)); c.restore();
  }
  function count(v, p) { return Math.round(v * eOut(p)); }

  /* party marks: white chip + logo (or monogram) */
  const PM = { tsp: { col: '#d02a2a', bg: '#b71212', n: 'TSP', img: 'tsp' }, udc: { col: '#32a852', n: 'UDC', img: 'udc', bare: true }, ua: { col: '#bcc0c2', n: 'Ua.', img: null }, ndtsr: { col: '#2b87c2', bg: '#004e7a', n: 'NDTSR', img: 'ndtsr', wide: true }, pps: { col: '#edce2f', bg: '#14161d', n: 'PPS', img: 'pps', k: 0.8 } };
  function chip(c, id, cx, cy, r, s) {
    const m = PM[id]; s = s == null ? 1 : s; if (s <= 0.001) return; c.save(); c.translate(cx, cy); c.scale(s, s);
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 18; c.shadowOffsetY = 6;
    if (m.wide) { const w = r * 3.2, h = r * 1.3; rr(c, -w / 2, -h / 2, w, h, h / 2); c.fillStyle = m.bg; c.fill(); c.shadowColor = 'transparent'; c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke(); const im = R.imgs.ndtsr, iw = w - 34, ih = iw * im.height / im.width; c.drawImage(im, -iw / 2, -ih / 2, iw, ih); }
    else if (m.bare) { const im = R.imgs[m.img], q = (r * 2.3) / Math.max(im.width, im.height); c.drawImage(im, -im.width * q / 2, -im.height * q / 2, im.width * q, im.height * q); }
    else { c.beginPath(); c.arc(0, 0, r, 0, 7); c.fillStyle = m.bg || m.col; c.fill(); c.shadowColor = 'transparent'; c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke(); if (m.img) { const im = R.imgs[m.img], q = (r * 2 - 10) * (m.k || 1) / Math.max(im.width, im.height); c.drawImage(im, -im.width * q / 2, -im.height * q / 2, im.width * q, im.height * q); } else txt(c, 'UA', 0, r * .3, r * .78, INK, { a: 'center' }); }
    c.restore();
  }

  /* ========== INTRO 0 – 3.2 ========== */
  function sIntro(c, t, W, H) {
    darkBg(c, t, W, H, .35); const M = 150, big = 330;
    const beats = [['NEW TOOLS.', .1, 1.1, '#fff'], ['NEW GRAPHS.', 1.1, 2.1, PINK]];
    beats.forEach(bt => { if (t < bt[1] || t > bt[2]) return; const pout = seg(t, bt[2] - .15, bt[2]); c.save(); if (pout > 0) { c.globalAlpha = 1 - pout; c.translate(-pout * pout * 200, 0); }
      riseWord(c, bt[0], M, H / 2 + 110, fitSize(c, bt[0], big, W - 2 * M), bt[3], seg(t, bt[1], bt[1] + .38)); c.restore(); });
    if (t >= 2.1) { const p = seg(t, 2.1, 2.5), pout = seg(t, 3.0, 3.2); c.save(); if (pout > 0) c.globalAlpha = 1 - pout;
      riseWord(c, 'ONE', M, H / 2 - 30, 300, '#fff', p); riseWord(c, 'SITE.', M, H / 2 + 250, 300, PINK, seg(t, 2.2, 2.6));
      const wp = eBack(seg(t, 2.5, 2.9)); c.translate(W - 420, H / 2 + 60); c.scale(wp, wp); const im = R.imgs.we, w = 520, h = w * im.height / im.width; c.drawImage(im, -w / 2, -h / 2, w, h); c.restore(); }
    c.fillStyle = PINK; c.fillRect(M, H - 130, eOut5(seg(t, .2, 1)) * (W - 2 * M), 8);
  }

  /* ---------- mini cards (drawn at origin, fixed design size; reused by the preview window and by their own scenes) ---------- */
  const RP = { w: 800, h: 640 }, MP = { w: 900, h: 700 }, RT = { w: 900, h: 700 };
  function miniReplay(c, lt) {
    const w = RP.w, h = RP.h; shadowCard(c, 0, 0, w, h, 20, '#14161d', true);
    const bl = R.ballots, prog = clamp((lt - .3) / 1.8), pos = prog * (bl.length - 1) + 1e-4, i0 = Math.min(bl.length - 2, Math.floor(pos)), now = lerp(bl[i0].t, bl[i0 + 1].t, pos - i0);
    const dd = new Date(now + 7200e3), z = n => String(n).padStart(2, '0'); txt(c, 'CLASS 1 OCTOBER 2026', 40, 66, 34, '#fff'); txt(c, `${z(dd.getUTCDate())}/10 · ${z(dd.getUTCHours())}:${z(dd.getUTCMinutes())}`, w - 40, 66, 34, '#fff', { a: 'right' }); c.fillStyle = '#c8102e'; c.fillRect(0, 92, w, 5);
    let n = { oc1: 0, dvwb: 0 }; const cnt = prog >= 1 ? bl.length : Math.floor(pos); for (let i = 0; i < cnt; i++) n[bl[i].c]++; const tot = Math.max(1, n.oc1 + n.dvwb);
    [['oc1', 'One-Community', OC], ['dvwb', 'Disguised_VW_Beetle', DV]].forEach((r, i) => { const yy = 150 + i * 150, sh = cnt ? n[r[0]] / tot : 0; txt(c, r[1], 40, yy + 30, fitSize(c, r[1], 36, 400), '#fff'); txt(c, (sh * 100).toFixed(1) + '%', w - 40, yy + 60, 76, '#fff', { a: 'right' }); txt(c, n[r[0]] + (n[r[0]] === 1 ? ' vote' : ' votes'), 42, yy + 66, 24, 'rgba(255,255,255,.6)', { f: BODY, w: '600' }); rr(c, 40, yy + 84, w - 80, 14, 7); c.fillStyle = '#242732'; c.fill(); rr(c, 40, yy + 84, Math.max(0, (w - 80) * sh), 14, 7); c.fillStyle = r[2]; c.fill(); });
    const sx = 40, sy = h - 110, sw = w - 80, t0 = bl[0].t, t1 = bl[bl.length - 1].t; rr(c, sx, sy, sw, 70, 10); c.fillStyle = '#0f1117'; c.fill();
    bl.forEach((q, i) => { const xx = sx + 20 + (sw - 40) * (q.t - t0) / (t1 - t0); c.globalAlpha = i < cnt ? 1 : .25; c.fillStyle = q.c === 'oc1' ? OC : DV; c.fillRect(xx - 3, sy + 20, 6, 30); }); c.globalAlpha = 1; const hx = sx + 20 + (sw - 40) * (now - t0) / (t1 - t0); c.fillStyle = '#fff'; c.fillRect(hx - 2, sy + 6, 4, 58);
  }
  function miniMap(c, lt) {
    const w = MP.w, h = MP.h, win = R.data.groupWinners, col = id => { const k = String(id); if (!win[k]) return '#d9d6cd'; return win[k] === 'oc1' ? OC : DV; };
    shadowCard(c, 0, 0, w, h, 22, '#fff', false); txt(c, 'CLASS 1 OCTOBER 2026 — BY GROUP', 40, 62, 24, 'rgba(11,12,16,.55)', { f: BODY, w: '800', ls: 4 });
    R.groups.forEach((gr, i) => { const e = eOut5(seg(lt, .05 + i * .06, .6 + i * .06)); if (e <= 0) return; c.save(); c.globalAlpha = e; c.translate(0, (1 - e) * 40); mapPath(c, gr, 40, 80, w - 80, h - 175); c.fillStyle = col(gr.id); c.fill();
      if (gr.id === 2) { c.save(); c.clip(); c.strokeStyle = DV; c.lineWidth = 14; for (let q = -900; q < 900; q += 34) { c.beginPath(); c.moveTo(q, h); c.lineTo(q + h, 0); c.stroke(); } c.restore(); mapPath(c, gr, 40, 80, w - 80, h - 175); } c.strokeStyle = '#fff'; c.lineWidth = 3; c.lineJoin = 'round'; c.stroke(); c.restore(); });
    [['One-Community', OC], ['Disguised_VW_Beetle', DV]].forEach((l, i) => { c.fillStyle = l[1]; c.fillRect(40 + i * 330, h - 54, 28, 28); txt(c, l[0], 80 + i * 330, h - 30, 24, INK, { f: BODY, w: '800' }); });
  }
  function miniRatings(c, lt) {
    const w = RT.w, h = RT.h, P = R.data.pollsters, pick = [0, 1, 2, 5, 6].map(i => P[i]);
    shadowCard(c, 0, 0, w, h, 22, '#fff', false); ['RANK', 'POLLSTER'].forEach((s, i) => txt(c, s, i ? 130 : 40, 62, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4 })); txt(c, 'AVG MISS', 650, 62, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4, a: 'right' }); txt(c, 'GRADE', w - 50, 62, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4, a: 'right' });
    pick.forEach((p, i) => { const a = .05 + i * .14, e = eOut5(seg(lt, a, a + .4)); if (e <= 0) return; const ry = 90 + i * 118; c.save(); c.globalAlpha = Math.min(1, e * 2); c.translate((1 - e) * 220, 0); c.fillStyle = i % 2 ? '#fff' : '#faf8f4'; c.fillRect(20, ry, w - 40, 106);
      txt(c, String(P.indexOf(p) + 1), 60, ry + 68, 44, 'rgba(11,12,16,.35)', { a: 'center' }); txt(c, p.n, 130, ry + 52, fitSize(c, p.n, 36, 380), INK); txt(c, `${p.np} poll${p.np > 1 ? 's' : ''}`, 132, ry + 84, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '600' });
      txt(c, (p.mae * eOut(seg(lt, a + .1, a + .7))).toFixed(1) + ' pts', 650, ry + 66, 32, INK, { f: BODY, w: '800', a: 'right' }); const gp = eBack(seg(lt, a + .2, a + .55)); c.save(); c.translate(w - 100, ry + 53); c.scale(Math.max(.001, gp), Math.max(.001, gp)); rr(c, -50, -34, 100, 68, 14); c.fillStyle = GCOL(p.g); c.fill(); txt(c, p.g, 0, 18, 46, '#fff', { a: 'center' }); c.restore(); c.restore(); });
  }
  const GCOL = g => g[0] === 'A' ? '#2fa36b' : g[0] === 'B' ? '#2f86c4' : g[0] === 'C' ? '#d9a21f' : g[0] === 'D' ? '#d9633b' : '#c62a3a';

  /* ========== 01 PREVIEW WINDOW (home-page stage) 3.2 – 7.4 ========== */
  function sSpot(c, t, W, H) {
    const lt = t - B.sp0; darkBg(c, t, W, H, .3);
    txt(c, '01  /  ON THE HOME PAGE', 120, 100, 26, 'rgba(255,255,255,.7)', { f: BODY, w: '800', ls: 5 }); c.fillStyle = PINK; c.fillRect(120, 128, eOut5(seg(lt, .05, .5)) * 90, 8);
    const px = 120, py = 170, pw = 1680, ph = 800, p = eOut5(seg(lt, .05, .65)); c.save(); c.globalAlpha = Math.min(1, p * 2); c.translate(0, (1 - p) * 220); shadowCard(c, px, py, pw, ph, 22, '#10121a', true);
    c.save(); rr(c, px, py, pw, ph, 22); c.clip(); c.fillStyle = '#121620'; c.fillRect(px, py, 520, ph); c.restore();
    const tabs = [['01', 'Election Replay', 'Watch the count unfold', 'ELECTION REPLAY', 'Watch every vote come in', 'Open the replay'], ['02', 'Results Map', 'Group by group', 'MAP MAKER', 'Class 1 October 2026 Election', 'Open the map'], ['03', 'Pollster Ratings', 'Who called it', 'POLLSTER RATINGS', 'Who actually called it?', 'See the ratings']];
    const per = 1.2, k = Math.min(2, Math.floor(Math.max(0, lt - .4) / per)), tl = Math.max(0, lt - .4) - k * per;
    tabs.forEach((tb, i) => { const ty = py + 150 + i * 132, on = i === k; if (on) { c.fillStyle = '#1b2030'; c.fillRect(px, ty - 38, 520, 118); c.fillStyle = '#c8102e'; c.fillRect(px, ty - 38, 5, 118); c.fillStyle = PINK; c.fillRect(px + 5, ty + 78, 515 * clamp(tl / per), 3); }
      txt(c, tb[0], px + 56, ty + 28, 24, on ? '#ff5468' : 'rgba(255,255,255,.4)', { f: BODY, w: '800', a: 'center' }); txt(c, tb[1], px + 100, ty + 20, 36, on ? '#fff' : 'rgba(255,255,255,.55)'); txt(c, tb[2], px + 102, ty + 58, 24, on ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.4)', { f: BODY, w: '600' }); });
    const tb = tabs[k], sx = px + 580;
    c.save(); const sw = eOut5(clamp(tl / .4)); c.globalAlpha = sw; txt(c, tb[3], sx, py + 66, 24, '#ff5468', { f: BODY, w: '800', ls: 5 }); txt(c, tb[4], sx, py + 150, fitSize(c, tb[4], 62, pw - 640 - 20), '#fff'); const bw = measure(c, tb[5], 26, BODY) + 76; rr(c, px + pw - 60 - bw, py + 30, bw, 56, 28); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 2; c.stroke(); txt(c, tb[5] + ' →', px + pw - 60 - bw / 2, py + 66, 26, '#fff', { f: BODY, w: '800', a: 'center' }); c.restore();
    // preview window
    const wx = sx, wy = py + 195, ww = pw - 640, wh = ph - 235; rr(c, wx, wy, ww, wh, 14); c.fillStyle = '#0f1117'; c.fill(); c.strokeStyle = '#232733'; c.lineWidth = 2; c.stroke();
    c.save(); rr(c, wx, wy, ww, wh, 14); c.clip(); c.globalAlpha = eOut(clamp(tl / .3)); const cw = [RP, MP, RT][k]; const sc = Math.min((ww - 50) / cw.w, (wh - 40) / cw.h); c.translate(wx + (ww - cw.w * sc) / 2 + (1 - eOut5(clamp(tl / .5))) * 80, wy + (wh - cw.h * sc) / 2); c.scale(sc, sc); [miniReplay, miniMap, miniRatings][k](c, tl); c.restore();
    c.restore();
  }

  /* ========== 02 ELECTION REPLAY 7.4 – 10.4 ========== */
  function sReplay(c, t, W, H) {
    const lt = t - B.rp0; darkBg(c, t, W, H, .4); const L = R.layout, sc = .8, ox = 120, oy = 330;
    txt(c, '02  /  ON THE NIGHT', 120, 100, 26, 'rgba(255,255,255,.7)', { f: BODY, w: '800', ls: 5 }); c.fillStyle = PINK; c.fillRect(120, 128, eOut5(seg(lt, .05, .5)) * 90, 8);
    const [a, b, d] = L.tri, tw = b[0] * sc, th = (d[1] - a[1]) * sc, tp = eBack(seg(lt, .05, .5));
    c.save(); c.translate(ox + tw * .4, oy + (a[1] + d[1]) / 2 * sc); c.rotate((1 - eOut(seg(lt, .05, .5))) * -Math.PI); c.scale(Math.max(.001, tp), Math.max(.001, tp)); c.translate(-tw * .4, -th / 2); c.fillStyle = '#c8195a'; c.beginPath(); c.moveTo(0, 0); c.lineTo(tw, th / 2); c.lineTo(0, th); c.fill(); c.restore();
    L.letters.forEach((r, i) => { const lp = seg(lt, .25 + i * .05, .65 + i * .05); if (lp <= 0) return; c.save(); c.globalAlpha = clamp(lp * 3); c.translate(ox + (r[0] + r[2] / 2) * sc, oy + (r[1] + r[3]) * sc); c.scale(1, Math.max(.001, eBack(lp))); c.drawImage(R.imgs.rtext, r[0], r[1], r[2], r[3], -r[2] / 2 * sc, -r[3] * sc, r[2] * sc, r[3] * sc); c.restore(); });
    c.save(); c.globalAlpha = eOut(seg(lt, .7, 1.1)); wrapLines(c, 'Watch any election night unfold vote by vote — then export it as video.', 38, 740, BODY).forEach((l, i) => txt(c, l, 122, 640 + i * 52, 38, 'rgba(255,255,255,.85)', { f: BODY, w: '800' })); c.restore();
    const p = eOut5(seg(lt, .2, .8)); c.save(); c.globalAlpha = Math.min(1, p * 2); c.translate(1000 + (1 - p) * 300, 200); miniReplay(c, lt); c.restore();
  }

  /* ========== 03 POLLSTER RATINGS 10.4 – 13.8 ========== */
  function sPollsters(c, t, W, H) {
    const lt = t - B.pg0; pinkBg(c, W, H); headline(c, lt, '03', 'ACCURACY', ['POLLSTER', 'RATINGS'], 'Every outlet, graded on how close it landed to the real result.', 'pink', 120);
    const P = R.data.pollsters, pick = [0, 1, 2, 5, 6, 8, 10].map(i => [P[i], i + 1]).filter(q => q[0]); const x = 900, y = 110, w = 900;
    shadowCard(c, x, y, w, 860, 22, '#fff', false); [['RANK', x + 40, 'left'], ['POLLSTER', x + 130, 'left']].forEach(q => txt(c, q[0], q[1], y + 70, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4 })); txt(c, 'AVG MISS', x + 650, y + 70, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4, a: 'right' }); txt(c, 'GRADE', x + w - 50, y + 70, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 4, a: 'right' });
    pick.forEach((q, i) => { const p = q[0], a = .25 + i * .17, e = eOut5(seg(lt, a, a + .45)); if (e <= 0) return; const ry = y + 105 + i * 106; c.save(); c.globalAlpha = Math.min(1, e * 2); c.translate((1 - e) * 260, 0);
      c.fillStyle = i % 2 ? '#fff' : '#faf8f4'; c.fillRect(x + 20, ry, w - 40, 96);
      txt(c, String(q[1]), x + 60, ry + 62, 44, 'rgba(11,12,16,.35)', { a: 'center' }); txt(c, p.n, x + 130, ry + 48, fitSize(c, p.n, 34, 380), INK); txt(c, `${p.np} poll${p.np > 1 ? 's' : ''}${p.prov ? ' · provisional' : ''}`, x + 132, ry + 78, 20, 'rgba(11,12,16,.5)', { f: BODY, w: '600' });
      txt(c, (p.mae * eOut(seg(lt, a + .1, a + .8))).toFixed(1) + ' pts', x + 650, ry + 62, 32, INK, { f: BODY, w: '800', a: 'right' });
      const gp = eBack(seg(lt, a + .2, a + .6)); c.save(); c.translate(x + w - 100, ry + 48); c.scale(Math.max(.001, gp), Math.max(.001, gp)); rr(c, -50, -34, 100, 68, 14); c.fillStyle = GCOL(p.g); c.fill(); txt(c, p.g, 0, 18, 46, '#fff', { a: 'center' }); c.restore(); c.restore(); });
  }

  /* ========== 04 PARTY ID — hero 13.4 – 19.2 ========== */
  function sParty(c, t, W, H) {
    const lt = t - B.party0, D = R.data.party; darkBg(c, t, W, H, .3);
    // NEW kicker + headline (compact, top-left)
    const kp = eBack(seg(lt, .05, .4)); c.save(); c.translate(120, 90); c.scale(kp, kp); rr(c, 0, -34, 120, 52, 8); c.fillStyle = MINT; c.fill(); txt(c, 'NEW', 60, 3, 28, INK, { a: 'center', ls: 4 }); c.restore();
    txt(c, '04  /  PARTY ID', 270, 90, 26, 'rgba(255,255,255,.65)', { f: BODY, w: '800', ls: 5 });
    riseWord(c, 'PARTY ID,', 118, 240, 130, '#fff', seg(lt, .1, .5)); riseWord(c, 'REDRAWN.', 118 + measure(c, 'PARTY ID, ', 130) + 20, 240, 130, PINK, seg(lt, .2, .6));
    c.save(); c.globalAlpha = eOut(seg(lt, .5, .9)); txt(c, 'Better graphs, with every party’s logo — pooled across every pollster.', 122, 300, 34, 'rgba(255,255,255,.82)', { f: BODY, w: '800' }); c.restore();
    // chart panel
    const cx = 120, cy = 350, cw = 1180, ch = 640; shadowCard(c, cx, cy, cw, ch, 22, '#14161d', true);
    const px = cx + 90, py = cy + 40, pw = cw - 250, ph = ch - 130, ymax = .6;
    c.save(); c.strokeStyle = 'rgba(255,255,255,.09)'; c.lineWidth = 2; c.fillStyle = 'rgba(255,255,255,.5)';
    for (let v = 0; v <= .6001; v += .2) { const y = py + ph - ph * v / ymax; c.beginPath(); c.moveTo(px, y); c.lineTo(px + pw, y); c.stroke(); txt(c, Math.round(v * 100) + '%', px - 16, y + 8, 22, 'rgba(255,255,255,.5)', { f: BODY, w: '600', a: 'right' }); }
    const n = D.dates.length, labs = [[0, 'Nov 25'], [Math.round(n * .26), 'Feb 26'], [Math.round(n * .6), 'May 26'], [Math.round(n * .8), 'Aug 26'], [n - 1, 'Nov 26']];
    labs.forEach(l => txt(c, l[1], px + pw * l[0] / (n - 1), py + ph + 40, 22, 'rgba(255,255,255,.5)', { f: BODY, w: '600', a: 'center' })); c.restore();
    const drawP = eIO(seg(lt, .7, 3.4)), lastIdx = (n - 1) * drawP, ends = {};
    ['ua', 'udc', 'tsp', 'ndtsr', 'pps'].forEach(id => { const S = D.series[id], col = id === 'ua' ? '#aeb3b8' : PM[id].col; c.save(); c.strokeStyle = col; c.lineWidth = 7; c.lineJoin = 'round'; c.lineCap = 'round'; c.beginPath(); let started = false, lx = 0, ly = 0;
      for (let i = 0; i <= Math.floor(lastIdx); i++) { if (S[i] == null) continue; const x = px + pw * i / (n - 1), y = py + ph - ph * S[i] / ymax; started ? c.lineTo(x, y) : c.moveTo(x, y); started = true; lx = x; ly = y; }
      const fi = Math.floor(lastIdx), fr = lastIdx - fi; if (started && fi < n - 1 && S[fi + 1] != null && S[fi] != null) { const nx = px + pw * (fi + 1) / (n - 1), ny = py + ph - ph * S[fi + 1] / ymax; lx = lerp(lx, nx, fr); ly = lerp(ly, ny, fr); c.lineTo(lx, ly); }
      c.stroke(); c.restore();
      ends[id] = { x: lx, y: ly, ok: S[Math.min(n - 1, Math.floor(lastIdx))] != null && started }; });
    // logo chips ride the line ends, then settle into the right-hand gutter (spaced so none overlap)
    const settle = eOut(seg(lt, 3.35, 3.9)), ids = Object.keys(ends).filter(k => ends[k].ok).sort((a, b) => ends[a].y - ends[b].y), ty = {};
    let prev = -1e9; ids.forEach(id => { let y = ends[id].y; if (y < prev + 70) y = prev + 70; ty[id] = y; prev = y; });
    { let nxt = py + ph - 48; for (let i = ids.length - 1; i >= 0; i--) { if (ty[ids[i]] > nxt) ty[ids[i]] = nxt; nxt = ty[ids[i]] - 70; } }
    ids.forEach(id => { const e = ends[id], gx = px + pw + (id === 'ndtsr' ? 95 : 58); chip(c, id, lerp(e.x + (id === 'ndtsr' ? 70 : 44), gx, settle), lerp(e.y, ty[id], settle), 34, eBack(seg(lt, 1.0, 1.4))); });
    // right ranking panel
    const rx = 1350, ry = 350, rw = 450, rh = 640; const rp = eOut5(seg(lt, 1.2, 1.9)); c.save(); c.globalAlpha = Math.min(1, rp * 2); c.translate((1 - rp) * 240, 0); shadowCard(c, rx, ry, rw, rh, 22, '#14161d', true);
    txt(c, 'AS OF NOV 5, 2026', rx + 36, ry + 62, 22, 'rgba(255,255,255,.55)', { f: BODY, w: '800', ls: 4 });
    const order = [['ua', D.latest.ua], ['tsp', D.latest.tsp], ['udc', D.latest.udc], ['ndtsr', D.latest.ndtsr], ['pps', D.latest.pps]], top = order[0][1];
    order.forEach((o, i) => { const id = o[0], a = 2.0 + i * .18, bp = eOut(seg(lt, a, a + 1.0)), yy = ry + 120 + i * 98; chip(c, id, rx + 76, yy + 28, 36, eBack(seg(lt, a - .2, a + .2)));
      const bx = rx + (id === 'ndtsr' ? 180 : 140), bw = rw - (bx - rx) - 36; rr(c, bx, yy + 34, bw, 18, 9); c.fillStyle = '#242732'; c.fill();
      rr(c, bx, yy + 34, Math.max(0, bw * o[1] / top * bp), 18, 9); c.fillStyle = id === 'ua' ? '#aeb3b8' : PM[id].col; c.fill(); txt(c, (o[1] * 100 * bp).toFixed(1) + '%', bx, yy + 20, 38, '#fff'); });
    c.restore();
    // footer note
    c.save(); c.globalAlpha = eOut(seg(lt, 3.6, 4.1)); txt(c, 'Drag the line to see standings on any date.', cx + 30, cy + ch - 24, 20, 'rgba(255,255,255,.45)', { f: BODY, w: '600' }); c.restore();
  }

  /* ========== 05 SIMULATOR 19.2 – 22.6 ========== */
  const FIELD = [['Nazibol1234', 31.4, '#7a5cc4'], ['wiptes167', 24.0, '#2fa38f'], ['Disguised_VW_Beetle', 18.6, DV], ['MaxFlares', 12.9, '#d9633b'], ['HighKingFloof', 8.7, '#2f86c4'], ['JackColon17', 4.4, '#c62a8a']];
  function sSim(c, t, W, H) {
    const lt = t - B.sim0; pinkBg(c, W, H); headline(c, lt, '05', 'SIMULATE', ['ELECTION', 'SIMULATOR'], 'Pick a field of candidates and run your own election night.', 'pink', 112);
    const x = 900, y = 110, w = 900, h = 860; shadowCard(c, x, y, w, h, 22, '#fff', false);
    txt(c, 'PICK A FIELD', x + 44, y + 70, 22, 'rgba(11,12,16,.5)', { f: BODY, w: '800', ls: 5 });
    // chips select one by one
    let cxp = x + 44, cyp = y + 100;
    FIELD.forEach((f, i) => { const sel = lt > .3 + i * .12, label = f[0]; const cw = measure(c, label, 24, BODY, 0) + 56; if (cxp + cw > x + w - 40) { cxp = x + 44; cyp += 62; } const bp = sel ? eBack(seg(lt, .3 + i * .12, .5 + i * .12)) : 0;
      rr(c, cxp, cyp, cw, 48, 24); c.fillStyle = sel ? f[2] : '#eceae3'; c.fill(); txt(c, label, cxp + cw / 2, cyp + 32, 24, sel ? '#fff' : 'rgba(11,12,16,.55)', { f: BODY, w: '800', a: 'center' }); cxp += cw + 14; });
    // run button
    const press = seg(lt, 1.1, 1.25) * (1 - seg(lt, 1.25, 1.4)), bx = x + 44, by = y + 250; c.save(); c.translate(bx + 110, by + 34); c.scale(1 - press * .06, 1 - press * .06); rr(c, -110, -34, 220, 68, 12); c.fillStyle = PINK; c.fill(); txt(c, '▶  RUN IT', 0, 11, 28, '#fff', { a: 'center', ls: 2 }); c.restore();
    txt(c, 'SIMULATED RESULT', x + w - 44, by + 46, 22, 'rgba(11,12,16,.45)', { f: BODY, w: '800', a: 'right', ls: 4 });
    // bars race
    const rp = seg(lt, 1.4, 2.6); FIELD.forEach((f, i) => { const yy = y + 352 + i * 64, jitter = (1 - rp) * (rnd(Math.floor(lt * 20) + i * 7) - .5) * 30, v = f[1] * eOut(rp) + (rp < 1 ? jitter * rp : 0);
      txt(c, f[0], x + 44, yy + 32, fitSize(c, f[0], 28, 270, BODY), INK, { f: BODY, w: '800' }); const bx2 = x + 330, bw = 400; rr(c, bx2, yy + 8, bw, 26, 13); c.fillStyle = '#eceae3'; c.fill(); rr(c, bx2, yy + 8, Math.max(0, bw * Math.max(0, v) / 40), 26, 13); c.fillStyle = f[2]; c.fill(); txt(c, Math.max(0, v).toFixed(1) + '%', x + w - 44, yy + 34, 30, INK, { a: 'right' }); });
    // winner banner
    const wp = eBack(seg(lt, 2.7, 3.15)); if (wp > 0) { c.save(); c.translate(x + w / 2, y + h - 56); c.scale(wp, wp); rr(c, -400, -40, 800, 80, 12); c.fillStyle = INK; c.fill(); txt(c, 'PROJECTED WINNER ✓', -360, 12, 32, '#fff'); txt(c, FIELD[0][0], 360, 12, 32, MINT, { a: 'right' }); c.restore(); }
  }

  /* ========== 06 MAP MAKER 23.0 – 26.0 ========== */
  function sMap(c, t, W, H) {
    const lt = t - B.map0; paperBg(c, W, H); headline(c, lt, '06', 'EXPORT', ['MAP', 'MAKER'], 'Clean, Wikipedia-style election maps. Download as SVG or PNG.', 'paper', 150);
    const x = 900, y = 90; c.save(); c.translate(x, y); miniMap(c, lt - .15); c.restore(); const h = MP.h;
    ['SVG', 'PNG'].forEach((s, i) => { const p = eBack(seg(lt, 1.2 + i * .15, 1.6 + i * .15)); c.save(); c.translate(x + 220 + i * 280, y + h + 100); c.scale(Math.max(.001, p), Math.max(.001, p)); rr(c, -110, -46, 220, 92, 14); c.fillStyle = i ? PINK : INK; c.fill(); txt(c, '↓  ' + s, 0, 14, 44, '#fff', { a: 'center' }); c.restore(); });
    const cp = seg(lt, 1.9, 2.5); if (cp > 0) { const cx0 = x + 800 - 200 * eIO(cp), cy0 = y + h + 260 - 160 * eIO(cp); c.save(); c.translate(cx0, cy0); c.fillStyle = '#fff'; c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 44); c.lineTo(12, 34); c.lineTo(22, 54); c.lineTo(32, 49); c.lineTo(22, 30); c.lineTo(36, 30); c.closePath(); c.fill(); c.stroke(); c.restore(); }
  }

  /* ========== 08 ARTICLES 28.4 – 31.4 ========== */
  function sArticles(c, t, W, H) {
    const lt = t - B.art0; darkBg(c, t, W, H, .3); headline(c, lt, '07', 'READ', ['ARTICLES'], 'Analysis and write-ups from the wikiElections team.', 'dark', 132);
    const A = R.data.articles.slice(0, 3), tiles = ['T', 'O', 'A'], tcol = ['#111214', PINK, '#3a9d23'];
    A.forEach((a, i) => { const st = .1 + i * .28, p = eOut5(seg(lt, st, st + .6)); if (p <= 0) return; const x = 900, y = 110 + i * 295, w = 900, h = 270; c.save(); c.globalAlpha = Math.min(1, p * 2); c.translate(0, (1 - p) * 260); shadowCard(c, x, y, w, h, 18, '#14161d', true);
      rr(c, x + 28, y + 28, 214, 214, 12); c.fillStyle = tcol[i]; c.fill(); txt(c, tiles[i], x + 135, y + 168, 140, '#fff', { a: 'center' });
      txt(c, a.d, x + 270, y + 64, 22, MINT, { f: BODY, w: '800', ls: 3 }); const sz = fitSize(c, a.t, 40, 590); const words = a.t.split(' '); let line = '', yy = y + 112; const ww = 590;
      words.forEach(wd => { const test = line + wd + ' '; if (measure(c, test, 38) > ww && line) { txt(c, line.trim(), x + 270, yy, 38, '#fff'); yy += 46; line = wd + ' '; } else line = test; }); txt(c, line.trim(), x + 270, yy, 38, '#fff'); yy += 40;
      let by = a.by || ''; if (measure(c, by, 20, BODY) > 590) { while (by.length > 4 && measure(c, by + '…', 20, BODY) > 590) by = by.slice(0, -1); by = by.trim() + '…'; } txt(c, by, x + 270, Math.min(yy + 6, y + h - 22), 20, 'rgba(255,255,255,.6)', { f: BODY, w: '600' }); c.restore(); });
  }

  /* ========== 08 THE WIRE 29.0 – 31.8 ========== */
  function sWire(c, t, W, H) {
    const lt = t - B.wire0; pinkBg(c, W, H); headline(c, lt, '08', 'ALWAYS ON', ['THE', 'WIRE'], 'What just changed, on a loop at the top of every page.', 'pink', 150);
    const items = [['REPLAY', 'Relive the Class 1 October 2026 count, vote by vote'], ['DESK', 'The Two-Party Order and the Curse of the Majority'], ['RATINGS', 'Golden Eagle Gallup tops the pollster ratings with a B']];
    const x = 900, y = 250, w = 900, p = eOut5(seg(lt, .1, .7)); c.save(); c.globalAlpha = Math.min(1, p * 2); c.translate((1 - p) * 320, 0);
    shadowCard(c, x, y, w, 520, 18, INK, true); c.fillStyle = '#c8102e'; c.fillRect(x, y + 516, w, 4); rr(c, x + 40, y + 50, 210, 60, 10); c.fillStyle = PINK; c.fill(); txt(c, 'THE WIRE', x + 145, y + 90, 28, '#fff', { f: BODY, w: '800', a: 'center', ls: 4 });
    const per = .85, k = Math.min(2, Math.floor(Math.max(0, lt - .5) / per)), tl = Math.max(0, lt - .5) - k * per, ip = eOut(clamp(tl / .3)) * (1 - seg(tl, per - .2, per) * (k < 2 ? 1 : 0)), it = items[k];
    c.save(); c.globalAlpha = ip; c.translate(0, (1 - ip) * 24); txt(c, it[0], x + 44, y + 230, 30, '#ff5468', { f: BODY, w: '800', ls: 4 }); wrapLines(c, it[1], 50, w - 88, BODY).slice(0, 3).forEach((l, i) => txt(c, l, x + 44, y + 300 + i * 66, 50, '#fff', { f: BODY, w: '800' })); c.restore();
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(x + w - 180 + i * 32, y + 80, 9, 0, 7); c.fillStyle = i === k ? '#fff' : 'rgba(255,255,255,.3)'; c.fill(); } rr(c, x + w - 76, y + 54, 36, 56, 6); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 2; c.stroke(); txt(c, '❚❚', x + w - 58, y + 90, 18, '#fff', { f: BODY, w: '800', a: 'center' });
    c.restore();
  }

  /* ========== OUTRO 31.8 – 35.6 ========== */
  function sOutro(c, t, W, H) {
    const lt = t - B.out0; darkBg(c, t, W, H, .45); const wp = eBack(seg(lt, .05, .55)); const im = R.imgs.we, w0 = 520, h0 = w0 * im.height / im.width;
    c.save(); c.translate(W / 2, 290); c.scale(Math.max(.001, wp), Math.max(.001, wp)); c.drawImage(im, -w0 / 2, -h0 / 2, w0, h0); c.restore();
    riseWord(c, 'wikiElections', W / 2 - measure(c, 'wikiElections', 150) / 2, 560, 150, '#fff', seg(lt, .3, .8));
    c.save(); c.globalAlpha = eOut(seg(lt, .7, 1.2)); txt(c, 'NEW TOOLS  ·  NEW GRAPHS  ·  ONE SITE', W / 2, 630, 30, 'rgba(255,255,255,.8)', { f: BODY, w: '800', a: 'center', ls: 6 }); c.restore();
    const chips = ['Live Previews', 'Replay', 'Pollster Ratings', 'Party ID', 'Simulator', 'Map Maker', 'Articles', 'The Wire']; const rows = [chips.slice(0, 4), chips.slice(4)];
    rows.forEach((row, ri) => { const widths = row.map(s => measure(c, s, 30, BODY) + 56), total = widths.reduce((a, b) => a + b, 0) + (row.length - 1) * 18; let x = (W - total) / 2; row.forEach((s, i) => { const k = ri * 4 + i, p = eBack(seg(lt, .9 + k * .08, 1.3 + k * .08)); c.save(); c.translate(x + widths[i] / 2, 740 + ri * 82); c.scale(Math.max(.001, p), Math.max(.001, p)); rr(c, -widths[i] / 2, -32, widths[i], 64, 32); c.fillStyle = s === 'Party ID' ? PINK : '#1b1e28'; c.fill(); c.strokeStyle = s === 'Party ID' ? PINK : '#2c303c'; c.lineWidth = 2; c.stroke(); txt(c, s, 0, 11, 30, '#fff', { f: BODY, w: '800', a: 'center' }); c.restore(); x += widths[i] + 18; }); });
    c.save(); c.globalAlpha = eOut(seg(lt, 1.8, 2.3)); txt(c, 'NEW  ·  Party ID graphs, now with logos', W / 2, 920, 30, MINT, { f: BODY, w: '800', a: 'center', ls: 4 }); c.restore();
    const fo = seg(lt, 3.5, 3.79); if (fo > 0) { c.fillStyle = `rgba(11,12,16,${fo})`; c.fillRect(0, 0, W, H); }
  }

  function draw(ctx, t, W, H) {
    if (!R.ready) return; t = clamp(t, 0, DUR - 1e-4); ctx.save(); ctx.scale(W / DW, H / DH);
    if (t < B.sp0) sIntro(ctx, t, DW, DH); else if (t < B.rp0) sSpot(ctx, t, DW, DH); else if (t < B.pg0) sReplay(ctx, t, DW, DH); else if (t < B.party0) sPollsters(ctx, t, DW, DH);
    else if (t < B.sim0) sParty(ctx, t, DW, DH); else if (t < B.map0) sSim(ctx, t, DW, DH); else if (t < B.art0) sMap(ctx, t, DW, DH); else if (t < B.wire0) sArticles(ctx, t, DW, DH);
    else if (t < B.out0) sWire(ctx, t, DW, DH); else sOutro(ctx, t, DW, DH);
    Object.values(B).forEach((b, i) => wipe(ctx, t, b - .25, b + .25, DW, DH, i % 2));
    ctx.restore();
  }
  g.ToolkitSpot = { init, draw, DURATION: DUR, W: DW, H: DH, B };
})(window);
