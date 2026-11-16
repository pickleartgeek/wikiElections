/* Atom feed builder — shared by the admin "Export feed.xml" button and tools/build-feed.js.
   FEED_build(articles, siteUrl, opts) -> Atom XML string. Only published (or schedule-passed) articles. */
(function (root) {
  const x = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isPub = a => a && (a.published === true || a.published === 'true' || (a.publishAt && Date.parse(a.publishAt) <= Date.now()));
  const iso = d => { const t = Date.parse(d); return isNaN(t) ? new Date(0).toISOString() : new Date(t).toISOString(); };
  function plain(h) { return String(h || '').replace(/<figure[\s\S]*?<\/figure>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
  function FEED_build(articles, siteUrl, opts) {
    opts = opts || {};
    const base = String(siteUrl || '').replace(/\/?$/, '/');
    const list = (articles || []).filter(isPub).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, opts.limit || 30);
    const upd = list.length ? iso(list[0].date) : new Date().toISOString();
    const out = ['<?xml version="1.0" encoding="utf-8"?>', '<feed xmlns="http://www.w3.org/2005/Atom">',
      `<title>${x(opts.title || 'wikiElections — Articles')}</title>`,
      `<subtitle>${x(opts.subtitle || 'Analysis and updates from wikiElections')}</subtitle>`,
      `<link href="${x(base)}articles"/>`, `<link rel="self" type="application/atom+xml" href="${x(base)}feed.xml"/>`,
      `<id>${x(base)}</id>`, `<updated>${upd}</updated>`];
    list.forEach(a => {
      const url = base + 'article?id=' + encodeURIComponent(a.id), txt = plain(a.bodyHtml);
      out.push('<entry>', `<title>${x(a.title)}</title>`, `<link href="${x(url)}"/>`, `<id>${x(url)}</id>`,
        `<updated>${iso(a.publishAt && !a.published ? a.publishAt : a.date)}</updated>`,
        a.author ? `<author><name>${x(a.author)}</name></author>` : '',
        `<summary>${x(a.byline || txt.slice(0, 280))}</summary>`, '</entry>');
    });
    out.push('</feed>');
    return out.filter(Boolean).join('\n') + '\n';
  }
  root.FEED_build = FEED_build;
  if (typeof module !== 'undefined') module.exports = { FEED_build };
})(typeof window !== 'undefined' ? window : globalThis);
