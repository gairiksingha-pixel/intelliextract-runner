// run-summary.js — Dynamic Run Summary page
// SUMMARY_DATA is injected by the server as window.SUMMARY_DATA
import { AppIcons } from "./icons.js";
import { AppUtils } from "./common.js";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getRecordFilename(r) {
  const safe = String(r.relativePath || r.filename || "")
    .replace(/[\\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  const base = (r.brand || "") + "_" + (safe || "file");
  return base.endsWith(".json") ? base : base + ".json";
}

async function downloadFile(path, btn) {
  if (!path) return;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = "...";
  btn.style.pointerEvents = "none";

  try {
    const isExtractionJson = path.includes("output/extractions/");
    const checkUrl = "/api/download-file?file=" + encodeURIComponent(path);

    // If it's an extraction JSON, we first try to find it in our local data
    // to avoid a Roundtrip if possible or if the file is missing from disk.
    if (isExtractionJson) {
      const filename = path.split("/").pop();
      // Try to find in SUMMARY_DATA
      if (window.SUMMARY_DATA) {
        for (const run of window.SUMMARY_DATA) {
          const er = (run.extractionResults || []).find(
            (e) => e.filename === filename,
          );
          if (er && er.response) {
            downloadDataLocally(er.response, filename);
            return;
          }
        }
      }
    }

    const response = await fetch(checkUrl, { method: "HEAD" });
    if (response.status === 404) {
      alert("The requested file was not found on the server.");
    } else if (!response.ok) {
      throw new Error("Download check failed");
    } else {
      // Create a temporary anchor to force download instead of just changing location.href
      const a = document.createElement("a");
      a.href = checkUrl;
      const fn = path.split(/[\\\/]/).pop() || "download";
      a.download = fn;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 200);
    }
  } catch (e) {
    alert("Failed to retrieve file: " + e.message);
  } finally {
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.style.pointerEvents = "auto";
    }, 300);
  }
}
window.downloadFile = downloadFile;

function downloadDataLocally(data, filename) {
  if (!data) return;
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  // Delay cleanup to ensure browser initiates the "Save As" handler
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}
window.downloadDataLocally = downloadDataLocally;

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const h = Math.floor(min / 60);
  if (h > 0) return `${h}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function formatRunDateTime(isoStr) {
  const d = new Date(isoStr);
  const istDate = new Date(
    d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const mon = MONTH_NAMES[istDate.getMonth()].toUpperCase();
  const day = istDate.getDate();
  const year = istDate.getFullYear();
  const h24 = istDate.getHours();
  const h12 = h24 % 12 || 12;
  const min = String(istDate.getMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${mon}-${day}-${year}-${String(h12).padStart(2, "0")}:${min}:${ampm}`;
}

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────
let ALL_DATA = [];
let selectedBrands = [];
let selectedPurchasers = [];
let currentStatusFilter = "all";
let currentSearch = "";
let historyPage = 1;
const historyPageSize = 20;
let chartInstances = {};

// Derived metadata
let BRANDS = [];
let PURCHASERS = [];
let BRAND_PURCHASER_MAP = {};

// ─────────────────────────────────────────────────────────────
// Conversions: HistoricalRunSummary → runData item
// ─────────────────────────────────────────────────────────────
function summaryToRunDataItem(s) {
  const m = s.metrics;
  const processed = m.success + m.failed + (m.skipped || 0);
  const throughput =
    s.runDurationSeconds > 0 ? (processed / s.runDurationSeconds) * 60 : 0;
  return {
    runId: s.runId,
    time: m.startedAt || s.start || new Date().toISOString(),
    success: m.success,
    failed: m.failed,
    skipped: m.skipped || 0,
    p50: m.p50LatencyMs || 0,
    p95: m.p95LatencyMs || 0,
    brand: s.brand || "",
    purchaser: s.purchaser || "",
    throughput,
    errors: {
      timeout: m.failureBreakdown?.timeout || 0,
      clientError: m.failureBreakdown?.clientError || 0,
      serverError: m.failureBreakdown?.serverError || 0,
      readError: m.failureBreakdown?.readError || 0,
      other: m.failureBreakdown?.other || 0,
    },
    status: m.failed > 0 ? "failed" : "success",
  };
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (!window.SUMMARY_DATA || !Array.isArray(window.SUMMARY_DATA)) return;

  ALL_DATA = window.SUMMARY_DATA;

  // Build metadata
  BRANDS = [...new Set(ALL_DATA.map((s) => s.brand).filter(Boolean))].sort();
  PURCHASERS = [
    ...new Set(ALL_DATA.map((s) => s.purchaser).filter(Boolean)),
  ].sort();
  BRAND_PURCHASER_MAP = {};
  ALL_DATA.forEach((s) => {
    if (!s.brand) return;
    if (!BRAND_PURCHASER_MAP[s.brand]) BRAND_PURCHASER_MAP[s.brand] = [];
    if (s.purchaser && !BRAND_PURCHASER_MAP[s.brand].includes(s.purchaser)) {
      BRAND_PURCHASER_MAP[s.brand].push(s.purchaser);
    }
  });

  initFilters();
  buildRunSections();

  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = "'JetBrains Mono', 'Consolas', monospace";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = "#5a5a5a";
  }

  const runData = ALL_DATA.map(summaryToRunDataItem);
  updateDashboardStats(runData);
  initCharts(runData);
  renderHistory();
  setupSmoothAccordion();
  handleDeepLinking();
});

