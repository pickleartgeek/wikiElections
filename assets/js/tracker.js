/**
 * Tracker — FiveThirtyEight-style poll-tracker graphics for the main page.
 *
 *   TK_trend(el, cfg)        interactive trend chart: faint dots for each poll, bold average
 *                            line, end labels, hover crosshair + tooltip, optional range buttons
 *   TK_spark(pts, opts)      tiny trend line with an end dot (returns an SVG string)
 *   TK_renderApproval(...)   leaderboard: approve | split bar | net | trend | change, plus a net-over-time chart
 *   TK_renderQuestions(...)  yes/no tracker cards with split bars and trend lines
 *   TK_renderParties(...)    generic-ballot style chart with party chips
 *   TK_renderRace(...)       live-race tracker (candidate chips + trend chart)
 *
 * Needs basecalc.js. Colors come from CSS variables, so dark mode works untouched.
 */
const TK_DAY = 86400000;
const TK_esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TK_t = d => new Date(d + 'T00:00:00Z').getTime();
const TK_iso = t => new Date(t).toISOString().slice(0, 10);
const TK_clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TK_net = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d);
const TK_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TK_pollsterHref = n => 'pollster?p=' + encodeURIComponent(String(n).replace(/\s*\(.*?\)/g, '').replace(/^u\//, '').replace(/\s+H2H Poll$/, '').trim());
const TK_INK = '#111214', TK_RED = '#cf1322';


/* ---------- theme-aware colour: on dark backgrounds, flip the lightness of colours that would sink into it ---------- */
const TK_isDark = () => document.documentElement.dataset.theme === 'dark';
function TK_hexToHsl(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let hh = 0, ss = 0;
  if (d) { ss = d / (1 - Math.abs(2 * l - 1)); hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; if (hh < 0) hh += 360; }
  return [hh, ss, l];
}
function TK_col(hex) {
  if (!TK_isDark()) return hex;
  const hsl = TK_hexToHsl(hex); if (!hsl) return hex;
  const [h, s, l] = hsl;
  if (l >= 0.5) return hex;                       // already readable on dark
  const l2 = Math.min(0.82, Math.max(0.58, 1 - l)); // invert the brightness
  return `hsl(${h.toFixed(0)} ${(Math.min(1, s) * 100).toFixed(0)}% ${(l2 * 100).toFixed(0)}%)`;
}

/** Monotone cubic (Fritsch-Carlson) curve through [[x,y],...]: smooth, passes through every point, never overshoots. */
function TK_smoothPath(P) {
  const n = P.length, f = v => v.toFixed(1);
  if (n === 0) return '';
  if (n === 1) return `M${f(P[0][0])},${f(P[0][1])}`;
  if (n === 2) return `M${f(P[0][0])},${f(P[0][1])}L${f(P[1][0])},${f(P[1][1])}`;
  const dx = [], m = [], t = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = dx[i] > 0 ? (P[i + 1][1] - P[i][1]) / dx[i] : 0; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(P[0][0])},${f(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(P[i][0] + h)},${f(P[i][1] + t[i] * h)} ${f(P[i + 1][0] - h)},${f(P[i + 1][1] - t[i + 1] * h)} ${f(P[i + 1][0])},${f(P[i + 1][1])}`;
  }
  return d;
}

/** linearly interpolated value of a series at time t (clamped to its ends) */
function TK_linAt(pts, t) {
  if (t <= pts[0].t) return pts[0].v;
  for (let i = 1; i < pts.length; i++) if (t <= pts[i].t) { const a = pts[i - 1], b = pts[i], f = (t - a.t) / Math.max(1, b.t - a.t); return a.v + f * (b.v - a.v); }
  return pts[pts.length - 1].v;
}

function TK_niceTicks(min, max, want = 5) {
  if (!(max > min)) { max = min + 1; }
  const raw = (max - min) / want, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(x => x * p).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { ticks: out, step };
}

function TK_dateLabel(t, longRange) {
  const d = new Date(t);
  return longRange ? `${TK_MON[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}` : `${TK_MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** value of a series at time t (last point at or before t; first point if t precedes all) */
function TK_valueAt(pts, t) {
  let lo = 0, hi = pts.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m].t <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return pts[ans];
}

/**
 * cfg: { series:[{id,name,short,color,pts:[{d,v}],dots:[{d,v,n}],faint}], yFmt, tipFmt, zero, height,
 *        yMin, yMax, ranges:[days...] (0 = all), range, labelMode:'name'|'value' }
 */
/* ---------- "art" mode helpers: reveal-on-scroll + number count-up ---------- */
let TK_uid = 0;
const TK_reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function TK_reveal(root) {
  if (!root || root.dataset.reveal) return;
  root.dataset.reveal = '1'; root.classList.add('tk-art');
  const go = () => { root.classList.add('in'); setTimeout(() => root.classList.add('done'), 3600); };
  if (TK_reduced() || !('IntersectionObserver' in window)) { go(); return; }
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { go(); io.disconnect(); } }, { threshold: 0.2 });
  io.observe(root);
}
function TK_countUp(root, sel) {
  if (!root || TK_reduced() || root.classList.contains('done') || !('IntersectionObserver' in window)) return;
  const items = [];
  root.querySelectorAll(sel || '.tk-tile-v,.tk-q-net,.tk-score-v,.tk-pod-net').forEach(n => {
    const t = [...n.childNodes].find(c => c.nodeType === 3 && /\d/.test(c.nodeValue)); if (!t) return;
    const m = t.nodeValue.match(/^(\s*[+−-]?)(\d+(?:\.\d+)?)([\s\S]*)$/); if (!m) return;
    items.push({ t, pre: m[1], val: parseFloat(m[2]), dec: (m[2].split('.')[1] || '').length, post: m[3] });
  });
  if (!items.length) return;
  const put = k => items.forEach(i => { i.t.nodeValue = i.pre + (i.val * k).toFixed(i.dec) + i.post; });
  put(0);
  const run = () => { const t0 = performance.now(); const step = now => { const k = Math.min(1, (now - t0) / 1300); put(1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); run(); } }, { threshold: 0.2 });
  io.observe(root);
}
/** Party logo treatment from registries.json (logo, logoStyle): returns {src, bg, zoom, wide} or null. */
function TK_partyMark(party, color, base) {
  if (!party || !party.logo) return null;
  const st = String(party.logoStyle || 'plain'), wide = st.includes('wide');
  return { src: (base || 'assets/img/parties/') + party.logo + '?v=3', wide, zoom: st.includes('zoom') ? 1.38 : 1,
    bg: st.includes('dark') ? '#111214' : st.includes('badge') ? '#ffffff' : color };
}
const TK_lightCol = hex => { const h = TK_hexToHsl(hex); return !!h && h[2] > 0.62; };

/** White luminance-cutout version of candidate photos (the site's duotone look); resolves to the original on failure. */
function TK_filterSrc(src) { return (typeof PhotoFilter_process === 'function' && src) ? PhotoFilter_process(src).catch(() => src) : Promise.resolve(src); }

function TK_trend(el, cfg) {
  if (cfg.art && !cfg._f && cfg.series.some(s => s.icon)) {
    Promise.all(cfg.series.map(s => s.icon ? TK_filterSrc(s.icon).then(v => ({ ...s, icon: v })) : s)).then(series => TK_trend(el, { ...cfg, series, _f: 1 }));
    return;
  }
  const state = { range: cfg.range != null ? cfg.range : 0 };
  const series = cfg.series.map(s => ({
    ...s, raw: s.color, color: TK_col(s.color),
    pts: (s.pts || []).map(p => ({ t: TK_t(p.d), d: p.d, v: p.v })).sort((a, b) => a.t - b.t),
    dots: (s.dots || []).map(p => ({ t: TK_t(p.d), d: p.d, v: p.v, n: p.n, pl: p.pl })),
  })).filter(s => s.pts.length);
  if (!series.length) { el.innerHTML = '<div class="small-muted" style="padding:16px">No polling logged yet.</div>'; return; }
  const tEnd = Math.max(...series.map(s => s.pts[s.pts.length - 1].t));
  const tAll = Math.min(...series.map(s => s.pts[0].t));
  const yFmt = cfg.yFmt || (v => v + '%');
  const tipFmt = cfg.tipFmt || (v => v.toFixed(1) + '%');

  el.classList.add('tk-chart');
  el.innerHTML = (cfg.ranges && cfg.ranges.length > 1 ? `<div class="tk-ranges" role="group" aria-label="Time range">${cfg.ranges.map(r =>
    `<button type="button" data-r="${r}" class="${r === state.range ? 'on' : ''}">${r ? (r >= 365 ? Math.round(r / 365) + 'Y' : Math.round(r / 30) + 'M') : 'All'}</button>`).join('')}</div>` : '') +
    '<div class="tk-plot"></div><div class="tk-tip" hidden></div>';
  const plot = el.querySelector('.tk-plot'), tip = el.querySelector('.tk-tip');
  el.querySelectorAll('.tk-ranges button').forEach(b => b.onclick = () => {
    state.range = +b.dataset.r; el.querySelectorAll('.tk-ranges button').forEach(x => x.classList.toggle('on', x === b));
    const rt = el.closest('.tk-art'); if (rt && !TK_reduced()) { rt.classList.remove('done'); clearTimeout(rt._dn); rt._dn = setTimeout(() => rt.classList.add('done'), 2600); }
    draw();
  });

  function draw() {
    const W = Math.max(280, plot.clientWidth || el.clientWidth || 640);
    const narrow = W < 540;
    const H = cfg.height || (cfg.art ? (narrow ? 320 : 470) : (narrow ? 250 : 330));
    const lblMode = cfg.labelMode || (narrow ? 'value' : 'name');
    const m = { t: 12, r: lblMode === 'name' ? (cfg.art ? 214 : 172) : (cfg.art ? 64 : 46), b: 28, l: narrow ? 36 : 42 };
    const t0 = state.range ? Math.max(tAll, tEnd - state.range * TK_DAY) : tAll;
    const t1 = tEnd, span = Math.max(TK_DAY, t1 - t0);
    const X = t => m.l + ((t - t0) / span) * (W - m.l - m.r);

    const vis = series.map(s => {
      const pts = s.pts.filter(p => p.t >= t0);
      const before = s.pts.filter(p => p.t < t0).pop();
      if (before && pts.length && pts[0].t > t0) pts.unshift({ ...before, t: t0 });
      return { ...s, vp: pts, vd: s.dots.filter(p => p.t >= t0) };
    }).filter(s => s.vp.length);
    let lo = Infinity, hi = -Infinity;
    vis.forEach(s => { s.vp.forEach(p => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }); s.vd.forEach(p => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }); });
    if (cfg.yMin != null) lo = Math.min(lo, cfg.yMin);
    if (cfg.yMax != null) hi = Math.max(hi, cfg.yMax);
    if (cfg.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const pad = (hi - lo) * 0.08 || 1;
    lo = cfg.yMin != null ? cfg.yMin : lo - pad; hi = cfg.yMax != null ? cfg.yMax : hi + pad;
    if (cfg.yMin == null && lo > 0 && lo < (hi - lo) * 0.6) lo = 0;
    const { ticks } = TK_niceTicks(lo, hi, narrow ? 4 : 5);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

    let g = '';
    ticks.forEach(v => {
      const y = Y(v), z = cfg.zero && v === 0;
      g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" class="${z ? 'tk-zero' : 'tk-grid'}"/>` +
        `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end" class="tk-ax">${TK_esc(yFmt(v))}</text>`;
    });
    const long = span > 300 * TK_DAY, nx = narrow ? 3 : 5;
    for (let i = 0; i <= nx; i++) {
      const t = t0 + (span * i) / nx, anchor = i === 0 ? 'start' : i === nx ? 'end' : 'middle';
      g += `<text x="${X(t)}" y="${H - 8}" text-anchor="${anchor}" class="tk-ax">${TK_dateLabel(t, long)}</text>`;
    }
    // dots first (under the lines), faint series first
    const order = [...vis].sort((a, b) => (b.faint ? 1 : 0) - (a.faint ? 1 : 0));
    let dotLinks = '';   // invisible hit-targets drawn above the hover layer: clicking a dot opens that pollster's rating page
    order.forEach(s => {
      s.vd.forEach(p => { const r = Math.min(6, 2.4 + Math.sqrt(p.n || 4) * 0.55), cx = X(p.t), cy = Y(p.v);
        g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}" fill-opacity="${s.faint ? .12 : .3}" stroke="${s.color}" stroke-opacity="${s.faint ? .3 : .75}" stroke-width="1" style="pointer-events:none"/>`;
        if (p.pl) dotLinks += `<a href="${TK_esc(TK_pollsterHref(p.pl))}"><circle cx="${cx}" cy="${cy}" r="${Math.max(r, 7)}" fill="transparent" style="cursor:pointer"><title>${TK_esc(p.pl)} · ${TK_esc(tipFmt(p.v))} · ${TK_esc(p.d)}${p.n ? ' · n=' + p.n : ''} — open pollster rating</title></circle></a>`; });
    });
    const uid = ++TK_uid;
    if (cfg.art) g = `<defs><filter id="tkg${uid}" x="-5%" y="-20%" width="110%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
      order.map((s, i) => `<linearGradient id="tkf${uid}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".2"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('') + '</defs>' + g;
    order.forEach((s, i) => {
      const pts = s.vp.map(p => [X(p.t), Y(p.v)]), d = TK_smoothPath(pts);
      if (cfg.art && cfg.area && !s.faint) { const yb = cfg.zero ? Y(0) : H - m.b; g += `<path class="tk-area" d="${d} L ${pts[pts.length - 1][0]} ${yb} L ${pts[0][0]} ${yb} Z" fill="url(#tkf${uid}-${i})" style="--i:${i}"/>`; }
      g += `<path ${cfg.art ? `class="tk-draw" pathLength="1" style="--i:${i}" ${s.faint ? '' : `filter="url(#tkg${uid})"`}` : ''} d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.faint ? 1.6 : (cfg.art ? 4.5 : 3)}" stroke-opacity="${s.faint ? .55 : 1}" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    // end labels with simple vertical dodge
    const labs = vis.filter(s => !s.faint).map(s => { const p = s.vp[s.vp.length - 1]; return { s, p, y: Y(p.v) }; }).sort((a, b) => a.y - b.y);
    { // spread end labels: push down to clear neighbours, then pull back up if the stack hits the bottom edge
      const GAP = cfg.art ? 42 : 15, top = m.t + (cfg.art ? 22 : 8), bot = H - m.b - (cfg.art ? 22 : 2);
      labs.forEach((l, i) => { l.y = Math.max(l.y, i ? labs[i - 1].y + GAP : top); });
      if (labs.length) { labs[labs.length - 1].y = Math.min(labs[labs.length - 1].y, bot); for (let i = labs.length - 2; i >= 0; i--) labs[i].y = Math.min(labs[i].y, labs[i + 1].y - GAP); }
    }
    if (cfg.art) labs.forEach((l, i) => {
      const x = X(l.p.t), ay = Y(l.p.v), my = l.y, c = l.s.color, cid = `tkc${uid}-${i}`, ink = TK_lightCol(l.s.raw) ? '#111214' : '#fff', mk = l.s.mark;
      g += (Math.abs(my - ay) > 1 ? `<line x1="${x}" y1="${ay}" x2="${x}" y2="${my}" stroke="${c}" stroke-width="2" stroke-opacity=".55"/>` : '') +
        `<circle cx="${x}" cy="${ay}" r="4.5" fill="${c}"/>` +
        `<g class="tk-pop" style="--i:${i}">${i === 0 ? `<circle class="tk-pulse" cx="${x}" cy="${my}" r="19" fill="none" stroke="${c}" stroke-width="2"/>` : ''}` +
        (mk ? (mk.wide ? `<rect x="${x - 22}" y="${my - 17}" width="84" height="34" rx="17" fill="${mk.bg}"/><image href="${TK_esc(mk.src)}" x="${x - 12}" y="${my - 8}" width="64" height="16" preserveAspectRatio="xMidYMid meet"/>`
          : `<circle cx="${x}" cy="${my}" r="20" fill="${mk.bg}" stroke="${c}" stroke-width="2.5"/><clipPath id="${cid}"><circle cx="${x}" cy="${my}" r="17.5"/></clipPath><image href="${TK_esc(mk.src)}" x="${x - 17.5 * mk.zoom}" y="${my - 17.5 * mk.zoom}" width="${35 * mk.zoom}" height="${35 * mk.zoom}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${cid})"/>`)
        : `<circle cx="${x}" cy="${my}" r="20" fill="${c}"/>`) +
        (mk ? '' : l.s.icon ? `<clipPath id="${cid}"><circle cx="${x}" cy="${my}" r="17"/></clipPath><image href="${TK_esc(l.s.icon)}" x="${x - 17}" y="${my - 17}" width="34" height="34" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cid})"/>`
          : `<text x="${x}" y="${my + 4}" text-anchor="middle" class="tk-badge" style="font-size:${String(l.s.badge || l.s.short || l.s.name).length > 3 ? 9.5 : 12}px" fill="${ink}">${TK_esc(TK_clip(String(l.s.badge || l.s.short || l.s.name), 5))}</text>`) + '</g>' +
        `<text x="${x + (mk && mk.wide ? 72 : 30)}" y="${my - 2}" class="tk-end tk-end-art" fill="${c}">${TK_esc(TK_clip(l.s.short || l.s.name, 19))}</text>` +
        `<text x="${x + (mk && mk.wide ? 72 : 30)}" y="${my + 15}" class="tk-end-val">${TK_esc(yFmt(Math.round(l.p.v * 10) / 10))}</text>`;
    });

    else labs.forEach(l => {
      const x = X(l.p.t);
      g += `<circle cx="${x}" cy="${Y(l.p.v)}" r="4.2" fill="${l.s.color}" stroke="var(--surface,#fff)" stroke-width="2"/>` +
        `<text x="${x + 10}" y="${l.y + 4}" class="tk-end" fill="${l.s.color}">${lblMode === 'name' ? TK_esc(TK_clip(l.s.short || l.s.name, 21)) + ' ' : ''}${TK_esc(yFmt(Math.round(l.p.v * 10) / 10))}</text>`;
    });
    vis.filter(s => s.faint && s.former).forEach(s => { const p = s.vp[s.vp.length - 1], x = X(p.t), y = Y(p.v);   // a former mod's line stops where the term ended: mark and name it there
      g += `<circle cx="${x}" cy="${y}" r="3.4" fill="var(--surface,#fff)" stroke="${s.color}" stroke-width="2"/><text x="${x}" y="${y - 9}" text-anchor="${x > W - m.r - 90 ? 'end' : 'middle'}" class="tk-end" fill="${s.color}" style="font-size:10px;opacity:.85">${TK_esc(TK_clip(s.short || s.name, 16))} · ${s.tag || 'former'}</text>`; });
    g += `<line class="tk-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/><rect class="tk-hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>${dotLinks}`;
    plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${TK_esc(cfg.label || 'Polling trend chart')}">${g}</svg>`;

    const svg = plot.querySelector('svg'), cross = svg.querySelector('.tk-cross'), hit = svg.querySelector('.tk-hit');
    const move = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (W / r.width);
      const t = t0 + ((px - m.l) / (W - m.l - m.r)) * span;
      const rows = vis.map(s => ({ s, p: { v: TK_linAt(s.vp, t) } }));
      if (!rows.length) return;
      const tt = Math.min(t1, Math.max(t0, t)), cx = X(tt);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      rows.sort((a, b) => b.p.v - a.p.v);
      tip.innerHTML = `<div class="tk-tip-d">${TK_dateLabel(tt, false)}${long ? ` ${new Date(tt).getUTCFullYear()}` : ''}</div>` +
        rows.map(x => `<div class="tk-tip-r"><i style="background:${x.s.color}"></i><span>${TK_esc(x.s.name)}</span><b>${TK_esc(tipFmt(x.p.v))}</b></div>`).join('');
      tip.hidden = false;
      const left = Math.min(Math.max(8, cx + 14), Math.max(8, W - tip.offsetWidth - 8));
      tip.style.left = left + 'px'; tip.style.top = (m.t + 6 + (plot.offsetTop || 0)) + 'px';
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.hidden = true; });
  }
  draw();
  let raf = 0, lastW = plot.clientWidth;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (plot.clientWidth && plot.clientWidth !== lastW) { lastW = plot.clientWidth; draw(); } }); });
}

