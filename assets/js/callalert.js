/**
 * CallAlert — the first-visit "race call" graphic (the on-site cousin of the CNN / NBC projection alert),
 * drawn in the Decision Desk TSR call-graphic style: party-colour field, Oswald type, cream PROJECTED pill, FLIP pill,
 * white photo disc with party badge, black DDTSR bar.
 *
 *   CA_init({ calls, base, demo })   shows every fresh call this browser hasn't seen yet (queued, max CA_MAX); remembers them in localStorage
 *   CA_open(callId)                  re-opens one call (used by The Wire and the Calls window)
 *
 * `calls` comes from EN_build(). In demo mode (homepage ?demo=night) nothing is read from or written to storage.
 * Needs callgraphic.js (colour helpers + the shareable PNG renderer).
 */
(function () {
  const KEY = 'wE-seenCalls', CA_MAX = 4;
  let CALLS = [], queue = [], pos = 0, root = null, lastFocus = null, BASE = './', DEMO = false, mem = [];

  const seen = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return mem; } };
  const remember = id => { if (DEMO) return; const s = seen(); if (s.includes(id)) return; s.push(id); mem = s;
    try { localStorage.setItem(KEY, JSON.stringify(s.slice(-200))); } catch (e) { /* private mode: in-memory only */ } };
  const ink = c => CG_lum(c) > 0.55 ? CG_mix(c, 0.5) : c;

  const CHECK = '<svg class="ca-check" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M4.5 12.8l5 5.2L19.8 6.4"/></svg>';
  const FLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 13.6-3.4L20 8M20 15a8 8 0 0 1-13.6 3.4L4 16" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M20.6 3.5V9H15zM3.4 20.5V15H9z" fill="#fff"/></svg>';

  function cardHTML(c, i, n) {
    const two = c.kind === 'autorunoff' && c.candidates.length > 1, cols = c.candidates.map(x => CG_deepen(x.color));
    const bg = two ? `linear-gradient(100deg, ${cols[0]}, ${cols[1] || cols[0]})` : (cols[0] || '#444');
    const face = x => `<figure class="ca-face"><span class="ca-ring"><img src="${esc(x.photo)}" alt="${esc(x.name)}"></span><span class="ca-badge" style="color:${ink(x.color)}">${esc(x.partyLabel)}</span></figure>`;
    const pill = two ? `<span class="ca-pill two">${CHECK}<span>Projected<br>Autorunoff</span></span>` : `<span class="ca-pill">${CHECK}<span>Projected winner</span></span>`;
    const names = two ? `<span>${esc(c.candidates[0].name)}</span><i>and</i><span>${esc(c.candidates[1].name)}</span>` : `<span>${esc(c.candidates[0].name)}</span>`;
    return `<div class="ca-card${two ? ' is-two' : ''}" style="--bg:${bg}">
      <div class="ca-field">
        <button type="button" class="ca-x" data-act="close" aria-label="Close race call">✕</button>
        <div class="ca-head"><span class="ca-kick"><i></i>Race call</span><h2 class="ca-title" id="caTitle">${esc(c.title)}</h2><div class="ca-sub">${esc(c.subtitle)}</div></div>
        <div class="ca-pills">${c.flip ? `<span class="ca-flip">${FLIP}<span>FLIP</span></span>` : ''}${pill}</div>
        <div class="ca-faces">${c.candidates.map(face).join(two ? '<b class="ca-plus" aria-hidden="true"></b>' : '')}</div>
        <div class="ca-name">${names}</div>
      </div>
      ${footHTML(c, i, n)}
    </div>`;
  }
  function footHTML(c, i, n) {
    const nav = n > 1 ? `<span class="ca-count">${i + 1} / ${n}</span>` : '';
    const next = n > 1 && i < n - 1 ? `<button type="button" class="ca-btn cream" data-act="next">Next call →</button>` : `<a class="ca-btn cream" href="${esc(BASE + c.href)}">Full results →</a>`;
    return `<div class="ca-foot"><img src="${esc(BASE)}assets/img/brand/ddtsr-full-logo.png" alt="Decision Desk TSR">${nav}<span class="ca-spacer"></span>
        <button type="button" class="ca-btn ghost" data-act="save">Save image</button>${next}</div>`;
  }

  function paint() {
    const c = queue[pos]; if (!c) return close();
    remember(c.id);
    const old = root.querySelector('.ca-card'); if (old) old.remove();
    root.insertAdjacentHTML('beforeend', cardHTML(c, pos, queue.length));
    const first = root.querySelector('.ca-btn.cream'); if (first) first.focus({ preventScroll: true });
  }

  async function save(btn) {
    const c = queue[pos]; if (!c) return;
    const label = btn.textContent; btn.textContent = 'Rendering…'; btn.disabled = true;
    try {
      const cv = document.createElement('canvas');
      await CG_render(cv, { title: c.title, subtitle: c.subtitle, kind: c.kind, flip: c.flip, logo: BASE + 'assets/img/brand/ddtsr-full-logo.png',
        candidates: c.candidates.map(x => ({ name: x.name, color: x.color, partyLabel: x.partyLabel, photo: x.photo })) });
      const a = document.createElement('a'); a.download = `${c.title}-${c.kind}-call.png`.replace(/\s+/g, '-').toLowerCase(); a.href = cv.toDataURL('image/png'); a.click();
    } catch (e) { console.warn('call image failed', e); }
    btn.textContent = label; btn.disabled = false;
  }

  function onClick(e) {
    if (e.target.classList.contains('ca-back')) return close();
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'close') close(); else if (b.dataset.act === 'next') { pos++; paint(); } else if (b.dataset.act === 'save') save(b);
  }
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), a[href]')]; if (!f.length) return;
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }

  function close() {
    if (!root) return;
    queue.slice(pos).forEach(c => remember(c.id));   // closing skips the rest of the queue
    const r = root; root = null; r.classList.add('out'); document.documentElement.classList.remove('ca-lock');
    document.removeEventListener('keydown', onKey); setTimeout(() => r.remove(), 220);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ }
  }

  function show(list) {
    if (root || !list.length) return;
    queue = list; pos = 0; lastFocus = document.activeElement;
    root = document.createElement('div'); root.className = 'ca'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'caTitle');
    root.innerHTML = '<div class="ca-back"></div><div class="ca-flash"></div>';
    root.addEventListener('click', onClick); document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('ca-lock'); document.body.appendChild(root); paint();
  }

  window.CA_init = function ({ calls, base, demo }) {
    BASE = base || './'; DEMO = !!demo; CALLS = calls || [];
    const s = DEMO ? [] : seen(), todo = CALLS.filter(c => c.fresh && !s.includes(c.id)).slice(0, CA_MAX);
    if (todo.length) setTimeout(() => show(todo), 700);
  };
  window.CA_setCalls = function (calls) { CALLS = calls || []; };
  /** A call that goes up while the page is open (live refresh): pops straight away, or joins the queue if the alert is already showing. */
  window.CA_push = function (call) {
    remember(call.id);
    if (!root) return show([call]);
    queue.push(call); const f = root.querySelector('.ca-foot'); if (f) f.outerHTML = footHTML(queue[pos], pos, queue.length);
  };
  window.CA_open = function (id) { const c = CALLS.find(x => x.id === id); if (c) show([c]); };
})();
