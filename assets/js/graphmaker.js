/**
 * GraphMaker — renders a chart spec to a self-contained SVG string, used by the article editor (admin) to build charts that live inside article bodies.
 * The SVG has no script and takes its text/line colours from the page's CSS variables (with fallbacks), so it follows light/dark mode wherever it is published.
 *
 *   GM_render(spec)        -> '<svg …>…</svg>'
 *   GM_figure(spec)        -> '<figure class="art-chart" data-chart="…">svg + caption</figure>'   (what gets stored in the article)
 *   GM_parsePaste(text)    -> { cats, series:[{name,values}] } from tab / comma / semicolon separated text (first row = series names, first column = categories)
 *   GM_fromFigure(el)      -> the spec stored on a figure element (or null)
 *   GM_DEFAULT             -> a starter spec
 *
 * spec = { type: 'bar' | 'hbar' | 'line' | 'stacked' | 'area' | 'donut' | 'rcp' (site results bars) | 'dumbbell' | 'strip' | 'timeline' | 'spectrum', title, sub, source, unit ('' | '%' | …), decimals, showValues, min, max,
 *          cats: ['A','B'], series: [{ name, color, values: [n, n] }], catColors: [hex…] (optional: one colour per category, used by single-series bar / hbar / donut) }
 */
const GM_PALETTE = ['#c6285a', '#2d6cdf', '#1f9d63', '#f2a900', '#7a4fd6', '#e4572e', '#0f9bb0', '#8a8f9c'];
const GM_DEFAULT = { type: 'bar', title: 'Chart title', sub: '', source: '', unit: '%', decimals: 0, showValues: true, min: '', max: '',
  cats: ['Option A', 'Option B', 'Option C'], series: [{ name: 'Share', color: GM_PALETTE[0], values: [42, 35, 23] }], catColors: [], kicker: '', boxed: false, axisL: '', axisR: '', caption: '', flows: [], nodeColors: {} };

const GM_esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GM_num = v => { const n = parseFloat(String(v).replace(',', '.').replace(/[^0-9eE.+-]/g, '')); return isFinite(n) ? n : 0; };

/** "Nice" axis: returns { min, max, step } covering [lo, hi] in 4-6 steps. */
function GM_niceScale(lo, hi) {
  if (lo === hi) { hi = lo + 1; }
  const span = hi - lo, raw = span / 5, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  return { min: Math.floor(lo / step + 1e-9) * step, max: Math.ceil(hi / step - 1e-9) * step, step };
}

function GM_parsePaste(text) {
  const rows = String(text || '').split(/\r?\n/).map(r => r.trim()).filter(Boolean); if (!rows.length) return null;
  const sep = rows[0].includes('\t') ? '\t' : rows[0].includes(';') ? ';' : ',', cells = rows.map(r => r.split(sep).map(c => c.trim().replace(/^"|"$/g, '')));
  const head = cells[0], hasHead = head.slice(1).some(c => c !== '' && isNaN(GM_num(c)) || /[a-z]/i.test(c));
  const body = hasHead ? cells.slice(1) : cells, names = hasHead ? head.slice(1) : head.slice(1).map((_, i) => 'Series ' + (i + 1)), nS = Math.max(1, Math.max(...body.map(r => r.length)) - 1);
  return { cats: body.map(r => r[0] || ''), series: Array.from({ length: nS }, (_, j) => ({ name: names[j] || 'Series ' + (j + 1), values: body.map(r => GM_num(r[j + 1])) })) };
}

