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
function TK_trend(el, cfg) {
  const state = { range: cfg.range != null ? cfg.range : 0 };
  const series = cfg.series.map(s => ({
    ...s, color: TK_col(s.color),
    pts: (s.pts || []).map(p => ({ t: TK_t(p.d), d: p.d, v: p.v })).sort((a, b) => a.t - b.t),
    dots: (s.dots || []).map(p => ({ t: TK_t(p.d), d: p.d, v: p.v, n: p.n })),
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
    state.range = +b.dataset.r; el.querySelectorAll('.tk-ranges button').forEach(x => x.classList.toggle('on', x === b)); draw();
  });

  function draw() {
    const W = Math.max(280, plot.clientWidth || el.clientWidth || 640);
    const narrow = W < 540;
    const H = cfg.height || (narrow ? 250 : 330);
    const lblMode = cfg.labelMode || (narrow ? 'value' : 'name');
    const m = { t: 12, r: lblMode === 'name' ? 138 : 46, b: 28, l: narrow ? 36 : 42 };
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
    order.forEach(s => {
      s.vd.forEach(p => { const r = Math.min(6, 2.4 + Math.sqrt(p.n || 4) * 0.55);
        g += `<circle cx="${X(p.t)}" cy="${Y(p.v)}" r="${r}" fill="${s.color}" fill-opacity="${s.faint ? .12 : .3}" stroke="${s.color}" stroke-opacity="${s.faint ? .3 : .75}" stroke-width="1"/>`; });
    });
    order.forEach(s => {
      const d = TK_smoothPath(s.vp.map(p => [X(p.t), Y(p.v)]));
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.faint ? 1.6 : 3}" stroke-opacity="${s.faint ? .55 : 1}" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    // end labels with simple vertical dodge
    const labs = vis.filter(s => !s.faint).map(s => { const p = s.vp[s.vp.length - 1]; return { s, p, y: Y(p.v) }; }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
    labs.forEach(l => {
      const x = X(l.p.t);
      g += `<circle cx="${x}" cy="${Y(l.p.v)}" r="4.2" fill="${l.s.color}" stroke="var(--surface,#fff)" stroke-width="2"/>` +
        `<text x="${x + 10}" y="${l.y + 4}" class="tk-end" fill="${l.s.color}">${lblMode === 'name' ? TK_esc(TK_clip(l.s.short || l.s.name, 15)) + ' ' : ''}${TK_esc(yFmt(Math.round(l.p.v * 10) / 10))}</text>`;
    });
    g += `<line class="tk-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/><rect class="tk-hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/>`;
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
  el.innerHTML = `
    <div class="tk-tiles">
      ${tile('Average net approval', TK_net(avgNet), `across ${rows.length} moderators`, avgNet < 0 ? 'neg' : '')}
      ${tile('Highest net', TK_net(top.net), TK_esc(top.name), top.net < 0 ? 'neg' : '')}
      ${tile('Lowest net', TK_net(bot.net), TK_esc(bot.name), bot.net < 0 ? 'neg' : '')}
      ${tile('Polls tracked', nPolls, `latest ${newest}`)}
    </div>
    <div class="tk-board" role="table" aria-label="Moderator approval">
      <div class="tk-row tk-hd" role="row"><span>Moderator</span><span class="tk-c-bar"><b>Approve</b><b>Disapprove</b></span><span class="tk-c-net">Net</span><span class="tk-c-sp">Trend</span><span class="tk-c-chg">14-day</span></div>
      ${rows.map(r => `
      <a class="tk-row" role="row" href="approval?mod=${encodeURIComponent(r.key)}">
        <span class="tk-who"><img src="${r.photo}" alt="" loading="lazy"><span class="tk-name">${TK_esc(r.name)}<small>${r.polls.length} poll${r.polls.length === 1 ? '' : 's'}</small></span></span>
        <span class="tk-c-bar"><em class="tk-a">${(r.a * 100).toFixed(1)}%</em>${TK_splitBar(r.a, r.d, 'Approve', 'Disapprove')}<em class="tk-d">${(r.d * 100).toFixed(1)}%</em></span>
        <span class="tk-c-net ${r.net < 0 ? 'neg' : ''}">${TK_net(r.net)}</span>
        <span class="tk-c-sp">${TK_spark(r.series, { color: r.net < 0 ? TK_RED : 'var(--ink)', zero: true })}</span>
        <span class="tk-c-chg">${TK_changeHtml(r.chg)}</span>
      </a>`).join('')}
    </div>
    <div class="tk-panel">
      <div class="tk-panel-h"><h3>Net approval over time</h3><span>Approve minus disapprove, in points</span></div>
      <div id="tkApprChart"></div>
    </div>`;
  const reg = o.registry;
  TK_trend(el.querySelector('#tkApprChart'), {
    label: 'Net approval over time for each moderator', zero: true, ranges: [90, 180, 0], range: 180,
    yFmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), tipFmt: v => TK_net(v),
    series: rows.slice(0, 8).map((r, i) => ({ id: r.key, name: r.name, short: r.name, color: o.colorFor(r.key, i), pts: r.series, faint: false }))
  });
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
      <div class="tk-q-main"><div><div class="tk-q-lead">${TK_esc(lead)}</div><div class="tk-q-net ${net < 0 ? 'neg' : ''}">${TK_net(Math.abs(net))}</div></div>${TK_spark(series, { w: 130, h: 44, color: net < 0 ? TK_RED : 'var(--ink)', zero: true, days: 180 })}</div>
      ${TK_splitBar(a, d, yes, no)}
      <div class="tk-q-lg"><span><i class="a"></i>${TK_esc(yes)} <b>${(a * 100).toFixed(1)}%</b></span><span><i class="d"></i>${TK_esc(no)} <b>${(d * 100).toFixed(1)}%</b></span></div>
      <div class="tk-q-ft">${q.polls.length} polls · ${TK_changeHtml(TK_change(series, 30))} <small>30-day net</small></div>
    </a>`;
  }).join('') + '</div>';
}

/* ---------- Generic-ballot style party tracker ---------- */
function _TK_parties(el, o) {
  const asOf = o.asOf || TK_dayStr(), ids = Object.keys(o.parties);
  if (!o.polls.length) { el.innerHTML = '<div class="small-muted" style="padding:16px">No party support polling logged yet.</div>'; return; }
  const tl = TK_asOfSeries(o.polls, ids, asOf, {});
  const last = tl[tl.length - 1].averages;
  const show = ids.filter(i => (last[i] || 0) >= 0.03).sort((a, b) => last[b] - last[a]).slice(0, 6);
  const lead = show[0], second = show[1];
  const series = show.map(i => ({
    id: i, name: o.parties[i].shortName || o.parties[i].name, short: o.parties[i].shortName || o.parties[i].name, color: o.parties[i].color,
    pts: tl.filter(p => p.coverage[i] > 0).map(p => ({ d: p.date, v: p.averages[i] * 100 })),
    dots: o.polls.filter(p => p.shares && typeof p.shares[i] === 'number').map(p => ({ d: p.date, v: p.shares[i] * 100, n: p.sample }))
  }));
  el.innerHTML = `
    <div class="tk-chips">${show.map(i => `<div class="tk-chip" style="--c:${TK_col(o.parties[i].color)}"><span class="tk-chip-n">${TK_esc(o.parties[i].shortName || o.parties[i].name)}</span><span class="tk-chip-v">${(last[i] * 100).toFixed(1)}<small>%</small></span></div>`).join('')}
      ${second ? `<div class="tk-chip-lead"><small>Lead</small><b>${TK_esc(o.parties[lead].shortName || o.parties[lead].name)} ${TK_net((last[lead] - last[second]) * 100)}</b></div>` : ''}</div>
    <div class="tk-panel"><div class="tk-panel-h"><h3>Party support over time</h3><span>Lines are the weighted average · dots are individual polls, sized by sample</span></div><div id="tkPartyChart"></div></div>
    <a class="tk-more" href="${o.href || 'party-support'}">Full party breakdown →</a>`;
  TK_trend(el.querySelector('#tkPartyChart'), { label: 'Party support over time', series, ranges: [90, 180, 0], range: 180, yMin: 0 });
}

/* ---------- Live race tracker ---------- */
function _TK_race(el, o) {
  const asOf = o.asOf || TK_dayStr(), ids = o.ids;
  const agg = BaseCalc_aggregate(o.polls, ids, asOf, o.opts || {});
  const tl = TK_asOfSeries(o.polls, ids, asOf, o.opts || {});
  const show = agg.sorted.map(x => x[0]);
  const reg = o.registry;
  const series = show.map(i => ({
    id: i, name: TSR_candidateName(reg, i), short: TSR_candidateName(reg, i), color: TSR_candidateColor(reg, i),
    pts: tl.filter(p => p.coverage[i] > 0).map(p => ({ d: p.date, v: p.averages[i] * 100 })),
    dots: o.polls.filter(p => p.shares && typeof p.shares[i] === 'number').map(p => ({ d: p.date, v: p.shares[i] * 100, n: p.sample }))
  }));
  const [a, b] = agg.sorted;
  let view = 'trend'; try { view = localStorage.getItem('wE-race-view') === 'donut' ? 'donut' : 'trend'; } catch (e) {}
  el.innerHTML = `
    <div class="tk-race-h"><div class="tk-race-t">${TK_esc(o.title)}</div>${b ? `<div class="tk-chip-lead"><small>Lead</small><b>${TK_esc(TSR_candidateName(reg, a[0]))} ${TK_net((a[1] - b[1]) * 100)}</b></div>` : ''}</div>
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

if (typeof window !== 'undefined') Object.assign(window, { TK_trend, TK_spark, TK_renderApproval, TK_renderQuestions, TK_renderParties, TK_renderRace });
