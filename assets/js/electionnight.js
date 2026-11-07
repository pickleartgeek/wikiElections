/**
 * ElectionNight — turns the results files into what the homepage shows while an election is on.
 *
 *   EN_merge(hand, ballottsr)          hand-curated results + BallotTSR mirror (+ admin overrides), same merge as TSR Elects
 *   EN_build({ elections, registry, cfg, now, demo, base })
 *        -> { boards, night, calls }
 *        boards  every election with its current round, races, totals, calls
 *        night   boards that are live, or finished within EN_NIGHT_DAYS days, and have votes in
 *        calls   every outright / autorunoff call, each flagged `fresh` when it should pop the first-visit graphic
 *   EN_wireItems(night, registry, pollMap)   rotating items for The Wire
 *
 * A race call may carry two optional fields on top of { status, winners }:
 *   flip: true            the seat changed hands -> FLIP pill on the call graphic
 *   calledAt: ISO string  when the call went up (the admin panel stamps it) -> lets a late call still pop the graphic
 * `demo: true` (homepage ?demo=night) pretends the newest election is live so all of this can be previewed off-cycle.
 */
const EN_NIGHT_DAYS = 3;   // a finished election keeps the results window this long
const EN_CALL_DAYS = 7;    // a call this fresh pops the first-visit graphic

function EN_merge(hand, bt) {
  const base = (hand || []).filter(Boolean);
  const extra = ((bt && bt.elections) || []).filter(e => e && !base.some(h => h.id === e.id));
  return OVR_getTsrElections(base.concat(extra));
}

function EN_classTitle(title) {
  const m = String(title || '').match(/Class\s*\d+/i);
  return m ? m[0].replace(/\s+/, ' ') : String(title || '').replace(/ Election$/, '');
}

function EN_candidate(registry, key, base) {
  const c = TSR_candidate(registry, key), party = TSR_party(registry, c.party);
  return { key, name: c.name, color: CG_candidateColor(registry, key), partyLabel: CG_candidateParty(registry, key), partyName: party ? party.name : '',
    photo: TSR_candidatePhoto(registry, key, base) };
}

function EN_build({ elections, registry, cfg, now, demo, base = './' }) {
  const today = (now || new Date()).toISOString().slice(0, 10), DAY = 864e5;
  const age = d => Math.round((Date.parse(today) - Date.parse(String(d).slice(0, 10))) / DAY);
  const cfgLive = new Set(SITE_electsIds(cfg));
  const newest = elections.reduce((m, e) => (e.date || '') > m ? e.date : m, '');
  const boards = [];
  elections.forEach(e => {
    try {
      if (!e || !e.date) return;
      const rk = TSR_defaultRoundKey(e), rd = TSR_getRoundData(e, rk), entries = Object.entries(TSR_getRaces(rd)).filter(([, g]) => g && typeof g === 'object');
      if (!entries.length) return;
      const live = !!(e.live || cfgLive.has(e.id) || (demo && e.date === newest)), a = age(e.date), short = EN_classTitle(e.title);
      const races = entries.map(([name, groups]) => {
        const totals = TSR_raceTotals(groups), sorted = Object.entries(totals).sort((x, y) => y[1] - x[1]), votes = sorted.reduce((s, x) => s + x[1], 0), wins = {};
        Object.values(groups).forEach(g => { const s = Object.entries(g).sort((x, y) => y[1] - x[1]), t = s.reduce((q, x) => q + x[1], 0);
          if (t > 0 && !(s[1] && s[1][1] === s[0][1])) wins[s[0][0]] = (wins[s[0][0]] || 0) + 1; });
        const call = TSR_getRaceCall(rd, name), winners = TSR_callWinners(call), st = call && call.status;
        const kind = st === 'winner' && winners.length ? 'winner' : st === 'runoff' && winners.length > 1 ? 'autorunoff' : st === 'runoff' && winners.length === 1 ? 'advance' : null;
        const tied = sorted.length > 1 && sorted[0][1] === sorted[1][1];
        return { name, groups, totals, sorted, votes, wins, groupTotal: Object.keys(groups).length, call, winners, kind, tied, flip: !!(call && call.flip), calledAt: call && call.calledAt || null,
          callId: kind ? [e.id, rk, name, st, winners.join('+')].join('|') : null };
      });
      const votes = races.reduce((s, r) => s + r.votes, 0);
      const rep = rd.precincts_reporting ?? e.precincts_reporting ?? null, tot = rd.precincts_total ?? e.precincts_total ?? null;
      boards.push({ id: e.id, e, rk, title: e.title, short, date: e.date, age: a, live, roundLabel: rk === 'runoff_round' ? 'Runoff' : 'First round', races, votes, hasVotes: votes > 0,
        reporting: rep, precinctsTotal: tot, reportingPct: rep != null && tot ? Math.round(rep / tot * 100) : rep, turnout: rd.turnout ?? e.turnout ?? null });
    } catch (err) { console.warn('election night: skipped', e && e.id, err); }
  });
  const num = b => parseInt((b.short.match(/\d+/) || [0])[0], 10);
  const night = boards.filter(b => b.hasVotes && (b.live || (b.age >= 0 && b.age <= EN_NIGHT_DAYS))).sort((x, y) => (y.date > x.date) - (y.date < x.date) || num(x) - num(y));
  const calls = [];
  boards.forEach(b => b.races.forEach(r => {
    if (r.kind !== 'winner' && r.kind !== 'autorunoff') return;
    const keys = r.winners.slice(0, r.kind === 'autorunoff' ? 2 : 1), fresh = b.live || (b.age >= 0 && b.age <= EN_CALL_DAYS) || (r.calledAt && age(r.calledAt) <= EN_CALL_DAYS);
    calls.push({ id: r.callId, electionId: b.id, electionTitle: b.title, raceName: r.name, kind: r.kind, flip: r.flip, fresh: !!fresh, date: r.calledAt || b.date,
      title: r.call.callTitle || b.short, subtitle: r.call.callSubtitle || 'moderator', href: `elects/?election=${encodeURIComponent(b.id)}`,
      candidates: keys.map(k => EN_candidate(registry, k, base)) });
  }));
  return { boards, night, calls, today };
}