/** Tiny trend line with end dot. pts: [{d,v}] sorted; shows the last `days` days. */
function TK_spark(pts, o = {}) {
  const w = o.w || 120, h = o.h || 34, color = o.color || 'var(--ink)';
  if (!pts || pts.length < 2) return `<svg class="tk-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"></svg>`;
  const tEnd = TK_t(pts[pts.length - 1].d), tS = tEnd - (o.days || 120) * TK_DAY;
  let p = pts.filter(x => TK_t(x.d) >= tS); if (p.length < 2) p = pts.slice(-2);
  const ts = p.map(x => TK_t(x.d)), vs = p.map(x => x.v);
  let lo = Math.min(...vs), hi = Math.max(...vs); if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.15 || 1; lo -= pad; hi += pad;
  const X = t => 4 + ((t - ts[0]) / Math.max(1, ts[ts.length - 1] - ts[0])) * (w - 12), Y = v => 4 + (1 - (v - lo) / (hi - lo)) * (h - 8);
  const d = TK_smoothPath(p.map((x, i) => [X(ts[i]), Y(x.v)]));
  const zero = o.zero && lo < 0 && hi > 0 ? `<line x1="4" x2="${w - 8}" y1="${Y(0)}" y2="${Y(0)}" class="tk-zero"/>` : '';
  const last = p[p.length - 1];
  return `<svg class="tk-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${zero}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${X(ts[ts.length - 1])}" cy="${Y(last.v)}" r="3" fill="${color}"/></svg>`;
}