function GM_svg(spec) {
  const S = Object.assign({}, GM_DEFAULT, spec), W = 640, cats = S.cats.map(String), series = S.series.filter(s => s && Array.isArray(s.values)), nS = series.length, nC = cats.length;
  const dec = Math.max(0, Math.min(4, +S.decimals || 0)), unit = S.unit || '', fmt = v => (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec).replace(/\.0+$/, '') + unit;
  const ink = 'var(--ink,#111214)', mut = 'var(--muted,#6b7080)', line = 'var(--line,#d8d6cf)', paper = 'var(--surface,var(--paper,#fff))';
  const colorOf = (si, ci) => (nS === 1 && S.catColors && S.catColors[ci]) || series[si].color || GM_PALETTE[si % GM_PALETTE.length];
  const val = (si, ci) => GM_num(series[si].values[ci]);
  let top = 16, g = '';
  const boxed = GM_isBoxed(S);
  if (S.title && !boxed) { g += `<text x="0" y="${top + 18}" font-size="21" font-weight="800" fill="${ink}">${GM_esc(S.title)}</text>`; top += 28; }
  if (S.sub && !boxed) { g += `<text x="0" y="${top + 14}" font-size="13" fill="${mut}">${GM_esc(S.sub)}</text>`; top += 22; }
  if (nS > 1 && !['donut', 'timeline', 'spectrum', 'sankey'].includes(S.type)) {   // legend
    let x = 0; series.forEach((s, i) => { const w = 34 + s.name.length * 8; g += `<rect x="${x}" y="${top + 4}" width="11" height="11" rx="2" fill="${colorOf(i, 0)}"/><text x="${x + 16}" y="${top + 14}" font-size="12.5" font-weight="700" fill="${ink}">${GM_esc(s.name)}</text>`; x += w; }); top += 26;
  }
  top += 6;
  const src = S.source ? `<text x="${W}" y="__H__" text-anchor="end" font-size="11" fill="${mut}">${GM_esc(S.source)}</text>` : '';
  const finish = (H0, body) => { const H = H0 + (S.source ? 16 : 0); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${GM_esc(S.title || 'Chart')}" font-family="inherit">${g}${body}${src.replace('__H__', H - 6)}</svg>`; };
  const bound = (vals, stack) => { let lo = Math.min(0, ...vals), hi = Math.max(...vals, 0); if (S.min !== '' && isFinite(+S.min)) lo = +S.min; if (S.max !== '' && isFinite(+S.max)) hi = +S.max; return [lo, hi]; };

  if (S.type === 'donut') {
    const vals = cats.map((c, i) => Math.max(0, val(0, i))), tot = vals.reduce((a, b) => a + b, 0) || 1, R = 112, r = 66, cx = 150, cy = top + R + 8; let a0 = -Math.PI / 2, body = '';
    vals.forEach((v, i) => { const a1 = a0 + v / tot * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, p = (a, rad) => `${(cx + Math.cos(a) * rad).toFixed(2)} ${(cy + Math.sin(a) * rad).toFixed(2)}`;
      if (v > 0) body += v / tot > .9999 ? `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${colorOf(0, i)}" stroke-width="${R - r}"/>` : `<path d="M${p(a0, R)} A${R} ${R} 0 ${big} 1 ${p(a1, R)} L${p(a1, r)} A${r} ${r} 0 ${big} 0 ${p(a0, r)}Z" fill="${colorOf(0, i)}" stroke="${paper}" stroke-width="2"><title>${GM_esc(cats[i] + ': ' + fmt(v) + ' (' + Math.round(v / tot * 100) + '%)')}</title></path>`; a0 = a1; });
    body += `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" font-weight="800" fill="${ink}">${GM_esc(fmt(tot))}</text>`;
    cats.forEach((c, i) => { const y = top + 22 + i * 26; body += `<rect x="330" y="${y - 11}" width="12" height="12" rx="2" fill="${colorOf(0, i)}"/><text x="350" y="${y}" font-size="14" font-weight="700" fill="${ink}">${GM_esc(c)}</text><text x="${W}" y="${y}" text-anchor="end" font-size="14" font-weight="800" fill="${ink}">${GM_esc(fmt(vals[i]))}</text>`; });
    return finish(Math.max(cy + R + 28, top + 40 + nC * 26), body);
  }

  if (S.type === 'hbar') {
    const all = series.flatMap((s, i) => cats.map((c, j) => val(i, j))), [lo, hi] = bound(all), sc = GM_niceScale(lo, hi), lab = Math.min(190, 14 + Math.max(...cats.map(c => c.length)) * 7.4), x0 = lab, pw = W - x0 - 56;
    const rowH = Math.max(26, 10 + nS * 17), H = top + nC * rowH + 34, X = v => x0 + (v - sc.min) / (sc.max - sc.min) * pw; let body = '';
    for (let t = sc.min; t <= sc.max + 1e-9; t += sc.step) body += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + nC * rowH}" stroke="${line}" ${Math.abs(t) < 1e-9 ? '' : 'stroke-dasharray="3 4"'}/><text x="${X(t)}" y="${top + nC * rowH + 18}" text-anchor="middle" font-size="11.5" fill="${mut}">${GM_esc(fmt(t))}</text>`;
    cats.forEach((c, j) => { const y = top + j * rowH, bh = Math.min(22, (rowH - 8) / nS);
      body += `<text x="${x0 - 10}" y="${y + rowH / 2 + 4.5}" text-anchor="end" font-size="13.5" font-weight="700" fill="${ink}">${GM_esc(c)}</text>`;
      series.forEach((s, i) => { const v = val(i, j), by = y + (rowH - bh * nS) / 2 + i * bh, xa = X(Math.min(0, v) < sc.min ? sc.min : 0), xb = X(v);
        body += `<rect x="${Math.min(xa, xb)}" y="${by}" width="${Math.max(1, Math.abs(xb - xa))}" height="${bh - 2}" rx="2" fill="${colorOf(i, j)}"><title>${GM_esc(c + (nS > 1 ? ' · ' + s.name : '') + ': ' + fmt(v))}</title></rect>`;
        if (S.showValues) body += `<text x="${v >= 0 ? xb + 6 : xb - 6}" y="${by + bh / 2 + 3.5}" text-anchor="${v >= 0 ? 'start' : 'end'}" font-size="12.5" font-weight="800" fill="${ink}">${GM_esc(fmt(v))}</text>`; }); });
    return finish(H, body);
  }

  if (S.type === 'dumbbell') {   // before / after dots joined by a line, one row per category
    const all = series.flatMap((s, i) => cats.map((c, j) => val(i, j))), [lo, hi] = bound(all), sc = GM_niceScale(lo, hi), x0 = Math.min(190, 14 + Math.max(...cats.map(c => c.length)) * 7.4), pw = W - x0 - 64, rowH = 34, H = top + nC * rowH + 34, X = v => x0 + 46 + (v - sc.min) / (sc.max - sc.min) * (pw - 46); let body = '';
    for (let t = sc.min; t <= sc.max + 1e-9; t += sc.step) body += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + nC * rowH}" stroke="${line}" ${Math.abs(t) < 1e-9 ? '' : 'stroke-dasharray="3 4"'}/><text x="${X(t)}" y="${top + nC * rowH + 18}" text-anchor="middle" font-size="11.5" fill="${mut}">${GM_esc(fmt(t))}</text>`;
    cats.forEach((c, j) => { const cy = top + j * rowH + rowH / 2, vs = series.map((s, i) => val(i, j)), a = Math.min(...vs), b = Math.max(...vs);
      body += `<text x="${x0 - 2}" y="${cy + 4.5}" text-anchor="end" font-size="13.5" font-weight="700" fill="${ink}">${GM_esc(c)}</text><line x1="${X(a)}" x2="${X(b)}" y1="${cy}" y2="${cy}" stroke="${mut}" stroke-width="3" stroke-linecap="round" opacity=".45"/>`;
      series.forEach((s, i) => { const v = vs[i], lowest = v === a && a !== b ? true : (a === b ? false : false); body += `<circle cx="${X(v)}" cy="${cy}" r="7" fill="${colorOf(i, j)}" stroke="${paper}" stroke-width="2"><title>${GM_esc(c + ' · ' + s.name + ': ' + fmt(v))}</title></circle>`;
        if (S.showValues) { const left = a !== b ? v === a : i === 0; body += `<text x="${X(v) + (left ? -12 : 12)}" y="${cy + 4}" text-anchor="${left ? 'end' : 'start'}" font-size="12" font-weight="800" fill="${ink}">${GM_esc(fmt(v))}</text>`; } }); });
    return finish(H, body);
  }

  if (S.type === 'strip') {   // one cell per category, coloured by whichever series leads it
    const cw = W / Math.max(1, nC), ch = 40, step = Math.max(1, Math.ceil(nC / Math.floor(W / 70))); let body = '';
    cats.forEach((c, j) => { const vs = series.map((s, i) => val(i, j)), m = Math.max(...vs), lead = vs.indexOf(m), tie = vs.filter(v => v === m).length > 1 || m <= 0 && nS > 1, fill = nS === 1 ? colorOf(0, j) : tie ? mut : colorOf(lead, 0);
      body += `<rect x="${(j * cw + .75).toFixed(2)}" y="${top}" width="${Math.max(1, cw - 1.5).toFixed(2)}" height="${ch}" rx="${cw > 8 ? 2 : 0}" fill="${fill}" ${tie && nS > 1 ? 'opacity=".4"' : ''}><title>${GM_esc(c)}: ${nS > 1 ? GM_esc(tie ? 'tie' : series[lead].name) : GM_esc(fmt(vs[0]))}</title></rect>`;
      if (j % step === 0 || j === nC - 1) body += `<text x="${(j * cw + cw / 2).toFixed(1)}" y="${top + ch + 18}" text-anchor="${j === 0 ? 'start' : j === nC - 1 ? 'end' : 'middle'}" font-size="11.5" font-weight="700" fill="${mut}">${GM_esc(c)}</text>`; });
    return finish(top + ch + 30, body);
  }

  if (S.type === 'timeline') {   // gantt: series 1 = start, series 2 = end, one row per category
    const st = cats.map((c, j) => val(0, j)), en = cats.map((c, j) => nS > 1 ? val(1, j) : Math.max(...st)), lo0 = Math.min(...st), hi0 = Math.max(...en), sc = GM_niceScale(lo0, hi0), x0 = Math.min(190, 14 + Math.max(...cats.map(c => c.length)) * 7.4), pw = W - x0 - 20, rowH = 30, H = top + nC * rowH + 34, X = v => x0 + (v - sc.min) / (sc.max - sc.min) * pw; let body = '';
    for (let t = sc.min; t <= sc.max + 1e-9; t += sc.step) body += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${top + nC * rowH}" stroke="${line}" stroke-dasharray="3 4"/><text x="${X(t)}" y="${top + nC * rowH + 18}" text-anchor="middle" font-size="11.5" fill="${mut}">${GM_esc(fmt(t))}</text>`;
    cats.forEach((c, j) => { const y = top + j * rowH, a = X(Math.min(st[j], en[j])), b = X(Math.max(st[j], en[j]));
      body += `<text x="${x0 - 10}" y="${y + rowH / 2 + 4.5}" text-anchor="end" font-size="13.5" font-weight="700" fill="${ink}">${GM_esc(c)}</text><rect x="${a}" y="${y + 5}" width="${Math.max(4, b - a)}" height="${rowH - 10}" rx="4" fill="${colorOf(0, j)}"><title>${GM_esc(c + ': ' + fmt(st[j]) + (nS > 1 ? '–' + fmt(en[j]) : ''))}</title></rect>`;
      if (S.showValues) body += `<text x="${b + 6}" y="${y + rowH / 2 + 4}" font-size="11.5" font-weight="800" fill="${ink}">${GM_esc(fmt(st[j]))}${nS > 1 ? '–' + GM_esc(fmt(en[j])) : ''}</text>`; });
    return finish(H, body);
  }

  if (S.type === 'spectrum') {   // items placed along one axis (min..max, default 0..100)
    const lo = S.min !== '' && isFinite(+S.min) ? +S.min : 0, hi = S.max !== '' && isFinite(+S.max) ? +S.max : 100, x0 = 24, pw = W - 48, X = v => x0 + (Math.min(hi, Math.max(lo, v)) - lo) / ((hi - lo) || 1) * pw, ty = top + 78; let body = '';
    body += `<line x1="${x0}" x2="${x0 + pw}" y1="${ty}" y2="${ty}" stroke="${mut}" stroke-width="4" stroke-linecap="round" opacity=".5"/>`;
    [...cats.keys()].sort((a, b) => val(0, a) - val(0, b)).forEach((j, k) => { const x = X(val(0, j)), up = k % 2 === 0, col = colorOf(0, j);
      body += `<line x1="${x}" x2="${x}" y1="${ty}" y2="${ty + (up ? -26 : 26)}" stroke="${col}" stroke-width="2"/><circle cx="${x}" cy="${ty}" r="9" fill="${col}" stroke="${paper}" stroke-width="2.5"/><text x="${Math.min(W - 4, Math.max(4, x))}" y="${ty + (up ? -34 : 44)}" text-anchor="${x < 60 ? 'start' : x > W - 60 ? 'end' : 'middle'}" font-size="13" font-weight="800" fill="${ink}">${GM_esc(cats[j])}${S.showValues ? ' · ' + GM_esc(fmt(val(0, j))) : ''}</text>`; });
    if (S.axisL) body += `<text x="${x0}" y="${ty + 84}" font-size="12" font-weight="800" fill="${mut}">◀ ${GM_esc(S.axisL)}</text>`;
    if (S.axisR) body += `<text x="${x0 + pw}" y="${ty + 84}" text-anchor="end" font-size="12" font-weight="800" fill="${mut}">${GM_esc(S.axisR)} ▶</text>`;
    return finish(ty + 100, body);
  }

  if (S.type === 'sankey') {   // flows between nodes, laid out in columns by path depth
    const flows = (S.flows || []).map(f => ({ a: String(f.from || '').trim(), b: String(f.to || '').trim(), v: GM_num(f.value) })).filter(f => f.a && f.b && f.v > 0 && f.a !== f.b);
    if (!flows.length) return finish(top + 50, `<text x="0" y="${top + 30}" font-size="13" fill="${mut}">Add at least one flow (from, to, value).</text>`);
    const names = GM_nodes(flows.map(f => ({ from: f.a, to: f.b }))), depth = {}; names.forEach(n => depth[n] = 0);
    for (let it = 0; it < names.length; it++) { let ch = false; flows.forEach(f => { if (depth[f.b] < depth[f.a] + 1 && depth[f.a] + 1 < names.length) { depth[f.b] = depth[f.a] + 1; ch = true; } }); if (!ch) break; }
    const nodes = names.map((n, i) => ({ n, i, d: depth[n], inV: 0, outV: 0, in: [], out: [] })), byN = {}; nodes.forEach(o => byN[o.n] = o);
    const links = flows.map(f => ({ s: byN[f.a], t: byN[f.b], v: f.v })); links.forEach(l => { l.s.outV += l.v; l.t.inV += l.v; l.s.out.push(l); l.t.in.push(l); }); nodes.forEach(o => o.v = Math.max(o.inV, o.outV));
    const nD = Math.max(...nodes.map(o => o.d)) + 1, cols = Array.from({ length: nD }, (_, d) => nodes.filter(o => o.d === d)), gap = 24, ph = Math.max(220, Math.max(...cols.map(c => c.length)) * 46);
    const k = Math.min(...cols.map(c => (ph - gap * (c.length - 1)) / (c.reduce((a, o) => a + o.v, 0) || 1))), nw = 14, cy = o => o.y + o.v * k / 2;
    cols.forEach((c, d) => { if (d) { c.forEach(o => { o.bc = o.in.length ? o.in.reduce((a, l) => a + cy(l.s) * l.v, 0) / o.inV : 0; }); c.sort((a, b) => a.bc - b.bc || a.i - b.i); }
      let y = top + 8 + (ph - (c.reduce((a, o) => a + o.v * k, 0) + gap * (c.length - 1))) / 2; c.forEach(o => { o.y = y; y += o.v * k + gap; }); });
    const lw = d => 14 + (Math.max(...cols[d].map(o => o.n.length)) + (S.showValues ? 6 : 0)) * 7, xL = Math.min(170, lw(0)), xR = Math.min(170, lw(nD - 1)), step = (W - xL - xR - nw) / Math.max(1, nD - 1);
    nodes.forEach(o => o.x = xL + o.d * step); const col = o => (S.nodeColors && S.nodeColors[o.n]) || GM_PALETTE[o.i % GM_PALETTE.length]; let body = '', bands = '';
    nodes.forEach(o => { let oy = o.y; o.out.sort((a, b) => cy(a.t) - cy(b.t)).forEach(l => { l.sy = oy; oy += l.v * k; }); let iy = o.y; o.in.sort((a, b) => cy(a.s) - cy(b.s)).forEach(l => { l.ty = iy; iy += l.v * k; }); });
    links.forEach(l => { const x0 = l.s.x + nw, x1 = l.t.x, xm = (x0 + x1) / 2, h = l.v * k, f1 = n => n.toFixed(1);
      bands += `<path d="M${f1(x0)} ${f1(l.sy)} C${f1(xm)} ${f1(l.sy)} ${f1(xm)} ${f1(l.ty)} ${f1(x1)} ${f1(l.ty)} L${f1(x1)} ${f1(l.ty + h)} C${f1(xm)} ${f1(l.ty + h)} ${f1(xm)} ${f1(l.sy + h)} ${f1(x0)} ${f1(l.sy + h)} Z" fill="${col(l.s)}" opacity=".38"><title>${GM_esc(l.s.n)} → ${GM_esc(l.t.n)}: ${GM_esc(fmt(l.v))}</title></path>`; });
    nodes.forEach(o => { const h = Math.max(1.5, o.v * k), first = o.d === 0, last = o.d === nD - 1, mid = !first && !last, ty = o.y + h / 2, lab = GM_esc(o.n) + (S.showValues ? ' · ' + GM_esc(fmt(o.v)) : '');
      const pos = first ? `x="${o.x - 7}" y="${ty + 4}" text-anchor="end"` : last ? `x="${o.x + nw + 7}" y="${ty + 4}" text-anchor="start"` : `x="${o.x + nw / 2}" y="${o.y - 6}" text-anchor="middle"`;
      body += `<rect x="${o.x}" y="${o.y}" width="${nw}" height="${h}" rx="2" fill="${col(o)}"/><text ${pos} font-size="12.5" font-weight="800" fill="${ink}" stroke="${paper}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${lab}</text>`; });
    return finish(top + ph + 20, bands + body);
  }

  // vertical charts: bar, stacked, area, line
  const stacked = S.type === 'stacked' || S.type === 'area', all = stacked ? cats.map((c, j) => series.reduce((a, s, i) => a + Math.max(0, val(i, j)), 0)) : series.flatMap((s, i) => cats.map((c, j) => val(i, j)));
  const [lo, hi] = bound(all), sc = GM_niceScale(lo, hi), x0 = 44, pw = W - x0 - 8, ph = 230, y0 = top, H = y0 + ph + 54, Y = v => y0 + ph - (v - sc.min) / (sc.max - sc.min) * ph; let body = '';
  for (let t = sc.min; t <= sc.max + 1e-9; t += sc.step) body += `<line x1="${x0}" x2="${W}" y1="${Y(t)}" y2="${Y(t)}" stroke="${line}" ${Math.abs(t) < 1e-9 ? '' : 'stroke-dasharray="3 4"'}/><text x="${x0 - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11.5" fill="${mut}">${GM_esc(fmt(t))}</text>`;
  const slot = pw / Math.max(1, nC), maxLab = Math.max(1, Math.floor(slot / 6.4)), lblOf = c => c.length > maxLab ? c.slice(0, Math.max(3, maxLab - 1)) + '…' : c;
  cats.forEach((c, j) => { body += `<text x="${x0 + slot * (j + .5)}" y="${y0 + ph + 20}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${ink}"><title>${GM_esc(c)}</title>${GM_esc(lblOf(c))}</text>`; });
  if (S.type === 'area') {
    const cum = cats.map(() => 0), px = j => x0 + slot * (j + .5);
    series.forEach((s, i) => { const lower = cum.slice(), upper = cats.map((c, j) => cum[j] += Math.max(0, val(i, j))), col = colorOf(i, 0);
      body += `<path d="M${upper.map((v, j) => px(j).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' L')} L${lower.map((v, j) => px(j).toFixed(1) + ' ' + Y(v).toFixed(1)).reverse().join(' L')} Z" fill="${col}" stroke="${paper}" stroke-width="1.5"><title>${GM_esc(s.name)}</title></path>`;
      if (S.showValues) [0, nC - 1].filter((j, k, a) => a.indexOf(j) === k).forEach(j => { const ya = Y(upper[j]), yb = Y(lower[j]); if (yb - ya > 15) body += `<text x="${px(j) + (j === 0 ? 14 : -14)}" y="${(ya + yb) / 2 + 4}" text-anchor="${j === 0 ? 'start' : 'end'}" font-size="11.5" font-weight="800" fill="#fff">${GM_esc(fmt(Math.max(0, val(i, j))))}</text>`; }); });
  } else if (S.type === 'line') {
    series.forEach((s, i) => { const pts = cats.map((c, j) => [x0 + slot * (j + .5), Y(val(i, j))]), col = colorOf(i, 0);
      body += `<polyline fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`
        + pts.map((p, j) => `<circle cx="${p[0]}" cy="${p[1]}" r="4.2" fill="${col}" stroke="${paper}" stroke-width="2"><title>${GM_esc(cats[j] + ' · ' + s.name + ': ' + fmt(val(i, j)))}</title></circle>${S.showValues && (nC <= 12) ? `<text x="${p[0]}" y="${p[1] - 10}" text-anchor="middle" font-size="12" font-weight="800" fill="${ink}">${GM_esc(fmt(val(i, j)))}</text>` : ''}`).join(''); });
  } else {
    const bw = Math.min(64, (slot - 14) / (stacked ? 1 : nS));
    cats.forEach((c, j) => { let acc = 0;
      series.forEach((s, i) => { const v = val(i, j);
        if (stacked) { const vv = Math.max(0, v), ya = Y(acc + vv), yb = Y(acc); body += `<rect x="${x0 + slot * (j + .5) - bw / 2}" y="${ya}" width="${bw}" height="${Math.max(0, yb - ya)}" fill="${colorOf(i, j)}"><title>${GM_esc(c + ' · ' + s.name + ': ' + fmt(vv))}</title></rect>`;
          if (S.showValues && yb - ya > 15) body += `<text x="${x0 + slot * (j + .5)}" y="${(ya + yb) / 2 + 4}" text-anchor="middle" font-size="11.5" font-weight="800" fill="#fff">${GM_esc(fmt(vv))}</text>`; acc += vv; }
        else { const bx = x0 + slot * (j + .5) - bw * nS / 2 + i * bw, ya = Y(Math.max(0, v)), yb = Y(Math.min(0, v));
          body += `<rect x="${bx}" y="${ya}" width="${bw - 2}" height="${Math.max(1, yb - ya)}" rx="2" fill="${colorOf(i, j)}"><title>${GM_esc(c + (nS > 1 ? ' · ' + s.name : '') + ': ' + fmt(v))}</title></rect>`;
          if (S.showValues) body += `<text x="${bx + (bw - 2) / 2}" y="${v >= 0 ? ya - 6 : yb + 14}" text-anchor="middle" font-size="12.5" font-weight="800" fill="${ink}">${GM_esc(fmt(v))}</text>`; } });
      if (stacked && S.showValues) body += `<text x="${x0 + slot * (j + .5)}" y="${Y(acc) - 6}" text-anchor="middle" font-size="12.5" font-weight="800" fill="${ink}">${GM_esc(fmt(acc))}</text>`; });
  }
  return finish(H, body);
}

