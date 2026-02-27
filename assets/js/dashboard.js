// SVG Icons
const ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_EXTRACT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/></svg>`;
const ICON_PIPELINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4"/><path d="M14 12h4"/><circle cx="12" cy="12" r="2"/></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;margin-right:6px"><path d="M5 3l14 9-14 9V3z"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;margin-right:6px"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>`;
const ICON_RESUME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px"><polygon points="5 3 19 12 5 21 5 3"></polygon><line x1="5" y1="3" x2="5" y2="21"></line></svg>`;
const ICON_HISTORY = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const ICON_PLUS = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
const ICON_EDIT = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;
const ICON_DELETE = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const ICON_BACK = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
const ICON_CHEVRON_LEFT = `<svg style="width:14px;height:14px;display:inline-block;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
const ICON_CHEVRON_RIGHT = `<svg style="width:14px;height:14px;display:inline-block;vertical-align:middle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
const ICON_NOTIF = `<svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
const ICON_SCHED = `<svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const ICON_RETRY = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
const ICON_STOP = `<svg class="btn-icon-inline" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="0" style="width:14px;height:14px;margin-right:6px"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

let BRAND_PURCHASERS = {};
let ALL_PURCHASERS = [];
let SELECTED_BRANDS = [];
let SELECTED_PURCHASERS = [];

const ROWS = [
  {
    id: "P1",
    title: "Cloud Sync",
    description: "Synchronize cloud files to local",
    limits: { sync: true, extract: false },
    iconHtml: ICON_DOWNLOAD,
  },
  {
    id: "P2",
    title: "Extract",
    description: "Run extraction without cloud sync",
    limits: { sync: false, extract: true },
    iconHtml: ICON_EXTRACT,
  },
  {
    id: "PIPE",
    title: "Sync & Extract",
    description: "Full pipeline execution",
    limits: { pipeline: true },
    iconHtml: ICON_PIPELINE,
  },
];

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatBrandName(brandId) {
  if (!brandId) return "";
  var b = brandId.toLowerCase();
  if (b.includes("no-cow")) return "No Cow";
  if (b.includes("sundia")) return "Sundia";
  if (b.includes("tractor-beverage")) return "Tractor";
  if (b === "p3" || b === "pipe") return "PIPE";
  return brandId;
}

function formatPurchaserName(purchaserId) {
  if (!purchaserId) return "";
  var p = purchaserId.toLowerCase();
  if (p.includes("8c03bc63-a173-49d2-9ef4-d3f4c540fae8")) return "Temp 1";
  if (p.includes("a451e439-c9d1-41c5-b107-868b65b596b8")) return "Temp 2";
  if (p.includes("dot_foods")) return "DOT Foods";
  if (p === "640" || p === "641" || p.includes("640") || p.includes("641"))
    return "DMC";
  if (p === "843") return "HPI";
  if (p === "895") return "HPD";
  if (p === "897") return "HPM";
  if (p === "991") return "HPT";
  if (p.includes("kehe")) return "KeHE";
  if (p.includes("unfi")) return "UNFI";
  return purchaserId;
}

function getOrdinalSuffix(day) {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function formatDateWithSuffix(dateStr) {
  if (!dateStr) return "";
  var d = new Date(dateStr);
  // Extract parts in IST
  var dayFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
  });
  var monthFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    month: "short",
  });
  var yearFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
  });
  var timeFormatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  });

  var day = parseInt(dayFormatter.format(d));
  var month = monthFormatter.format(d);
  var year = yearFormatter.format(d);
  var timeStr = timeFormatter.format(d);

  return (
    day + getOrdinalSuffix(day) + " " + month + " " + year + ", " + timeStr
  );
}

function formatCronWithTime(cron) {
  if (!cron) return "";
  var parts = cron.trim().split(" ");
  if (parts.length >= 2) {
    var m = parseInt(parts[0], 10);
    var h = parseInt(parts[1], 10);
    if (!isNaN(m) && !isNaN(h)) {
      var displayHour = ((h + 11) % 12) + 1;
      var ampm = h < 12 ? "AM" : "PM";
      var minLabel = String(m).padStart(2, "0");
      return cron + " (" + displayHour + ":" + minLabel + " " + ampm + ")";
    }
  }
  return cron;
}

function updateModalTitle(text) {
  var el = document.getElementById("modal-title-text");
  if (el) el.textContent = text;
}

function renderWithTransition(body, html, direction) {
  if (!body) return;
  var dirClass = direction === "left" ? "slide-left" : "slide-right";
  body.innerHTML =
    '<div class="modal-screen-animate ' + dirClass + '">' + html + "</div>";
}

function renderPagination(container, total, page, limit, onPageClick) {
  if (!container) return;
  var totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }
  var html = "";
  html +=
    '<button class="pagination-btn" ' +
    (page === 1 ? "disabled" : "") +
    ' data-page="' +
    (page - 1) +
    '">' +
    ICON_CHEVRON_LEFT +
    " Previous</button>";

  var start = Math.max(1, page - 2);
  var end = Math.min(totalPages, page + 2);

  if (start > 1)
    html +=
      '<button class="pagination-btn" data-page="1">1</button><span>...</span>';
  for (var i = start; i <= end; i++) {
    html +=
      '<button class="pagination-btn ' +
      (i === page ? "active" : "") +
      '" data-page="' +
      i +
      '">' +
      i +
      "</button>";
  }
  if (end < totalPages)
    html +=
      '<span>...</span><button class="pagination-btn" data-page="' +
      totalPages +
      '">' +
      totalPages +
      "</button>";

  html +=
    '<button class="pagination-btn" ' +
    (page === totalPages ? "disabled" : "") +
    ' data-page="' +
    (page + 1) +
    '">Next ' +
    ICON_CHEVRON_RIGHT +
    "</button>";
  container.innerHTML = html;
  container.querySelectorAll(".pagination-btn").forEach(function (btn) {
    btn.onclick = function () {
      var p = parseInt(this.getAttribute("data-page"), 10);
      if (!isNaN(p)) onPageClick(p);
    };
  });
}

function getPlaceholderText(caseId) {
  if (caseId === "P1")
    return "Ready for cloud synchronization. Select brands/purchasers and click Start Sync.";
  if (caseId === "P2")
    return "Ready for data extraction. Select brands/purchasers and click Start Operation.";
  if (caseId === "PIPE")
    return "Ready for full synchronization and extraction. Select brands/purchasers and click Sync & Operation.";
  return "Ready to extract. Configure filters and click Run.";
}

function getRunButtonLabel(caseId) {
  if (caseId === "P1") return "Start Sync";
  if (caseId === "P2") return "Start Operation";
  if (caseId === "PIPE") return "Sync & Operation";
  return "Run";
}

function renderLimitsCell(c) {
  const lim = c.limits || { sync: false, extract: false, pipeline: false };
  if (!lim.sync && !lim.extract && !lim.pipeline) {
    return '<td class="limits-cell"><span class="n/a">—</span></td>';
  }
  var html = '<td class="limits-cell"><div class="limit-row">';
  if (lim.pipeline) {
    html +=
      '<div class="limit-chip"><span class="limit-label">Limit:</span><input type="number" class="limit-sync" min="0" step="1" value="0" title="Max files to sync; each is extracted in background as it is synced. 0 = no limit"></div>';
  } else {
    if (lim.sync) {
      html +=
        '<div class="limit-chip"><span class="limit-label">Sync:</span><input type="number" class="limit-sync" min="0" step="1" value="0" title="Max files to download. 0 = no limit"></div>';
    }
    if (lim.extract) {
      html +=
        '<div class="limit-chip"><span class="limit-label">Extract:</span><input type="number" class="limit-extract" min="0" step="1" value="0" title="Max files to extract. 0 = no limit"></div>';
    }
  }
  html += '</div><div class="limit-hint">0 = no limit</div></td>';
  return html;
}

function renderRow(c) {
  const tr = document.createElement("tr");
  tr.setAttribute("data-case-id", c.id);

  const resultCell = document.createElement("td");
  resultCell.className = "result-cell";
  const resultDiv = document.createElement("div");
  resultDiv.id = `result-${c.id}`;
  resultDiv.className = "result result-placeholder";
  resultDiv.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(c.id)}</span>`;
  resultCell.appendChild(resultDiv);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "run";
  btn.innerHTML = `${ICON_PLAY}<span>${getRunButtonLabel(c.id)}</span>`;
  btn.title = getRunButtonLabel(c.id);
  btn.onclick = () => runCase(c.id, btn, resultDiv);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "reset-case";
  resetBtn.innerHTML = `${ICON_RESET}<span>Reset</span>`;
  resetBtn.onclick = () => resetCase(resultDiv);

  let retryBtn = null;
  if (c.id === "P2") {
    retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "run retry-failed-btn";
    retryBtn.innerHTML = `${ICON_RETRY}<span>Retry Failed</span>`;
    retryBtn.title = "Only retry extractions that previously failed";
    retryBtn.onclick = () =>
      runCase(c.id, retryBtn, resultDiv, { retryFailed: true });
  }

  const resetDuringResumeBtn = document.createElement("button");
  resetDuringResumeBtn.type = "button";
  resetDuringResumeBtn.className = "reset-case reset-during-resume";
  resetDuringResumeBtn.innerHTML = `${ICON_RESET}<span>Reset</span>`;
  resetDuringResumeBtn.title = "Clear result and exit resume mode";
  resetDuringResumeBtn.onclick = () => {
    resetCase(resultDiv);
    resetDuringResumeBtn.classList.remove("show-during-resume");
    resetBtn.innerHTML = `${ICON_RESET}<span>Reset</span>`;
    resetBtn.onclick = () => resetCase(resultDiv);
  };

  tr.innerHTML = `
    <td class="op-name">
      <div class="op-content-wrap">
        <div class="op-icon-wrap">${c.iconHtml}</div>
        <span class="op-title">${escapeHtml(c.title)}</span>
        <span class="op-description">${escapeHtml(c.description)}</span>
      </div>
    </td>
    ${renderLimitsCell(c)}
    <td class="run-cell">
      <div class="btn-group">
        <div class="btn-row"></div>
      </div>
    </td>
  `;

  const btnRow = tr.querySelector(".btn-row");
  btnRow.appendChild(btn);
  if (retryBtn) btnRow.appendChild(retryBtn);
  btnRow.appendChild(resetBtn);
  btnRow.appendChild(resetDuringResumeBtn);
  tr.appendChild(resultCell);

  return tr;
}

