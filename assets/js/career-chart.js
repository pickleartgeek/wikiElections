/**
 * CareerChart -- one continuous timeline for a moderator who has held more than one seat.
 * Each term is its own line (approve = ink, disapprove = red) that starts fresh at the term's first poll, so a seat change
 * is a visible reset instead of a smoothed-over blend. Terms are shaded bands with a marker (flag + divider) where each begins;
 * dots are individual polls (sized by sample); filled dots are each term's last standing. A current term with no polls yet
 * is a hatched "first poll pending" band; former terms with no polling are listed under the chart (they can't be placed in time).
 *
 *   CareerChart_render(container, entry)   entry = OVR_viewTerm(...) result (needs allPolls, terms, polls tagged with _t)
 */
function CareerChart_render(el, entry, rangeKey) {
  const W = 760, H = 340, pL = 42, pR = 22, pT = 40, pB = 30, plotW = W - pL - pR, plotH = H - pT - pB, DAY = 864e5;
  const terms = entry.terms || [], all = entry.allPolls || entry.polls || [], esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const now = new Date(), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()), todayStr = new Date(today).toISOString().slice(0, 10);
  const by = {}; all.forEach(p => { (by[p._t] = by[p._t] || []).push(p); });
  const polled = terms.filter(t => by[t.id]).map(t => { const ps = by[t.id].slice().sort((a, b) => a.date.localeCompare(b.date)); return { t, ps, first: Date.parse(ps[0].date), last: Date.parse(ps[ps.length - 1].date) }; }).sort((a, b) => a.first - b.first);
  if (!polled.length) { el.innerHTML = '<div class="small-muted" style="padding:20px;">No polling logged for any term yet.</div>'; return; }
  const cur = terms.filter(t => t.status === 'current').pop(), pending = cur && !by[cur.id] ? cur : null;
  const fullMin = polled[0].first, tMax = Math.max(polled[polled.length - 1].last, cur ? today : 0, fullMin + 7 * DAY), spanDays = (tMax - fullMin) / DAY;
  const rk = rangeKey || RCP_effectiveRange(spanDays), rd = (RCP_RANGES.find(r => r[0] === rk) || [0, 0])[1];
  const tMin = rd ? Math.max(fullMin, tMax - rd * DAY) : fullMin;
  const X = t => pL + (t - tMin) / (tMax - tMin) * plotW, CX = t => Math.max(pL, X(t));   // CX: clamp bands/flags that began before the visible window

  // one weighted-average line per term (same ProbCalc recency model as everywhere else), each frozen at its term's end
  const series = polled.map(o => {
    const asOf = o.t.status === 'former' ? (o.t.end || new Date(o.last).toISOString().slice(0, 10)) : todayStr;
    return Object.assign(o, { pts: BaseCalc_weightedTimeline(o.ps, ['approve', 'disapprove'], asOf, { normalize: false }) });
  });
  let ymax = 0; series.forEach(s => s.pts.forEach(p => { ymax = Math.max(ymax, p.averages.approve || 0, p.averages.disapprove || 0); })); all.forEach(p => { ymax = Math.max(ymax, p.shares.approve || 0); });
  ymax = Math.max(.3, Math.ceil(ymax * 10 + .4) / 10);
  const Y = v => pT + plotH - v / ymax * plotH;

  // term extents: a term begins at its `start`, else halfway through the quiet gap after the previous term's last poll
  const starts = polled.map((o, i) => i === 0 ? tMin : (o.t.start || o.t._start ? Date.parse(o.t.start || o.t._start) : (polled[i - 1].last + o.first) / 2));
  const ends = polled.map((o, i) => i < polled.length - 1 ? starts[i + 1] : (o.t.status === 'current' ? tMax : o.last));
  const label = t => esc(t.label || t.seat);
  let g = '';
  // y grid
  for (let v = 0; v <= ymax + 1e-9; v += ymax > .5 ? .2 : .1) g += `<line x1="${pL}" x2="${W - pR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--line)" stroke-width="1"/><text x="${pL - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" style="fill:var(--muted)">${Math.round(v * 100)}%</text>`;
  // term bands + markers
  g += `<defs><pattern id="ccHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" style="fill:none"/><line x1="0" y1="0" x2="0" y2="8" style="stroke:var(--line)" stroke-width="3"/></pattern></defs>`;
  polled.forEach((o, i) => {
    if (ends[i] <= tMin) return;
    const x0 = CX(starts[i]), x1 = X(ends[i]), w = x1 - x0, cur2 = o.t.status === 'current', cont = starts[i] < tMin;
    if (i % 2 === 0) g += `<rect x="${x0.toFixed(1)}" y="${pT}" width="${Math.max(0, w).toFixed(1)}" height="${plotH}" style="fill:var(--paper-dim)" opacity=".75"/>`;
    const room = Math.max(0, Math.floor((w - 14) / 6.4)), txt = (o.t.label || o.t.seat), shown = txt.length <= room ? txt : txt.slice(0, Math.max(0, room - 1)) + '…';
    const link = o.t.electionId ? `elects/?election=${encodeURIComponent(o.t.electionId)}` : '';
    const flag = `<g><line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${pT - 20}" y2="${pT + plotH}" style="stroke:var(--ink)" stroke-width="${i && !cont ? 1.5 : 1}" ${i && !cont ? 'stroke-dasharray="4 3"' : ''}/><circle cx="${x0.toFixed(1)}" cy="${pT - 20}" r="4.5" style="fill:${cur2 ? 'var(--elects-pink)' : 'var(--ink)'}"/>${room > 3 ? `<text x="${(x0 + 9).toFixed(1)}" y="${pT - 16}" font-size="12" font-weight="800" style="fill:var(--ink)">${esc(shown)}</text>` : `<text x="${(x0 - 9).toFixed(1)}" y="${pT - 16}" text-anchor="end" font-size="12" font-weight="800" style="fill:${cur2 ? 'var(--elects-pink)' : 'var(--ink)'}">${esc(txt)}</text>`}<title>${label(o.t)} · ${cur2 ? 'current' : 'former'} · ${o.ps.length} poll${o.ps.length === 1 ? '' : 's'}${i && !cont ? ' · seat change' : ''}</title></g>`;
    g += link ? `<a href="${link}">${flag}</a>` : flag;
  });
  if (pending) {
    const ps = pending.start || pending._start, lastX = polled[polled.length - 1].last, px = Math.min(tMax, Math.max(lastX, ps ? Date.parse(ps) : lastX)), x0 = CX(px), w = X(tMax) - x0, txt = esc(pending.label || pending.seat) + ' · first poll pending', flip = x0 > W - pR - 190;
    g += `<rect x="${CX(lastX).toFixed(1)}" y="${pT}" width="${Math.max(0, X(tMax) - CX(lastX)).toFixed(1)}" height="${plotH}" fill="url(#ccHatch)" opacity=".7"/><line x1="${x0.toFixed(1)}" x2="${x0.toFixed(1)}" y1="${pT - 20}" y2="${pT + plotH}" style="stroke:var(--elects-pink)" stroke-width="1.5" stroke-dasharray="4 3"/><circle cx="${x0.toFixed(1)}" cy="${pT - 20}" r="4.5" style="fill:none;stroke:var(--elects-pink)" stroke-width="2"/><text x="${(x0 + (flip ? -9 : 9)).toFixed(1)}" y="${pT - 16}" text-anchor="${flip ? 'end' : 'start'}" font-size="12" font-weight="800" style="fill:var(--elects-pink)">${txt}</text>`; }
  // x axis
  for (let i = 0; i <= 4; i++) { const t = tMin + (tMax - tMin) * i / 4; g += `<text x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" font-size="11" style="fill:var(--muted)">${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })}</text>`; }
  // lines, poll dots, final markers
  const RED = '#cf1322';
  series.forEach(s => {
    ['disapprove', 'approve'].forEach(k => {
      const c = s.pts.filter(p => Date.parse(p.date) >= tMin).map(p => [X(Date.parse(p.date)), Y(p.averages[k] || 0)]); if (!c.length) return;
      g += `<path d="${RCPChart_smoothPath(c, .6)}" fill="none" stroke-width="${k === 'approve' ? 2.6 : 2}" stroke-linecap="round" ${k === 'approve' ? 'style="stroke:var(--ink)"' : `stroke="${RED}"`}/>`;
    });
    s.ps.filter(p => Date.parse(p.date) >= tMin).forEach(p => ['approve', 'disapprove'].forEach(k => { const r = 1.8 + Math.sqrt(p.sample || 10) / 5; g += `<circle cx="${X(Date.parse(p.date)).toFixed(1)}" cy="${Y(p.shares[k] || 0).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke-width="1.2" opacity=".55" ${k === 'approve' ? 'style="stroke:var(--ink)"' : `stroke="${RED}"`}><title>${esc(p.pollster)} · ${p.date} · n=${p.sample} · ${k} ${((p.shares[k] || 0) * 100).toFixed(1)}%</title></circle>`; }));
    if (Date.parse(s.pts[s.pts.length - 1].date) < tMin) return;
    const L = s.pts[s.pts.length - 1], lx = X(Date.parse(L.date)), a = L.averages.approve || 0, d = L.averages.disapprove || 0, flip = lx > W - pR - 50;
    g += `<circle cx="${lx.toFixed(1)}" cy="${Y(a).toFixed(1)}" r="4.6" style="fill:var(--ink);stroke:var(--paper)" stroke-width="2"/><circle cx="${lx.toFixed(1)}" cy="${Y(d).toFixed(1)}" r="4.2" fill="${RED}" style="stroke:var(--paper)" stroke-width="2"/>`
      + `<text x="${(lx + (flip ? -8 : 8)).toFixed(1)}" y="${(Y(a) - 9).toFixed(1)}" text-anchor="${flip ? 'end' : 'start'}" font-size="12" font-weight="800" style="fill:var(--ink)">${(a * 100).toFixed(1)}%</text>`
      + `<text x="${(lx + (flip ? -8 : 8)).toFixed(1)}" y="${(Y(d) + 16).toFixed(1)}" text-anchor="${flip ? 'end' : 'start'}" font-size="12" font-weight="800" fill="${RED}">${(d * 100).toFixed(1)}%</text>`;
  });
  const noPoll = terms.filter(t => !by[t.id] && t !== pending);
  el.innerHTML = RCP_rangeBarHtml(spanDays, rk) + `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Approval across every term held" style="display:block;max-width:100%;height:auto;font-family:inherit">${g}</svg>
    <div class="cc-legend"><span><i style="background:var(--ink)"></i>Approve</span><span><i style="background:${RED}"></i>Disapprove</span><span><i class="ring"></i>Individual poll (sized by sample)</span><span><i class="band"></i>Shaded / flagged = a term · dashed divider = seat change</span></div>
    ${noPoll.length ? `<p class="small-muted cc-none">No approval polling logged for: ${noPoll.map(t => `<b>${label(t)}</b>`).join(', ')}.</p>` : ''}`;
  RCP_wireRangeBar(el, k => CareerChart_render(el, entry, k));
}
