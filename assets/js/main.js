/**
 * Shared site chrome. Every page sets `window.SITE_BASE` (relative
 * path back to the repo root, e.g. "./" or "../") before loading this
 * script, then calls initSiteChrome().
 */
function initSiteChrome() {
  const base = window.SITE_BASE || './';
  fetch(base + 'data/site-config.json')
    .then(r => r.json())
    .then(cfg => {
      const merged = (typeof OVR_getSiteConfig === 'function') ? OVR_getSiteConfig(cfg) : cfg;
      renderChrome(merged, base);
    })
    .catch(() => { /* fail quiet: page still works without live chrome */ });
}

/** Every active race, as [{pollsId}]; falls back to the legacy single activePollsId. */
function SITE_activeList(cfg) {
  const l = Array.isArray(cfg.activeElections) ? cfg.activeElections.filter(e => e && e.pollsId) : [];
  return l.length ? l : (cfg.activePollsId ? [{ pollsId: cfg.activePollsId }] : []);
}

/** Elections live on TSR Elects right now: the explicit `electsIds` list, else the active races' ids (which match results ids for some races). */
function SITE_electsIds(cfg) {
  if (cfg.mode !== 'active') return [];
  if (Array.isArray(cfg.electsIds) && cfg.electsIds.length) return cfg.electsIds;
  return SITE_activeList(cfg).map(e => e.pollsId);
}

/** Where the banner / live box / hub button should send people: straight to the race when only one is live, else the TSR Elects chooser. */
function SITE_electsLink(cfg, base) {
  const ids = SITE_electsIds(cfg);
  if (ids.length === 1) return `${base}elects/?election=${encodeURIComponent(ids[0])}`;
  return base + 'elects/';
}

function renderChrome(cfg, base) {
  const nActive = Math.max(1, SITE_activeList(cfg).length);
  // mode pill in masthead, if present
  const pill = document.getElementById('modePill');
  if (pill) {
    pill.textContent = cfg.mode === 'active' ? (nActive > 1 ? nActive + ' Active Elections' : 'Active Election') : 'Off-Cycle';
    pill.className = 'mode-pill ' + (cfg.mode === 'active' ? 'active' : 'off-cycle');
  }

  const slot = document.getElementById('dynamicBanner');
  if (!slot) return;

  if (cfg.mode === 'active') {
    slot.innerHTML = `
      <a class="breaking-banner" href="${nActive > 1 ? base + 'elects/' : (SITE_electsIds(cfg).length === 1 ? SITE_electsLink(cfg, base) : base + cfg.banner.link)}">
        <div class="wrap">
          <span class="tag">${cfg.banner.eyebrow}${nActive > 1 ? ' · ' + nActive + ' RACES' : ''}</span>
          <span class="headline">${cfg.banner.headline}</span>
          <span class="sub">${cfg.banner.subtext}</span>
        </div>
      </a>`;
  } else {
    slot.innerHTML = `
      <div class="offcycle-strip">
        <div class="wrap"><span class="dot"></span> Site is currently in off-cycle mode — no elections are actively being called.</div>
      </div>`;
  }

  const heroSlot = document.getElementById('heroLiveSlot');
  if (heroSlot) {
    if (cfg.mode === 'active') {
      heroSlot.innerHTML = `
        <a class="live-box" href="${nActive > 1 ? base + 'elects/' : (SITE_electsIds(cfg).length === 1 ? SITE_electsLink(cfg, base) : base + cfg.liveBox.link)}">
          <div class="label">${nActive > 1 ? 'LIVE: ' + nActive + ' elections underway' : cfg.liveBox.label}</div>
          <div class="body">${nActive > 1 ? 'Follow every race as the results come in, live on TSR Elects.' : cfg.liveBox.text}</div>
        </a>`;
    } else {
      heroSlot.innerHTML = `
        <div class="offcycle-card">
          <h3>${cfg.offCycle.headline}</h3>
          <p>${cfg.offCycle.text}</p>
        </div>`;
    }
  }
}


/* ---------- Dark mode switch (theme is applied pre-paint by a tiny inline script in each <head>) ---------- */
(function initTheme() {
  function set(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('wE-theme', t); } catch (e) {} paint(); }
  function paint() {
    const b = document.getElementById('themeToggle'); if (!b) return;
    const d = document.documentElement.dataset.theme === 'dark';
    b.setAttribute('aria-checked', d); b.title = d ? 'Switch to light mode' : 'Switch to dark mode';
  }
  function mount() {
    const wrap = document.querySelector('.masthead .wrap'); if (!wrap || document.getElementById('themeToggle')) return;
    const b = document.createElement('button'); b.id = 'themeToggle'; b.className = 'theme-toggle'; b.type = 'button';
    b.setAttribute('role', 'switch'); b.setAttribute('aria-label', 'Dark mode');
    b.innerHTML = '<span class="tt-dots"><i></i><i></i><i></i></span><span class="tt-knob">' +
      '<svg class="tt-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="tt-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></span>';
    b.onclick = () => set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); wrap.appendChild(b); paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();

/* ---------- "More" menu: close on outside click / Escape / link click ---------- */
(function initNavMore() {
  function menus() { return document.querySelectorAll('details.nav-more'); }
  document.addEventListener('click', e => { menus().forEach(d => { if (d.open && !d.contains(e.target)) d.open = false; }); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menus().forEach(d => { if (d.open) { d.open = false; const s = d.querySelector('summary'); if (s) s.focus(); } }); });
})();

/* ---------- Dark-mode logos: swap in the dark wikiElections marks instead of boxing the light ones on white ---------- */
(function initLogos() {
  const MAP = { 'wikielections-mark.png': 'wikielections-mark-dark.png', 'wikielections-wordmark.png': 'wikielections-wordmark-dark.png' };
  function apply() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('img').forEach(img => {
      let src = img.getAttribute('src') || '';
      Object.keys(MAP).forEach(light => {
        if (dark && src.endsWith('/' + light) || dark && src === light) src = src.slice(0, src.length - light.length) + MAP[light];
        else if (!dark && src.endsWith(MAP[light])) src = src.slice(0, src.length - MAP[light].length) + light;
      });
      if (src !== img.getAttribute('src')) img.setAttribute('src', src);
      img.classList.toggle('logo-dark', /-dark\.png$/.test(src));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