async function runCase(caseId, btn) {
  const resultDiv = document.getElementById(`result-${caseId}`);
  const row = btn.closest("tr");
  const syncLimit = row.querySelector(".limit-sync")?.value || 0;
  const extractLimit = row.querySelector(".limit-extract")?.value || 0;

  btn.disabled = true;
  resultDiv.className = "result running";
  resultDiv.innerHTML =
    '<span class="exit">Starting process…<span class="loading-dots"></span></span>';

  try {
    const response = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId,
        syncLimit: parseInt(syncLimit),
        extractLimit: parseInt(extractLimit),
        tenant: SELECTED_BRANDS.length === 1 ? SELECTED_BRANDS[0] : null,
        purchaser:
          SELECTED_PURCHASERS.length === 1 ? SELECTED_PURCHASERS[0] : null,
        pairs: SELECTED_BRANDS.length > 0 ? getPairsForRun() : null,
      }),
    });

    if (!response.ok) throw new Error(await response.text());

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          handleStreamData(caseId, data);
        } catch (e) {
          console.error("Error parsing stream line:", e);
        }
      }
    }
  } catch (e) {
    resultDiv.className = "result fail";
    resultDiv.innerHTML = `<span class="exit">Error: ${escapeHtml(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function showResult(div, data, pass, options) {
  const resultClass = data ? (pass ? "pass" : "fail") : "running";
  div.className = "result " + resultClass;

  if (data) {
    if (data.type === "report") {
      div.innerHTML = `
        <div class="report-summary">
          <strong>Operation Successful</strong>
          <div>Extracted: ${data.successCount} files</div>
          <div>Latency: ${data.avgLatency}ms avg</div>
        </div>
      `;
    } else {
      div.innerHTML = `<span class="exit">${escapeHtml(data.message || (pass ? "Completed" : "Error"))}</span>`;
    }
    return;
  }

  const {
    syncProgress,
    extractionProgress,
    resumeSkipSyncProgress,
    resumeSkipExtractProgress,
    logMessage,
    caseId,
  } = options || {};
  let extra = "";

  if (resumeSkipSyncProgress && caseId !== "PIPE") {
    const skipSync = Number(resumeSkipSyncProgress.skipped) || 0;
    const skipSyncTotal = Number(resumeSkipSyncProgress.total) || 0;
    const skipSyncPct =
      skipSyncTotal > 0
        ? Math.min(100, Math.round((100 * skipSync) / skipSyncTotal))
        : 100;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping synced files: ${skipSync} / ${skipSyncTotal} skipped</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill" style="width:${skipSyncPct}%"></div></div>
    `;
  }

  if (resumeSkipExtractProgress) {
    const skipExt = Number(resumeSkipExtractProgress.skipped) || 0;
    const skipExtTotal = Number(resumeSkipExtractProgress.total) || 0;
    const skipExtPct =
      skipExtTotal > 0
        ? Math.min(100, Math.round((100 * skipExt) / skipExtTotal))
        : 100;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping extracted files: ${skipExt} / ${skipExtTotal} skipped</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill" style="width:${skipExtPct}%"></div></div>
    `;
  }

  if (syncProgress) {
    const done = Number(syncProgress.done) || 0;
    const total = Number(syncProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap">Runner is syncing file: ${total > 0 ? done + " / " + total : done + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${total > 0 && done === 0 ? "sync-progress-indeterminate" : ""}" style="width:${total > 0 ? pct : 40}%"></div></div>
    `;
  }

  if (extractionProgress) {
    const extDone = Number(extractionProgress.done) || 0;
    const extTotal = Number(extractionProgress.total) || 0;
    const extPct =
      extTotal > 0 ? Math.min(100, Math.round((100 * extDone) / extTotal)) : 0;
    extra += `
      <div class="sync-progress-wrap extraction-progress-wrap">Runner is extracting: ${extTotal > 0 ? extDone + " / " + extTotal : extDone + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${extTotal > 0 && extDone === 0 ? "sync-progress-indeterminate" : ""}" style="width:${extTotal > 0 ? extPct : 40}%"></div></div>
    `;
  }

  if (logMessage) {
    div.innerHTML = `<span class="exit">${escapeHtml(logMessage)}${extra}</span>`;
  } else {
    div.innerHTML = `${extra || '<span class="exit">Starting process…<span class="loading-dots"></span></span>'}`;
  }
}

