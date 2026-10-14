/**
 * Pollster ratings — grades every outlet by comparing its published polls with the
 * logged results in tsrelects-results.json.  CENSUS and ELECTION are the official
 * series (never graded); they are surfaced separately.
 *
 *   PG_load(base)  -> Promise<{ pollsters, official:{CENSUS,ELECTION}, registry }>
 *   PG_gradeOf(score) -> 'A+'..'F'
 */
const PG_OFFICIAL = ['CENSUS', 'ELECTION'];
const PG_PRIOR_SCORE = 60, PG_PRIOR_N = 2, PG_MIN_FULL = 3;

function PG_esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function PG_slug(n) { return encodeURIComponent(n); }
function PG_norm(n) {
  return String(n).replace(/\s*\(.*?\)/g, '').replace(/^u\//, '').replace(/\s+H2H Poll$/, '').trim();
}
function PG_gradeOf(s) {
  const t = [[90, 'A+'], [85, 'A'], [80, 'A-'], [75, 'B+'], [70, 'B'], [65, 'B-'], [60, 'C+'], [55, 'C'], [50, 'C-'], [40, 'D']];
  for (const [min, g] of t) if (s >= min) return g;
  return 'F';
}
function PG_gradeClass(g) { return 'pg-g-' + g[0].toLowerCase(); }
function PG_dayDiff(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }
function PG_tot(round) {
  const t = {};
  Object.values((round && round.races) || {}).forEach(groups =>
    Object.values(groups).forEach(v => Object.entries(v).forEach(([k, x]) => { t[k] = (t[k] || 0) + (Number(x) || 0); })));
  return t;
}
const PG_sum = o => Object.values(o).reduce((a, b) => a + b, 0);

/* Score for one poll: 0–100, 70% proximity of the vote shares, 30% for naming the right leader. */
function PG_scorePoll(mae, leaderHit) { return 0.7 * Math.max(0, 100 - 4 * mae) + 0.3 * (leaderHit ? 100 : 0); }

function PG_weight(p, ref) {
  const close = 1 / (1 + Math.max(0, p.daysOut) / 10);          // polls released nearer election day count more
  const recent = Math.pow(0.5, Math.max(0, PG_dayDiff(ref, p.date)) / 365); // 1-year half-life
  return Math.max(0.05, close * recent);
}
function PG_gradePolls(polls) {
  const n = polls.length;
  if (!n) return null;
  const W = polls.reduce((a, p) => a + p.w, 0);
  const mae = polls.reduce((a, p) => a + p.mae * p.w, 0) / W;
  const hit = polls.reduce((a, p) => a + (p.leaderHit ? p.w : 0), 0) / W;
  const raw = polls.reduce((a, p) => a + p.score * p.w, 0) / W;
  const score = (n * raw + PG_PRIOR_N * PG_PRIOR_SCORE) / (n + PG_PRIOR_N);
  return { n, mae, hit, raw, score, grade: PG_gradeOf(score), provisional: n < PG_MIN_FULL };
}
/** Mean signed miss (poll − result, in points) per key; positive = overstated. */
function PG_bias(polls, keyOf) {
  const m = {};
  polls.forEach(p => p.errs.forEach(e => { const k = keyOf(e.k); (m[k] = m[k] || []).push(e.err); }));
  return Object.entries(m).map(([k, v]) => ({ k, n: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length }));
}

async function PG_load(base) {
  base = base || './';
  const j = u => fetch(base + u).then(r => r.json());
  const [registry, results, idx, partyPolls, approval] =
    await Promise.all([j('data/registries.json'), j('data/tsrelects-results.json'), j('data/polls-index.json'), j('data/party-polls.json'), j('data/approval-polls.json')]);
  const elections = await Promise.all(idx.elections.map(e => j(`data/elections/${e.id}.json`)));

  const byName = {};
  const bucket = n => (byName[n] = byName[n] || { name: n, aliases: new Set(), polls: [], ungraded: [] });

  elections.forEach(el => {
    const cands = new Set([...(el.candidateIds || []), ...(el.writeInIds || [])]);
    let best = null;
    results.forEach(r => {
      if (Math.abs(PG_dayDiff(r.date, el.electionDate)) > 3) return;
      const fr = PG_tot(r.first_round);
      const ov = Object.keys(fr).filter(k => fr[k] > 0 && cands.has(k)).length;
      if (PG_sum(fr) > 0 && (!best || ov > best.ov)) best = { ov, r, fr };
    });
    const hasResult = best && best.ov > 0;
    const ru = hasResult ? PG_tot(best.r.runoff_round) : {}, RT = PG_sum(ru);
    el.polls.forEach(p => {
      const name = PG_norm(p.pollster), b = bucket(name);
      b.aliases.add(p.pollster);
      const base = { election: el.title, electionId: el.id, date: p.date, sample: p.sample, shares: p.shares, raw: p.pollster, daysOut: PG_dayDiff(el.electionDate, p.date) };
      if (!hasResult) { b.ungraded.push({ ...base, why: 'no logged result yet' }); return; }
      const ks = Object.keys(p.shares);
      let act, kind;
      if (ks.length === 2 && RT > 0 && ks.every(k => k in ru)) { act = {}; ks.forEach(k => act[k] = ru[k] / RT); kind = 'Runoff'; }
      else {
        const s = ks.reduce((a, k) => a + (best.fr[k] || 0), 0);
        if (!s) { b.ungraded.push({ ...base, why: 'polled candidates not on the ballot' }); return; }
        act = {}; ks.forEach(k => act[k] = (best.fr[k] || 0) / s); kind = 'First round';
      }
      const mae = ks.reduce((a, k) => a + Math.abs(p.shares[k] - act[k]), 0) / ks.length * 100;
      const lp = ks.reduce((a, k) => p.shares[k] > p.shares[a] ? k : a, ks[0]);
      const la = ks.reduce((a, k) => act[k] > act[a] ? k : a, ks[0]);
      const errs = ks.map(k => ({ k, poll: p.shares[k], actual: act[k], err: (p.shares[k] - act[k]) * 100 }));
      b.polls.push({ ...base, kind, actual: act, errs, mae, leaderPoll: lp, leaderActual: la, leaderHit: act[lp] >= act[la] - 1e-9, score: 0 });
      b.polls[b.polls.length - 1].score = PG_scorePoll(mae, act[lp] >= act[la] - 1e-9);
    });
  });

  const official = { CENSUS: { party: [], approval: [], questions: [] }, ELECTION: { party: [] } };
  (partyPolls.polls || []).forEach(p => { if (official[p.pollster]) official[p.pollster].party.push(p); });
  official.CENSUS.approval = Object.entries(approval.moderators || {}).map(([id, m]) => ({ id, name: m.role || m.name, former: (m.status || 'current') === 'former', termEnd: m.termEnd || '', polls: (m.polls || []).filter(p => p.pollster === 'CENSUS').sort((a, b) => a.date.localeCompare(b.date)) })).filter(m => m.polls.length);
  official.CENSUS.questions = Object.entries(approval.questions || {}).map(([id, q]) => ({ id, name: q.name, yes: q.yesLabel, no: q.noLabel, polls: (q.polls || []).filter(p => p.pollster === 'CENSUS').sort((a, b) => a.date.localeCompare(b.date)) })).filter(q => q.polls.length);
  Object.values(official).forEach(o => o.party.sort((a, b) => a.date.localeCompare(b.date)));

  const ref = Object.values(byName).flatMap(b => b.polls.map(p => p.date)).sort().pop() || new Date().toISOString().slice(0, 10);
  Object.values(byName).forEach(b => b.polls.forEach(p => { p.w = PG_weight(p, ref); }));
  const pollsters = Object.values(byName).map(b => {
    b.aliases = [...b.aliases];
    b.polls.sort((a, c) => c.date.localeCompare(a.date));
    b.grade = PG_gradePolls(b.polls);
    b.total = b.polls.length + b.ungraded.length;
    return b;
  }).sort((a, b) => ((b.grade ? b.grade.score : -1) - (a.grade ? a.grade.score : -1)) || b.total - a.total);
  return { pollsters, official, registry, elections };
}

/* ---------- tiny SVG helpers ---------- */
function PG_col(hex) { return typeof TK_col === 'function' ? TK_col(hex) : hex; }
function PG_candColor(reg, k) {
  const c = (reg.candidates || {})[k] || {}, p = c.party && c.party !== 'ua' ? (reg.parties || {})[c.party] : null;
  return (p && p.color) || c.color || '#888';
}
function PG_candName(reg, k) { return ((reg.candidates || {})[k] || {}).name || k; }
function PG_partyColor(reg, k) { return ((reg.parties || {})[k] || {}).color || '#888'; }
function PG_partyName(reg, k) { const p = (reg.parties || {})[k] || {}; return p.shortName || p.name || k; }

/** Dumbbell strip: poll vs actual for each candidate in one poll. */
function PG_dumbbell(reg, poll) {
  const W = 300, rowH = 22, pad = 4, rows = poll.errs.length, H = rows * rowH + pad * 2;
  const xs = v => 6 + v * (W - 12);
  let g = '';
  poll.errs.forEach((e, i) => {
    const y = pad + i * rowH + rowH / 2, col = PG_col(PG_candColor(reg, e.k));
    g += `<line x1="6" x2="${W - 6}" y1="${y}" y2="${y}" class="pg-rail"/>`
      + `<line x1="${xs(e.poll)}" x2="${xs(e.actual)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="3" opacity=".55"/>`
      + `<circle cx="${xs(e.actual)}" cy="${y}" r="5.5" fill="var(--paper)" stroke="${col}" stroke-width="2"/>`
      + `<circle cx="${xs(e.poll)}" cy="${y}" r="5" fill="${col}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="pg-dumb" role="img" aria-label="Poll versus result per candidate">${g}</svg>`;
}

/** Multi-line chart of party (or any) shares over time with monotone smoothing. */
function PG_lines(series, colorOf, opts) {
  opts = opts || {};
  const W = 640, H = 230, L = 34, R = 12, T = 10, B = 24;
  const pts = series.flatMap(s => s.points);
  if (!pts.length) return '';
  const t0 = Math.min(...pts.map(p => +new Date(p.date))), t1 = Math.max(...pts.map(p => +new Date(p.date)));
  const span = Math.max(1, t1 - t0);
  const ymax = Math.max(0.1, Math.ceil(Math.max(...pts.map(p => p.v)) * 10) / 10);
  const x = d => L + (+new Date(d) - t0) / span * (W - L - R), y = v => T + (1 - v / ymax) * (H - T - B);
  let g = '';
  for (let v = 0; v <= ymax + 1e-9; v += ymax / 4) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pg-grid"/><text x="${L - 6}" y="${y(v) + 3}" class="pg-ax" text-anchor="end">${Math.round(v * 100)}%</text>`;
  const ticks = 5;
  for (let i = 0; i < ticks; i++) {
    const t = new Date(t0 + span * i / (ticks - 1));
    g += `<text x="${x(t)}" y="${H - 6}" class="pg-ax" text-anchor="${i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle'}">${t.toISOString().slice(0, 7)}</text>`;
  }
  series.forEach(s => {
    const col = PG_col(colorOf(s.key)), P = s.points.map(p => [x(p.date), y(p.v)]);
    g += `<path d="${TK_smoothPath(P)}" fill="none" stroke="${col}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    P.forEach(p => g += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.8" fill="${col}"/>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="pg-lines" role="img">${g}</svg>`;
}
