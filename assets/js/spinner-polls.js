/**
 * SpinnerPolls
 * -------------
 * One poll -> one bar-chart card. Clicking the arrow expands a
 * spreadsheet-style table with the same data in tabular form
 * (share %, implied vote count from the sample size).
 */

let SP_cardCounter = 0;

function SpinnerPolls_renderCard(poll, candidateIds, registry) {
  const id = `sp-card-${SP_cardCounter++}`;
  const present = candidateIds.filter(cid => typeof poll.shares[cid] === 'number');
  const sorted = [...present].sort((a, b) => poll.shares[b] - poll.shares[a]);
  const maxShare = sorted.length ? poll.shares[sorted[0]] : 0;

  let barsHtml = '';
  sorted.forEach(cid => {
    const share = poll.shares[cid];
    const color = TSR_candidateColor(registry, cid);
    const name = TSR_candidateName(registry, cid);
    const widthPct = maxShare > 0 ? Math.max((share / maxShare) * 100, 6) : 6;
    barsHtml += `
      <div class="sp-bar-row">
        <div class="sp-bar-label">${name}</div>
        <div class="sp-bar-track">
          <div class="sp-bar-fill" style="width:${widthPct}%; background:linear-gradient(90deg, ${color}, ${TSR_darkenHex(color, 0.3)});"></div>
        </div>
        <div class="sp-bar-pct">${(share * 100).toFixed(1)}%</div>
      </div>`;
  });

  let sheetRows = '';
  sorted.forEach(cid => {
    const share = poll.shares[cid];
    const impliedVotes = Math.round(share * poll.sample);
    sheetRows += `
      <tr>
        <td><span class="sp-swatch" style="background:${TSR_candidateColor(registry, cid)}"></span>${TSR_candidateName(registry, cid)}</td>
        <td>${(share * 100).toFixed(2)}%</td>
        <td>${impliedVotes}</td>
      </tr>`;
  });

  return `
    <div class="sp-card">
      <button class="sp-card-header" onclick="SpinnerPolls_toggle('${id}')">
        <div class="sp-card-meta">
          <div class="sp-card-pollster">${poll.pollster}</div>
          <div class="sp-card-sub">${poll.date} · n=${poll.sample}${poll.weight !== 1 ? ` · weight ${poll.weight}` : ''}</div>
        </div>
        <span class="sp-arrow" id="${id}-arrow">▸</span>
      </button>
      <div class="sp-bars">${barsHtml}</div>
      <div class="sp-sheet" id="${id}-sheet" style="display:none;">
        <table class="sp-sheet-table">
          <thead><tr><th>Candidate</th><th>Share</th><th>${poll.sample} Votes</th></tr></thead>
          <tbody>${sheetRows}</tbody>
        </table>
      </div>
    </div>`;
}

function SpinnerPolls_toggle(id) {
  const sheet = document.getElementById(`${id}-sheet`);
  const arrow = document.getElementById(`${id}-arrow`);
  const open = sheet.style.display !== 'none';
  sheet.style.display = open ? 'none' : 'block';
  arrow.textContent = open ? '▸' : '▾';
}

if (typeof window !== 'undefined') {
  window.SpinnerPolls_renderCard = SpinnerPolls_renderCard;
  window.SpinnerPolls_toggle = SpinnerPolls_toggle;
}