const EN_pct = (v, t) => Math.round(v / (t || 1) * 100);

/** Final DDTSR polling average as { canonicalCandidateId: share% } for one election (null when there are no usable polls). */
function EN_pollShares(pf, b) {
  try {
    const ids = BaseCalc_currentCandidates(pf.polls, pf.candidateIds), agg = BaseCalc_aggregate(pf.polls, ids, pf.electionDate || b.date, { anticipatedTurnout: pf.anticipatedTurnout }),
      tot = agg.sorted.reduce((s, x) => s + x[1], 0) || 1, o = {};
    agg.sorted.forEach(([k, v]) => { o[TSR_canonId(k)] = EN_pct(v, tot); }); return o;
  } catch (e) { return null; }
}

/** Wire items for election mode. pollMap: { electionId: pollsFile } (optional) adds the polls-vs-result lines. */
function EN_wireItems(night, registry, pollMap = {}) {
  const items = [], nm = k => TSR_candidateName(registry, k);
  night.forEach(b => {
    const link = `elects/?election=${encodeURIComponent(b.id)}`, many = b.races.length > 1;
    b.races.forEach(r => {
      const label = b.short + (many ? ' · ' + r.name.replace(/ (First Round|Runoff|Final RCV Round)$/, '') : ''), top = r.sorted.filter(x => x[1] > 0).slice(0, 3), c = r.call;
      if (r.kind === 'winner') items.push({ tag: 'Call', kind: 'call', text: `${nm(r.winners[0])} is the projected winner in ${label}`, href: link, call: r.callId, flip: r.flip });
      else if (r.kind === 'autorunoff') items.push({ tag: 'Call', kind: 'call', text: `${nm(r.winners[0])} and ${nm(r.winners[1])} projected to advance to the ${b.short} runoff`, href: link, call: r.callId });
      else if (r.kind === 'advance') items.push({ tag: 'Call', kind: 'call', text: `${nm(r.winners[0])} advances to the ${b.short} runoff`, href: link });
      if (top.length) items.push({ tag: 'Results', kind: 'results', href: link,
        text: `${label}: ${top.map(([k, v]) => `${nm(k)} ${EN_pct(v, r.votes)}%`).join(' · ')}${b.reportingPct != null ? ` · ${b.reportingPct}% reporting` : ''}${r.kind ? '' : r.tied ? ' · Too close to call' : ' · Not yet called'}` });
      const lead = top[0], n = lead && r.wins[lead[0]];
      if (n) items.push({ tag: 'Groups', kind: 'groups', href: link, text: `${nm(lead[0])} ${r.kind === 'winner' || r.kind === 'advance' ? 'carried' : 'leads in'} ${n} of ${r.groupTotal} groups in ${label}` });
      const pf = pollMap[b.id];
      if (pf && lead && !r.tied) {
        try {
          const ids = BaseCalc_currentCandidates(pf.polls, pf.candidateIds), agg = BaseCalc_aggregate(pf.polls, ids, pf.electionDate || b.date, { anticipatedTurnout: pf.anticipatedTurnout }),
            tot = agg.sorted.reduce((s, x) => s + x[1], 0) || 1, hit = agg.sorted.find(x => TSR_canonId(x[0]) === TSR_canonId(lead[0]));
          if (hit) { const pp = EN_pct(hit[1], tot), rp = EN_pct(lead[1], r.votes), d = rp - pp;
            items.push({ tag: 'Polls', kind: 'polls', href: `ddtsr?election=${encodeURIComponent(pf.id || b.id)}#probcalc`,
              text: `${nm(lead[0])} polled ${pp}% in the final DDTSR average and is at ${rp}% in the count (${d >= 0 ? '+' : '−'}${Math.abs(d)})` }); }
        } catch (err) { /* no poll line */ }
      }
    });
    if (b.reportingPct != null) items.push({ tag: 'Turnout', kind: 'turnout', href: link, text: `${b.short}: ${b.reporting} of ${b.precinctsTotal || 100} precincts reporting${b.turnout != null ? ` · turnout ${b.turnout}%` : ''}` });
  });
  return items;
}

if (typeof window !== 'undefined') Object.assign(window, { EN_merge, EN_build, EN_wireItems, EN_classTitle, EN_pollShares });