function handleStreamData(caseId, data) {
  const div = document.getElementById(`result-${caseId}`);
  if (!div) return;

  if (data.type === "log") {
    showResult(div, null, false, { logMessage: data.message, caseId });
  } else if (data.type === "progress") {
    if (data.phase === "sync") {
      showResult(div, null, false, { syncProgress: data, caseId });
    } else {
      showResult(div, null, false, { extractionProgress: data, caseId });
    }
  } else if (data.type === "resume_skip") {
    if (data.phase === "sync") {
      showResult(div, null, false, { resumeSkipSyncProgress: data, caseId });
    } else {
      showResult(div, null, false, { resumeSkipExtractProgress: data, caseId });
    }
  } else if (data.type === "report") {
    showResult(div, data, true, { caseId });
  } else if (data.type === "error") {
    showResult(div, data, false, { caseId });
  }
}

function getPairsForRun() {
  const pairs = [];
  SELECTED_BRANDS.forEach((b) => {
    const allowed = BRAND_PURCHASERS[b] || [];
    if (SELECTED_PURCHASERS.length === 0) {
      allowed.forEach((p) => pairs.push({ tenant: b, purchaser: p }));
    } else {
      SELECTED_PURCHASERS.forEach((p) => {
        if (allowed.includes(p)) pairs.push({ tenant: b, purchaser: p });
      });
    }
  });
  return pairs;
}