// ─────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────
function initFilters() {
  const brandPanel = document.getElementById("brand-dropdown-panel");
  BRANDS.forEach((b) => {
    const div = document.createElement("div");
    div.className = "filter-dropdown-option";
    div.innerHTML = `<input type="checkbox" value="${escapeHtml(b)}"> <span>${escapeHtml(AppUtils.formatBrandName(b))}</span>`;
    div.onclick = (e) => {
      if (e.target.tagName !== "INPUT")
        div.querySelector("input").checked =
          !div.querySelector("input").checked;
      updateFilters();
    };
    brandPanel.appendChild(div);
  });

  const purchaserPanel = document.getElementById("purchaser-dropdown-panel");
  PURCHASERS.forEach((p) => {
    const div = document.createElement("div");
    div.className = "filter-dropdown-option";
    div.innerHTML = `<input type="checkbox" value="${escapeHtml(p)}"> <span>${escapeHtml(AppUtils.formatPurchaserName(p))}</span>`;
    div.onclick = (e) => {
      if (e.target.tagName !== "INPUT")
        div.querySelector("input").checked =
          !div.querySelector("input").checked;
      updateFilters();
    };
    purchaserPanel.appendChild(div);
  });

  document.querySelectorAll(".filter-dropdown-trigger").forEach((trigger) => {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const panel = trigger.parentElement.nextElementSibling;
      const isOpen = panel.classList.contains("open");
      closeAllPanels();
      if (!isOpen) panel.classList.add("open");
    };
  });

  document.addEventListener("click", closeAllPanels);

  document.querySelectorAll(".status-tab").forEach((btn) => {
    btn.onclick = () => {
      document
        .querySelectorAll(".status-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatusFilter = btn.getAttribute("data-filter");
      historyPage = 1;
      renderHistory();
    };
  });

  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.oninput = (e) => {
      currentSearch = e.target.value.toLowerCase();
      historyPage = 1;
      renderHistory();
    };
  }
}

function closeAllPanels() {
  document
    .querySelectorAll(".filter-dropdown-panel")
    .forEach((p) => p.classList.remove("open"));
}

function updateFilters() {
  selectedBrands = Array.from(
    document.querySelectorAll("#brand-dropdown-panel input:checked"),
  ).map((i) => i.value);
  selectedPurchasers = Array.from(
    document.querySelectorAll("#purchaser-dropdown-panel input:checked"),
  ).map((i) => i.value);

  const bTrigger = document.getElementById("brand-dropdown-trigger");
  bTrigger.innerText =
    selectedBrands.length === 0
      ? "Select brand"
      : selectedBrands.length === 1
        ? AppUtils.formatBrandName(selectedBrands[0])
        : selectedBrands.length + " Brands";

  const pTrigger = document.getElementById("purchaser-dropdown-trigger");
  pTrigger.innerText =
    selectedPurchasers.length === 0
      ? "Select purchaser"
      : selectedPurchasers.length === 1
        ? AppUtils.formatPurchaserName(selectedPurchasers[0])
        : selectedPurchasers.length + " Purchasers";

  // Cascading: disable purchasers not in selected brands
  document
    .querySelectorAll("#purchaser-dropdown-panel .filter-dropdown-option")
    .forEach((div) => {
      const input = div.querySelector("input");
      const possible =
        selectedBrands.length === 0 ||
        selectedBrands.some((b) =>
          BRAND_PURCHASER_MAP[b]?.includes(input.value),
        );
      div.style.opacity = possible ? "1" : "0.4";
      div.style.pointerEvents = possible ? "auto" : "none";
      if (!possible) input.checked = false;
    });

  applyFilteringToUI();
}