/** Unique node names of a flow list, in order of first appearance. */
function GM_nodes(flows) { const out = []; (flows || []).forEach(f => [f.from, f.to].forEach(n => { n = String(n || '').trim(); if (n && !out.includes(n)) out.push(n); })); return out; }
/** 'From <tab> To <tab> Value' rows (tab, comma or semicolon separated; a header row is skipped). */
function GM_parseFlows(text) {
  const rows = String(text || '').split(/\r?\n/).map(r => r.trim()).filter(Boolean), out = [];
  rows.forEach(r => { const sep = r.includes('\t') ? '\t' : r.includes(';') ? ';' : ',', c = r.split(sep).map(x => x.trim().replace(/^"|"$/g, '')); if (c.length >= 3 && c[0] && c[1] && /\d/.test(c[2])) out.push({ from: c[0], to: c[1], value: GM_num(c[2]) }); });
  return out;
}
/* ---------- PNG export + share card ---------- */
const GM_FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif";
/** A standalone SVG (title included, no CSS variables needed) for any type; results bars are redrawn as SVG. */
function GM_pngSvg(spec) {
  const S = Object.assign({}, GM_DEFAULT, spec);
  if (S.type !== 'rcp') return GM_svg(Object.assign({}, S, { boxed: false })).replace('font-family="inherit"', `font-family="${GM_FONT}"`);
  const cats = S.cats.map(String), vals = cats.map((c, i) => Math.max(0, GM_num((S.series[0] || { values: [] }).values[i]))), ord = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a]), mx = Math.max(...vals, 1e-9), dec = Math.max(0, Math.min(4, +S.decimals || 0));
  const f = v => (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec).replace(/\.0+$/, '') + (S.unit || ''), colOf = i => (S.catColors && S.catColors[i]) || (S.series[0] && S.series[0].color) || GM_PALETTE[i % GM_PALETTE.length];
  let y = 16, g = '';
  if (S.title) { g += `<text x="0" y="${y + 18}" font-size="21" font-weight="800" fill="#111214">${GM_esc(S.title)}</text>`; y += 28; }
  if (S.sub) { g += `<text x="0" y="${y + 14}" font-size="13" fill="#6b7080">${GM_esc(S.sub)}</text>`; y += 22; }
  y += 10; ord.forEach((i, k) => { const w = Math.max(6, vals[i] / mx * 640); g += `<rect x="0" y="${y}" width="${w}" height="44" rx="3" fill="${colOf(i)}"/><text x="${w > 220 ? 12 : w + 10}" y="${y + 19}" font-size="14" font-weight="800" fill="${w > 220 ? '#fff' : '#111214'}">${GM_esc(cats[i])}</text><text x="${w > 220 ? 12 : w + 10}" y="${y + 37}" font-size="15" font-weight="800" fill="${w > 220 ? '#fff' : '#111214'}">${GM_esc(f(vals[i]))}</text>`; y += 52; });
  if (S.source) { g += `<text x="640" y="${y + 12}" text-anchor="end" font-size="11" fill="#6b7080">${GM_esc(S.source)}</text>`; y += 20; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 ${y}" width="640" height="${y}" font-family="${GM_FONT}">${g}</svg>`;
}
function GM_svgImage(svg, w, h) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('image')); const head = /^<svg[^>]*>/.exec(svg)[0], head2 = head.replace(/\s(width|height)="[^"]*"/g, '').replace('<svg ', `<svg width="${w}" height="${h}" `); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(head2 + svg.slice(head.length)); });
}
/** PNG blob of a chart on a white background (scale 2 = 1280 px wide). */
async function GM_png(spec, scale = 2) {
  const svg = GM_pngSvg(spec), m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), w = +m[1], h = +m[2], pad = 24, c = document.createElement('canvas'); c.width = (w + pad * 2) * scale; c.height = (h + pad * 2) * scale;
  const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(await GM_svgImage(svg, w * scale, h * scale), pad * scale, pad * scale, w * scale, h * scale);
  return new Promise(r => c.toBlob(r, 'image/png'));
}
function GM_wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }); if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}
/** 1200x630 share card: headline, byline and (optionally) the article's first chart. opts = { title, byline, author, date, kicker, accent, spec } */
async function GM_shareCard(o) {
  const W = 1200, H = 630, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), accent = o.accent || '#ca1957';
  x.fillStyle = '#111214'; x.fillRect(0, 0, W, H); x.fillStyle = accent; x.fillRect(0, 0, W, 12);
  const hasChart = !!o.spec, tw = hasChart ? 560 : 1040;
  x.fillStyle = accent; x.font = `800 22px ${GM_FONT}`; x.fillText(String(o.kicker || 'DECISION DESK TSR').toUpperCase(), 80, 92);
  x.fillStyle = '#ffffff'; let size = 60, lines; do { x.font = `800 ${size}px ${GM_FONT}`; lines = GM_wrap(x, o.title || 'Untitled', tw, 5); size -= 4; } while (lines.length * (size + 14) > 400 && size > 28);
  lines.forEach((l, i) => x.fillText(l, 80, 170 + i * (size + 20)));
  x.fillStyle = '#b9bdc7'; x.font = `600 24px ${GM_FONT}`; const by = [o.author ? 'by ' + o.author : '', o.date || ''].filter(Boolean).join('  ·  '); if (by) x.fillText(by, 80, H - 96);
  x.fillStyle = '#ffffff'; x.font = `800 26px ${GM_FONT}`; x.fillText('wikiElections', 80, H - 48);
  if (hasChart) { const svg = GM_pngSvg(o.spec), m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg), w = +m[1], h = +m[2], bw = 520, bh = Math.min(470, bw * h / w + 40), sc = Math.min((bw - 40) / w, (bh - 40) / h), dw = w * sc, dh = h * sc, bx = 640, by2 = (H - bh) / 2 + 10;
    x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect ? x.roundRect(bx, by2, bw, bh, 14) : x.rect(bx, by2, bw, bh); x.fill(); x.drawImage(await GM_svgImage(svg, dw * 2, dh * 2), bx + (bw - dw) / 2, by2 + (bh - dh) / 2, dw, dh); }
  return new Promise(r => c.toBlob(r, 'image/png'));
}

