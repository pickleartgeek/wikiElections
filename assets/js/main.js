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

function renderChrome(cfg, base) {
  // mode pill in masthead, if present
  const pill = document.getElementById('modePill');
  if (pill) {
    pill.textContent = cfg.mode === 'active' ? 'Active Election' : 'Off-Cycle';
    pill.className = 'mode-pill ' + (cfg.mode === 'active' ? 'active' : 'off-cycle');
  }

  const slot = document.getElementById('dynamicBanner');
  if (!slot) return;

  if (cfg.mode === 'active') {
    slot.innerHTML = `
      <a class="breaking-banner" href="${base}${cfg.banner.link}">
        <div class="wrap">
          <span class="tag">${cfg.banner.eyebrow}</span>
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
        <a class="live-box" href="${base}${cfg.liveBox.link}">
          <div class="label">${cfg.liveBox.label}</div>
          <div class="body">${cfg.liveBox.text}</div>
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
