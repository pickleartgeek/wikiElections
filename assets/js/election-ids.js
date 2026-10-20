/**
 * Election IDs.
 * -------------
 * ONE scheme everywhere (data/elections/<id>.json, polls-index, tsrelects-results,
 * plain-results, site-config, ?election= links):
 *
 *     class<N>-<YYYY>-<MM>        e.g.  class7-2026-09   (Class 7, September 2026)
 *
 * N = seat class, YYYY-MM = the election's nominal month (the month in its title, which can
 * differ from the exact vote date by a few days). Lowercase, no spaces, sorts chronologically.
 * Two elections of the same class in the same month would need a suffix (class5-2026-04-special).
 *
 * EID_LEGACY maps every ID the site used before the rename, so old bookmarks, shared
 * ?election= links and admin overrides saved in a browser keep working.
 */
const EID_PATTERN = /^class(\d+)-(\d{4})-(\d{2})(?:-[a-z0-9]+)?$/;
const EID_LEGACY = {
  "class1-sept": "class1-2025-09",
  "class2-july": "class2-2025-07",
  "class3-jan": "class3-2026-01",
  "class4-april": "class4-2026-04",
  "class4-march": "class4-2026-03",
  "class5-april": "class5-2026-04",
  "class5-june": "class5-2026-06",
  "class5-sept": "class5-2025-09",
  "class6": "class6-2026-07",
  "class7-26": "class7-2026-09",
  "class7-july": "class7-2025-07",
  "Class 6 July": "class6-2026-07",
  "Class 4": "class4-2026-04",
  "Class 5": "class5-2026-04",
  "Class 4 March": "class4-2026-03",
  "Class 5 September": "class5-2025-09",
  "Class 1 September": "class1-2025-09",
  "Class 2 July": "class2-2025-07",
  "Class 7 July": "class7-2025-07",
  "Class 6 June": "class6-2025-06",
  "class3-apr25": "class3-2025-04",
  "class4-may25": "class4-2025-05",
  "class5-jun25": "class5-2025-06",
  "class2-nov25": "class2-2025-11",
  "class3-jan26": "class3-2026-01",
  "class5-jun26": "class5-2026-06"
};

/** Any known ID (current or legacy) -> the canonical ID. Unknown strings come back unchanged. */
function EID_canon(id) {
  if (id == null) return id;
  const s = String(id).trim();
  if (EID_PATTERN.test(s)) return s;
  return EID_LEGACY[s] || EID_LEGACY[s.replace(/\s+/g, ' ')] || s;
}

/** 'class7-2026-09' -> { cls: 7, year: 2026, month: 9, sort: '2026-09' } (null if not a canonical ID). */
function EID_parse(id) {
  const m = EID_PATTERN.exec(String(id));
  return m ? { cls: +m[1], year: +m[2], month: +m[3], sort: m[2] + '-' + m[3] } : null;
}

/** 'class7-2026-09' -> 'Class 7 · Sep 2026' (short label for chips and dropdowns). */
function EID_label(id) {
  const p = EID_parse(id); if (!p) return String(id);
  return `Class ${p.cls} · ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][p.month - 1]} ${p.year}`;
}

/** Read ?election= from the URL, canonicalised; rewrites the address bar if it was a legacy ID. */
function EID_fromUrl(param) {
  try {
    const u = new URL(location.href), raw = u.searchParams.get(param || 'election');
    if (!raw) return null;
    const id = EID_canon(raw);
    if (id !== raw) { u.searchParams.set(param || 'election', id); history.replaceState(null, '', u); }
    return id;
  } catch (e) { return null; }
}

if (typeof window !== 'undefined') Object.assign(window, { EID_PATTERN, EID_LEGACY, EID_canon, EID_parse, EID_label, EID_fromUrl });
