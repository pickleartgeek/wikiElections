/**
 * RCPChart
 * ---------
 * A small, dependency-free SVG line chart in the RealClearPolitics
 * house style: time-scaled x-axis, faint gridlines, smooth colored
 * lines per candidate (monotone-cubic smoothed (opts.smooth: 1 = full, 0 = straight segments, 0.5 = in between), no dot
 * markers cluttering up every single day now that the rolling average
 * emits one point per calendar day), a legend, a lead badge (yellow pill
 * + leader-colored value, same component as everywhere else on the
 * site), and a draggable vertical scrubber -- drag it along the timeline
 * and the lead badge + legend values + one highlighted marker per line
 * update to whatever the standings were at that point in time.
 */

let RCPChart_instanceCounter = 0;

/** Catmull-Rom -> cubic Bezier smoothing so the line reads as one fluid curve instead of straight day-to-day segments. */
function RCPChart_smoothPath(coords, k = 1) {
  // Monotone cubic (Fritsch-Carlson): smooth, but never overshoots a data point and never doubles back in x.
  // (Plain Catmull-Rom looped and spiked when polls were unevenly spaced in time.) k: 1 = full smoothing, 0 = straight.
  const f = v => v.toFixed(1), n = coords.length;
  if (n < 2) return n ? `M ${f(coords[0][0])} ${f(coords[0][1])}` : '';
  if (k <= 0 || n === 2) return coords.map((c, i) => `${i ? 'L' : 'M'} ${f(c[0])} ${f(c[1])}`).join(' ');
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = coords[i + 1][0] - coords[i][0] || 1e-6; d[i] = (coords[i + 1][1] - coords[i][1]) / h[i]; }
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;                       // local extremum: flat tangent, so no overshoot
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  m[n - 1] = d[n - 2];
  let p = `M ${f(coords[0][0])} ${f(coords[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = coords[i], [x1, y1] = coords[i + 1], t0 = d[i] + k * (m[i] - d[i]), t1 = d[i] + k * (m[i + 1] - d[i]);
    p += ` C ${f(x0 + h[i] / 3)} ${f(y0 + t0 * h[i] / 3)} ${f(x1 - h[i] / 3)} ${f(y1 - t1 * h[i] / 3)} ${f(x1)} ${f(y1)}`;
  }
  return p;
}

function RCPChart_draw(container, points, candidateIds, registry, opts = {}) {
  const width = opts.width || 760;
  const height = opts.height || 300;
  const padL = 40, padR = 16, padT = 16, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const instanceId = RCPChart_instanceCounter++;

  if (!points.length) {
    container.innerHTML = '<div class="small-muted" style="padding:20px;">Not enough dated polls yet to chart a trend.</div>';
    return;
  }

  const times = points.map(p => new Date(p.date).getTime());
  const tMin = Math.min(...times), tMax = Math.max(...times);
  const tSpan = Math.max(tMax - tMin, 1);

  let maxVal = 0;
  points.forEach(p => candidateIds.forEach(id => {
    const v = p.averages[id];
    if (typeof v === 'number') maxVal = Math.max(maxVal, v);
  }));
  const yMax = Math.min(1, Math.max(0.2, Math.ceil((maxVal * 100 + 5) / 10) * 10 / 100));   // a share can't exceed 100%

  const xOf = t => padL + ((t - tMin) / tSpan) * plotW;
  const yOf = v => padT + plotH - (v / yMax) * plotH;
  const xPositions = times.map(xOf);

  function nameOf(id) { return (registry.candidates[id] && registry.candidates[id].name) || id; }
  function colorOf(id) { return (registry.candidates[id] && registry.candidates[id].color) || '#888'; }

  let svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="display:block;font-family:var(--font-body);" id="rcp-chart-svg-${instanceId}">`;

  for (let pct = 0; pct <= yMax; pct += 0.10) {
    const y = yOf(pct);
    svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#e4e2d8" stroke-width="1"/>`;
    svg += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#8a887c" text-anchor="end">${Math.round(pct * 100)}%</text>`;
  }

  const labelIdxs = points.length <= 5
    ? points.map((_, i) => i)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1];
  labelIdxs.forEach(i => {
    const x = xOf(times[i]);
    const d = new Date(points[i].date);
    const label = d.toLocaleDateString('en-US', tSpan > 300 * 864e5 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
    svg += `<text x="${x}" y="${height - 8}" font-size="10" fill="#8a887c" text-anchor="middle">${label}</text>`;
  });

  const seriesColors = {};
  const seriesCoordsByPointIdx = {}; // id -> array (same length as points), [x,y] or null
  candidateIds.forEach(id => {
    const coordsByIdx = new Array(points.length).fill(null);
    const coords = [];
    points.forEach((p, i) => {
      const v = p.averages[id];
      if (typeof v === 'number') {
        const c = [xOf(new Date(p.date).getTime()), yOf(v), v];
        coords.push(c);
        coordsByIdx[i] = c;
      }
    });
    if (!coords.length) return;
    const color = colorOf(id);
    seriesColors[id] = color;
    seriesCoordsByPointIdx[id] = coordsByIdx;
    svg += `<path d="${RCPChart_smoothPath(coords, opts.smooth ?? 1)}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  });

  // One marker per series, repositioned by renderAtIndex() to sit at the
  // scrubbed date -- deliberately not one dot per day, which at daily
  // granularity turned the line into more of a dotted trail than a line.
  candidateIds.forEach(id => {
    if (!seriesCoordsByPointIdx[id]) return;
    svg += `<circle class="rcp-marker" id="rcp-marker-${instanceId}-${id}" r="4" fill="${seriesColors[id]}" stroke="#fff" stroke-width="1.5" cx="0" cy="0" style="display:none;"/>`;
  });

  // draggable scrubber: vertical guideline + a handle circle at the top, defaults to the latest point
  svg += `
    <g id="rcp-scrubber-${instanceId}" style="cursor:ew-resize;">
      <line class="rcp-scrub-line" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="#111214" stroke-width="1.5" stroke-dasharray="3 3"/>
      <circle class="rcp-scrub-handle" cx="0" cy="${padT}" r="7" fill="#111214"/>
    </g>
    <rect id="rcp-capture-${instanceId}" x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:ew-resize;"/>
  `;

  svg += `</svg>`;

  container.innerHTML = `
    <div class="rcp-chart-lead" id="rcp-lead-${instanceId}"></div>
    <div class="rcp-chart-wrap">${svg}</div>
    <div class="rcp-legend" id="rcp-legend-${instanceId}"></div>
    <div class="small-muted rcp-scrub-hint">Drag the line along the chart to see standings on any date.</div>`;

  function renderAtIndex(idx) {
    const p = points[idx];
    const entries = candidateIds
      .filter(id => typeof p.averages[id] === 'number')
      .map(id => ({ id, pct: p.averages[id] }))
      .sort((a, b) => b.pct - a.pct);

    const leadEl = document.getElementById(`rcp-lead-${instanceId}`);
    if (entries.length) {
      const leader = entries[0];
      const margin = entries.length > 1 ? (entries[0].pct - entries[1].pct) * 100 : entries[0].pct * 100;
      const d = new Date(p.date);
      const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      leadEl.innerHTML = `<div class="rcp-lead-badge">${nameOf(leader.id)}<span class="rcp-lead-value" style="background:${colorOf(leader.id)}">+${margin.toFixed(1)}</span></div><span class="rcp-scrub-date">as of ${dateLabel}</span>`;
    } else {
      leadEl.innerHTML = '';
    }

    const legendEl = document.getElementById(`rcp-legend-${instanceId}`);
    legendEl.innerHTML = entries.map(e =>
      `<span class="rcp-legend-item"><span class="rcp-legend-dot" style="background:${colorOf(e.id)}"></span>${nameOf(e.id)} <strong>${(e.pct * 100).toFixed(1)}%</strong></span>`
    ).join('');

    const scrubber = document.getElementById(`rcp-scrubber-${instanceId}`);
    const x = xPositions[idx];
    scrubber.querySelector('.rcp-scrub-line').setAttribute('x1', x);
    scrubber.querySelector('.rcp-scrub-line').setAttribute('x2', x);
    scrubber.querySelector('.rcp-scrub-handle').setAttribute('cx', x);

    candidateIds.forEach(id => {
      const marker = document.getElementById(`rcp-marker-${instanceId}-${id}`);
      if (!marker) return;
      const c = seriesCoordsByPointIdx[id] && seriesCoordsByPointIdx[id][idx];
      if (c) {
        marker.setAttribute('cx', c[0].toFixed(1));
        marker.setAttribute('cy', c[1].toFixed(1));
        marker.style.display = '';
      } else {
        marker.style.display = 'none';
      }
    });
  }

  function nearestIndexForX(clientX) {
    const svgEl = document.getElementById(`rcp-chart-svg-${instanceId}`);
    const rect = svgEl.getBoundingClientRect();
    const scale = width / rect.width;
    const localX = (clientX - rect.left) * scale;
    let nearest = 0, nearestDist = Infinity;
    xPositions.forEach((x, i) => {
      const dist = Math.abs(x - localX);
      if (dist < nearestDist) { nearestDist = dist; nearest = i; }
    });
    return nearest;
  }

  let dragging = false;
  const capture = document.getElementById(`rcp-capture-${instanceId}`);
  const scrubberEl = document.getElementById(`rcp-scrubber-${instanceId}`);

  function onDown(e) {
    dragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    renderAtIndex(nearestIndexForX(clientX));
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    renderAtIndex(nearestIndexForX(clientX));
  }
  function onUp() { dragging = false; }

  capture.addEventListener('pointerdown', onDown);
  scrubberEl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  // touch fallback for browsers without full pointer events on SVG
  capture.addEventListener('touchstart', onDown, { passive: false });
  scrubberEl.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onUp);

  renderAtIndex(points.length - 1);
}

/* ---- Time-range selector shared by the long-running trend charts (1M / 3M / 6M / 1Y / All) ---- */
const RCP_RANGES = [['1M', 30], ['3M', 91], ['6M', 183], ['1Y', 365], ['All', 0]];
const RCP_RANGE_KEY = 'wE-range';
function RCP_getRange() { try { const v = localStorage.getItem(RCP_RANGE_KEY); return RCP_RANGES.some(r => r[0] === v) ? v : 'All'; } catch (e) { return 'All'; } }
function RCP_setRange(v) { try { localStorage.setItem(RCP_RANGE_KEY, v); } catch (e) {} }
/** Which presets make sense for a series spanning `spanDays` (a preset must hide something to be worth showing). */
function RCP_rangesFor(spanDays) { return RCP_RANGES.filter(r => !r[1] || spanDays > r[1] * 1.15); }
/** Resolve the saved choice against what's available: a saved "6M" on a 2-month series falls back to All. */
function RCP_effectiveRange(spanDays) { const av = RCP_rangesFor(spanDays), want = RCP_getRange(); return av.some(r => r[0] === want) ? want : 'All'; }
function RCP_rangeBarHtml(spanDays, current) {
  const av = RCP_rangesFor(spanDays); if (av.length < 3) return '';
  return `<div class="rcp-range" role="group" aria-label="Chart time range">${av.map(r => `<button type="button" data-r="${r[0]}" aria-pressed="${r[0] === current}">${r[0]}</button>`).join('')}</div>`;
}
function RCP_wireRangeBar(root, onPick) {
  root.querySelectorAll('.rcp-range button').forEach(b => b.onclick = () => { RCP_setRange(b.dataset.r); onPick(b.dataset.r); });
}

function RCPChart_render(container, points, candidateIds, registry, opts = {}) {
  if (!points.length) return RCPChart_draw(container, points, candidateIds, registry, opts);
  const DAY = 864e5, sorted = points.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
  const last = new Date(sorted[sorted.length - 1].date).getTime(), span = (last - new Date(sorted[0].date).getTime()) / DAY;
  const paint = cur => {
    const days = (RCP_RANGES.find(r => r[0] === cur) || [0, 0])[1];
    const vis = days ? sorted.filter(p => new Date(p.date).getTime() >= last - days * DAY) : sorted;
    container.innerHTML = RCP_rangeBarHtml(span, cur) + '<div class="rcp-range-body"></div>';
    RCPChart_draw(container.querySelector('.rcp-range-body'), vis.length >= 2 ? vis : sorted, candidateIds, registry, opts);
    RCP_wireRangeBar(container, paint);
  };
  paint(RCP_effectiveRange(span));
}

if (typeof window !== 'undefined') {
  window.RCPChart_render = RCPChart_render;
}
