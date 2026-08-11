/**
 * RCPDonut
 * ---------
 * A donut/ring chart in the RealClearPolitics "poll average" style:
 * title, a yellow "+X.X" lead pill, a colored ring (top candidates get
 * their own arc, everyone else pools into a neutral "field" arc), pill
 * labels on the ring, and a dot-legend underneath.
 */

function RCPDonut_render(container, opts) {
  const { title, segments, leadLabel, leadValue, leadColor, size = 260, href } = opts;
  // segments: [{ name, color, pct }], pct in 0-1, should sum to <= 1

  const r = size / 2 - 18;
  const cx = size / 2, cy = size / 2;
  const strokeWidth = Math.max(28, size * 0.16);
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  let arcs = '';
  let labels = '';
  segments.forEach(seg => {
    const len = seg.pct * circumference;
    const dashArray = `${len} ${circumference - len}`;
    const rotation = (offset / circumference) * 360 - 90;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}"
      stroke-width="${strokeWidth}" stroke-dasharray="${dashArray}" stroke-dashoffset="0"
      transform="rotate(${rotation} ${cx} ${cy})" stroke-linecap="butt"/>`;

    if (seg.pct > 0.03) {
      const midAngle = ((offset + len / 2) / circumference) * 2 * Math.PI - Math.PI / 2;
      const lx = cx + Math.cos(midAngle) * r;
      const ly = cy + Math.sin(midAngle) * r;
      const pctText = `${(seg.pct * 100).toFixed(1)}%`;
      const textW = 20 + pctText.length * 7.5;
      labels += `
        <g transform="translate(${lx} ${ly})">
          <rect x="${-textW / 2}" y="-13" width="${textW}" height="26" rx="13" fill="#fff" stroke="${seg.color}" stroke-width="2"/>
          <text x="0" y="5" text-anchor="middle" font-size="13" font-weight="800" fill="${seg.color}" font-family="var(--font-spinner-display, sans-serif)">${pctText}</text>
        </g>`;
    }
    offset += len;
  });

  const legendHtml = segments.filter(s => s.pct > 0).map(s =>
    `<span class="rcp-donut-legend-item"><span class="rcp-donut-legend-dot" style="background:${s.color}"></span>${s.name}</span>`
  ).join('');

  const leadValueText = typeof leadValue === 'number' ? leadValue.toFixed(1) : leadValue;
  const badgeColor = leadColor || (segments[0] && segments[0].color) || '#2e6fdb';

  const inner = `
      ${title ? `<div class="rcp-donut-title">${title}</div>` : ''}
      ${leadLabel ? `<div class="rcp-donut-lead"><span class="rcp-donut-lead-name">${leadLabel}</span><span class="rcp-donut-lead-badge" style="background:${badgeColor}">+${leadValueText}</span></div>` : ''}
      <svg viewBox="0 0 ${size} ${size}" width="100%" style="display:block; max-width:${size}px; margin:0 auto;">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e9e7dd" stroke-width="${strokeWidth}"/>
        ${arcs}
        ${labels}
      </svg>
      <div class="rcp-donut-legend">${legendHtml}</div>`;

  container.innerHTML = href
    ? `<a class="rcp-donut-card rcp-donut-link" href="${href}">${inner}</a>`
    : `<div class="rcp-donut-card">${inner}</div>`;
}

/**
 * Convenience: build a top-2-plus-field donut from a BaseCalc aggregate.
 */
function RCPDonut_fromAggregate(container, agg, registry, title, href) {
  const sorted = agg.sorted;
  if (!sorted.length) {
    container.innerHTML = '<div class="small-muted" style="padding:16px;">No polling yet.</div>';
    return;
  }
  const top = sorted.slice(0, 2);
  const rest = sorted.slice(2);
  const fieldPct = rest.reduce((a, [, v]) => a + v, 0);

  const segments = top.map(([id, pct]) => ({
    name: TSR_candidateName(registry, id),
    color: TSR_candidateColor(registry, id),
    pct
  }));
  if (fieldPct > 0.005) segments.push({ name: 'Field / Undecided', color: '#c9c7bb', pct: fieldPct });

  const leadName = TSR_candidateName(registry, top[0][0]);
  const leadValue = top.length > 1 ? (top[0][1] - top[1][1]) * 100 : top[0][1] * 100;
  const leadColor = TSR_candidateColor(registry, top[0][0]);

  RCPDonut_render(container, { title, segments, leadLabel: leadName, leadValue, leadColor, href });
}

if (typeof window !== 'undefined') {
  window.RCPDonut_render = RCPDonut_render;
  window.RCPDonut_fromAggregate = RCPDonut_fromAggregate;
}
