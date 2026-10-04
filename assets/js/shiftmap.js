/** Shift-map controller for Leaflet group maps (DDTSR forecast + simulator). Needs tsrelects.js (TSR_shift).
 *  Shift = change in vote share, in points, vs a past election; by candidate (nzb = nzb1) or by party. */
function SM_olds(results) {
  const tot = r => Object.values(r).reduce((a, g) => a + Object.values(g).reduce((x, y) => x + y, 0), 0);
  return results.map(e => {
    const rk = Object.keys(e).find(k => /first/i.test(k) && e[k] && e[k].races) || Object.keys(e).find(k => e[k] && e[k].races && !/runoff|final/i.test(k));
    if (!rk) return null;
    const races = e[rk].races, best = Object.keys(races).sort((a, b) => tot(races[b]) - tot(races[a]))[0];
    return { id: e.id, title: e.title || e.id, date: e.date, race: races[best] };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
}

/** o: { controls, panel, legend?, registry, olds, layer():Leaflet group, getNew():race, partyOf?(id), onExit() } */
function SM_create(o) {
  const st = { mode: 'results', by: 'candidate', base: (o.olds[0] || {}).id, track: null, data: null, sel: null }, c = o.controls, reg = o.registry;
  const legendOrig = o.legend ? o.legend.innerHTML : '';
  c.classList.add('sm-controls');
  c.innerHTML = `<div class="seg" data-k="mode"><button data-v="results" class="on">${o.resultsLabel || 'Forecast'}</button><button data-v="shift">Shift</button></div>
    <span class="sm-opts" style="display:none"><div class="seg" data-k="by"><button data-v="candidate" class="on">Candidates</button><button data-v="party">Parties</button></div>
    <label>vs <select class="sm-base">${o.olds.map(e => `<option value="${e.id}">${e.title}</option>`).join('')}</select></label>
    <label>Track <select class="sm-track"></select></label></span>`;
  const $ = s => c.querySelector(s);
  const name = b => st.by === 'party' ? ((reg.parties[b] || {}).name || b) : TSR_candidateName(reg, st.data.rep[b]);
  const color = b => st.by === 'party' ? ((reg.parties[b] || {}).color || '#888') : TSR_candidateColor(reg, st.data.rep[b]);

  function compute() {
    const old = (o.olds.find(e => e.id === st.base) || {}).race, nw = o.getNew();
    st.data = old && nw ? TSR_shift(reg, st.by, nw, old, o.partyOf) : null;
    if (st.data && !st.data.buckets.includes(st.track)) st.track = st.data.buckets[0];
  }
  function style(gid) {
    const gd = st.data && st.data.groups[gid], x = gd && gd.d[st.track];
    if (!x || x.d == null) return { fillColor: '#e5e4dc', fillOpacity: 0.7, color: '#555', weight: 1 };
    const low = gd.nn < 5 || gd.on < 5;
    return { fillColor: x.d >= 0 ? color(st.track) : '#5b6270', fillOpacity: (0.2 + 0.7 * Math.min(1, Math.abs(x.d) / 40)) * (low ? 0.6 : 1), color: String(st.sel) === gid ? '#111' : '#555', weight: String(st.sel) === gid ? 2.5 : 1 };
  }
  function panel() {
    const d = st.data, p = o.panel;
    if (!d) { p.innerHTML = '<div class="gf-ptitle">Shift</div><div class="small-muted">No matching race in the compared election.</div>'; return; }
    const gd = st.sel ? d.groups[st.sel] : d.state;
    if (!gd) { p.innerHTML = `<div class="gf-ptitle">Group ${st.sel}</div><div class="small-muted">No data in one of the elections.</div>`; return; }
    const rows = d.buckets.filter(b => gd.d[b].n || gd.d[b].o).sort((a, b) => (gd.d[b].n || 0) - (gd.d[a].n || 0));
    p.innerHTML = `<div class="gf-ptitle">${st.sel ? 'Group ' + st.sel : 'Statewide'} · shift</div>` + rows.map(b => { const x = gd.d[b];
      return `<div class="sm-row" data-b="${b}"><i style="background:${color(b)}"></i><span class="sm-n">${name(b)}${b === st.track ? ' ◂' : ''}</span>
        <span class="sm-v"><small>${x.o == null ? '—' : x.o.toFixed(1) + '%'} → ${x.n == null ? '—' : x.n.toFixed(1) + '%'}</small><b style="color:${x.d == null ? 'inherit' : x.d >= 0 ? '#1a7f4b' : '#b3261e'}">${TSR_fmtShift(x.d)}</b></span></div>`; }).join('') +
      `<div class="small-muted" style="margin-top:6px">${o.forecast ? 'Forecast' : Math.round(gd.nn) + ' votes now'} vs ${gd.on} votes then · tap a row to track it · * = under 5 votes</div>`;
    p.querySelectorAll('.sm-row').forEach(r => r.onclick = () => { st.track = r.dataset.b; refresh(); });
  }
  function refresh() {
    const on = st.mode === 'shift';
    $('.sm-opts').style.display = on ? '' : 'none';
    c.querySelectorAll('.seg[data-k=mode] button').forEach(b => b.classList.toggle('on', b.dataset.v === st.mode));
    c.querySelectorAll('.seg[data-k=by] button').forEach(b => b.classList.toggle('on', b.dataset.v === st.by));
    const L = o.layer();
    if (!on) { if (L) L.eachLayer(l => l.unbindTooltip()); if (o.legend) o.legend.innerHTML = legendOrig; o.onExit(); return; }
    compute();
    $('.sm-base').value = st.base;
    $('.sm-track').innerHTML = st.data ? st.data.buckets.map(b => `<option value="${b}">${name(b)}</option>`).join('') : '';
    if (st.data) $('.sm-track').value = st.track;
    if (L) L.eachLayer(l => { const gid = String(l.feature.properties.id), gd = st.data && st.data.groups[gid], x = gd && gd.d[st.track], low = gd && (gd.nn < 5 || gd.on < 5);
      l.setStyle(style(gid)); l.unbindTooltip(); l.bindTooltip(x ? TSR_fmtShift(x.d) + (low ? '*' : '') : '—', { permanent: true, direction: 'center', className: 'shift-label' }); });
    if (o.legend) o.legend.innerHTML = st.data ? `<span><i style="background:${color(st.track)}"></i>${name(st.track)} gained</span><span><i style="background:#5b6270"></i>lost</span><span class="small-muted">points vs. ${(o.olds.find(e => e.id === st.base) || {}).title}</span>` : '';
    panel();
  }
  c.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (!b) return; st[b.parentNode.dataset.k] = b.dataset.v; if (b.parentNode.dataset.k === 'by') st.track = null; refresh(); });
  $('.sm-base').onchange = e => { st.base = e.target.value; refresh(); };
  $('.sm-track').onchange = e => { st.track = e.target.value; refresh(); };
  return { refresh, active: () => st.mode === 'shift', pick(gid) { st.sel = String(st.sel) === String(gid) ? null : String(gid); refresh(); } };
}
if (typeof window !== 'undefined') Object.assign(window, { SM_olds, SM_create });
