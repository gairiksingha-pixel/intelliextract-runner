// SVG Icons
const ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const ICON_EXTRACT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8h8"/><path d="M7 12h10"/><path d="M7 16h6"/></svg>`;
const ICON_PIPELINE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4"/><path d="M14 12h4"/><circle cx="12" cy="12" r="2"/></svg>`;
const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;margin-right:6px"><path d="M5 3l14 9-14 9V3z"/></svg>`;
const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:14px;height:14px;margin-right:6px"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>`;
const ICON_RESUME = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px"><polygon points="5 3 19 12 5 21 5 3"></polygon><line x1="5" y1="3" x2="5" y2="21"></line></svg>`;

let BRAND_PURCHASERS = window.BRAND_PURCHASERS || {};
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

function formatPurchaserName(p) {
  if (!p) return "";
  return p
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function getPlaceholderText(caseId) {
  if (caseId === "P1")
    return "Ready for sync. Select filters and click Start Sync.";
  if (caseId === "P2")
    return "Ready for extraction. Select filters and click Start Operation.";
  if (caseId === "PIPE")
    return "Ready for full pipeline. Select filters and click Sync & Operation.";
  return "Ready.";
}

function getRunButtonLabel(caseId) {
  if (caseId === "P1") return "Start Sync";
  if (caseId === "P2") return "Start Operation";
  if (caseId === "PIPE") return "Sync & Operation";
  return "Run";
}

function renderRow(c) {
  const tr = document.createElement("tr");
  tr.setAttribute("data-case-id", c.id);

  // Op Name
  const opTd = document.createElement("td");
  opTd.className = "op-name";
  opTd.innerHTML = `
    <div class="op-content-wrap">
      <div class="op-icon-wrap">${c.iconHtml}</div>
      <span class="op-title">${c.title}</span>
      <span class="op-description">${c.description}</span>
    </div>
  `;
  tr.appendChild(opTd);

  // Limits
  const limitsTd = document.createElement("td");
  limitsTd.className = "limits-col";
  let limHtml = '<div class="limit-row">';
  if (c.limits.pipeline || c.limits.sync) {
    limHtml += `<div class="limit-chip"><span class="limit-label">Sync:</span><input type="number" class="limit-sync" value="0" min="0"></div>`;
  }
  if (c.limits.pipeline || c.limits.extract) {
    limHtml += `<div class="limit-chip"><span class="limit-label">Extract:</span><input type="number" class="limit-extract" value="0" min="0"></div>`;
  }
  limHtml += "</div>";
  limitsTd.innerHTML = limHtml;
  tr.appendChild(limitsTd);

  // Parameters (Filters)
  const paramsTd = document.createElement("td");
  paramsTd.className = "params-col";
  paramsTd.textContent = "Using Global Filters";
  tr.appendChild(paramsTd);

  // Actions
  const actionsTd = document.createElement("td");
  actionsTd.className = "actions-col";
  const btnGroup = document.createElement("div");
  btnGroup.className = "btn-group";

  const runBtn = document.createElement("button");
  runBtn.className = "btn-primary run";
  runBtn.innerHTML = `${ICON_PLAY}<span>${getRunButtonLabel(c.id)}</span>`;
  runBtn.onclick = () => runCase(c.id, runBtn);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn-secondary reset-case";
  resetBtn.innerHTML = `${ICON_RESET}<span>Reset</span>`;
  resetBtn.onclick = () => resetCase(c.id);

  btnGroup.appendChild(runBtn);
  btnGroup.appendChild(resetBtn);
  actionsTd.appendChild(btnGroup);
  tr.appendChild(actionsTd);

  // Status
  const statusTd = document.createElement("td");
  statusTd.className = "status-col";
  const resultDiv = document.createElement("div");
  resultDiv.id = `result-${c.id}`;
  resultDiv.className = "result result-placeholder";
  resultDiv.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(c.id)}</span>`;
  statusTd.appendChild(resultDiv);
  tr.appendChild(statusTd);

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

function handleStreamData(caseId, data) {
  const div = document.getElementById(`result-${caseId}`);
  if (!div) return;

  if (data.type === "log") {
    div.innerHTML = `<span class="exit">${escapeHtml(data.message)}<span class="loading-dots"></span></span>`;
  } else if (data.type === "progress") {
    const pct = data.percent || 0;
    const label = data.phase === "sync" ? "Synchronizing…" : "Extracting…";
    div.innerHTML = `
      <div class="sync-progress-wrap">${label} ${data.done} / ${data.total}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill" style="width:${pct}%"></div></div>
    `;
  } else if (data.type === "report") {
    div.className = "result pass";
    div.innerHTML = `
      <div class="report-summary">
        <strong>Operation Successful</strong>
        <div>Extracted: ${data.successCount} files</div>
        <div>Latency: ${data.avgLatency}ms avg</div>
      </div>
    `;
  } else if (data.type === "error") {
    div.className = "result fail";
    div.innerHTML = `<span class="exit">Error: ${escapeHtml(data.message)}</span>`;
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

function resetCase(caseId) {
  const resultDiv = document.getElementById(`result-${caseId}`);
  resultDiv.className = "result result-placeholder";
  resultDiv.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(caseId)}</span>`;
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

function initNotificationModal() {
  const overlay = document.getElementById("email-modal-overlay");
  const closeIcon = document.getElementById("email-modal-close-icon");
  const cancelBtn = document.getElementById("email-modal-cancel-btn");
  const saveBtn = document.getElementById("email-modal-save-btn");
  const emailInput = document.getElementById("recipient-email");

  const close = () => {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  };

  window.openNotificationSettings = () => {
    fetch("/api/email-config")
      .then((r) => r.json())
      .then((data) => {
        if (data.recipientEmail) emailInput.value = data.recipientEmail;
        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
      })
      .catch((e) => {
        console.warn("Failed to load config", e);
        overlay.classList.add("open");
      });
  };

  if (closeIcon) closeIcon.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;

  if (saveBtn) {
    saveBtn.onclick = () => {
      const email = emailInput.value.trim();
      saveBtn.disabled = true;
      saveBtn.innerHTML = "<span>Saving...</span>";

      fetch("/api/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: email }),
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
  const brands = Object.keys(BRAND_PURCHASERS).sort();
  panel.innerHTML = brands
    .map(
      (b) => `
    <label class="filter-dropdown-option">
      <input type="checkbox" value="${escapeHtml(b)}" ${SELECTED_BRANDS.includes(b) ? "checked" : ""}>
      <span>${escapeHtml(b)}</span>
    </label>
  `,
    )
    .join("");

  panel.querySelectorAll("input").forEach((input) => {
    input.onchange = () => {
      if (input.checked) SELECTED_BRANDS.push(input.value);
      else SELECTED_BRANDS = SELECTED_BRANDS.filter((v) => v !== input.value);
      updateDropdownTriggers();
      renderPurchaserOptions(
        document.getElementById("purchaser-dropdown-panel"),
      );
    };
  });
}

function renderPurchaserOptions(panel) {
  if (!panel) return;
  const available =
    SELECTED_BRANDS.length === 0
      ? ALL_PURCHASERS
      : Array.from(
          new Set(SELECTED_BRANDS.flatMap((b) => BRAND_PURCHASERS[b] || [])),
        ).sort();

  panel.innerHTML = available
    .map(
      (p) => `
    <label class="filter-dropdown-option">
      <input type="checkbox" value="${escapeHtml(p)}" ${SELECTED_PURCHASERS.includes(p) ? "checked" : ""}>
      <span>${formatPurchaserName(p)}</span>
    </label>
  `,
    )
    .join("");

  panel.querySelectorAll("input").forEach((input) => {
    input.onchange = () => {
      if (input.checked) SELECTED_PURCHASERS.push(input.value);
      else
        SELECTED_PURCHASERS = SELECTED_PURCHASERS.filter(
          (v) => v !== input.value,
        );
      updateDropdownTriggers();
    };
  });
}

function updateDropdownTriggers() {
  const bt = document.getElementById("brand-dropdown-trigger");
  if (bt)
    bt.textContent =
      SELECTED_BRANDS.length === 0
        ? "Select brand"
        : SELECTED_BRANDS.length === 1
          ? SELECTED_BRANDS[0]
          : SELECTED_BRANDS.length + " selected";

  const pt = document.getElementById("purchaser-dropdown-trigger");
  if (pt)
    pt.textContent =
      SELECTED_PURCHASERS.length === 0
        ? "Select purchaser"
        : SELECTED_PURCHASERS.length === 1
          ? formatPurchaserName(SELECTED_PURCHASERS[0])
          : SELECTED_PURCHASERS.length + " selected";
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("rows");
  if (tbody) {
    ROWS.forEach((c) => tbody.appendChild(renderRow(c)));
  }

  // Populate ALL_PURCHASERS
  const set = new Set();
  Object.values(BRAND_PURCHASERS).forEach((arr) =>
    arr.forEach((p) => set.add(p)),
  );
  ALL_PURCHASERS = Array.from(set).sort();

  initDropdowns();
  initNotificationModal();
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