const GM_isBoxed = S => !!(S && (S.boxed || S.type === 'rcp'));
function GM_rcp(S) {   // the site's own results-bar look (.rcp-*), single series, sorted high -> low
  const cats = S.cats.map(String), vals = cats.map((c, i) => Math.max(0, GM_num((S.series[0] || { values: [] }).values[i]))), ord = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a]), mx = Math.max(...vals, 1e-9), dec = Math.max(0, Math.min(4, +S.decimals || 0));
  const colOf = i => (S.catColors && S.catColors[i]) || (S.series[0] && S.series[0].color) || GM_PALETTE[i % GM_PALETTE.length];
  const dk = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return h; const n = parseInt(m[1], 16); return 'rgb(' + [16, 8, 0].map(sh => Math.round(((n >> sh) & 255) * .62)).join(',') + ')'; };
  const f = v => (Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec).replace(/\.0+$/, '');
  const badge = ord.length > 1 ? `<div class="rcp-lead-badge">${GM_esc(cats[ord[0]])}<span class="rcp-lead-value" style="background:${colOf(ord[0])}">+${f(vals[ord[0]] - vals[ord[1]])}</span></div>` : '';
  return `<div class="rcp-bars-wrap" style="margin:12px 0 4px;">${badge}${ord.map((i, k) => `<div class="rcp-bar-row"><div class="rcp-bar-fill" style="width:${(vals[i] / mx * 100).toFixed(1)}%; background:linear-gradient(120deg, ${colOf(i)}, ${dk(colOf(i))});"></div><div class="rcp-bar-remainder"></div><div class="rcp-bar-meta${k === 0 ? ' on-fill' : ''}"><div class="name">${GM_esc(cats[i])}</div><div class="pct">${f(vals[i])}${S.unit ? '<sup>' + GM_esc(S.unit) + '</sup>' : ''}</div></div></div>`).join('')}</div>`;
}
/** Full markup of a chart: optional boxed head (kicker / title / subtitle) + the SVG (or results bars). */
function GM_render(spec) {
  const S = Object.assign({}, GM_DEFAULT, spec), head = GM_isBoxed(S) ? `<div class="ac-head">${S.kicker ? `<span class="ac-kick">${GM_esc(S.kicker)}</span>` : ''}${S.title ? `<div class="ac-title">${GM_esc(S.title)}</div>` : ''}${S.sub ? `<div class="ac-sub">${GM_esc(S.sub)}</div>` : ''}</div>` : '';
  return head + (S.type === 'rcp' ? GM_rcp(S) + (S.source ? `<div class="ac-sub" style="text-align:right;margin-top:6px;">${GM_esc(S.source)}</div>` : '') : GM_svg(S));
}

function GM_figure(spec) {
  const f = document.createElement('figure'); f.className = 'art-chart' + (GM_isBoxed(spec) ? ' ac-fig' : ''); f.setAttribute('contenteditable', 'false'); f.setAttribute('data-chart', JSON.stringify(spec));
  f.innerHTML = GM_render(spec) + (spec.caption ? `<figcaption>${GM_esc(spec.caption)}</figcaption>` : ''); return f;
}
function GM_fromFigure(el) { try { return JSON.parse(el.getAttribute('data-chart')); } catch (e) { return null; } }

if (typeof window !== 'undefined') Object.assign(window, { GM_png, GM_pngSvg, GM_shareCard, GM_nodes, GM_parseFlows, GM_render, GM_svg, GM_isBoxed, GM_figure, GM_fromFigure, GM_parsePaste, GM_niceScale, GM_DEFAULT, GM_PALETTE });