function TK_splitBar(a, d, la, ld) {
  const gap = Math.max(0, 1 - a - d);
  return `<div class="tk-split" role="img" aria-label="${la} ${(a * 100).toFixed(0)} percent, ${ld} ${(d * 100).toFixed(0)} percent">
    <span class="tk-split-a" style="width:${(a * 100).toFixed(2)}%"></span><span class="tk-split-g" style="width:${(gap * 100).toFixed(2)}%"></span><span class="tk-split-d" style="width:${(d * 100).toFixed(2)}%"></span></div>`;
}

/* ---------- shared: series (average as of each poll release) + change ---------- */
/** The official BaseCalc average evaluated on each poll's release date (and on asOf), not every calendar day:
 *  the day-by-day version saw-tooths because a fresh poll counts n/1 and then decays as n/days. */
function TK_asOfSeries(polls, ids, asOf, opts) {
  const dates = [...new Set(polls.map(p => p.date).filter(d => d <= asOf))].sort();
  if (!dates.length) return [];
  if (dates[dates.length - 1] < asOf) dates.push(asOf);
  return dates.map(d => {
    const agg = BaseCalc_aggregate(polls.filter(p => p.date <= d), ids, d, opts || {});
    return { date: d, averages: agg.averages, coverage: agg.coverage };
  });
}
function TK_netSeries(polls, asOf) {
  return TK_asOfSeries(polls, ['approve', 'disapprove'], asOf, { normalize: false })
    .map(p => ({ d: p.date, v: ((p.averages.approve || 0) - (p.averages.disapprove || 0)) * 100 }));
}
function TK_interp(series, t) {
  if (t <= TK_t(series[0].d)) return series[0].v;
  for (let i = 1; i < series.length; i++) {
    const t1 = TK_t(series[i].d);
    if (t <= t1) { const t0 = TK_t(series[i - 1].d), f = (t - t0) / Math.max(1, t1 - t0); return series[i - 1].v + f * (series[i].v - series[i - 1].v); }
  }
  return series[series.length - 1].v;
}
function TK_change(series, days) {
  if (!series.length) return null;
  const last = series[series.length - 1], target = TK_t(last.d) - days * TK_DAY;
  if (TK_t(series[0].d) > target) return null;
  return last.v - TK_interp(series, target);
}
function TK_changeHtml(c) {
  if (c == null) return '<span class="tk-chg flat">—</span>';
  if (Math.abs(c) < 0.5) return '<span class="tk-chg flat">▬ 0.0</span>';
  return `<span class="tk-chg ${c > 0 ? 'up' : 'down'}">${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}</span>`;
}
const TK_dayStr = () => { const n = new Date(); return TK_iso(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };

/* ---------- Moderator approval ---------- */
function _TK_approval(el, o) {
  const asOf = o.asOf || TK_dayStr();
  const rows = o.mods.map(m => {
    const mAsOf = m.asOf || asOf;
    const agg = BaseCalc_aggregate(m.polls, ['approve', 'disapprove'], mAsOf, { normalize: false });
    const a = agg.averages.approve || 0, d = agg.averages.disapprove || 0;
    const series = TK_netSeries(m.polls, mAsOf);
    const last = m.polls.reduce((x, p) => (p.date > x ? p.date : x), '');
    return { ...m, a, d, net: (a - d) * 100, series, chg: TK_change(series, 14), last };
  }).sort((x, y) => y.net - x.net);
  if (!rows.length) { el.innerHTML = ''; return; }
  const avgNet = rows.reduce((s, r) => s + r.net, 0) / rows.length;
  const newest = rows.reduce((x, r) => (r.last > x ? r.last : x), '');
  const nPolls = rows.reduce((s, r) => s + r.polls.length, 0);
  const tile = (k, v, sub, cls = '') => `<div class="tk-tile"><div class="tk-tile-k">${k}</div><div class="tk-tile-v ${cls}">${v}</div><div class="tk-tile-s">${sub}</div></div>`;
  const top = rows[0], bot = rows[rows.length - 1];
  const tg = o.toggle, tgHtml = tg ? `<label class="tk-toggle"><input type="checkbox" ${tg.on ? 'checked' : ''}><span class="tk-sw" aria-hidden="true"></span><span>${TK_esc(tg.label)}</span></label>` : '';
  const art = !!o.art;
  const podium = art ? `<div class="tk-podium">${rows.slice(0, 3).map((r, i) => `
      <a class="tk-pod" href="approval?mod=${encodeURIComponent(r.key)}" style="--c:${TK_col(o.colorFor(r.key, i))}">
        <span class="tk-pod-rank">${i + 1}</span>
        <img class="white-filter-img" src="${r.photo}" alt="" loading="lazy">
        <span class="tk-pod-name">${TK_esc(r.name)}</span>
        <span class="tk-pod-net ${r.net < 0 ? 'neg' : ''}">${TK_net(r.net)}</span>
        <span class="tk-pod-bar"><i style="--w:${Math.max(0, Math.min(100, r.a * 100))}%"></i></span>
        <small>${(r.a * 100).toFixed(1)}% approve · ${(r.d * 100).toFixed(1)}% disapprove</small>
      </a>`).join('')}</div>` : '';
  const chartPanel = `<div class="tk-panel">
      <div class="tk-panel-h"><h3>Net approval over time</h3><span>Approve minus disapprove, in points</span></div>
      <div id="tkApprChart"></div>
    </div>`;
  el.innerHTML = `${tgHtml}
    <div class="tk-tiles">
      ${tile('Average net approval', TK_net(avgNet), `across ${rows.length} moderators`, avgNet < 0 ? 'neg' : '')}
      ${tile('Highest net', TK_net(top.net), TK_esc(top.name), top.net < 0 ? 'neg' : '')}
      ${tile('Lowest net', TK_net(bot.net), TK_esc(bot.name), bot.net < 0 ? 'neg' : '')}
      ${tile('Polls tracked', nPolls, `latest ${newest}`)}
    </div>
    ${art ? podium + chartPanel : ''}
    <div class="tk-board" role="table" aria-label="Moderator approval">
      <div class="tk-row tk-hd" role="row"><span>Moderator</span><span class="tk-c-bar"><b>Approve</b><b>Disapprove</b></span><span class="tk-c-net">Net</span><span class="tk-c-sp">Trend</span><span class="tk-c-chg">14-day</span></div>
      ${rows.map(r => `
      <a class="tk-row" role="row" href="approval?mod=${encodeURIComponent(r.key)}">
        <span class="tk-who"><img src="${r.photo}" alt="" loading="lazy"><span class="tk-name">${TK_esc(r.name)}<small>${r.former ? `<b class="tk-seat prev" title="Final approval at end of term">Former</b> · ` : ''}${r.seat ? `<b class="tk-seat${r.carryOver ? ' prev' : ''}"${r.carryOver ? ' title="Previous term"' : ''}>${TK_esc(r.seat)}</b> · ` : ''}${r.polls.length} poll${r.polls.length === 1 ? '' : 's'}</small>${r.pending ? `<small class="tk-pend">Now ${TK_esc(r.pending)} · first poll pending</small>` : ''}</span></span>
        <span class="tk-c-bar"><em class="tk-a">${(r.a * 100).toFixed(1)}%</em>${TK_splitBar(r.a, r.d, 'Approve', 'Disapprove')}<em class="tk-d">${(r.d * 100).toFixed(1)}%</em></span>
        <span class="tk-c-net ${r.net < 0 ? 'neg' : ''}">${TK_net(r.net)}</span>
        <span class="tk-c-sp">${TK_spark(r.series, { color: r.net < 0 ? TK_RED : 'var(--ink)', zero: true })}</span>
        <span class="tk-c-chg">${TK_changeHtml(r.chg)}</span>
      </a>`).join('')}
    </div>
    ${art ? '' : chartPanel}`;
  const reg = o.registry;
  if (tg) el.querySelector('.tk-toggle input').addEventListener('change', ev => tg.onChange(ev.target.checked));
  const cur = rows.filter(r => !r.former), old = rows.filter(r => r.former);
  TK_trend(el.querySelector('#tkApprChart'), {
    label: 'Net approval over time for each moderator', zero: true, ranges: [90, 180, 0], range: old.length ? 0 : 180,
    yFmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), tipFmt: v => TK_net(v),
    art, area: false, series: cur.slice(0, 8).map((r, i) => ({ id: r.key, name: r.name, short: r.name, icon: r.photo, color: o.colorFor(r.key, i), pts: r.series, faint: false }))
      .concat(cur.slice(0, 8).flatMap((r, i) => (r.earlier || []).filter(t => t.polls.length).map(t => ({ id: r.key + ':' + t.label, name: `${r.name} · ${t.label}`, short: t.label, tag: 'earlier tenure', color: o.colorFor(r.key, i), pts: TK_netSeries(t.polls, t.asOf || asOf), faint: true, former: true }))))
      .concat(old.slice(0, 8).map((r, i) => ({ id: r.key, name: r.name + ' (former)', short: r.name, color: o.colorFor(r.key, cur.length + i), pts: r.series, faint: true, former: true })))
  });
  if (art) { TK_reveal(el); TK_countUp(el); if (typeof PhotoFilter_applyAll === 'function') PhotoFilter_applyAll('.tk-pod .white-filter-img'); }
}