window.resetFilters = function () {
  document
    .querySelectorAll(".filter-dropdown-panel input")
    .forEach((i) => (i.checked = false));
  selectedBrands = [];
  selectedPurchasers = [];
  updateFilters();
};

function getFilteredRunData() {
  return ALL_DATA.map(summaryToRunDataItem).filter((d) => {
    if (selectedBrands.length > 0 && !selectedBrands.includes(d.brand))
      return false;
    if (
      selectedPurchasers.length > 0 &&
      !selectedPurchasers.includes(d.purchaser)
    )
      return false;
    return true;
  });
}

function applyFilteringToUI() {
  const filteredRunData = getFilteredRunData();
  updateDashboardStats(filteredRunData);
  initCharts(filteredRunData);

  let visibleCount = 0;
  document.querySelectorAll(".history-item").forEach((item) => {
    const b = item.getAttribute("data-brand");
    const p = item.getAttribute("data-purchaser");
    const match =
      (selectedBrands.length === 0 || selectedBrands.includes(b)) &&
      (selectedPurchasers.length === 0 || selectedPurchasers.includes(p));
    item.classList.toggle("filtered-out", !match);
    if (match) visibleCount++;
  });

  document.getElementById("operation-count-label").innerText =
    visibleCount + " operation(s)";
  historyPage = 1;
  renderHistory();
  updateStatusCounts();
}

function updateStatusCounts() {
  const activeItems = Array.from(
    document.querySelectorAll(".history-item:not(.filtered-out)"),
  );
  const cAll = document.getElementById("c-all");
  const cSucc = document.getElementById("c-succ");
  const cFail = document.getElementById("c-fail");
  if (cAll) cAll.innerText = activeItems.length;
  if (cSucc)
    cSucc.innerText = activeItems.filter(
      (i) => i.getAttribute("data-status") === "success",
    ).length;
  if (cFail)
    cFail.innerText = activeItems.filter(
      (i) => i.getAttribute("data-status") !== "success",
    ).length;
}

