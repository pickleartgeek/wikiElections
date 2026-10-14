/**
 * CallGraphic — renders a Decision Desk TSR "race call" graphic (1000 x 1333) to a <canvas>.
 *
 *   CG_render(canvas, spec)   spec = {
 *     title: 'Class 7', subtitle: 'moderator',
 *     kind: 'winner' | 'autorunoff', flip: false,
 *     candidates: [{ name, photo, color, partyLabel }],   // 1 for a winner call, 2 for an autorunoff
 *     bg: optional CSS colour that replaces the derived colour(s)
 *   }
 *   CG_candidateColor(registry, key)  party colour when the candidate has a party, their own colour if unaffiliated
 *   CG_candidateParty(registry, key)  short party label ("TSP", "UDC", "Ua.")
 *
 * Fonts: Oswald (assets/fonts) for the big type, Public Sans 800 for the badges.
 */
const CG_W = 1000, CG_H = 1333, CG_BAR = 100;
const CG_LOGO = '../assets/img/brand/ddtsr-full-logo.png';
const CG_CREAM = '#ffefaf', CG_CREAM_LINE = '#a49f88';
const CG_DISPLAY = "'Oswald','Arial Narrow','Archivo Black',Impact,sans-serif";
const CG_BADGE = "'Public Sans','Archivo Black',Arial,sans-serif";

function CG_candidateColor(registry, key) {
  const c = (registry.candidates || {})[key] || {};
  const party = c.party && c.party !== 'ua' ? (registry.parties || {})[c.party] : null;
  return party ? (party.callColor || party.color) : (c.color || '#444444');
}
function CG_candidateParty(registry, key) {
  const c = (registry.candidates || {})[key] || {};
  const party = c.party ? (registry.parties || {})[c.party] : null;
  return party ? (party.shortName || party.name) : 'Ua.';
}

function CG_rgb(css) {
  const t = document.createElement('canvas').getContext('2d'); t.fillStyle = '#000'; t.fillStyle = css;
  const v = t.fillStyle;
  if (v[0] === '#') { const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = v.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]];
}
const CG_lum = css => { const [r, g, b] = CG_rgb(css).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const CG_mix = (css, k) => { const [r, g, b] = CG_rgb(css); return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`; };

function CG_loadImage(src) {
  return new Promise(res => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
async function CG_fonts() {
  if (!document.fonts || !document.fonts.load) return;
  try { await Promise.all(["700 100px Oswald", "600 100px Oswald", "500 100px Oswald", "800 40px 'Public Sans'", "400 40px 'Archivo Black'"].map(f => document.fonts.load(f))); } catch (e) { /* fall back to system fonts */ }
}

/** font size that gives `cap` px of cap height, shrunk if the text would exceed maxW */
function CG_fit(ctx, text, weight, cap, maxW) {
  ctx.font = `${weight} 200px ${CG_DISPLAY}`;
  const ratio = (ctx.measureText('H').actualBoundingBoxAscent || 140) / 200;
  let size = cap / ratio;
  ctx.font = `${weight} ${size}px ${CG_DISPLAY}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) size *= maxW / w;
  return size;
}

function CG_check(ctx, cx, cy, s, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = s * 0.17; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx - s * 0.46, cy + s * 0.02); ctx.lineTo(cx - s * 0.14, cy + s * 0.36); ctx.lineTo(cx + s * 0.5, cy - s * 0.4); ctx.stroke(); ctx.restore();
}
function CG_flipIcon(ctx, cx, cy, r, color) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = r * 0.3; ctx.lineCap = 'round';
  [[0.15, 1.05], [1.15, 2.05]].forEach(([a0, a1]) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, a0 * Math.PI, a1 * Math.PI); ctx.stroke();
    const a = a1 * Math.PI, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, tx = -Math.sin(a), ty = Math.cos(a), nx = Math.cos(a), ny = Math.sin(a), h = r * 0.62;
    ctx.beginPath(); ctx.moveTo(x + tx * h, y + ty * h); ctx.lineTo(x + nx * h * 0.9, y + ny * h * 0.9); ctx.lineTo(x - nx * h * 0.9, y - ny * h * 0.9); ctx.closePath(); ctx.fill();
  });
  ctx.restore();
}
function CG_pill(ctx, x, y, w, h, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(h / 2, 36)); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.lineWidth = 3; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function CG_circleImage(ctx, img, cx, cy, r, fallback) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (img && img.width) {
    const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, cx - r, cy - r, r * 2, r * 2);
  } else { ctx.fillStyle = fallback || '#999'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  ctx.restore();
}
function CG_partyBadge(ctx, cx, cy, r, label, color) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  const ink = CG_lum(color) > 0.55 ? CG_mix(color, 0.5) : color;
  const size = CG_fit(ctx, label, 700, r * 0.95, r * 1.55);
  ctx.font = `700 ${size}px ${CG_DISPLAY}`; ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, cx, cy + (ctx.measureText('H').actualBoundingBoxAscent || size * 0.7) / 2);
}