/* ---------- Community track record (yes/no questions) ---------- */
function _TK_questions(el, o) {
  const asOf = o.asOf || TK_dayStr();
  el.innerHTML = '<div class="tk-qgrid">' + o.questions.map(q => {
    if (!q.polls.length) return `<a class="tk-q" href="approval?mod=${encodeURIComponent(q.key)}"><div class="tk-q-t">${TK_esc(q.name)}</div><div class="small-muted" style="padding:18px 0">No polling logged yet.</div></a>`;
    const agg = BaseCalc_aggregate(q.polls, ['approve', 'disapprove'], asOf, { normalize: false });
    const a = agg.averages.approve || 0, d = agg.averages.disapprove || 0, net = (a - d) * 100;
    const series = TK_netSeries(q.polls, asOf), yes = q.yesLabel || 'Yes', no = q.noLabel || 'No';
    const lead = a >= d ? yes : no;
    return `<a class="tk-q" href="approval?mod=${encodeURIComponent(q.key)}">
      <div class="tk-q-t">${TK_esc(q.name)}</div>
      ${o.art ? TK_gauge(a, d) : ''}
      <div class="tk-q-main"><div><div class="tk-q-lead">${TK_esc(lead)}</div><div class="tk-q-net ${net < 0 ? 'neg' : ''}">${TK_net(Math.abs(net))}</div></div>${TK_spark(series, { w: 130, h: 44, color: net < 0 ? TK_RED : 'var(--ink)', zero: true, days: 180 })}</div>
      ${TK_splitBar(a, d, yes, no)}
      <div class="tk-q-lg"><span><i class="a"></i>${TK_esc(yes)} <b>${(a * 100).toFixed(1)}%</b></span><span><i class="d"></i>${TK_esc(no)} <b>${(d * 100).toFixed(1)}%</b></span></div>
      <div class="tk-q-ft">${q.polls.length} polls · ${TK_changeHtml(TK_change(series, 30))} <small>30-day net</small></div>
    </a>`;
  }).join('') + '</div>';
  if (o.art) { TK_reveal(el); TK_countUp(el); }
}
/** Semicircle gauge: yes share fills from the left (ink), no share from the right (red). */
function TK_gauge(a, d) {
  const tot = a + d || 1, ys = a / tot, ns = d / tot, arc = 'M 10 66 A 56 56 0 0 1 122 66', rev = 'M 122 66 A 56 56 0 0 1 10 66';
  return `<svg class="tk-gauge" viewBox="0 0 132 74" aria-hidden="true"><path d="${arc}" class="tk-gauge-t" pathLength="1"/>` +
    `<path d="${arc}" class="tk-gauge-y" pathLength="1" style="--s:${ys.toFixed(4)}"/><path d="${rev}" class="tk-gauge-n" pathLength="1" style="--s:${Math.max(0, ns - 0.012).toFixed(4)}"/></svg>`;
}

