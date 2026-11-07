/**
 * NightFX — the broadcast-style motion for the election-night windows.
 *
 *   NightFX.play(panel)   (re)plays every effect inside one stage panel; called each time a window comes on screen or is refreshed
 *
 * Driven by data attributes the channels render, so the markup is already correct without JS (and with reduced motion):
 *   .rs-bar i[data-w]          bar grows from 0 to its share
 *   [data-count]               number counts up from 0
 *   .rs-delta[data-to]         the ±% chip appears and ticks 0 -> change for about a second (green up, red down)
 *   .cl-card                   call cards stamp in one after another
 *   .mpv-svg path[data-fill]   groups sweep in left to right; data-chg paths (changed by a live update) flash
 */
const NightFX = (() => {
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches, ease = t => 1 - Math.pow(1 - t, 3);

  function run(el, dur, delay, step, done) {
    const token = el._fx = {}, t0 = performance.now() + delay;
    const frame = now => { if (el._fx !== token) return; const t = Math.min(1, Math.max(0, (now - t0) / dur)); step(ease(t)); if (t < 1) requestAnimationFrame(frame); else if (done) done(); };
    requestAnimationFrame(frame);
  }
  const arrow = d => d > 0 ? '▲ +' + d : d < 0 ? '▼ −' + Math.abs(d) : '– 0';

  function play(panel) {
    if (!panel || reduce()) return;
    panel.querySelectorAll('.rs-bar i[data-w]').forEach((b, i) => {
      b.style.transition = 'none'; b.style.width = '0%'; void b.offsetWidth;
      b.style.transition = `width 1.1s cubic-bezier(.2,.8,.2,1) ${120 + i * 90}ms`; b.style.width = b.dataset.w + '%';
    });
    panel.querySelectorAll('[data-count]').forEach(el => { const to = +el.dataset.count; el.textContent = '0'; run(el, 1100, 150, k => { el.textContent = Math.round(to * k); }, () => { el.textContent = to; }); });
    panel.querySelectorAll('.rs-delta[data-to]').forEach((el, i) => {
      const to = Math.round(+el.dataset.to), num = el.querySelector('b'), cls = to > 0 ? 'up' : to < 0 ? 'dn' : 'zero';
      el.className = 'rs-delta ' + cls; el.style.visibility = 'hidden'; num.textContent = arrow(0);
      setTimeout(() => { el.style.visibility = 'visible'; run(el, 1000, 0, k => { num.textContent = arrow(Math.round(to * k)); }, () => { num.textContent = arrow(to); }); }, 650 + i * 90);
    });
    panel.querySelectorAll('.cl-card').forEach((c, i) => { c.classList.remove('stamp'); c.style.setProperty('--d', i * 170 + 'ms'); void c.offsetWidth; c.classList.add('stamp'); });
    const paths = [...panel.querySelectorAll('.mpv-svg path[data-fill]')];
    if (paths.length) {
      paths.forEach(p => { p.style.transition = 'none'; p.style.fill = '#2a2e3a'; p.style.fillOpacity = '1'; p.classList.remove('flash'); });
      void panel.offsetWidth;
      const order = paths.map(p => { let x = 0; try { x = p.getBBox().x; } catch (e) { /* hidden */ } return [x, p]; }).sort((a, b) => a[0] - b[0]);
      order.forEach(([, p], i) => setTimeout(() => {
        p.style.transition = 'fill .65s ease, fill-opacity .65s ease'; p.style.fill = p.dataset.fill; p.style.fillOpacity = p.dataset.op;
        if (p.dataset.chg) { p.classList.add('flash'); delete p.dataset.chg; }
      }, 200 + i * 120));
    }
  }
  return { play };
})();
if (typeof window !== 'undefined') window.NightFX = NightFX;