function resetCase(div) {
  if (!div) return;
  const caseId = div.id.replace("result-", "");
  div.className = "result result-placeholder";
  div.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(caseId)}</span>`;
}

// Dropdown Management
function initDropdowns() {
  const brandTrigger = document.getElementById("brand-dropdown-trigger");
  const brandPanel = document.getElementById("brand-dropdown-panel");
  const purchaserTrigger = document.getElementById(
    "purchaser-dropdown-trigger",
  );
  const purchaserPanel = document.getElementById("purchaser-dropdown-panel");
  const resetBtn = document.getElementById("filter-reset-btn");

  if (brandTrigger && brandPanel) {
    renderBrandOptions(brandPanel);
    brandTrigger.onclick = (e) => {
      e.stopPropagation();
      brandPanel.classList.toggle("open");
      purchaserPanel?.classList.remove("open");
    };
  }

  if (purchaserTrigger && purchaserPanel) {
    renderPurchaserOptions(purchaserPanel);
    purchaserTrigger.onclick = (e) => {
      e.stopPropagation();
      purchaserPanel.classList.toggle("open");
      brandPanel?.classList.remove("open");
    };
  }

  if (resetBtn) {
    resetBtn.onclick = () => {
      SELECTED_BRANDS = [];
      SELECTED_PURCHASERS = [];
      renderBrandOptions(brandPanel);
      renderPurchaserOptions(purchaserPanel);
      updateDropdownTriggers();
    };
  }

  document.addEventListener("click", () => {
    brandPanel?.classList.remove("open");
    purchaserPanel?.classList.remove("open");
  });
}

let ALL_SCHEDULES = [];

function initNotificationModal() {
  const overlay = document.getElementById("notification-modal-overlay");
  const closeIcon = document.getElementById("notification-modal-close-icon");
  const cancelBtn = document.getElementById("notification-modal-cancel");
  const saveBtn = document.getElementById("notification-save-btn");
  const emailInput = document.getElementById("recipient-email-input");

  if (!overlay) return;

  const close = () => {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  };

  const openLogic = () => {
    fetch("/api/email-config")
      .then((r) => r.json())
      .then((data) => {
        if (emailInput && data.recipientEmail)
          emailInput.value = data.recipientEmail;
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
      })
      .catch((e) => {
        console.warn("Failed to load config, opening anyway:", e);
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
      });
  };

  window.openNotificationSettings = openLogic;

  if (closeIcon) closeIcon.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };

  if (saveBtn) {
    saveBtn.onclick = () => {
      const rawValue = emailInput ? emailInput.value.trim() : "";
      if (rawValue) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emails = rawValue
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean);
        for (const email of emails) {
          if (!emailRegex.test(email)) {
            showAppAlert(
              "Validation Error",
              `Invalid email address: ${email}`,
              true,
            );
            return;
          }
        }
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = "<span>Saving...</span>";

      fetch("/api/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: rawValue }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            showAppAlert(
              "Settings Saved",
              "Notification settings saved successfully!",
              false,
            );
            close();
          } else {
            showAppAlert("Save Failed", "Failed to save settings.", true);
          }
        })
        .catch((e) => showAppAlert("Error", e.message, true))
        .finally(() => {
          saveBtn.disabled = false;
          saveBtn.innerHTML = "<span>Save Settings</span>";
        });
    };
  }
}

function renderBrandOptions(panel) {
  if (!panel) return;
  var brands = Object.keys(BRAND_PURCHASERS).sort(function (a, b) {
    return formatBrandName(a).localeCompare(formatBrandName(b));
  });
  var allHtml =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"> <strong>All</strong></label>';
  panel.innerHTML =
    allHtml +
    brands
      .map(function (b) {
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          escapeHtml(b) +
          '" ' +
          (SELECTED_BRANDS.includes(b) ? "checked" : "") +
          "> " +
          escapeHtml(formatBrandName(b)) +
          "</label>"
        );
      })
      .join("");

  attachSelectAll(panel.id, function () {
    const inputs = panel.querySelectorAll(
      'input[type=checkbox]:not([value="ALL"])',
    );
    SELECTED_BRANDS = Array.from(inputs)
      .filter((i) => i.checked)
      .map((i) => i.value);
    updateDropdownTriggers();
    renderPurchaserOptions(document.getElementById("purchaser-dropdown-panel"));
  });
}

function renderPurchaserOptions(panel) {
  if (!panel) return;
  const available =
    SELECTED_BRANDS.length === 0
      ? ALL_PURCHASERS
      : Array.from(
          new Set(SELECTED_BRANDS.flatMap((b) => BRAND_PURCHASERS[b] || [])),
        ).sort(function (a, b) {
          var nameA = formatPurchaserName(a).toLowerCase();
          var nameB = formatPurchaserName(b).toLowerCase();
          var isTempA = nameA.includes("temp");
          var isTempB = nameB.includes("temp");
          if (isTempA && !isTempB) return 1;
          if (!isTempA && isTempB) return -1;
          return nameA.localeCompare(nameB);
        });

  var allChecked =
    available.length > 0 &&
    available.every((p) => SELECTED_PURCHASERS.includes(p));
  var allHtml =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"' +
    (allChecked ? " checked" : "") +
    "> <strong>All</strong></label>";

  panel.innerHTML =
    allHtml +
    available
      .map(function (p) {
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          escapeHtml(p) +
          '" ' +
          (SELECTED_PURCHASERS.includes(p) ? "checked" : "") +
          "> " +
          escapeHtml(formatPurchaserName(p)) +
          "</label>"
        );
      })
      .join("");

  attachSelectAll(panel.id, function () {
    const inputs = panel.querySelectorAll(
      'input[type=checkbox]:not([value="ALL"])',
    );
    SELECTED_PURCHASERS = Array.from(inputs)
      .filter((i) => i.checked)
      .map((i) => i.value);
    updateDropdownTriggers();
  });
}

function updateDropdownTriggers() {
  const bt = document.getElementById("brand-dropdown-trigger");
  if (bt) {
    if (SELECTED_BRANDS.length === 0) {
      bt.textContent = "Select brand";
    } else if (SELECTED_BRANDS.length === 1) {
      bt.textContent = formatBrandName(SELECTED_BRANDS[0]);
    } else {
      const brands = Object.keys(BRAND_PURCHASERS);
      if (brands.length > 0 && SELECTED_BRANDS.length === brands.length) {
        bt.textContent = "All";
      } else {
        bt.textContent = SELECTED_BRANDS.length + " selected";
      }
    }
  }

  const pt = document.getElementById("purchaser-dropdown-trigger");
  if (pt) {
    if (SELECTED_PURCHASERS.length === 0) {
      pt.textContent = "Select purchaser";
    } else if (SELECTED_PURCHASERS.length === 1) {
      pt.textContent = formatPurchaserName(SELECTED_PURCHASERS[0]);
    } else {
      if (
        ALL_PURCHASERS.length > 0 &&
        SELECTED_PURCHASERS.length === ALL_PURCHASERS.length
      ) {
        pt.textContent = "All";
      } else {
        pt.textContent = SELECTED_PURCHASERS.length + " selected";
      }
    }
  }
}

function attachSelectAll(panelId, onToggle) {
  var panel = document.getElementById(panelId);
  if (!panel) return;
  var allCb = panel.querySelector('input[value="ALL"]');
  if (!allCb) return;
  var otherCbs = Array.from(
    panel.querySelectorAll('input[type=checkbox]:not([value="ALL"])'),
  );
  allCb.onchange = function () {
    var checked = allCb.checked;
    otherCbs.forEach(function (cb) {
      cb.checked = checked;
    });
    if (onToggle) onToggle();
  };
  otherCbs.forEach(function (cb) {
    cb.onchange = function () {
      allCb.checked =
        otherCbs.length > 0 &&
        otherCbs.every(function (c) {
          return c.checked;
        });
      if (onToggle) onToggle();
    };
  });
  if (otherCbs.length > 0) {
    allCb.checked = otherCbs.every(function (c) {
      return c.checked;
    });
  }
}

function initActionButtons() {
  const container = document.getElementById("header-actions");
  if (!container) return;

  function createBtn(id, iconHtml, label, title, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = id;
    btn.className = "header-action-btn";
    btn.title = title;
    btn.innerHTML = iconHtml + `<span>${label}</span>`;
    btn.onclick = onClick;
    container.appendChild(btn);
  }

  createBtn(
    "notification-settings-btn",
    ICON_NOTIF,
    "Alert Recipients",
    "Configure email notifications for failures",
    () => {
      initNotificationModal();
      window.openNotificationSettings && window.openNotificationSettings();
    },
  );

  createBtn(
    "header-schedule-btn",
    ICON_SCHED,
    "Manage Schedules",
    "Configure automated operations",
    () => {
      initScheduleModal();
      window.openScheduleModal && window.openScheduleModal();
    },
  );
}

function initScheduleModal() {
  var overlay = document.getElementById("schedule-modal-overlay");
  var body = document.getElementById("schedule-modal-body");
  var closeIcon = document.getElementById("schedule-modal-close-icon");
  if (!overlay || !body) return;

  function close() {
    if (overlay.classList.contains("closing")) return;
    overlay.classList.add("closing");
    overlay.setAttribute("aria-hidden", "true");
    setTimeout(function () {
      overlay.classList.remove("open");
      overlay.classList.remove("closing");
    }, 160);
  }

  window.closeScheduleModal = close;
  window.openScheduleModal = function () {
    overlay.classList.remove("closing");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    loadSchedulesIntoModal();
  };

  if (closeIcon) closeIcon.onclick = close;
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
}

function loadSchedulesIntoModal(direction) {
  fetch("/api/schedules")
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load schedules");
      return r.json();
    })
    .then(function (data) {
      ALL_SCHEDULES = data.schedules || [];
      ALL_SCHEDULES.sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      renderScheduleListView(
        {
          schedules: ALL_SCHEDULES,
          timezones: data.timezones || [],
        },
        direction,
      );
    })
    .catch(function () {
      renderScheduleListView({ schedules: [], timezones: ["UTC"] }, direction);
    });
}

function renderScheduleListView(state, direction) {
  updateModalTitle("Operation Dashboard");
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;
  var schedules =
    state && Array.isArray(state.schedules) ? state.schedules : [];
  var tz = state && Array.isArray(state.timezones) ? state.timezones : [];
  var html =
    '<div class="schedule-header-row"><div class="subtitle-chip">Configure automated periodic operations</div><div style="display:flex;gap:0.51rem;flex-wrap:wrap;"><button type="button" id="schedule-history-btn" class="btn-secondary">' +
    ICON_HISTORY +
    '<span>History</span></button><button type="button" id="schedule-create-btn" class="download-report-btn download-report-schedule-btn">' +
    ICON_PLUS +
    '<span>Create Operation</span></button></div></div><div style="flex:1;display:flex;flex-direction:column;min-height:0;">';
  if (!schedules.length) {
    html +=
      '<div class="schedule-empty">No active schedules. Start by creating an operation.</div>';
  } else {
    html +=
      '<div style="flex:1;overflow-y:auto;padding-right:4px;"><table class="schedule-list"><thead><tr><th>Brand Scope</th><th>Purchaser Scope</th><th>Operation Time</th><th>Timezone</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody>';
    schedules.forEach(function (s) {
      var brands =
        s.brands && s.brands.length
          ? s.brands.map(formatBrandName).join(", ")
          : "All Brands";
      var purchasers =
        s.purchasers && s.purchasers.length
          ? s.purchasers.map(formatPurchaserName).join(", ")
          : "All Purchasers";
      html +=
        "<tr data-sched-id='" +
        escapeHtml(s.id || "") +
        "'><td><strong>" +
        escapeHtml(brands) +
        "</strong></td><td>" +
        escapeHtml(purchasers) +
        "</td><td><span class='cron-tag'>" +
        escapeHtml(formatCronWithTime(s.cron)) +
        "</span></td><td>" +
        escapeHtml(s.timezone) +
        "</td><td>" +
        escapeHtml(formatDateWithSuffix(s.createdAt || "")) +
        '</td><td style="text-align:right"><div style="display:flex;justify-content:flex-end;gap:0.4rem;">' +
        '<button type="button" class="btn-secondary" data-sched-edit style="padding:0.4rem 0.6rem">' +
        ICON_EDIT +
        "</button>" +
        '<button type="button" class="btn-secondary" data-sched-delete style="padding:0.4rem 0.6rem;color:var(--fail)">' +
        ICON_DELETE +
        "</button>" +
        "</div></td></tr>";
    });
    html += "</tbody></table></div>";
  }
  html += "</div>";
  html +=
    '<div class="modal-footer"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Close window</button></div>';
  renderWithTransition(body, html, direction);
  var createBtn = document.getElementById("schedule-create-btn");
  if (createBtn) {
    createBtn.onclick = function () {
      renderScheduleCreateForm(tz, null, "right");
    };
  }
  var historyBtn = document.getElementById("schedule-history-btn");
  if (historyBtn) {
    historyBtn.onclick = function () {
      renderScheduleRunHistoryView("right");
    };
  }

  body.querySelectorAll("[data-sched-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tr = btn.closest("tr");
      var id = tr && tr.getAttribute("data-sched-id");
      if (!id) return;
      var sched = schedules.find(function (s) {
        return s.id === id;
      });
      if (!sched) return;
      renderScheduleCreateForm(tz, sched, "right");
    });
  });
  body.querySelectorAll("[data-sched-delete]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tr = btn.closest("tr");
      var id = tr && tr.getAttribute("data-sched-id");
      if (!id) return;
      showAppAlert(
        "Delete Schedule",
        "Are you sure you want to delete this schedule? This action cannot be undone.",
        {
          isConfirm: true,
          onConfirm: function () {
            deleteSchedule(id);
          },
        },
      );
    });
  });
}

function getSelectedScheduleBrands() {
  var panel = document.getElementById("sched-brand-dropdown-panel");
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll("input[type=checkbox]:checked:not([value='ALL'])"),
  ).map(function (cb) {
    return cb.value;
  });
}
function getSelectedSchedulePurchasers() {
  var panel = document.getElementById("sched-purchaser-dropdown-panel");
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll("input[type=checkbox]:checked:not([value='ALL'])"),
  ).map(function (cb) {
    return cb.value;
  });
}
function updateScheduleDropdownTrigger(type) {
  var trigger = document.getElementById(
    type === "brand"
      ? "sched-brand-dropdown-trigger"
      : "sched-purchaser-dropdown-trigger",
  );
  var panel = document.getElementById(
    type === "brand"
      ? "sched-brand-dropdown-panel"
      : "sched-purchaser-dropdown-panel",
  );
  var total = panel
    ? panel.querySelectorAll("input[type=checkbox]:not([value='ALL'])").length
    : 0;

  if (panel) {
    var allCb = panel.querySelector('input[value="ALL"]');
    if (allCb) {
      var otherCbs = Array.from(
        panel.querySelectorAll('input[type=checkbox]:not([value="ALL"])'),
      );
      allCb.checked =
        otherCbs.length > 0 &&
        otherCbs.every(function (c) {
          return c.checked;
        });
    }
  }

  if (!trigger) return;
  var selected =
    type === "brand"
      ? getSelectedScheduleBrands()
      : getSelectedSchedulePurchasers();
  if (selected.length === 0) {
    trigger.textContent =
      type === "brand" ? "Select brand" : "Select purchaser";
  } else if (selected.length === 1) {
    trigger.textContent =
      type === "brand"
        ? formatBrandName(selected[0])
        : formatPurchaserName(selected[0]);
  } else {
    if (total > 0 && selected.length === total) {
      trigger.textContent = "All";
    } else {
      trigger.textContent = selected.length + " selected";
    }
  }
}
function refreshSchedulePurchaserOptions() {
  var panel = document.getElementById("sched-purchaser-dropdown-panel");
  var trigger = document.getElementById("sched-purchaser-dropdown-trigger");
  if (!panel || !trigger) return;
  var brands = getSelectedScheduleBrands();
  var opts =
    brands.length === 0
      ? ALL_PURCHASERS
      : (function () {
          var set = new Set();
          brands.forEach(function (b) {
            (BRAND_PURCHASERS[b] || []).forEach(function (p) {
              set.add(p);
            });
          });
          return Array.from(set).sort(function (a, b) {
            var nameA = formatPurchaserName(a).toLowerCase();
            var nameB = formatPurchaserName(b).toLowerCase();
            var isTempA = nameA.includes("temp");
            var isTempB = nameB.includes("temp");
            if (isTempA && !isTempB) return 1;
            if (!isTempA && isTempB) return -1;
            return nameA.localeCompare(nameB);
          });
        })();
  var currentChecked = getSelectedSchedulePurchasers();
  var allChecked =
    opts.length > 0 &&
    opts.every(function (p) {
      return currentChecked.indexOf(p) !== -1;
    });
  var allHtml =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"' +
    (allChecked ? " checked" : "") +
    "> <strong>All</strong></label>";
  panel.innerHTML =
    allHtml +
    opts
      .map(function (p) {
        var checked = currentChecked.indexOf(p) !== -1 ? " checked" : "";
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          escapeHtml(p) +
          '"' +
          checked +
          "> " +
          escapeHtml(formatPurchaserName(p)) +
          "</label>"
        );
      })
      .join("");
  attachSelectAll("sched-purchaser-dropdown-panel", function () {
    updateScheduleDropdownTrigger("purchaser");
  });
  updateScheduleDropdownTrigger("purchaser");
}
function renderScheduleCreateForm(timezones, schedule, direction) {
  updateModalTitle(
    "Dashboard / " + (schedule ? "Edit Operation" : "New Operation"),
  );
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;
  var brands = Object.keys(BRAND_PURCHASERS || {}).sort(function (a, b) {
    var la = formatBrandName(a).toLowerCase();
    var lb = formatBrandName(b).toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  var tz = Array.isArray(timezones) && timezones.length ? timezones : ["UTC"];
  var brandOptions =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"> <strong>All</strong></label>' +
    brands
      .map(function (b) {
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          escapeHtml(b) +
          '"> ' +
          escapeHtml(formatBrandName(b)) +
          "</label>"
        );
      })
      .join("");
  var cronOptions = "";
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 5) {
      var displayHour = ((h + 11) % 12) + 1; // 0 -> 12, 13 -> 1
      var ampm = h < 12 ? "AM" : "PM";
      var minLabel = String(m).padStart(2, "0");
      var label = displayHour + ":" + minLabel + " " + ampm;
      var cronVal = String(m) + " " + String(h) + " * * *";
      cronOptions +=
        '<div class="filter-dropdown-option single-select" data-value="' +
        cronVal +
        '">' +
        escapeHtml(label) +
        "</div>";
    }
  }
  var tzOptions = tz
    .map(function (z) {
      return (
        '<div class="filter-dropdown-option single-select" data-value="' +
        escapeHtml(z) +
        '">' +
        escapeHtml(z) +
        "</div>"
      );
    })
    .join("");
  renderWithTransition(
    body,
    '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-form-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
      ICON_BACK +
      '<span>BACK</span></button><div class="subtitle-chip">' +
      (schedule
        ? "Edit operation parameters"
        : "Launch a new operation schedule") +
      "</div></div></div>" +
      '<div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:visible;padding-right:4px;">' +
      '<div class="schedule-form-grid">' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-brand-dropdown-trigger">Brand (optional)</label><div id="sched-brand-dropdown" class="filter-dropdown"><button type="button" id="sched-brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">Select brand</button><div id="sched-brand-dropdown-panel" class="filter-dropdown-panel" role="listbox">' +
      brandOptions +
      '</div></div><div class="schedule-hint">Leave empty to include all brands.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-purchaser-dropdown-trigger">Purchaser (optional)</label><div id="sched-purchaser-dropdown" class="filter-dropdown"><button type="button" id="sched-purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">Select purchaser</button><div id="sched-purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div></div><div class="schedule-hint">Leave empty to include all purchasers. Options update based on selected brands.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-cron-trigger">Run time (daily)</label><div id="sched-cron-dropdown" class="filter-dropdown"><input type="hidden" id="sched-cron"><button type="button" id="sched-cron-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">Select time</button><div id="sched-cron-panel" class="filter-dropdown-panel" role="listbox">' +
      cronOptions +
      '</div></div><div class="schedule-hint">Runs once per day at the selected time.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-tz-trigger">Timezone</label><div id="sched-tz-dropdown" class="filter-dropdown"><input type="hidden" id="sched-tz"><button type="button" id="sched-tz-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">Select timezone</button><div id="sched-tz-panel" class="filter-dropdown-panel" role="listbox">' +
      tzOptions +
      '</div></div><div class="schedule-hint">All runs use this timezone for the schedule.</div></div>' +
      "</div>" +
      '<div id="schedule-error" class="schedule-error"></div>' +
      "</div>" +
      '<div class="schedule-note-card">' +
      "<strong>⚠ Important Information:</strong> Ensure no other extraction operations are scheduled or active at this time. Manual processes or <strong>paused (Resume)</strong> states will cause this operation to be skipped to prevent data conflicts." +
      "</div>" +
      '<div class="modal-footer" style="border-top: none; padding-top: 0.5rem;"><button type="button" id="schedule-cancel-btn" class="btn-secondary">Discard</button><button type="button" id="schedule-save-btn" class="download-report-btn download-report-schedule-btn">' +
      "<span>" +
      (schedule ? "Update Changes" : "Launch Operation") +
      "</span>" +
      "</button></div>",
    direction || "right",
  );

  function updateDisabledCronOptions() {
    var cronPanel = document.getElementById("sched-cron-panel");
    var tzInput = document.getElementById("sched-tz");
    if (!cronPanel || !tzInput) return;
    var selectedTz = tzInput.value;
    var options = cronPanel.querySelectorAll(".filter-dropdown-option");
    options.forEach(function (opt) {
      var cronVal = opt.getAttribute("data-value");
      var inUse = ALL_SCHEDULES.some(function (s) {
        return (
          s.cron === cronVal &&
          s.timezone === selectedTz &&
          (!schedule || s.id !== schedule.id)
        );
      });
      if (inUse) {
        opt.classList.add("disabled");
        if (opt.textContent.indexOf(" (In Use)") === -1) {
          opt.textContent += " (In Use)";
        }
      } else {
        opt.classList.remove("disabled");
        opt.textContent = opt.textContent.replace(" (In Use)", "");
      }
    });
  }

  var tzEl = document.getElementById("sched-tz");
  if (tzEl) {
    tzEl.addEventListener("change", updateDisabledCronOptions);
  }
  updateDisabledCronOptions();

  refreshSchedulePurchaserOptions();
  var brandTrigger = document.getElementById("sched-brand-dropdown-trigger");
  var brandPanel = document.getElementById("sched-brand-dropdown-panel");
  var brandDropdown = document.getElementById("sched-brand-dropdown");
  var purchaserTrigger = document.getElementById(
    "sched-purchaser-dropdown-trigger",
  );
  var purchaserPanel = document.getElementById(
    "sched-purchaser-dropdown-panel",
  );
  var purchaserDropdown = document.getElementById("sched-purchaser-dropdown");
  var cronTrigger = document.getElementById("sched-cron-trigger");
  var cronPanel = document.getElementById("sched-cron-panel");
  var tzTrigger = document.getElementById("sched-tz-trigger");
  var tzPanel = document.getElementById("sched-tz-panel");

  function closeScheduleDropdowns() {
    if (brandPanel) brandPanel.classList.remove("open");
    if (purchaserPanel) purchaserPanel.classList.remove("open");
    if (cronPanel) cronPanel.classList.remove("open");
    if (tzPanel) tzPanel.classList.remove("open");
    if (brandTrigger) brandTrigger.setAttribute("aria-expanded", "false");
    if (purchaserTrigger)
      purchaserTrigger.setAttribute("aria-expanded", "false");
    if (cronTrigger) cronTrigger.setAttribute("aria-expanded", "false");
    if (tzTrigger) tzTrigger.setAttribute("aria-expanded", "false");
  }
  function toggleScheduleDropdown(panel, trigger) {
    var isOpen = panel && panel.classList.contains("open");
    closeScheduleDropdowns();
    if (!isOpen && panel && trigger) {
      panel.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    }
  }
  if (brandTrigger && brandPanel) {
    brandTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(brandPanel, brandTrigger);
    });
  }
  if (cronTrigger && cronPanel) {
    cronTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(cronPanel, cronTrigger);
    });
  }
  if (tzTrigger && tzPanel) {
    tzTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(tzPanel, tzTrigger);
    });
  }

  function initSingleSelectDropdown(panel, trigger, inputId, onSelect) {
    if (!panel || !trigger) return;
    var input = document.getElementById(inputId);
    panel.querySelectorAll(".filter-dropdown-option").forEach(function (opt) {
      opt.onclick = function (e) {
        e.stopPropagation();
        if (opt.classList.contains("disabled")) return;
        var val = opt.getAttribute("data-value");
        if (input) input.value = val;
        trigger.textContent = opt.textContent.replace(" (In Use)", "");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        if (onSelect) onSelect(val);
      };
    });
  }

  initSingleSelectDropdown(cronPanel, cronTrigger, "sched-cron");
  initSingleSelectDropdown(tzPanel, tzTrigger, "sched-tz", function () {
    updateDisabledCronOptions();
  });

  if (purchaserTrigger && purchaserPanel) {
    purchaserTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(purchaserPanel, purchaserTrigger);
    });
  }
  if (brandDropdown) {
    brandDropdown.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }
  if (purchaserDropdown) {
    purchaserDropdown.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }
  document.addEventListener("click", function () {
    closeScheduleDropdowns();
  });
  attachSelectAll("sched-brand-dropdown-panel", function () {
    updateScheduleDropdownTrigger("brand");
    refreshSchedulePurchaserOptions();
  });
  var backBtnHeader = document.getElementById("schedule-form-back-btn");
  if (backBtnHeader) {
    backBtnHeader.onclick = function () {
      loadSchedulesIntoModal("left");
    };
  }
  var cancelBtn = document.getElementById("schedule-cancel-btn");
  if (cancelBtn) {
    cancelBtn.onclick = function () {
      loadSchedulesIntoModal("left");
    };
  }
  var saveBtn = document.getElementById("schedule-save-btn");
  if (saveBtn) {
    saveBtn.onclick = function () {
      submitScheduleForm(schedule);
    };
  }
  if (schedule) {
    var cronInput = document.getElementById("sched-cron");
    var tzInput = document.getElementById("sched-tz");
    if (schedule.brands && schedule.brands.length) {
      schedule.brands.forEach(function (b) {
        var cb = brandPanel.querySelector(
          'input[type=checkbox][value="' + escapeHtml(b) + '"]',
        );
        if (cb) cb.checked = true;
      });
      updateScheduleDropdownTrigger("brand");
      refreshSchedulePurchaserOptions();
    }
    if (schedule.purchasers && schedule.purchasers.length) {
      schedule.purchasers.forEach(function (p) {
        var cb = purchaserPanel.querySelector(
          'input[type=checkbox][value="' + escapeHtml(p) + '"]',
        );
        if (cb) cb.checked = true;
      });
      updateScheduleDropdownTrigger("purchaser");
    }
    if (cronInput && schedule.cron) {
      cronInput.value = schedule.cron;
      var cronOpt = cronPanel.querySelector(
        '.filter-dropdown-option[data-value="' + schedule.cron + '"]',
      );
      if (cronOpt && cronTrigger)
        cronTrigger.textContent = cronOpt.textContent.replace(" (In Use)", "");
    }
    if (tzInput && schedule.timezone) {
      tzInput.value = schedule.timezone;
      var tzOpt = tzPanel.querySelector(
        '.filter-dropdown-option[data-value="' + schedule.timezone + '"]',
      );
      if (tzOpt && tzTrigger) tzTrigger.textContent = tzOpt.textContent;
    }
  }
}

function deleteSchedule(id) {
  fetch("/api/schedules/" + encodeURIComponent(id), {
    method: "DELETE",
  })
    .then(function (r) {
      if (!r.ok) {
        throw new Error("Failed to delete schedule");
      }
      loadSchedulesIntoModal("left");
    })
    .catch(function () {
      // Best effort
    });
}

function submitScheduleForm(schedule) {
  var cronEl = document.getElementById("sched-cron");
  var tzEl = document.getElementById("sched-tz");
  var errorEl = document.getElementById("schedule-error");
  if (!cronEl || !tzEl || !errorEl) return;
  var brands = getSelectedScheduleBrands();
  var purchasers = getSelectedSchedulePurchasers();
  var cron = (cronEl.value || "").trim();
  var timezone = (tzEl.value || "").trim();
  errorEl.textContent = "";
  if (brands.length === 0 && purchasers.length === 0) {
    errorEl.textContent = "Please select at least one brand or purchaser.";
    return;
  }
  if (!cron) {
    errorEl.textContent = "Run time is required.";
    return;
  }
  if (!timezone) {
    errorEl.textContent = "Timezone is required.";
    return;
  }
  // Final duplicate check
  var isDuplicate = ALL_SCHEDULES.some(function (s) {
    return (
      s.cron === cron &&
      s.timezone === timezone &&
      (!schedule || s.id !== schedule.id)
    );
  });
  if (isDuplicate) {
    errorEl.textContent =
      "A schedule for this time and timezone already exists.";
    return;
  }
  var url = "/api/schedules";
  var method = "POST";
  if (schedule && schedule.id) {
    url = "/api/schedules/" + encodeURIComponent(schedule.id);
    method = "PUT";
  }
  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brands: brands,
      purchasers: purchasers,
      cron: cron,
      timezone: timezone,
    }),
  })
    .then(function (r) {
      if (!r.ok) {
        return r.json().then(function (err) {
          throw new Error(
            err && err.error ? err.error : "Failed to save schedule",
          );
        });
      }
      return r.json();
    })
    .then(function () {
      loadSchedulesIntoModal("left");
    })
    .catch(function (e) {
      errorEl.textContent =
        e && e.message ? e.message : "Failed to save schedule.";
      errorEl.style.display = "block";
    });
}

function renderScheduleRunHistoryView(direction, page) {
  page = page || 1;
  updateModalTitle("Dashboard / Execution Logs");
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;

  // Initial loading state
  if (page === 1) {
    renderWithTransition(
      body,
      '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-log-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
        ICON_BACK +
        '<span>BACK</span></button><div class="subtitle-chip">Schedule execution logs</div></div></div><div class="schedule-empty">Loading history logs...</div><div class="modal-footer" style="margin-top:0.85rem; border-top:none;"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Cancel</button></div>',
      direction || "right",
    );
    var backBtn = document.getElementById("schedule-log-back-btn");
    if (backBtn) {
      backBtn.onclick = function () {
        loadSchedulesIntoModal("left");
      };
    }
  }

  fetch("/api/schedule-log?page=" + page + "&limit=15")
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load schedule log");
      return r.json();
    })
    .then(function (data) {
      var entries = data.entries || [];
      var html =
        '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-log-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
        ICON_BACK +
        '<span>BACK</span></button><div class="subtitle-chip">Schedule execution logs</div></div></div><div style="flex:1;display:flex;flex-direction:column;overflow-y:auto;padding-right:4px;">';
      if (!entries.length) {
        html +=
          '<div class="schedule-empty">No execution history found yet. Logs for operations will appear here.</div>';
      } else {
        html +=
          '<table class="schedule-list"><thead><tr><th>Time</th><th>Schedule ID</th><th>Outcome</th><th>Message</th></tr></thead><tbody>';
        entries.forEach(function (e) {
          var time = e.timestamp
            ? new Date(e.timestamp).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
              })
            : "—";
          var schedId =
            e.scheduleId != null ? String(e.scheduleId).slice(0, 20) : "";
          var outcome = (e.outcome || "executed").toLowerCase();
          var outcomeLabel = outcome === "skipped" ? "Skipped" : "Executed";
          var outcomeClass =
            outcome === "skipped"
              ? "schedule-outcome-skipped"
              : "schedule-outcome-executed";
          var msg = e.message || "";
          if (outcome === "executed") {
            if (e.exitCode === 0) {
              msg = "Operation completed successfully";
            } else if (e.exitCode != null) {
              msg = "Operation completed with issues";
            }
          }
          if (e.error) {
            msg += (msg ? " : " : "") + e.error;
          }
          html +=
            "<tr><td>" +
            escapeHtml(time) +
            "</td><td>" +
            escapeHtml(schedId) +
            '</td><td><span class="' +
            outcomeClass +
            '">' +
            escapeHtml(outcomeLabel) +
            "</span></td><td>" +
            escapeHtml(msg) +
            "</td></tr>";
        });
        html += "</tbody></table>";
        html +=
          '<div id="schedule-log-pagination" class="pagination-wrap"></div>';
      }
      html += "</div>";
      html +=
        '<div class="modal-footer" style="margin-top:0.85rem; border-top:none;"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Cancel</button></div>';

      // For page > 1, don't use transition
      if (page === 1) {
        renderWithTransition(body, html, direction || "right");
      } else {
        body.innerHTML = html;
      }

      renderPagination(
        document.getElementById("schedule-log-pagination"),
        data.total,
        data.page,
        data.limit,
        function (p) {
          renderScheduleRunHistoryView(null, p);
        },
      );

      backBtn = document.getElementById("schedule-log-back-btn");
      if (backBtn) {
        backBtn.onclick = function () {
          loadSchedulesIntoModal("left");
        };
      }
    })
    .catch(function () {
      // Error handling
    });
}

// Initialization Logic Updates
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("rows");
  if (tbody) {
    ROWS.forEach((c) => tbody.appendChild(renderRow(c)));
  }

  // Ensure data is synced from window
  BRAND_PURCHASERS = window.BRAND_PURCHASERS || {};

  // Populate ALL_PURCHASERS
  const set = new Set();
  Object.values(BRAND_PURCHASERS).forEach((arr) =>
    arr.forEach((p) => set.add(p)),
  );
  ALL_PURCHASERS = Array.from(set).sort();

  initDropdowns();
  initActionButtons();
  initNotificationModal();
  initScheduleModal();

  updateSystemStatus();
  setInterval(updateSystemStatus, 5000);
});

async function updateSystemStatus() {
  try {
    const res = await fetch("/api/active-runs");
    const data = await res.json();
    const statusText = document.getElementById("system-status-text");
    const pill = document.querySelector(".system-status-pill");

    if (statusText && pill) {
      if (data.activeRuns && data.activeRuns.length > 0) {
        statusText.textContent = "Runner is busy";
        pill.classList.add("busy");
        pill.classList.remove("offline");
      } else {
        statusText.textContent = "Runner is active";
        pill.classList.remove("busy");
        pill.classList.remove("offline");
      }
    }
  } catch (e) {
    const statusText = document.getElementById("system-status-text");
    const pill = document.querySelector(".system-status-pill");
    if (statusText && pill) {
      statusText.textContent = "System offline";
      pill.classList.add("offline");
    }
  }
}