/* ---------- Generic-ballot style party tracker ---------- */
/** The classic DDTSR lead badge: yellow pill, leader's name, and the margin in the leader's own colour. */
function TK_leadBadge(name, color, margin) {
  const hsl = TK_hexToHsl(color), ink = hsl && hsl[2] > 0.62 ? '#111214' : '#fff';  // keep light party colours (e.g. Unaffiliated grey) legible
  return `<div class="rcp-lead-badge tk-leadbadge">${TK_esc(name)}<span class="rcp-lead-value" style="background:${color};color:${ink}">+${margin.toFixed(1)}</span></div>`;
}

function _TK_parties(el, o) {
  const asOf = o.asOf || TK_dayStr(), ids = Object.keys(o.parties);
  if (!o.polls.length) { el.innerHTML = '<div class="small-muted" style="padding:16px">No party support polling logged yet.</div>'; return; }
  const tl = SITE_partyEras(o.parties, asOf).flatMap(e => TK_asOfSeries(o.polls, e.ids, asOf, {}).filter(p => p.date > e.from && p.date <= e.to));
  const last = tl[tl.length - 1].averages;
  const show = ids.filter(i => (last[i] || 0) >= 0.03).sort((a, b) => last[b] - last[a]).slice(0, 6);
  const lead = show[0], second = show[1];
  const series = show.map(i => ({
    id: i, name: o.parties[i].shortName || o.parties[i].name, short: o.parties[i].shortName || o.parties[i].name, color: o.parties[i].color,
    pts: tl.filter(p => p.coverage[i] > 0).map(p => ({ d: p.date, v: p.averages[i] * 100 })),
    dots: o.polls.filter(p => p.shares && typeof p.shares[i] === 'number').map(p => ({ d: p.date, v: p.shares[i] * 100, n: p.sample, pl: p.pollster }))
  }));
  const art = !!o.art, code = i => o.parties[i].shortName || o.parties[i].name;
  const scores = art ? `<div class="tk-scores">${show.map((i, k) => `<div class="tk-score" style="--c:${TK_col(o.parties[i].color)};--k:${k}">
      <span class="tk-score-top">${(mk => mk ? `<span class="tk-score-logo${mk.wide ? ' wide' : ''}" style="background:${mk.bg}"><img src="${TK_esc(mk.src)}" alt="" style="${mk.zoom > 1 ? 'transform:scale(' + mk.zoom + ')' : ''}"></span>` : `<span class="tk-score-badge" style="background:${TK_col(o.parties[i].color)};color:${TK_lightCol(o.parties[i].color) ? '#111214' : '#fff'}">${TK_esc(TK_clip(code(i), 4))}</span>`)(TK_partyMark(o.parties[i], TK_col(o.parties[i].color)))}<span class="tk-score-n">${TK_esc(o.parties[i].name)}</span></span>
      <span class="tk-score-v">${(last[i] * 100).toFixed(1)}<small>%</small></span>
      <span class="tk-score-bar"><i style="--w:${(last[i] / last[lead] * 100).toFixed(1)}%"></i></span></div>`).join('')}
</div>` : '';
  el.innerHTML = art ? `${scores}
    <div class="tk-panel"><div class="tk-panel-h"><h3>Party support over time</h3><span>Lines are the weighted average · dots are individual polls, sized by sample</span>${second ? TK_leadBadge(code(lead), o.parties[lead].color, (last[lead] - last[second]) * 100) : ''}</div><div id="tkPartyChart"></div></div>
    <a class="tk-more" href="${o.href || 'party-support'}">Full party breakdown →</a>` : `
    <div class="tk-chips">${show.map(i => `<div class="tk-chip" style="--c:${TK_col(o.parties[i].color)}"><span class="tk-chip-n">${TK_esc(o.parties[i].shortName || o.parties[i].name)}</span><span class="tk-chip-v">${(last[i] * 100).toFixed(1)}<small>%</small></span></div>`).join('')}
      ${second ? TK_leadBadge(o.parties[lead].shortName || o.parties[lead].name, o.parties[lead].color, (last[lead] - last[second]) * 100) : ''}</div>
    <div class="tk-panel"><div class="tk-panel-h"><h3>Party support over time</h3><span>Lines are the weighted average · dots are individual polls, sized by sample</span></div><div id="tkPartyChart"></div></div>
    <a class="tk-more" href="${o.href || 'party-support'}">Full party breakdown →</a>`;
  TK_trend(el.querySelector('#tkPartyChart'), { label: 'Party support over time', series: art ? series.map(x => ({ ...x, badge: x.short, mark: TK_partyMark(o.parties[x.id], TK_col(o.parties[x.id].color)) })) : series, ranges: [90, 180, 0], range: 180, yMin: 0, art, area: art });
  if (art) { TK_reveal(el); TK_countUp(el); }
}