async function CG_render(canvas, spec) {
  await CG_fonts();
  canvas.width = CG_W; canvas.height = CG_H;
  const ctx = canvas.getContext('2d'), cands = spec.candidates || [], two = spec.kind === 'autorunoff' && cands.length > 1;
  const cols = spec.bg ? [spec.bg] : cands.map(c => c.color);
  const bgCols = two ? [cols[0], cols[1] || cols[0]] : [cols[0] || '#444'];

  // background
  const areaH = CG_H - CG_BAR;
  if (two) { const g = ctx.createLinearGradient(0, 0, CG_W, 0); g.addColorStop(0, bgCols[0]); g.addColorStop(1, bgCols[1]); ctx.fillStyle = g; }
  else ctx.fillStyle = bgCols[0];
  ctx.fillRect(0, 0, CG_W, areaH);
  const avgLum = bgCols.reduce((a, c) => a + CG_lum(c), 0) / bgCols.length;
  const ink = avgLum > 0.5 ? '#111214' : '#ffffff';

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = ink;
  // title + subtitle
  const title = spec.title || 'Race', sub = spec.subtitle || '';
  let ts = CG_fit(ctx, title, 700, 195, 880); ctx.font = `700 ${ts}px ${CG_DISPLAY}`; ctx.fillText(title, CG_W / 2, 250);
  if (sub) {
    ctx.font = `600 100px ${CG_DISPLAY}`; const k = 296 / ctx.measureText('moderator').width;
    let ss = 100 * k; ctx.font = `600 ${ss}px ${CG_DISPLAY}`; const w = ctx.measureText(sub).width; if (w > 700) ss *= 700 / w;
    ctx.font = `600 ${ss}px ${CG_DISPLAY}`; ctx.fillText(sub, CG_W / 2, 312);
  }

  // badge(s)
  const bf = (px, wt = 800) => `${wt} ${px}px ${CG_BADGE}`;
  if (spec.kind === 'autorunoff') {
    ctx.font = bf(46); const tw = Math.max(ctx.measureText('PROJECTED').width, ctx.measureText('AUTORUNOFF').width);
    const w = 40 + 100 + 28 + tw + 40, x = (CG_W - w) / 2, y = 345, h = 120;
    CG_pill(ctx, x, y, w, h, CG_CREAM, CG_CREAM_LINE); CG_check(ctx, x + 40 + 50, y + h / 2, 86, '#111214');
    ctx.fillStyle = '#111214'; ctx.textAlign = 'left'; ctx.font = bf(46);
    ctx.fillText('PROJECTED', x + 168, y + 52); ctx.fillText('AUTORUNOFF', x + 168, y + 100); ctx.textAlign = 'center';
  } else {
    const label = 'PROJECTED WINNER'; ctx.font = bf(34); const tw = ctx.measureText(label).width;
    const pw = 22 + 55 + 22 + tw + 22, ph = 65, py = spec.flip ? 340 : 360;
    const fw = 295, gap = 32, total = spec.flip ? fw + gap + pw : pw;
    let x = (CG_W - total) / 2;
    if (spec.flip) {
      const g = ctx.createLinearGradient(x, 0, x + fw, 0); g.addColorStop(0, '#676ef7'); g.addColorStop(1, '#ed67ca');
      CG_pill(ctx, x, py, fw, ph, g, '#6d6a6a'); CG_flipIcon(ctx, x + 56, py + ph / 2, 19, '#fff');
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = bf(50); ctx.fillText('FLIP', x + 92, py + ph / 2 + 18);
      x += fw + gap;
    }
    CG_pill(ctx, x, py, pw, ph, CG_CREAM, CG_CREAM_LINE); CG_check(ctx, x + 22 + 27, py + ph / 2, 52, '#111214');
    ctx.fillStyle = '#111214'; ctx.textAlign = 'left'; ctx.font = bf(34); ctx.fillText(label, x + 22 + 55 + 22, py + ph / 2 + 12); ctx.textAlign = 'center';
  }

  // photos + party badges
  const imgs = await Promise.all(cands.map(c => CG_loadImage(c.photo)));
  if (two) {
    [[206, 0], [752, 1]].forEach(([cx, i]) => {
      const cy = 728, c = cands[i]; if (!c) return;
      ctx.beginPath(); ctx.arc(cx, cy, 186, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      CG_circleImage(ctx, imgs[i], cx, cy, 172, c.color);
      CG_partyBadge(ctx, cx + 159, cy + 102, 68, c.partyLabel, c.color);
    });
    ctx.fillStyle = ink; ctx.fillRect(461, 712, 78, 14); ctx.fillRect(493, 680, 14, 78);
  } else if (cands[0]) {
    const cx = 500, cy = 780;
    ctx.beginPath(); ctx.arc(cx, cy, 320, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    CG_circleImage(ctx, imgs[0], cx, cy, 304, cands[0].color);
    CG_partyBadge(ctx, 780, 962, 138, cands[0].partyLabel, cands[0].color);
  }

  // names
  ctx.textAlign = 'center'; ctx.fillStyle = ink;
  if (two) {
    const lines = [cands[0].name, 'and', cands[1].name], base = [1015, 1105, 1200];
    lines.forEach((t, i) => { const s = CG_fit(ctx, t, 500, 78, 840); ctx.font = `500 ${s}px ${CG_DISPLAY}`; ctx.fillText(t, CG_W / 2, base[i]); });
  } else if (cands[0]) {
    const s = CG_fit(ctx, cands[0].name, 500, 78, 840); ctx.font = `500 ${s}px ${CG_DISPLAY}`; ctx.fillText(cands[0].name, CG_W / 2, 1205);
  }

  // bottom bar + DDTSR logo
  ctx.fillStyle = '#000'; ctx.fillRect(0, areaH, CG_W, CG_BAR);
  const logo = await CG_loadImage(spec.logo || CG_LOGO);
  if (logo) { const h = 93, w = h * logo.width / logo.height; ctx.drawImage(logo, 24, areaH + 4, w, h); }
}

if (typeof window !== 'undefined') Object.assign(window, { CG_render, CG_candidateColor, CG_candidateParty });
