/* Replay — 20s "commercial" motion-graphics spot, drawn deterministically on a canvas.
 * ReplaySpot.init({base:'../'}) -> Promise ; ReplaySpot.draw(ctx, t, W, H) draws frame at time t (seconds).
 * The same code drives the on-site player and the rendered MP4 (elects/replay-spot.html?capture=1&t=...). */
(function (g) {
  const DUR = 20, DW = 1920, DH = 1080;
  const PINK = '#c8195a', PINK2 = '#ca1957', INK = '#0b0c10', PANEL = '#14161d', LINE = '#262a35';
  const DISPLAY = '"Archivo Black","Arial Black",sans-serif', BODY = '"Public Sans","Helvetica Neue",Arial,sans-serif';
  const R = { text: null, layout: null, ballots: null, ready: false };

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const eOut = x => 1 - Math.pow(1 - x, 3);
  const eOut5 = x => 1 - Math.pow(1 - x, 5);
  const eIO = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const eBack = x => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const lerp = (a, b, x) => a + (b - a) * x;
  const rnd = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function init(opts) {
    const base = (opts && opts.base) || '../';
    const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const font = (name, url, w) => new FontFace(name, `url(${url})`, { weight: w }).load().then(f => { document.fonts.add(f); });
    return Promise.all([
      loadImg(base + 'assets/img/brand/spot/replay-text-white.png').then(i => R.text = i),
      fetch(base + 'assets/img/brand/spot/layout.json').then(r => r.json()).then(j => R.layout = j),
      fetch(base + 'data/timelines/class1-2026-10.json').then(r => r.json()).then(j => R.ballots = j.ballots.map(b => ({ t: Date.parse(b.t), c: b.r[0] }))),
      font('Archivo Black', base + 'assets/fonts/archivo-black-latin-400-normal.woff2', '400'),
      font('Public Sans', base + 'assets/fonts/public-sans-latin-800-normal.woff2', '800'),
      font('Public Sans', base + 'assets/fonts/public-sans-latin-600-normal.woff2', '600'),
    ]).then(() => { R.ready = true; });
  }

  /* ---------- small drawing helpers ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); }
  function txt(c, s, x, y, size, color, o = {}) {
    c.font = `${o.w || ''} ${size}px ${o.f || DISPLAY}`.trim(); c.fillStyle = color; c.textAlign = o.a || 'left'; c.textBaseline = o.b || 'alphabetic';
    if (o.ls != null && 'letterSpacing' in c) c.letterSpacing = o.ls + 'px'; else if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.fillText(s, x, y);
  }
  function measure(c, s, size, f, ls) { c.font = `${size}px ${f || DISPLAY}`; if ('letterSpacing' in c) c.letterSpacing = (ls || 0) + 'px'; return c.measureText(s).width; }
  /* a word that rises out of a clip box (masked slide-up) */
  function riseWord(c, s, x, baseY, size, color, p, o = {}) {
    const h = size * 1.0; c.save(); c.beginPath(); c.rect(x - 40, baseY - h * .92, 4000, h * 1.1); c.clip();
    txt(c, s, x, baseY + (1 - eOut5(p)) * h * 1.1, size, color, o); c.restore();
  }
  function triangle(c, x, y, w, h, color) { c.fillStyle = color; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h / 2); c.lineTo(x, y + h); c.closePath(); c.fill(); }
  function bgGrid(c, t, W, H, a) {
    c.save(); c.globalAlpha = a; c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 2; const s = 120, off = (t * 40) % s;
    for (let x = -s + off; x < W; x += s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    c.restore();
  }
  function pinkBand(c, W, H, a) {
    const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, PINK2); gr.addColorStop(.62, '#8f1243'); gr.addColorStop(1, '#5e0a2d');
    c.save(); c.globalAlpha = a == null ? 1 : a; c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.05)'; c.save(); c.translate(W / 2, H / 2); c.rotate(Math.PI / 4);
    for (let i = -2400; i < 2400; i += 40) c.fillRect(i, -2400, 14, 4800); c.restore(); c.restore();
  }
  function vignette(c, W, H) { const gr = c.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .95); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.45)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); }
  /* wipe: a pink block sweeping across the screen; returns its x-range so scenes can swap behind it */
  function wipe(c, t, a, b, W, H, dir) {
    const p = seg(t, a, b); if (p <= 0 || p >= 1) return;
    const e = eIO(p); let x0, x1;
    if (p < .5) { x0 = 0; x1 = W * eIO(p * 2); } else { x0 = W * eIO((p - .5) * 2); x1 = W; }
    c.fillStyle = PINK2; c.fillRect(x0, 0, x1 - x0, H); c.fillStyle = '#fff'; c.fillRect(x1 - 10, 0, 10, H * 0);
  }

  /* ---------- SCENE 1: kinetic type (0 – 5.3s) ---------- */
  function scene1(c, t, W, H) {
    c.fillStyle = INK; c.fillRect(0, 0, W, H); bgGrid(c, t, W, H, 1);
    const M = 150;
    // beat table: [start, end, lines]
    const beats = [
      { a: 0.15, b: 1.45, lines: [['ELECTION', '#fff'], ['NIGHT.', PINK]] },
      { a: 1.45, b: 2.75, lines: [['EVERY', '#fff'], ['VOTE.', PINK]] },
      { a: 2.75, b: 4.0, lines: [['COUNTED', '#fff'], ['LIVE.', PINK]] },
    ];
    const size = 330;
    beats.forEach((bt, k) => {
      if (t < bt.a || t > bt.b + .02) return;
      const pin = seg(t, bt.a, bt.a + .38), pout = seg(t, bt.b - .22, bt.b);
      bt.lines.forEach((ln, i) => {
        const bx = M, by = H / 2 + (i === 0 ? -20 : 285);
        const pi = seg(t, bt.a + i * .09, bt.a + i * .09 + .4);
        c.save();
        const shake = (t - bt.a) < .25 && i === 1 ? Math.sin((t - bt.a) * 90) * 10 * (1 - (t - bt.a) / .25) : 0;
        c.translate(shake, 0);
        if (pout > 0) { c.globalAlpha = 1 - pout; c.translate(-pout * pout * 260, 0); }
        const sz = size * (k === 0 && i === 0 ? .98 : 1);
        riseWord(c, ln[0], bx, by, sz, ln[1], pi);
        c.restore();
      });
      // underline bar
      const bw = eOut5(seg(t, bt.a + .2, bt.a + .6)) * (W - 2 * M) * (1 - pout);
      c.fillStyle = PINK; c.fillRect(M, H - 130, bw, 8);
      txt(c, `0${k + 1} / 04`, M, H - 160, 28, 'rgba(255,255,255,.55)', { f: BODY, w: '800', ls: 6 });
    });
    // beat 4: "...AND YOU MISSED IT."
    const a4 = 4.0;
    if (t >= a4) {
      const p = seg(t, a4, a4 + .45), pout = seg(t, 5.0, 5.3);
      c.save();
      if (pout > 0) c.globalAlpha = 1 - pout;
      const glitch = t > 4.55 && t < 5.0 ? (rnd(Math.floor(t * 30)) - .5) * 40 : 0;
      riseWord(c, 'AND YOU', M, H / 2 - 20, 250, '#fff', p);
      riseWord(c, 'MISSED IT.', M + glitch, H / 2 + 250, 250, PINK, seg(t, a4 + .12, a4 + .57));
      if (glitch) { c.globalCompositeOperation = 'screen'; txt(c, 'MISSED IT.', M - glitch * 1.4, H / 2 + 250, 250, 'rgba(0,255,255,.16)'); }
      c.restore();
      // rewind arrows
      if (t > 4.6) { const q = seg(t, 4.6, 5.3); c.save(); c.globalAlpha = Math.min(1, q * 3) * (1 - pout);
        for (let i = 0; i < 2; i++) { const x = W - 380 + i * 130 - q * 90; c.fillStyle = PINK; c.beginPath(); c.moveTo(x + 110, H / 2 - 150); c.lineTo(x, H / 2 - 60 - 90 + 90); c.lineTo(x + 110, H / 2 + 30); c.closePath(); c.fill(); }
        c.restore(); }
    }
    vignette(c, W, H);
  }

  /* ---------- SCENE 2: UI demo (5.4 – 11.6s) ---------- */
  const CAND = { oc1: { n: 'One-Community', p: 'New Democrats of TSR', col: '#0f6aa6', ini: 'O' }, dvwb: { n: 'Disguised_VW_Beetle', p: 'Unaffiliated', col: '#e6bd3c', ini: 'D' } };
  function fmtTime(ms) {
    const d = new Date(ms + 3600e3 * 2), D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const z = n => String(n).padStart(2, '0');
    return `${D[d.getUTCDay()]} ${d.getUTCDate()} ${M[d.getUTCMonth()]} · ${z(d.getUTCHours())}:${z(d.getUTCMinutes())}`;
  }
  function scene2(c, t, W, H) {
    const lt = t - 5.4, B = R.ballots;
    pinkBand(c, W, H, 1);
    // scene-in wipe-out of pink to reveal done by wipe in scene1; add push-in camera
    const cam = 1 + lt * .012;
    c.save(); c.translate(W / 2, H / 2); c.scale(cam, cam); c.translate(-W / 2, -H / 2);
    // headline
    riseWord(c, 'ELECTION NIGHT, REPLAYED.', 120, 150, 84, '#fff', seg(lt, .1, .6));
    txt(c, 'Every real ballot, replayed on the clock.', 124, 205, 34, 'rgba(255,255,255,.85)', { f: BODY, w: '600' }); // static after
    // panel
    const pp = eOut5(seg(lt, .15, .85)), px = 120, py = 262 + (1 - pp) * 700, pw = 1680, ph = 740;
    c.save(); c.globalAlpha = Math.min(1, pp * 2);
    c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 60; c.shadowOffsetY = 24; rr(c, px, py, pw, ph, 22); c.fillStyle = INK; c.fill(); c.shadowColor = 'transparent';
    rr(c, px, py, pw, ph, 22); c.save(); c.clip();
    // header
    const prog = clamp((lt - .9) / 4.7); // 0..1 of count
    const pos = prog * (B.length - 1) + 0.0001; const i0 = Math.min(B.length - 2, Math.floor(pos)), fr = pos - i0;
    const ease = x => x; const now = lerp(B[i0].t, B[i0 + 1].t, ease(fr));
    txt(c, 'CLASS 1 OCTOBER 2026 ELECTION', px + 48, py + 74, 46, '#fff');
    txt(c, 'Class 1 October 2026 First Round', px + 48, py + 112, 24, 'rgba(255,255,255,.6)', { f: BODY, w: '600' });
    txt(c, fmtTime(now), px + pw - 48, py + 74, 46, '#fff', { a: 'right' });
    txt(c, 'REAL BALLOT TIMES', px + pw - 48, py + 112, 20, 'rgba(255,255,255,.6)', { f: BODY, w: '800', a: 'right', ls: 3 });
    c.fillStyle = '#c8102e'; c.fillRect(px, py + 132, pw, 5);
    // tallies
    let n = { oc1: 0, dvwb: 0 }, cnt = Math.floor(pos + 1e-6) + (fr > .92 ? 1 : 0); if (prog <= 0) cnt = 0; if (prog >= 1) cnt = B.length;
    for (let i = 0; i < Math.min(cnt, B.length); i++) n[B[i].c]++;
    const tot = Math.max(1, n.oc1 + n.dvwb);
    // smooth bar % toward current
    ['oc1', 'dvwb'].forEach((k, i) => {
      const cd = CAND[k], y = py + 200 + i * 150, share = prog <= 0 ? 0 : n[k] / tot;
      const lead = n[k] > n[k === 'oc1' ? 'dvwb' : 'oc1'];
      c.fillStyle = cd.col; c.beginPath(); c.arc(px + 90, y + 40, 44, 0, 7); c.fill(); txt(c, cd.ini, px + 90, y + 56, 44, '#fff', { a: 'center' });
      txt(c, cd.n, px + 170, y + 28, 44, '#fff'); txt(c, cd.p, px + 172, y + 66, 24, 'rgba(255,255,255,.6)', { f: BODY, w: '600' });
      if (lead && cnt > 0) { const lw = measure(c, cd.n, 44) + 20; rr(c, px + 170 + lw, y - 4, 150, 34, 6); c.fillStyle = '#fff'; c.fill(); txt(c, 'LEADING', px + 170 + lw + 75, y + 21, 20, INK, { f: BODY, w: '800', a: 'center', ls: 2 }); }
      const bx = px + 172, bw = 760; rr(c, bx, y + 88, bw, 14, 7); c.fillStyle = '#242732'; c.fill();
      rr(c, bx, y + 88, Math.max(0, bw * share), 14, 7); c.fillStyle = cd.col; c.fill();
      txt(c, (share * 100).toFixed(1) + '%', px + 1190, y + 52, 76, '#fff', { a: 'right' });
      txt(c, n[k] + (n[k] === 1 ? ' vote' : ' votes'), px + 1190, y + 92, 28, 'rgba(255,255,255,.7)', { f: BODY, w: '600', a: 'right' });
    });
    // ballot ticker (right)
    const tx = px + 1260, ty = py + 180; txt(c, 'BALLOTS IN', tx, ty, 22, 'rgba(255,255,255,.55)', { f: BODY, w: '800', ls: 4 });
    const shown = []; for (let i = Math.max(0, cnt - 5); i < cnt; i++) shown.push(i);
    shown.reverse().forEach((bi, row) => {
      const cd = CAND[B[bi].c], age = (pos - bi); const slide = row === 0 ? eOut5(clamp(age * 6)) : 1;
      c.save(); c.globalAlpha = (1 - row * .17) * slide; c.translate((1 - slide) * 80, 0);
      rr(c, tx, ty + 24 + row * 66, 340, 52, 10); c.fillStyle = '#1b1e28'; c.fill(); c.fillStyle = cd.col; c.fillRect(tx, ty + 24 + row * 66, 8, 52);
      txt(c, 'Ballot #' + (bi + 1), tx + 26, ty + 58 + row * 66, 26, '#fff', { f: BODY, w: '800' });
      txt(c, cd.n.length > 13 ? cd.n.slice(0, 12) + '…' : cd.n, tx + 322, ty + 58 + row * 66, 22, 'rgba(255,255,255,.7)', { f: BODY, w: '600', a: 'right' });
      c.restore();
    });
    // timeline strip
    const sy = py + ph - 150, sx = px + 48, sw = pw - 96; rr(c, sx, sy, sw, 90, 12); c.fillStyle = '#0f1117'; c.fill(); c.strokeStyle = LINE; c.lineWidth = 2; c.stroke();
    const t0 = B[0].t, t1 = B[B.length - 1].t;
    B.forEach((b, i) => { const x = sx + 24 + (sw - 48) * (b.t - t0) / (t1 - t0), on = i < cnt; c.globalAlpha = on ? 1 : .22; c.fillStyle = CAND[b.c].col; const hh = 14 + (i % 3) * 8; c.fillRect(x - 3, sy + 45 - hh, 6, hh * 2); });
    c.globalAlpha = 1; const hx = sx + 24 + (sw - 48) * (now - t0) / (t1 - t0); c.fillStyle = '#fff'; c.fillRect(hx - 2, sy + 8, 4, 74); c.beginPath(); c.arc(hx, sy + 8, 9, 0, 7); c.fill();
    // play pill
    const pl = lt < .9 ? 0 : 1; txt(c, prog >= 1 ? '✓  FINAL' : '▶  PLAYING', px + 48, py + ph - 38, 24, prog >= 1 ? '#6be3a8' : '#fff', { f: BODY, w: '800', ls: 4 });
    txt(c, '18 ballots · 31 hours · 30 seconds', px + pw - 48, py + ph - 38, 24, 'rgba(255,255,255,.55)', { f: BODY, w: '600', a: 'right' });
    c.restore(); c.restore();
    // callout tags
    const tag = (s, x, y, a, b, rot) => { const p = eBack(seg(lt, a, a + .35)) * (1 - seg(lt, b, b + .25)); if (p <= 0) return; c.save(); c.translate(x, y); c.rotate(rot); c.scale(p, p);
      const w = measure(c, s, 38) + 56; rr(c, -w / 2, -34, w, 68, 12); c.fillStyle = '#fff'; c.fill(); txt(c, s, 0, 13, 38, INK, { a: 'center' }); c.restore(); };
    tag('VOTE BY VOTE', 640, 745, 1.5, 3.4, -.04);
    tag('REAL BALLOT TIMES', 760, 745, 3.5, 6.0, .03);
    c.restore();
  }

  /* ---------- SCENE 3: three fast feature cuts (11.5 – 15.6s) ---------- */
  function icon(c, kind, cx, cy, s, col, p) {
    c.save(); c.translate(cx, cy); c.scale(s, s); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 12; c.lineCap = 'round'; c.lineJoin = 'round';
    if (kind === 'play') { c.beginPath(); c.arc(0, 0, 100, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * eOut(p)); c.stroke(); c.globalAlpha = p; c.beginPath(); c.moveTo(-28, -50); c.lineTo(58, 0); c.lineTo(-28, 50); c.closePath(); c.fill(); }
    if (kind === 'clock') { c.beginPath(); c.arc(0, 0, 100, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * eOut(p)); c.stroke(); c.globalAlpha = p; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -62); c.moveTo(0, 0); c.lineTo(Math.cos(p * 10 - 1) * 46, Math.sin(p * 10 - 1) * 46); c.stroke(); }
    if (kind === 'film') { c.globalAlpha = 1; rr(c, -110, -80, 220 * eOut(p), 160, 18); c.stroke(); c.globalAlpha = p; for (let i = 0; i < 3; i++) { c.fillRect(-90, -50 + i * 40, 14, 20); c.fillRect(76, -50 + i * 40, 14, 20); } c.beginPath(); c.moveTo(-24, -34); c.lineTo(40, 0); c.lineTo(-24, 34); c.closePath(); c.fill(); }
    c.restore();
  }
  function scene3(c, t, W, H) {
    const cuts = [
      { a: 11.5, b: 12.9, bg: INK, fg: '#fff', ac: PINK, big: ['VOTE', 'BY VOTE.'], sub: 'Watch the count build, ballot by ballot.', ic: 'play' },
      { a: 12.9, b: 14.3, bg: '#fff', fg: INK, ac: PINK, big: ['REAL', 'BALLOT TIMES.'], sub: 'Every vote lands exactly when it was cast.', ic: 'clock' },
      { a: 14.3, b: 15.7, bg: PINK2, fg: '#fff', ac: INK, big: ['EXPORT', 'AS VIDEO.'], sub: 'One click. Ready to post.', ic: 'film' },
    ];
    const k = cuts.findIndex(x => t >= x.a && t < x.b); if (k < 0) { c.fillStyle = PINK2; c.fillRect(0, 0, W, H); return; }
    const ct = cuts[k], lt = t - ct.a, M = 150;
    c.fillStyle = ct.bg; c.fillRect(0, 0, W, H);
    if (ct.bg === PINK2) pinkBand(c, W, H, 1); else if (ct.bg === INK) bgGrid(c, t, W, H, 1);
    // giant ghost number
    c.save(); c.globalAlpha = ct.bg === '#fff' ? .06 : .09; txt(c, '0' + (k + 1), W - 80, H - 60, 760, ct.fg, { a: 'right' }); c.restore();
    const fit = (str, sz) => Math.min(sz, sz * (W - 2 * M - 40) / measure(c, str, sz));
    riseWord(c, ct.big[0], M, 470, fit(ct.big[0], 270), ct.fg, seg(lt, 0, .35));
    riseWord(c, ct.big[1], M, 740, fit(ct.big[1], 230), ct.ac, seg(lt, .08, .43));
    c.save(); c.globalAlpha = eOut(seg(lt, .35, .7)); txt(c, ct.sub, M + 4, 850, 44, ct.fg, { f: BODY, w: '800' }); c.restore();
    c.fillStyle = ct.ac; c.fillRect(M, 168, eOut5(seg(lt, .1, .5)) * 220, 10);
    // icon
    const ip = eOut(seg(lt, .15, .75)); icon(c, ct.ic, W - 290, 250, 1.35 * eBack(seg(lt, .1, .5)), ct.ac, ip);
    // hard cut flash
    const fl = 1 - seg(lt, 0, .12); if (fl > 0) { c.fillStyle = `rgba(255,255,255,${fl * .6})`; c.fillRect(0, 0, W, H); }
    // out wipe on last
    if (k === 2) { /* handled by scene4 reveal */ }
  }

  /* ---------- SCENE 4: logo reveal (15.7 – 20s) ---------- */
  function scene4(c, t, W, H) {
    const lt = t - 15.7;
    c.fillStyle = INK; c.fillRect(0, 0, W, H);
    // pink radial glow growing
    const gp = eOut(seg(lt, 0, 1.2)); const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 900 * gp + 1); gr.addColorStop(0, 'rgba(200,25,90,.55)'); gr.addColorStop(1, 'rgba(200,25,90,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H);
    bgGrid(c, t, W, H, .8);
    const L = R.layout, sc = 1.75, lw = L.w * sc, lh = L.h * sc, ox = (W - lw) / 2 + 10, oy = (H - lh) / 2 - 40;
    // shockwave ring at impact
    const ip = seg(lt, .55, 1.5); if (ip > 0 && ip < 1) { c.save(); c.strokeStyle = `rgba(255,255,255,${.7 * (1 - ip)})`; c.lineWidth = 8 * (1 - ip) + 1; c.beginPath(); c.arc(ox + 120, oy + lh / 2, 60 + eOut(ip) * 900, 0, 7); c.stroke(); c.restore(); }
    // triangle: spins/scales in, then slams to place
    const tp = seg(lt, .05, .75), te = eBack(tp); const [a, b, d] = L.tri; const tw = b[0] * sc, th = (d[1] - a[1]) * sc;
    c.save(); c.translate(ox + tw * .38, oy + (a[1] + d[1]) / 2 * sc); c.rotate((1 - eOut(tp)) * -Math.PI * 1.5); c.scale(Math.max(.0001, te), Math.max(.0001, te)); c.translate(-tw * .38, -th / 2); triangle(c, 0, 0, tw, th, PINK); c.restore();
    // letters pop in with stagger
    L.letters.forEach((r, i) => {
      const lp = seg(lt, .6 + i * .07, .6 + i * .07 + .5); if (lp <= 0) return; const e = eBack(lp);
      const sx = r[0], sy = r[1], sw = r[2], sh = r[3];
      c.save(); c.globalAlpha = clamp(lp * 3); c.translate(ox + (sx + sw / 2) * sc, oy + (sy + sh) * sc); c.scale(1, Math.max(.0001, e)); c.drawImage(R.text, sx, sy, sw, sh, -sw / 2 * sc, -sh * sc, sw * sc, sh * sc); c.restore();
    });
    // light sweep across the logo
    const sp = seg(lt, 1.25, 1.95); if (sp > 0 && sp < 1) { c.save(); c.beginPath(); c.rect(ox - 20, oy - 20, lw + 40, lh + 40); c.clip(); const x = ox - 200 + (lw + 400) * eIO(sp);
      const g2 = c.createLinearGradient(x - 120, 0, x + 120, 0); g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(.5, 'rgba(255,255,255,.55)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'source-atop'; c.fillStyle = g2; c.save(); c.translate(0, 0); c.transform(1, 0, -.35, 1, 0, 0); c.fillRect(x - 120, oy - 20, 240, lh + 40); c.restore(); c.restore(); }
    // tagline + url
    const tg = seg(lt, 1.5, 2.1); c.save(); c.globalAlpha = eOut(tg); txt(c, 'RELIVE THE COUNT.', W / 2, oy + lh + 150 + (1 - eOut(tg)) * 30, 78, '#fff', { a: 'center', ls: 2 }); c.restore();
    const up = seg(lt, 2.0, 2.6); c.save(); c.globalAlpha = eOut(up); const u = 'wikiElections  ·  TSR Elects  ·  elects/replay';
    txt(c, u.toUpperCase(), W / 2, oy + lh + 225, 28, 'rgba(255,255,255,.7)', { f: BODY, w: '800', a: 'center', ls: 5 }); c.restore();
    // tail fade-out to black for looping
    const fo = seg(lt, 4.1, 4.3); if (fo > 0) { c.fillStyle = `rgba(11,12,16,${fo})`; c.fillRect(0, 0, W, H); }
    // entry flash
    const fl = 1 - seg(lt, 0, .15); if (fl > 0) { c.fillStyle = `rgba(255,255,255,${fl * .7})`; c.fillRect(0, 0, W, H); }
  }

  function draw(ctx, t, W, H) {
    if (!R.ready) return; t = clamp(t, 0, DUR - 1e-4);
    ctx.save(); ctx.scale(W / DW, H / DH);
    if (t < 5.35) scene1(ctx, t, DW, DH);
    else if (t < 11.5) { scene2(ctx, t, DW, DH); }
    else if (t < 15.7) scene3(ctx, t, DW, DH);
    else scene4(ctx, t, DW, DH);
    wipe(ctx, t, 5.0, 5.7, DW, DH); wipe(ctx, t, 11.2, 11.8, DW, DH);
    ctx.restore();
  }

  g.ReplaySpot = { init, draw, DURATION: DUR, W: DW, H: DH };
})(window);