/* ---------- Election-season "arena" tracker: dark stage, jagged daily lines, scrubbable giant numbers ---------- */
function TK_bright(hex) {   // lift dark party/candidate colours so they glow on the dark stage
  const h = TK_hexToHsl(hex); if (!h) return hex;
  const l = Math.max(h[2], 0.6), s = Math.min(1, Math.max(h[1], 0.55) + (h[2] < 0.35 ? 0.1 : 0));
  return `hsl(${h[0].toFixed(0)} ${(s * 100).toFixed(0)}% ${(Math.min(l, 0.72) * 100).toFixed(0)}%)`;
}
function TK_arena(el, o) {
  const reg = o.registry, ids = o.ids, asOf = o.asOf || TK_dayStr();
  const agg = BaseCalc_aggregate(o.polls, ids, asOf, o.opts || {});
  const tl = TK_asOfSeries(o.polls, ids, asOf, o.opts || {});
  const order = agg.sorted.map(x => x[0]);
  const S = order.map(i => ({
    id: i, name: TSR_candidateName(reg, i), color: TK_bright(TSR_candidateColor(reg, i)), raw: TSR_candidateColor(reg, i), photo: TSR_candidatePhoto(reg, i),
    pts: tl.filter(p => p.coverage[i] > 0).map(p => ({ t: TK_t(p.date), v: p.averages[i] * 100 }))
  })).filter(s => s.pts.length);
  if (!S.length) { el.innerHTML = '<div class="small-muted" style="padding:16px">No polling logged yet.</div>'; return; }
  const tEnd = Math.max(...S.map(s => s.pts[s.pts.length - 1].t)), tStart = Math.min(...S.map(s => s.pts[0].t));
  const sparse = a => a;                         // (series are per poll-date already)
  el.classList.add('ar-card');
  el.innerHTML = `<div class="ar-head"><div class="ar-kicker">Polling average</div><h2 class="ar-title">${TK_esc(o.title)}</h2>
      <a class="ar-btn" href="${TK_esc(o.href || '#')}"><span>View Polls</span><b aria-hidden="true">→</b></a></div>
    <div class="ar-plot"><div class="ar-badge" hidden></div><div class="ar-svgbox"></div></div>
    <div class="ar-foot">Hover or drag across the chart to scrub through time · dots in the chart are individual polls</div>`;
  const box = el.querySelector('.ar-svgbox'), badge = el.querySelector('.ar-badge');
  const valAt = (s, t) => TK_linAt(s.pts.map(p => ({ t: p.t, v: p.v })), t);
  let cursor = null, lay = null;
  const filtered = Promise.all(S.map(s => TK_filterSrc(s.photo).then(v => { s.photo = v; })));
  function draw() {
    const W = Math.max(300, box.clientWidth || 700), narrow = W < 560, H = narrow ? 420 : 520;
    const m = { t: 56, r: narrow ? 118 : 232, b: 30, l: 14 };
    let lo = Infinity, hi = -Infinity; S.forEach(s => s.pts.forEach(p => { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }));
    const pad = (hi - lo) * .1 || 4; lo = Math.max(0, Math.floor((lo - pad) / 10) * 10); hi = Math.min(100, Math.ceil((hi + pad) / 10) * 10); const step = (hi - lo) > 60 ? 20 : 10;
    const X = t => m.l + ((t - tStart) / Math.max(1, tEnd - tStart)) * (W - m.l - m.r), Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    const uid = ++TK_uid; let g = `<defs>` + S.map((s, i) => `<linearGradient id="arf${uid}-${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".42"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`).join('') + '</defs>';
    for (let v = lo; v <= hi; v += step) g += `<line x1="${m.l}" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" class="ar-grid"/><text x="${m.l + 2}" y="${Y(v) - 5}" class="ar-ax">${v}%</text>`;
    const days = Math.max(1, Math.round((tEnd - tStart) / TK_DAY)), nx = Math.min(narrow ? 4 : 7, days); for (let i = 0; i <= nx; i++) { const t = tStart + (tEnd - tStart) * i / nx; g += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t - 20}" y2="${H - m.b}" class="ar-vgrid"/><text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}" class="ar-ax">${TK_dateLabel(t, (tEnd - tStart) > 300 * TK_DAY)}</text>`; }
    S.forEach((s, i) => {
      const line = s.pts.map((p, k) => (k ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.v).toFixed(1)).join(' ');
      const f = s.pts[0], l = s.pts[s.pts.length - 1];
      g += `<path class="tk-area" style="--i:${i}" d="${line} L ${X(l.t)} ${H - m.b} L ${X(f.t)} ${H - m.b} Z" fill="url(#arf${uid}-${i})"/>`;
      g += `<path class="tk-draw" pathLength="1" style="--i:${i}" d="${line}" fill="none" stroke="${s.color}" stroke-width="${narrow ? 3 : 4}" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    const tt = cursor == null ? tEnd : Math.min(tEnd, Math.max(tStart, cursor)), cx = X(tt);
    const lab = S.map(s => ({ s, v: valAt(s, tt), y: Y(valAt(s, tt)) })).sort((a, b) => a.y - b.y);
    const GAP = Math.max(narrow ? 52 : 58, Math.min(narrow ? 66 : 78, (H - m.t - m.b - 30) / Math.max(1, lab.length))), big = narrow ? (GAP > 60 ? 30 : 26) : (GAP > 70 ? 48 : GAP > 62 ? 40 : 34); lab.forEach((l, i) => { l.my = Math.max(l.y, i ? lab[i - 1].my + GAP : m.t + 10); });
    const bot = H - m.b - 20; lab[lab.length - 1].my = Math.min(lab[lab.length - 1].my, bot); for (let i = lab.length - 2; i >= 0; i--) lab[i].my = Math.min(lab[i].my, lab[i + 1].my - GAP);
    g += `<line x1="${cx}" x2="${cx}" y1="${m.t - 30}" y2="${H - m.b}" class="ar-cursor"/>`;
    lab.forEach((l, i) => {
      const { s } = l, R = narrow ? 17 : 23, id = `arc${uid}-${i}`;
      g += (Math.abs(l.my - l.y) > 1 ? `<line x1="${cx}" x2="${cx}" y1="${l.y}" y2="${l.my}" stroke="${s.color}" stroke-width="3"/>` : '') + `<circle cx="${cx}" cy="${l.y}" r="5" fill="${s.color}"/>` +
        `<g class="tk-pop" style="--i:${i}"><circle cx="${cx}" cy="${l.my}" r="${R + 3}" fill="${s.color}"/><clipPath id="${id}"><circle cx="${cx}" cy="${l.my}" r="${R}"/></clipPath>` +
        `<image href="${TK_esc(s.photo)}" x="${cx - R}" y="${l.my - R}" width="${R * 2}" height="${R * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/></g>` +
        `<text x="${cx + R + 16}" y="${l.my + big * .16}" class="ar-big" fill="${s.color}" style="font-size:${big}px">${l.v.toFixed(1)}<tspan class="ar-pct" style="font-size:${Math.round(big * .58)}px">%</tspan></text>` +
        `<text x="${cx + R + 16}" y="${l.my + big * .16 + 17}" class="ar-name">${TK_esc(TK_clip(s.name, narrow ? 12 : 20))}</text>`;
    });
    g += `<rect class="ar-hit" x="${m.l}" y="${m.t - 30}" width="${W - m.l - m.r + 20}" height="${H - m.t + 30 - m.b}" fill="transparent"/>`;
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${TK_esc(o.title)} polling average">${g}</svg>`;
    // lead badge above the cursor
    const a = lab[0].v >= lab[lab.length - 1].v ? lab[0] : lab[lab.length - 1], top2 = [...lab].sort((p, q) => q.v - p.v), lead = top2[0], runner = top2[1];
    if (runner) { const hsl = TK_hexToHsl(lead.s.raw); badge.hidden = false; badge.style.left = Math.min(W - 150, Math.max(80, cx)) + 'px';
      badge.innerHTML = `${TK_esc(TK_clip(lead.s.name, 18))}<span style="background:${lead.s.color};color:${(hsl && hsl[2] > .62) ? '#111214' : '#fff'}">+${(lead.v - runner.v).toFixed(1)}</span>`;
      badge.title = cursor == null ? 'Latest average' : TK_dateLabel(tt, false); } else badge.hidden = true;
    lay = { W, m };
  }
  let busy = false; const redrawLive = () => { if (busy) return; busy = true; requestAnimationFrame(() => { busy = false; el.classList.add('done'); draw(); }); };
  const mv = ev => { const svg = box.querySelector('svg'); if (!svg || !lay) return; const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * (lay.W / r.width);
    if (px < lay.m.l - 4 || px > lay.W - lay.m.r + 24) return; cursor = tStart + ((px - lay.m.l) / (lay.W - lay.m.l - lay.m.r)) * (tEnd - tStart); redrawLive(); };
  box.addEventListener('pointermove', mv); box.addEventListener('pointerdown', mv); box.addEventListener('pointerleave', () => { cursor = null; redrawLive(); });
  filtered.then(() => { draw(); TK_reveal(el); });
  let lw = box.clientWidth; window.addEventListener('resize', () => { if (box.clientWidth && box.clientWidth !== lw) { lw = box.clientWidth; draw(); } });
}

