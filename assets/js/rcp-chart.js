/**
 * RCPChart
 * ---------
 * A small, dependency-free SVG line chart in the RealClearPolitics
 * house style: time-scaled x-axis, faint gridlines, smooth colored
 * lines per candidate with dot markers at each data point, a legend,
 * a lead badge (yellow pill + leader-colored value, same component as
 * everywhere else on the site), and a draggable vertical scrubber --
 * drag it along the timeline and the lead badge + legend values update
 * to whatever the standings were at that point in time.
 */

let RCPChart_instanceCounter = 0;

function RCPChart_render(container, points, candidateIds, registry, opts = {}) {
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
  const yMax = Math.max(0.2, Math.ceil((maxVal * 100 + 5) / 10) * 10 / 100);

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
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    svg += `<text x="${x}" y="${height - 8}" font-size="10" fill="#8a887c" text-anchor="middle">${label}</text>`;
  });

  const seriesColors = {};
  candidateIds.forEach(id => {
    const coords = [];
    points.forEach(p => {
      const v = p.averages[id];
      if (typeof v === 'number') coords.push([xOf(new Date(p.date).getTime()), yOf(v), v]);
    });
    if (!coords.length) return;
    const color = colorOf(id);
    seriesColors[id] = color;
    const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ');
    svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    coords.forEach(c => {
      svg += `<circle cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3" fill="${color}" stroke="#fff" stroke-width="1"/>`;
    });
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

if (typeof window !== 'undefined') {
  window.RCPChart_render = RCPChart_render;
}