// ─────────────────────────────────────────────────────────────
// Build Run Sections (HTML)
// ─────────────────────────────────────────────────────────────
function buildRunSections() {
  const container = document.getElementById("history-items-container");
  if (!container) return;
  if (ALL_DATA.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 4rem 2rem; text-align: center; background: white; border-radius: 12px; border: 1px dashed #cbd5e1; margin: 1rem 0;">
        <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
        <h3 style="margin: 0 0 0.5rem 0; color: #1e293b; border-bottom: none;">No operation history found</h3>
        <p style="margin: 0; color: #64748b; font-size: 0.9rem;">Runs will appear here once you start synchronization or extraction from the dashboard.</p>
        <button class="pg-btn" style="margin-top: 1.5rem;" onclick="window.location.href='/'">Go to Dashboard</button>
      </div>
    `;
    return;
  }
  container.innerHTML = ALL_DATA.map(buildRunSection).join("");
}

function buildRunSection(s) {
  const m = s.metrics;
  const wallMs = (s.runDurationSeconds || 0) * 1000;
  const runDuration = formatDuration(wallMs);
  const processed = m.success + m.failed + (m.skipped || 0);
  const succeededCount = (s.extractionResults || []).filter(
    (e) => e.extractionSuccess,
  ).length;
  const displaySuccess = succeededCount;
  const displayInfraFailed = m.failed;
  const displayApiFailed = Math.max(0, m.success - displaySuccess);
  const status = m.failed > 0 ? "failed" : "success";
  const runTime = m.startedAt ? formatRunDateTime(m.startedAt) : "—";

  const throughput =
    s.runDurationSeconds > 0 ? (processed / s.runDurationSeconds) * 60 : 0;
  const totalApiTime = formatDuration(m.totalProcessingTimeMs || 0);
  const avgConc =
    wallMs > 0 ? (m.totalProcessingTimeMs / wallMs).toFixed(1) : "0.0";

  // Latency table
  const latencyTableRows = `
    <tr><td>Average</td><td><span class="chip">${(m.avgLatencyMs || 0).toFixed(2)}</span></td></tr>
    <tr><td>P50</td><td><span class="chip">${(m.p50LatencyMs || 0).toFixed(2)}</span></td></tr>
    <tr><td>P95</td><td><span class="chip">${(m.p95LatencyMs || 0).toFixed(2)}</span></td></tr>
    <tr><td>P99</td><td><span class="chip">${(m.p99LatencyMs || 0).toFixed(2)}</span></td></tr>
  `.trim();

  // Top slowest files
  const topSlowRows = (m.topSlowestFiles || [])
    .map((f) => {
      const jsonName = getRecordFilename(f);
      const sourcePath = `output/staging/${f.brand}/${f.relativePath}`;
      const jsonPath = `output/extractions/succeeded/${jsonName}`;
      return `
    <tr>
      <td class="file-path">${escapeHtml(f.filePath)}</td>
      <td>${f.latencyMs?.toFixed(0)}</td>
      <td>${escapeHtml(f.patternKey || "—")}</td>
      <td class="action-cell">
        <div style="display:flex;gap:4px;">
          <a href="javascript:void(0)" onclick="downloadFile('${sourcePath}', this)" class="action-btn" title="Download Source File">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          </a>
          <a href="javascript:void(0)" onclick="downloadFile('${jsonPath}', this)" class="action-btn" title="Download Extraction JSON">
            ${AppIcons.DOWNLOAD}
          </a>
        </div>
      </td>
    </tr>
  `;
    })
    .join("");
  const topSlowSection =
    m.topSlowestFiles?.length > 0
      ? `
    <h3>Top ${m.topSlowestFiles.length} slowest files (by processing time)</h3>
    <div class="table-responsive">
      <table>
        <tr><th>File</th><th>Latency (ms)</th><th>Pattern Key</th><th class="action-cell">Action</th></tr>
        ${topSlowRows}
      </table>
    </div>
  `
      : "";

  // Failure details
  const failDetailRows = (m.failureDetails || [])
    .map(
      (f) => `
    <tr>
      <td>${f.statusCode ?? "—"}</td>
      <td class="file-path">${escapeHtml(f.filePath)}</td>
      <td>${escapeHtml((f.errorMessage || "").trim() || "(no response body)")}</td>
    </tr>
  `,
    )
    .join("");
  const failDetailSection =
    failDetailRows.length > 0
      ? `
    <h3>Failure details (API response)</h3>
    <div class="table-responsive">
      <table class="failure-details-table">
        <tr><th style="width:80px">Status</th><th>File</th><th>Message snippet</th></tr>
        ${failDetailRows}
      </table>
    </div>
  `
      : "";

  // Anomalies
  const anomalyItems = (m.anomalies || []).map(
    (a) =>
      `<li><strong>${escapeHtml(a.type)}</strong>: ${escapeHtml(a.message)}${a.filePath ? " (" + escapeHtml(a.filePath) + ")" : ""}</li>`,
  );
  const anomaliesHtml =
    anomalyItems.length > 0
      ? `<ul>${anomalyItems.join("")}</ul>`
      : "<p>None detected.</p>";

  // Agent summary
  const agentSummaryPoints = [];
  if (displayInfraFailed + displayApiFailed > 0) {
    const er =
      processed > 0
        ? ((displayInfraFailed / processed) * 100).toFixed(2)
        : "0.00";
    agentSummaryPoints.push(
      `Error rate is ${er}% with ${displayInfraFailed + displayApiFailed} total failures (${displayApiFailed} from API).`,
    );
  }
  if (m.failureCountByBrand?.length > 0) {
    const tb = m.failureCountByBrand[0];
    agentSummaryPoints.push(
      `Most failures are for brand "${escapeHtml(tb.brand)}" (${tb.count} failed file${tb.count === 1 ? "" : "s"}).`,
    );
  }
  const highLatency = (m.anomalies || []).filter(
    (a) => a.type === "high_latency",
  );
  if (highLatency.length > 0) {
    agentSummaryPoints.push(
      `${highLatency.length} file${highLatency.length === 1 ? "" : "s"} exceeded 2× P95 latency (${m.p95LatencyMs?.toFixed(0)}ms).`,
    );
  }
  if (agentSummaryPoints.length === 0 && processed > 0) {
    const skipSuffix = m.skipped > 0 ? ` (+${m.skipped} skipped)` : "";
    agentSummaryPoints.push(
      `Run completed without notable anomalies: ${processed} files${skipSuffix} in ${runDuration} at ${throughput.toFixed(1)} files/min.`,
    );
  }
  const agentSummaryHtml =
    agentSummaryPoints.length > 0
      ? `<ul>${agentSummaryPoints.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
      : '<p class="muted">No notable anomalies detected.</p>';

  // Extraction log rows
  const logRows = (s.records || [])
    .map((rec) => {
      const statusIcon =
        rec.status === "done"
          ? '<span class="status-icon success">✅</span> SUCCESS'
          : rec.status === "error"
            ? '<span class="status-icon error">❌</span> FAILED'
            : '<span class="status-icon skipped">⏭️</span> SKIPPED';

      const jsonName = getRecordFilename(rec);
      const er = (s.extractionResults || []).find(
        (e) => e.filename === jsonName,
      );
      const resp = rec.fullResponse || er?.response;

      let patternKey = rec.patternKey || resp?.pattern?.pattern_key || "—";
      let latency = rec.latencyMs || resp?.latency_ms || resp?.meta?.latency_ms;
      const latencyDisplay = latency ? latency.toFixed(0) + " ms" : "—";

      const searchData = `${escapeHtml(rec.filePath)} ${rec.status} ${escapeHtml(patternKey)}`;

      const sourcePath = `output/staging/${rec.brand}/${rec.relativePath}`;
      let jsonDir = "output/extractions/failed";
      if (rec.status === "done" || (rec.status === "skipped" && er)) {
        jsonDir =
          er?.extractionSuccess !== false
            ? "output/extractions/succeeded"
            : "output/extractions/failed";
      }
      const jsonPath = `${jsonDir}/${jsonName}`;

      return `
      <tr class="log-row" data-search="${searchData.toLowerCase()}">
        <td>${statusIcon}</td>
        <td class="file-path">${escapeHtml(rec.filePath)}</td>
        <td>${escapeHtml(patternKey)}</td>
        <td><span class="chip">${latencyDisplay}</span></td>
        <td class="action-cell">
          <div style="display:flex;gap:4px;">
            <a href="javascript:void(0)" onclick="downloadFile('${sourcePath}', this)" class="action-btn" title="Download Source File">
              ${AppIcons.FILE}
            </a>
            ${
              resp || er
                ? `
            <a href="javascript:void(0)" onclick="downloadFile('${jsonPath}', this)" class="action-btn" title="Download Response (JSON)">
              ${AppIcons.DOWNLOAD}
            </a>`
                : ""
            }
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  const runIdSafe = escapeHtml(s.runId);
  const brandDisplay = AppUtils.formatBrandName(s.brand || "");
  const purchaserDisplay = AppUtils.formatPurchaserName(s.purchaser || "");

  return `
  <details class="run-section history-item" data-runid="${runIdSafe}" data-brand="${escapeHtml(s.brand || "")}" data-purchaser="${escapeHtml(s.purchaser || "")}" data-status="${status}">
    <summary class="run-section-summary">
      <div class="summary-content">
        <div class="operation-pointer">
          <span class="chip batch-id">#${runIdSafe}</span>
          <span class="badge-brand">[${escapeHtml(brandDisplay)}]</span>
          ${purchaserDisplay ? `<span class="badge-purchaser">${escapeHtml(purchaserDisplay)}</span>` : ""}
          <span class="run-time">${runTime}</span>
        </div>
        <div class="summary-badges">
          <span class="badge-status secondary" style="background:rgba(33,108,109,0.1);color:var(--header-bg);border:1px solid rgba(33,108,109,0.2);">${processed} ITEMS</span>
          <span class="badge-status success">${displaySuccess} SUCCESS</span>
          <span class="badge-status secondary">${displayApiFailed} API FAIL</span>
          <span class="badge-status fail">${displayInfraFailed} INFRA FAIL</span>
          <svg class="accordion-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left:12px;flex-shrink:0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>
    </summary>
    <div class="run-section-body">
      <div class="run-section-body-inner" style="padding: 0.5rem 1.5rem 1.5rem;">
        <div style="margin-bottom: 2rem;">
          <h3 style="margin-top: 0;">Consolidated Overview</h3>
        </div>
        <div class="table-responsive">
          <table>
            <tr><th>Metric</th><th>Value</th></tr>
            <tr><td>Total synced files</td><td><span class="chip secondary">${m.totalFiles ?? processed}</span></td></tr>
            <tr><td>Total extraction results available</td><td><span class="chip secondary">${(s.extractionResults || []).length}</span></td></tr>
            <tr><td>Files processed in this operation</td><td><span class="chip secondary">${processed}</span></td></tr>
            <tr><td>Files skipped (already handled)</td><td><span class="chip secondary">${m.skipped || 0}</span></td></tr>
            <tr><td>Successful Response (Success: true)</td><td><span class="chip success">${displaySuccess}</span></td></tr>
            <tr><td>Successful Response (Success: false)</td><td><span class="chip secondary">${displayApiFailed}</span></td></tr>
            <tr><td>Failure (Infrastructure)</td><td><span class="chip fail">${displayInfraFailed}</span></td></tr>
            <tr><td>Operation duration (wall clock)</td><td><span class="chip">${runDuration}</span></td></tr>
            <tr><td>Average API concurrency</td><td><span class="chip">${avgConc}x</span></td></tr>
            <tr><td>Total API processing time</td><td><span class="chip">${totalApiTime}</span> <span class="muted small">(sum of latencies)</span></td></tr>
            <tr><td>Throughput (observed)</td><td><span class="chip">${throughput.toFixed(2)} files/min</span></td></tr>
            <tr><td>Error rate (Infrastructure failures)</td><td><span class="chip fail">${processed > 0 ? ((displayInfraFailed / processed) * 100).toFixed(2) : "0.00"}%</span></td></tr>
          </table>
        </div>

        <h3>Latency (ms)</h3>
        <div class="table-responsive">
          <table>
            <tr><th>Percentile</th><th>Value</th></tr>
            ${latencyTableRows}
          </table>
        </div>

        <h3>Automated summary</h3>
        <div class="agent-style-summary">${agentSummaryHtml}</div>

        ${topSlowSection}
        ${failDetailSection}

        <h3>Anomalies</h3>
        <div class="anomalies-container">${anomaliesHtml}</div>

        <details class="full-log-container">
          <summary class="run-section-summary" style="border:none;">
            <div class="summary-content" style="justify-content:flex-start;">
              <div style="font-weight:800;font-size:0.85rem;text-transform:uppercase;">📦 View Full Extraction Log (${(s.extractionResults || []).length} files)</div>
              <svg class="accordion-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left:12px;flex-shrink:0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </summary>
          <div class="run-section-body" style="padding:1.5rem;">
            <div class="log-search-container" style="display:flex;align-items:center;justify-content:space-between;gap:1rem;">
              <input type="text" placeholder="Search files, patterns, or status..." onkeyup="filterSectionLog(this)" style="flex:1;">
              <div style="display:flex;gap:8px;">
                <button class="pg-btn" onclick="exportRun('${runIdSafe}', this, 'json')" style="height:38px;white-space:nowrap;font-family:inherit;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export JSON
                </button>
              </div>
            </div>
            <div class="table-responsive" style="max-height:500px;overflow-y:auto;">
              <table class="log-table">
                <thead>
                  <tr>
                    <th style="width:140px;">Status</th>
                    <th>File Path</th>
                    <th style="width:200px;">Pattern</th>
                    <th style="width:100px;">Latency</th>
                    <th style="width:80px;" class="action-cell">Action</th>
                  </tr>
                </thead>
                <tbody>${logRows}</tbody>
              </table>
            </div>
          </div>
        </details>
      </div>
    </div>
  </details>
  `;
}

// ─────────────────────────────────────────────────────────────
// History Pagination / Filter
// ─────────────────────────────────────────────────────────────
function renderHistory() {
  const allItems = Array.from(document.querySelectorAll(".history-item"));

  const visibleItems = allItems.filter((item) => {
    if (item.classList.contains("filtered-out")) return false;
    if (
      currentStatusFilter !== "all" &&
      item.getAttribute("data-status") !== currentStatusFilter
    )
      return false;
    if (currentSearch) {
      const content = (
        item.getAttribute("data-runid") +
        " " +
        item.getAttribute("data-brand") +
        " " +
        item.getAttribute("data-purchaser")
      ).toLowerCase();
      if (!content.includes(currentSearch)) return false;
    }
    return true;
  });

  const total = visibleItems.length;
  const pages = Math.max(1, Math.ceil(total / historyPageSize));
  if (historyPage > pages) historyPage = pages;
  if (historyPage < 1) historyPage = 1;

  allItems.forEach((i) => (i.style.display = "none"));
  visibleItems.forEach((item, idx) => {
    const start = (historyPage - 1) * historyPageSize;
    if (idx >= start && idx < start + historyPageSize)
      item.style.display = "block";
  });

  // Pagination
  const pgContainer = document.getElementById("history-pagination");
  if (pages <= 1) {
    pgContainer.innerHTML = "";
    return;
  }

  let html = `<button class="pg-btn" ${historyPage === 1 ? "disabled" : ""} onclick="goHistoryPage(${historyPage - 1})">Prev</button>`;
  for (let i = 1; i <= pages; i++) {
    if (
      i === 1 ||
      i === pages ||
      (i >= historyPage - 1 && i <= historyPage + 1)
    ) {
      html += `<button class="pg-btn ${i === historyPage ? "active" : ""}" onclick="goHistoryPage(${i})">${i}</button>`;
    } else if (i === historyPage - 2 || i === historyPage + 2) {
      html += '<span class="pg-ellipsis">...</span>';
    }
  }
  html += `<button class="pg-btn" ${historyPage === pages ? "disabled" : ""} onclick="goHistoryPage(${historyPage + 1})">Next</button>`;
  pgContainer.innerHTML = html;

  const info = document.getElementById("results-info");
  if (info) {
    const start = total ? (historyPage - 1) * historyPageSize + 1 : 0;
    const end = Math.min(historyPage * historyPageSize, total);
    info.innerText = `Showing ${start}-${end} of ${total} operation(s)`;
  }
}

window.goHistoryPage = (p) => {
  historyPage = p;
  renderHistory();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ─────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────
window.switchTab = (tabId, btn) => {
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");
  if (btn) btn.classList.add("active");
  else {
    const defaultBtn = document.querySelector(`.tab-btn[onclick*="${tabId}"]`);
    if (defaultBtn) defaultBtn.classList.add("active");
  }
  if (tabId === "history") renderHistory();
  else applyFilteringToUI();
};

// ─────────────────────────────────────────────────────────────
// Smooth Accordion
// ─────────────────────────────────────────────────────────────
function setupSmoothAccordion() {
  document
    .querySelectorAll(".run-section, .full-log-container")
    .forEach((el) => {
      const summary = el.querySelector(".run-section-summary");
      if (!summary) return;
      summary.onclick = (e) => {
        if (e) e.preventDefault();
        if (
          el.classList.contains("collapsing") ||
          el.classList.contains("expanding")
        )
          return;
        if (el.hasAttribute("open")) {
          const startH = el.offsetHeight;
          el.classList.add("collapsing");
          el.style.height = startH + "px";
          el.offsetHeight; // reflow
          el.style.height = summary.offsetHeight + "px";
          setTimeout(() => {
            el.removeAttribute("open");
            el.classList.remove("collapsing");
            el.style.height = "";
          }, 350);
        } else {
          const startH = el.offsetHeight;
          el.setAttribute("open", "");
          const endH = el.offsetHeight;
          el.classList.add("expanding");
          el.style.height = startH + "px";
          el.offsetHeight; // reflow
          el.style.height = endH + "px";
          setTimeout(() => {
            el.classList.remove("expanding");
            el.style.height = "";
          }, 350);
        }
      };
    });
}

function handleDeepLinking() {
  const hash = window.location.hash;
  const search = window.location.search;
  const params = new URLSearchParams(search || hash.split("?")[1] || "");
  const runId = params.get("runId");

  if (hash.startsWith("#history") || runId) {
    window.switchTab("history");
    if (runId) {
      // Find which page this runId is on
      const items = Array.from(document.querySelectorAll(".history-item"));
      const idx = items.findIndex(
        (el) => el.getAttribute("data-runid") === runId,
      );

      if (idx !== -1) {
        historyPage = Math.floor(idx / historyPageSize) + 1;
        renderHistory();

        setTimeout(() => {
          const el = document.querySelector(
            `.history-item[data-runid="${runId}"]`,
          );
          if (el) {
            const summary = el.querySelector(".run-section-summary");
            if (summary) summary.click(); // Trigger smooth expansion
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 500);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Dashboard Stats
// ─────────────────────────────────────────────────────────────
function updateDashboardStats(data) {
  const totalProcessed = data.reduce(
    (a, b) => a + b.success + b.failed + (b.skipped || 0),
    0,
  );
  const totalSuccess = data.reduce(
    (a, b) => a + b.success + (b.skipped || 0),
    0,
  );
  const successRate =
    totalProcessed > 0
      ? ((totalSuccess / totalProcessed) * 100).toFixed(1)
      : "0.0";
  const avgLatency =
    data.length > 0
      ? Math.round(data.reduce((a, b) => a + (b.p50 || 0), 0) / data.length)
      : 0;

  const el = (id) => document.getElementById(id);
  if (el("agg-total")) el("agg-total").innerText = totalProcessed;
  if (el("agg-rate")) el("agg-rate").innerText = successRate + "%";
  if (el("agg-latency")) el("agg-latency").innerText = avgLatency + "ms";
  if (el("agg-ops")) el("agg-ops").innerText = data.length;
}

// ─────────────────────────────────────────────────────────────
// Charts
// ─────────────────────────────────────────────────────────────
function initCharts(dataToUse) {
  if (typeof Chart === "undefined") return;

  const sortedData = [...dataToUse]
    .sort((a, b) => new Date(a.time) - new Date(b.time))
    .slice(-100);
  const chartWidth = Math.max(100, sortedData.length * 60) + "px";
  [
    "volChartContainer",
    "latencyChartContainer",
    "throughputChartContainer",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.width = chartWidth;
  });

  const labels = sortedData.map((d) => {
    const obj = new Date(d.time);
    return (
      obj.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      " " +
      obj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  });

  const errs = dataToUse.reduce(
    (acc, d) => {
      acc.timeout += d.errors.timeout || 0;
      acc.client += d.errors.clientError || 0;
      acc.server += d.errors.serverError || 0;
      acc.read += d.errors.readError || 0;
      acc.other += d.errors.other || 0;
      return acc;
    },
    { timeout: 0, client: 0, server: 0, read: 0, other: 0 },
  );

  const chartConfigs = {
    volChart: {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Success",
            data: sortedData.map((d) => d.success),
            backgroundColor: "#2d9d5f",
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: "Failed",
            data: sortedData.map((d) => d.failed),
            backgroundColor: "#ef4444",
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: "Skipped",
            data: sortedData.map((d) => d.skipped),
            backgroundColor: "#94a3b8",
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, beginAtZero: true },
        },
      },
    },
    latencyChart: {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "P50 Latency (ms)",
            data: sortedData.map((d) => d.p50),
            borderColor: "#216c6d",
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 4,
          },
          {
            label: "P95 Latency (ms)",
            data: sortedData.map((d) => d.p95),
            borderColor: "#f59e0b",
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
      },
    },
    throughputChart: {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Throughput (files/min)",
            data: sortedData.map((d) => d.throughput),
            borderColor: "#216c6d",
            backgroundColor: "rgba(33,108,109,0.1)",
            fill: true,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } },
      },
    },
    errorChart: {
      type: "doughnut",
      data: {
        labels: [
          "Timeout",
          "Client (4xx)",
          "Server (5xx)",
          "Read Error",
          "Other",
        ],
        datasets: [
          {
            data: [
              errs.timeout,
              errs.client,
              errs.server,
              errs.read,
              errs.other,
            ],
            backgroundColor: [
              "#f59e0b",
              "#ef4444",
              "#991b1b",
              "#3b82f6",
              "#64748b",
            ],
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: "70%" },
    },
  };

  const legendConfig = {
    position: "bottom",
    labels: { usePointStyle: true, padding: 15, font: { weight: "600" } },
  };
  Object.values(chartConfigs).forEach((c) => {
    c.options.plugins = { ...(c.options.plugins || {}), legend: legendConfig };
  });

  Object.keys(chartConfigs).forEach((id) => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    if (chartInstances[id]) chartInstances[id].destroy();
    chartInstances[id] = new Chart(canvas, chartConfigs[id]);
  });
}

// ─────────────────────────────────────────────────────────────
// Log Filtering
// ─────────────────────────────────────────────────────────────
window.filterSectionLog = (input) => {
  const filter = input.value.toLowerCase();
  const rows = input.closest(".run-section-body").querySelectorAll(".log-row");
  rows.forEach((row) => {
    const text = (row.getAttribute("data-search") || "").toLowerCase();
    row.classList.toggle("log-row-hidden", !text.includes(filter));
  });
};

// ─────────────────────────────────────────────────────────────
// Export  (API calls to /api/reports/… or /api/export-zip)
// ─────────────────────────────────────────────────────────────
window.exportRun = async (runId, btn, type) => {
  const originalHtml = btn.innerHTML;
  btn.innerHTML = "Preparing...";
  btn.disabled = true;
  try {
    const url = `/api/reports/${type}/${runId}.${type === "json" ? "json" : "zip"}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Export failed");
    const blob = await resp.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `report_${runId}.${type}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert("Export failed: " + e.message);
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
};