/* ---------- Live race tracker ---------- */
function _TK_race(el, o) {
  if (o.arena !== false && typeof TK_linAt === 'function') { TK_arena(el, o); return; }
  const asOf = o.asOf || TK_dayStr(), ids = o.ids;
  const agg = BaseCalc_aggregate(o.polls, ids, asOf, o.opts || {});
  const tl = TK_asOfSeries(o.polls, ids, asOf, o.opts || {});
  const show = agg.sorted.map(x => x[0]);
  const reg = o.registry;
  const series = show.map(i => ({
    id: i, name: TSR_candidateName(reg, i), short: TSR_candidateName(reg, i), color: TSR_candidateColor(reg, i),
    pts: tl.filter(p => p.coverage[i] > 0).map(p => ({ d: p.date, v: p.averages[i] * 100 })),
    dots: o.polls.filter(p => p.shares && typeof p.shares[i] === 'number').map(p => ({ d: p.date, v: p.shares[i] * 100, n: p.sample, pl: p.pollster }))
  }));
  const [a, b] = agg.sorted;
  let view = 'trend'; try { view = localStorage.getItem('wE-race-view') === 'donut' ? 'donut' : 'trend'; } catch (e) {}
  el.innerHTML = `
    <div class="tk-race-h"><div class="tk-race-t">${TK_esc(o.title)}</div>${b ? TK_leadBadge(TSR_candidateName(reg, a[0]), TSR_candidateColor(reg, a[0]), (a[1] - b[1]) * 100) : ''}</div>
    <div class="tk-chips">${agg.sorted.map(([i, v]) => `<div class="tk-chip" style="--c:${TK_col(TSR_candidateColor(reg, i))}"><span class="tk-chip-n">${TK_esc(TSR_candidateName(reg, i))}</span><span class="tk-chip-v">${(v * 100).toFixed(1)}<small>%</small></span></div>`).join('')}</div>
    <div class="tk-panel"><div class="tk-panel-h"><h3>Polling average</h3><span class="tk-sub">Dots are individual polls, sized by sample</span>${typeof RCPDonut_render === 'function' ? `<div class="tk-seg" role="group" aria-label="Chart view"><button data-v="trend" class="${view === 'trend' ? 'on' : ''}">Trend</button><button data-v="donut" class="${view === 'donut' ? 'on' : ''}">Donut</button></div>` : ''}</div><div id="tkRaceChart"></div></div>
    <a class="tk-more" href="${o.href}">Full breakdown on Decision Desk TSR →</a>`;
  const draw = () => {
    const box = el.querySelector('#tkRaceChart');
    el.querySelectorAll('.tk-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    const sub = el.querySelector('.tk-sub'); if (sub) sub.style.display = view === 'trend' ? '' : 'none';
    if (view === 'donut' && typeof RCPDonut_fromAggregate === 'function') RCPDonut_fromAggregate(box, agg, reg, '', null);
    else { box.innerHTML = ''; TK_trend(box, { label: o.title + ' polling average', series, yMin: 0 }); }
  };
  el.querySelectorAll('.tk-seg button').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; try { localStorage.setItem('wE-race-view', view); } catch (e) {} draw(); }));
  draw();
}


/* ---------- mounting: remember each section so it can redraw when the theme is toggled ---------- */
const TK_reg = new Map();
function TK_mount(el, fn) { TK_reg.set(el, fn); fn(); }
const TK_renderApproval = (el, o) => TK_mount(el, () => _TK_approval(el, o));
const TK_renderQuestions = (el, o) => TK_mount(el, () => _TK_questions(el, o));
const TK_renderParties = (el, o) => TK_mount(el, () => _TK_parties(el, o));
const TK_renderRace = (el, o) => TK_mount(el, () => _TK_race(el, o));
if (typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => TK_reg.forEach((fn, el) => { if (document.body.contains(el)) fn(); }))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

if (typeof window !== 'undefined') Object.assign(window, { TK_arena, TK_partyMark, TK_leadBadge, TK_trend, TK_spark, TK_renderApproval, TK_renderQuestions, TK_renderParties, TK_renderRace });
