/* Article extras rendered at view time: footnotes -> numbered notes list, auto table of contents. */
function AB_render(root) {
  root = root || document.querySelector('.article-body'); if (!root) return;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // headings get ids (for the contents list)
  const used = {};
  root.querySelectorAll('h2, h3').forEach(h => {
    let id = (h.textContent || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    if (used[id]) id += '-' + (++used[id]); else used[id] = 1;
    if (!h.id) h.id = id;
  });
  root.querySelectorAll('.art-toc').forEach(t => {
    const hs = [...root.querySelectorAll('h2')];
    t.innerHTML = hs.length ? '<div class="art-toc-h">In this article</div><ol>' + hs.map(h => `<li><a href="#${esc(h.id)}">${esc(h.textContent)}</a></li>`).join('') + '</ol>' : '';
    t.hidden = !hs.length;
  });
  const notes = [...root.querySelectorAll('sup.fn[data-note]')];
  root.querySelectorAll('.art-notes').forEach(n => n.remove());
  if (!notes.length) return;
  notes.forEach((s, i) => { const n = i + 1; s.id = 'fnref-' + n; s.innerHTML = `<a href="#fn-${n}" aria-label="Note ${n}">${n}</a>`; });
  const box = document.createElement('section'); box.className = 'art-notes';
  box.innerHTML = '<h2>Notes &amp; sources</h2><ol>' + notes.map((s, i) => {
    const t = esc(s.getAttribute('data-note')).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener" target="_blank">$1</a>');
    return `<li id="fn-${i + 1}">${t} <a class="fn-back" href="#fnref-${i + 1}" aria-label="Back to text">↩</a></li>`;
  }).join('') + '</ol>';
  root.appendChild(box);
}
