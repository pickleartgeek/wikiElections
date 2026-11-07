/**
 * Site-wide UX helpers, auto-loaded by main.js on every page:
 *   - Search palette (button in the header, "/" or Ctrl/Cmd+K)
 *   - Share button (copies the current deep link; native share sheet on phones)
 *   - "What's new since your last visit" line on the homepage (#sinceLine)
 * No dependencies. Everything fails quiet: the site works without any of it.
 */
(function () {
  const BASE = window.SITE_BASE || './';
  const $ = (s, r) => (r || document).querySelector(s);
  const J = u => fetch(BASE + u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------------- Search ---------------- */
  const PAGES = [
    ['Main Page', '', 'home start'],
    ['Decision Desk TSR', 'ddtsr', 'forecast probcalc basecalc race calls'],
    ['Spinner Insights Polls', 'polls', 'polling polls spinner insights'],
    ['TSR Elects', 'elects/', 'results elections history live'],
    ['Election Replay', 'elects/replay', 'replay vote by vote video export count'],
    ['Election Simulator', 'elects/simulate', 'simulate election night'],
    ['Map Maker', 'elects/mapmaker', 'map svg png download'],
    ['Pollster Ratings', 'pollsters', 'grades accuracy census election pollsters'],
    ['Moderator Approval', 'approval', 'approval track record moderators'],
    ['Party Support', 'party-support', 'parties membership generic ballot'],
    ['Articles', 'articles', 'analysis write-ups blog'],
    ['Understanding ProbCalc', 'guide', 'guide how it works probabilities methodology']
  ].map(([t, u, k]) => ({ t, u, k, g: 'Pages', s: '' }));

  let items = PAGES.slice(), built = false, pollstersLoaded = false;

  async function buildIndex() {
    if (built) return; built = true;
    const add = (g, t, s, u, k) => items.push({ g, t, s: s || '', u, k: k || '' });
    const tasks = [
      J('data/articles.json').then(d => (d.articles || []).filter(a => a.published !== false && a.published !== 'False')
        .forEach(a => add('Articles', a.title, a.author ? 'by ' + a.author : '', 'article?id=' + encodeURIComponent(a.id), a.byline))),
      J('data/approval-polls.json').then(d => {
        Object.entries(d.moderators || {}).forEach(([k, m]) => add('Approval', (m.role ? m.role + ' · ' : '') + m.name, 'Moderator approval' + ((m.terms || []).length > 1 ? ' · ' + m.terms.length + ' seats' : ''), 'approval?mod=' + k, m.name + ' ' + (m.role || '') + ' ' + (m.terms || []).map(t => t.seat).join(' ')));
        Object.entries(d.questions || {}).forEach(([k, q]) => add('Approval', q.name, 'Community question', 'approval?mod=' + k));
      }),
      J('data/tsrelects-results.json').then(list => (Array.isArray(list) ? list : []).forEach(e => add('Elections', e.title, e.date || '', 'elects/?election=' + encodeURIComponent(e.id), e.id))),
      J('data/timelines/index.json').then(d => (d.timelines || []).forEach(t => add('Replay', t.title, 'Watch the count', 'elects/replay?e=' + encodeURIComponent(t.id), 'replay ' + t.id)))
    ];
    await Promise.allSettled(tasks);
    refresh();
    loadPollsters();
  }

  function loadPollsters() {
    if (pollstersLoaded) return; pollstersLoaded = true;
    const run = () => (typeof PG_load === 'function' ? PG_load(BASE) : Promise.reject())
      .then(D => { (D.pollsters || []).forEach(p => items.push({ g: 'Pollsters', t: p.name, s: 'Pollster rating', u: 'pollster?p=' + encodeURIComponent(p.name), k: '' })); refresh(); })
      .catch(() => {});
    if (typeof PG_load === 'function') return run();
    const sc = document.createElement('script'); sc.src = BASE + 'assets/js/pollsters.js'; sc.onload = run; document.head.appendChild(sc);
  }

  function score(it, toks) {
    const t = it.t.toLowerCase(), hay = (it.t + ' ' + it.s + ' ' + it.k).toLowerCase();
    let sc = 0;
    for (const w of toks) {
      if (!hay.includes(w)) return -1;
      sc += t.startsWith(w) ? 6 : t.split(/\W+/).some(x => x.startsWith(w)) ? 4 : t.includes(w) ? 2 : 1;
    }
    return sc + (it.g === 'Pages' ? 1 : 0);
  }

  let dlg, input, list, active = 0, shown = [], lastFocus = null;

  function build() {
    if (dlg) return;
    dlg = document.createElement('div');
    dlg.className = 'sx'; dlg.hidden = true;
    dlg.innerHTML = '<div class="sx-back" data-close></div><div class="sx-box" role="dialog" aria-modal="true" aria-label="Search wikiElections">' +
      '<div class="sx-bar"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<input type="search" id="sxInput" placeholder="Search pages, moderators, elections, pollsters, articles…" autocomplete="off" spellcheck="false" aria-label="Search"><kbd>Esc</kbd></div>' +
      '<div class="sx-list" id="sxList" role="listbox"></div></div>';
    document.body.appendChild(dlg);
    input = $('#sxInput', dlg); list = $('#sxList', dlg);
    dlg.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
    input.addEventListener('input', () => { active = 0; refresh(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(shown[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
    });
    list.addEventListener('mousemove', e => { const r = e.target.closest('[data-i]'); if (r && +r.dataset.i !== active) { active = +r.dataset.i; paint(); } });
    list.addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r) go(shown[+r.dataset.i]); });
  }

  function refresh() {
    if (!dlg) return;
    const q = input.value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
    if (!toks.length) shown = items.filter(i => i.g === 'Pages');
    else shown = items.map(i => [i, score(i, toks)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).slice(0, 30).map(x => x[0]);
    active = Math.min(active, Math.max(0, shown.length - 1));
    if (!shown.length) { list.innerHTML = '<div class="sx-empty">Nothing matches “' + esc(input.value) + '”. Try a moderator, an election or a pollster name.</div>'; return; }
    let html = '', g = '';
    shown.forEach((it, i) => {
      if (it.g !== g) { g = it.g; html += '<div class="sx-g">' + esc(g) + '</div>'; }
      html += '<a role="option" class="sx-it" data-i="' + i + '" href="' + esc(BASE + it.u) + '"><b>' + esc(it.t) + '</b>' + (it.s ? '<span>' + esc(it.s) + '</span>' : '') + '</a>';
    });
    list.innerHTML = html; paint();
  }

  function paint() {
    list.querySelectorAll('.sx-it').forEach(a => {
      const on = +a.dataset.i === active; a.classList.toggle('on', on); a.setAttribute('aria-selected', on);
      if (on) a.scrollIntoView({ block: 'nearest' });
    });
  }
  function move(d) { if (!shown.length) return; active = (active + d + shown.length) % shown.length; paint(); }
  function go(it) { if (it) location.href = BASE + it.u; }

  function open() {
    build(); lastFocus = document.activeElement; dlg.hidden = false; document.documentElement.classList.add('sx-open');
    input.value = ''; active = 0; refresh(); input.focus(); buildIndex();
  }
  function close() { if (!dlg || dlg.hidden) return; dlg.hidden = true; document.documentElement.classList.remove('sx-open'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }

  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') || (document.activeElement || {}).isContentEditable;
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dlg && !dlg.hidden ? close() : open(); }
    else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); open(); }
  });

  /* ---------------- Header buttons ---------------- */
  function share() {
    const url = location.href, title = document.title;
    const done = msg => toast(msg);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title, url }).catch(() => {}); return; }
    const fallback = () => { const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} t.remove(); done(ok ? 'Link copied' : 'Press Ctrl+C to copy: ' + url); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done('Link copied'), fallback); else fallback();
  }
  let toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'sx-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  function injectButtons() {
    const wrap = $('.masthead .wrap'); if (!wrap || $('.sx-btns')) return;
    const box = document.createElement('div'); box.className = 'sx-btns';
    box.innerHTML = '<button type="button" class="sx-btn" id="sxOpen" aria-label="Search the site" title="Search ( / )"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Search</span></button>' +
      '<button type="button" class="sx-btn sx-icon" id="sxShare" aria-label="Copy link to this page" title="Copy link to this page"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M8 12l4-4M7.5 9.5l-2 2a3 3 0 004.2 4.2l2-2M12.5 10.5l2-2a3 3 0 00-4.2-4.2l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>';
    const pill = $('#modePill', wrap);
    wrap.insertBefore(box, pill || $('.theme-toggle', wrap) || null);
    $('#sxOpen', box).onclick = open; $('#sxShare', box).onclick = share;
  }

  /* ---------------- What's new since last visit (homepage) ---------------- */
  async function since() {
    const slot = $('#sinceLine'); if (!slot) return;
    try {
      const [ap, idx, res, art, pp] = await Promise.all([J('data/approval-polls.json'), J('data/polls-index.json'), J('data/tsrelects-results.json'), J('data/articles.json'), J('data/party-polls.json').catch(() => ({}))]);
      const count = o => Object.values(o || {}).reduce((n, m) => n + ((m && m.polls) || []).length, 0);
      const cur = {
        approval: count(ap.moderators) + count(ap.questions),
        party: ((pp.polls || pp.party || []) || []).length,
        elections: (idx.elections || []).length,
        results: (Array.isArray(res) ? res : []).length,
        articles: (art.articles || []).filter(a => a.published !== false && a.published !== 'False').length
      };
      const prev = (() => { try { return JSON.parse(store.get('wE-seen')); } catch (e) { return null; } })();
      const save = () => store.set('wE-seen', JSON.stringify(cur));
      if (!prev) { save(); return; }
      const d = k => Math.max(0, cur[k] - (prev[k] || 0));
      const bits = [];
      const polls = d('approval') + d('party');
      if (polls) bits.push(`<a href="approval">${polls} new poll${polls > 1 ? 's' : ''}</a>`);
      if (d('elections')) bits.push(`<a href="polls">${d('elections')} new race${d('elections') > 1 ? 's' : ''} polled</a>`);
      if (d('results')) bits.push(`<a href="elects/">${d('results')} new result${d('results') > 1 ? 's' : ''}</a>`);
      if (d('articles')) bits.push(`<a href="articles">${d('articles')} new article${d('articles') > 1 ? 's' : ''}</a>`);
      if (bits.length) { slot.innerHTML = '<span class="since-dot" aria-hidden="true"></span><b>New since your last visit</b> ' + bits.join(' · ') + '<button type="button" class="since-x" aria-label="Dismiss">×</button>'; slot.hidden = false; $('.since-x', slot).onclick = () => { slot.hidden = true; save(); }; }
      addEventListener('pagehide', save);
    } catch (e) { /* quiet */ }
  }

  function init() { injectButtons(); since(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
