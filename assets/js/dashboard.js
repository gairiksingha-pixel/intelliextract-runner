import { AppUtils, showAppAlert } from "./common.js";
import { AppIcons } from "./icons.js";

/**
 * Dashboard Logic for IntelliExtract
 */
// --- Data State ---
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
    iconHtml: AppIcons.DOWNLOAD,
  },
  {
    id: "P2",
    title: "Extract",
    description: "Run extraction without cloud sync",
    limits: { sync: false, extract: true },
    iconHtml: AppIcons.EXTRACT,
  },
  {
    id: "PIPE",
    title: "Sync & Extract",
    description: "Full pipeline execution",
    limits: { pipeline: true },
    iconHtml: AppIcons.PIPELINE,
  },
];

// --- Initializer ---
document.addEventListener("DOMContentLoaded", () => {
  const tbody = document.getElementById("rows");
  if (tbody) {
    ROWS.forEach((c) => tbody.appendChild(renderRow(c)));
  }

  // Sync configuration from window
  BRAND_PURCHASERS = window.BRAND_PURCHASERS || {};

  const set = new Set();
  Object.values(BRAND_PURCHASERS).forEach((arr) =>
    arr.forEach((p) => set.add(p)),
  );
  ALL_PURCHASERS = Array.from(set).sort();

  // Initialize standalone components
  initDropdowns();
  if (typeof window.initActionButtons === "function")
    window.initActionButtons();
  if (typeof window.initNotificationModal === "function")
    window.initNotificationModal();
  if (typeof window.initScheduleModal === "function")
    window.initScheduleModal();

  // System status polling
  updateSystemStatus();
  setInterval(updateSystemStatus, 3000);
});

// --- Core Dashboard Logic ---

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
  btn.innerHTML = `${AppIcons.PLAY}<span>${getRunButtonLabel(c.id)}</span>`;
  btn.title = getRunButtonLabel(c.id);
  btn.onclick = () => runCase(c.id, btn, resultDiv);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "reset-case";
  resetBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
  resetBtn.onclick = () => resetCase(resultDiv);

  let retryBtn = null;
  if (c.id === "P2") {
    retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "run retry-failed-btn";
    retryBtn.innerHTML = `${AppIcons.RETRY}<span>Retry Failed</span>`;
    retryBtn.title = "Only retry extractions that previously failed";
    retryBtn.onclick = () =>
      runCase(c.id, retryBtn, resultDiv, { retryFailed: true });
  }

  const resetDuringResumeBtn = document.createElement("button");
  resetDuringResumeBtn.type = "button";
  resetDuringResumeBtn.className = "reset-case reset-during-resume";
  resetDuringResumeBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
  resetDuringResumeBtn.title = "Clear result and exit resume mode";
  resetDuringResumeBtn.onclick = () => {
    showAppAlert(
      "Reset Operation",
      "Are you sure you want to clear the result and exit resume mode? This will discard the current progress tracking for this case.",
      {
        isConfirm: true,
        confirmText: "Yes, Reset",
        onConfirm: () => {
          resetCase(resultDiv);
          resetDuringResumeBtn.classList.remove("show-during-resume");
          resetBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
          resetBtn.onclick = () => resetCase(resultDiv);
        },
      },
    );
  };

  tr.innerHTML = `
    <td class="op-name">
      <div class="op-content-wrap">
        <div class="op-icon-wrap">${c.iconHtml}</div>
        <span class="op-title">${AppUtils.esc(c.title)}</span>
        <span class="op-description">${AppUtils.esc(c.description)}</span>
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

async function runCase(caseId, btn, resultDiv, options = {}) {
  const isResume = options.resume === true;
  const row = btn.closest("tr");
  const syncLimitInput = row.querySelector(".limit-sync");
  const extractLimitInput = row.querySelector(".limit-extract");
  const syncLimit = syncLimitInput?.value || 0;
  const extractLimit = extractLimitInput?.value || 0;
  const resetBtn = row.querySelector(".reset-case:not(.reset-during-resume)");

  if (SELECTED_BRANDS.length === 0 && SELECTED_PURCHASERS.length === 0) {
    resultDiv.className = "result result-placeholder result-validation-alert";
    resultDiv.innerHTML =
      '<span class="result-placeholder-text">Please select at least one brand or purchaser from filter.</span>';
    return;
  }

  const pairs = getPairsForRun();
  if (
    SELECTED_BRANDS.length > 0 &&
    SELECTED_PURCHASERS.length > 0 &&
    pairs.length === 0
  ) {
    resultDiv.className = "result result-placeholder result-validation-alert";
    resultDiv.innerHTML =
      '<span class="result-placeholder-text">No valid brand/purchaser combination for the selected filter. Use Reset filter and try again.</span>';
    return;
  }

  const isNoLimit =
    (syncLimitInput && parseInt(syncLimit) === 0) ||
    (extractLimitInput && parseInt(extractLimit) === 0);

  const executeRun = async () => {
    btn.disabled = true;
    if (syncLimitInput) syncLimitInput.disabled = true;
    if (extractLimitInput) extractLimitInput.disabled = true;

    clearRowProgress(caseId);
    resultDiv.className = "result running";
    resultDiv.innerHTML =
      '<span class="exit">Starting process…<span class="loading-dots"></span></span><div class="sync-progress-bar"><div class="sync-progress-fill sync-progress-indeterminate" style="width:40%"></div></div>';

    const isPipe = caseId === "PIPE";
    resetBtn.innerHTML = `${AppIcons.STOP}<span>Stop</span>`;
    resetBtn.classList.add("stop-btn");
    resetBtn.title = "Stop the execution";
    resetBtn.onclick = () => stopCase(caseId, row, resultDiv, "manual");

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
          pairs: pairs.length > 0 ? pairs : null,
          ...options,
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
      if (e.name === "AbortError" || e.message?.includes("aborted")) {
        // Handled by Stop logic
      } else {
        resultDiv.className = "result fail";
        resultDiv.innerHTML = `<span class="exit">Error: ${AppUtils.esc(e.message)}</span>`;
      }
    } finally {
      btn.disabled = false;
      if (syncLimitInput) syncLimitInput.disabled = false;
      if (extractLimitInput) extractLimitInput.disabled = false;
      setTimeout(() => updateSystemStatus(), 500);
    }
  };

  if (isNoLimit && !isResume) {
    showAppAlert(
      "High Load Warning",
      "Limit is set to 0 (no limit). This will process all files and may take a long time. Continue?",
      {
        isConfirm: true,
        confirmText: "Continue",
        onConfirm: executeRun,
      },
    );
  } else {
    executeRun();
  }
}

async function stopCase(caseId, row, resultDiv, origin = "manual") {
  showAppAlert(
    "Stop Operation",
    "Are you sure you want to stop the current process? Progress will be saved for resume.",
    {
      isConfirm: true,
      confirmText: "Yes, Stop",
      onConfirm: async () => {
        try {
          const res = await fetch("/api/stop-run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caseId, origin }),
          });
          if (!res.ok) throw new Error(await res.text());

          resultDiv.innerHTML = '<span class="exit">Stopping process...</span>';
        } catch (e) {
          showAppAlert("Error", "Failed to stop process: " + e.message, true);
        }
      },
    },
  );
}

// Per-row progress state accumulation (keyed by caseId)
const ROW_PROGRESS = {};

function getRowProgress(caseId) {
  if (!ROW_PROGRESS[caseId]) {
    ROW_PROGRESS[caseId] = {
      syncProgress: null,
      extractionProgress: null,
      resumeSkipSyncProgress: null,
      resumeSkipExtractProgress: null,
      logMessage: null,
    };
  }
  return ROW_PROGRESS[caseId];
}

function clearRowProgress(caseId) {
  ROW_PROGRESS[caseId] = null;
}

function handleStreamData(caseId, data) {
  const div = document.getElementById(`result-${caseId}`);
  if (!div) return;

  const state = getRowProgress(caseId);

  if (data.type === "log") {
    state.logMessage = data.message;
    showResult(div, null, false, { ...state, caseId });
  } else if (data.type === "progress") {
    if (data.phase === "sync") {
      state.syncProgress = data;
    } else {
      state.extractionProgress = data;
    }
    showResult(div, null, false, { ...state, caseId });
  } else if (data.type === "resume_skip") {
    if (data.phase === "sync") {
      state.resumeSkipSyncProgress = {
        skipped: data.skipped,
        total: data.total,
      };
    } else {
      state.resumeSkipExtractProgress = {
        skipped: data.skipped,
        total: data.total,
      };
    }
    showResult(div, null, false, { ...state, caseId });
  } else if (data.type === "report") {
    showResult(div, data, true, { caseId });
  } else if (data.type === "error") {
    showResult(div, data, false, { caseId });
  }
}

function buildResultTable(caseId, data, pass, stdoutStr, stderrStr) {
  const SYNC_CASES = ["P1", "PIPE", "P5"];
  const EXTRACT_CASES = ["P2", "PIPE", "P5", "P3"];

  function filterResultLine(line) {
    if (line.indexOf("SYNC_PROGRESS\t") === 0) return false;
    if (
      line.indexOf("RESUME_SKIP\t") === 0 ||
      line.indexOf("RESUME_SKIP_SYNC\t") === 0
    )
      return false;
    if (line.indexOf("Report(s) written:") !== -1) return false;
    if (/Run (?:run_|RUN|SKIP-)\S+ finished\./.test(line)) return false;
    return true;
  }

  const stdoutFiltered = stdoutStr
    ? stdoutStr.split("\n").filter(filterResultLine).join("\n").trim()
    : "";
  const stderrFiltered = stderrStr
    ? stderrStr.split("\n").filter(filterResultLine).join("\n").trim()
    : "";

  const statusLabel = pass ? "Success" : "Failed";
  const parsed = {};
  const lines = stdoutFiltered ? stdoutFiltered.split("\n") : [];
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || "").trim().replace(/\r$/, "");
    let m;
    if ((m = /^Download limit:\s*(.+)$/.exec(line)))
      parsed.downloadLimit = m[1].trim();
    else if ((m = /^Downloaded \(new\):\s*(\d+)\s*$/.exec(line)))
      parsed.downloadedNew = m[1];
    else if ((m = /^Skipped \(already present[^:]*:\s*(\d+)\s*$/.exec(line)))
      parsed.skipped = m[1];
    else if ((m = /^Errors:\s*(\d+)\s*$/.exec(line))) parsed.errors = m[1];
    else if ((m = /^\s+Staging path:\s*(.+)$/.exec(line))) {
      if (!parsed.stagingPaths) parsed.stagingPaths = [];
      parsed.stagingPaths.push(m[1].trim());
    } else if (
      (m = /^Scoped to tenant:\s*([^,]+),\s*purchaser:\s*(.+)$/.exec(line))
    ) {
      parsed.brandAndPurchaser = (m[1].trim() + " / " + m[2].trim()).trim();
    } else if (
      (m = /^\s{2}([^:\s][^:]*)$/.exec(line)) &&
      line.indexOf("/") !== -1 &&
      !/Staging path|Downloaded:|Skipped:|Errors:/.test(line)
    ) {
      if (!parsed.brandAndPurchaserList) parsed.brandAndPurchaserList = [];
      parsed.brandAndPurchaserList.push(line.trim());
    } else if (
      (m =
        /^Extraction metrics:\s*success=(\d+),\s*skipped=(\d+),\s*failed=(\d+)\s*$/.exec(
          line,
        ))
    ) {
      parsed.extractSuccess = m[1];
      parsed.extractSkipped = m[2];
      parsed.extractFailed = m[3];
    } else if ((m = /^Extraction result\(s\):\s*(.+?)\s*\(full/.exec(line))) {
      parsed.extractionResultsPath = m[1].trim();
    } else if ((m = /^Reports path:\s*(.+)$/.exec(line))) {
      parsed.reportsPath = m[1].trim();
    } else if (
      (m =
        /^CUMULATIVE_METRICS\tsuccess=(\d+),failed=(\d+),total=(\d+)\s*$/.exec(
          line,
        ))
    ) {
      parsed.cumSuccess = m[1];
      parsed.cumFailed = m[2];
      parsed.cumTotal = m[3];
    }
  }

  // Also extract from structured report data if stdout wasn't parsed
  if (data.successCount !== undefined && parsed.extractSuccess === undefined) {
    parsed.extractSuccess = String(data.successCount);
    // Be careful here: if we have successCount from data, we might not have the others
    // unless they are also in the data. For now, we only set success if missing.
  }

  const hasSync =
    caseId &&
    SYNC_CASES.indexOf(caseId) !== -1 &&
    (parsed.downloadLimit != null || parsed.downloadedNew != null);
  const hasExtract =
    caseId &&
    EXTRACT_CASES.indexOf(caseId) !== -1 &&
    (parsed.extractSuccess != null ||
      parsed.extractionResultsPath != null ||
      parsed.reportsPath != null);
  const allExtractZero =
    (parsed.extractSuccess === "0" || parsed.extractSuccess === 0) &&
    (parsed.extractFailed === "0" || parsed.extractFailed === 0) &&
    (parsed.extractSkipped === "0" || parsed.extractSkipped === 0);
  const noSyncDownloaded =
    parsed.downloadedNew == null || parsed.downloadedNew === "0";
  let noFilesFound = pass && allExtractZero && (noSyncDownloaded || !hasSync);
  if (parsed.cumTotal != null && Number(parsed.cumTotal) > 0)
    noFilesFound = false;

  const rows = [];
  rows.push(["Status", statusLabel]);

  if (noFilesFound) {
    let msg = "No files found to sync or extract.";
    if (row && row._isRetryFailed) {
      msg = "No failed files found to retry.";
    }
    rows.push(["Message", msg]);
  } else {
    if (hasSync) {
      const bp =
        parsed.brandAndPurchaser ||
        (parsed.brandAndPurchaserList && parsed.brandAndPurchaserList.length
          ? parsed.brandAndPurchaserList.join("\n")
          : null);
      if (bp) rows.push(["Brand and purchaser", bp]);
      if (parsed.stagingPaths && parsed.stagingPaths.length)
        rows.push(["Staging path", parsed.stagingPaths.join("\n")]);
      const overview = [];
      if (parsed.downloadedNew != null)
        overview.push("Downloaded: " + AppUtils.esc(parsed.downloadedNew));
      if (parsed.skipped != null) {
        const skippedHtml =
          'Skipped<span class="info-icon" title="These files were already synced in a previous run and are unchanged, so they were skipped.">i</span>: ' +
          AppUtils.esc(parsed.skipped);
        overview.push(skippedHtml);
      }
      if (parsed.errors != null)
        overview.push("Errors: " + AppUtils.esc(parsed.errors));
      if (overview.length)
        rows.push(["Download overview", overview.join(", ")]);
    }
    if (hasExtract) {
      if (parsed.brandAndPurchaser && !hasSync)
        rows.push(["Brand and purchaser", parsed.brandAndPurchaser]);
      if (
        parsed.extractSuccess != null ||
        parsed.extractFailed != null ||
        parsed.extractSkipped != null
      ) {
        const successVal = parsed.extractSuccess || "0";
        const skippedVal = parsed.extractSkipped || "0";
        const failedVal = parsed.extractFailed || "0";
        const detail =
          "Success: " +
          AppUtils.esc(successVal) +
          ', Skipped<span class="info-icon" title="These files were already extracted in a previous run, so they were skipped this time.">i</span>: ' +
          AppUtils.esc(skippedVal) +
          ", Failed: " +
          AppUtils.esc(failedVal);
        rows.push(["Extraction overview", detail]);
      }
      if (parsed.cumTotal != null) {
        const cumDetail =
          "Success: " +
          AppUtils.esc(parsed.cumSuccess) +
          ', Failed<span class="info-icon" title="Aggregated status of all unique files found for this filter across all historical runs.">i</span>: ' +
          AppUtils.esc(parsed.cumFailed) +
          " (Total: " +
          AppUtils.esc(parsed.cumTotal) +
          ")";
        rows.push(["Overall status", cumDetail]);
      }
    }
    if (!hasSync && !hasExtract && stdoutFiltered) {
      rows.push([
        "Output",
        AppUtils.esc(stdoutFiltered.slice(0, 5000)) +
          (stdoutFiltered.length > 5000 ? "…" : ""),
      ]);
    } else if (rows.length === 1) {
      const noOutput = !stdoutFiltered && !stderrFiltered;
      rows.push([
        "Output",
        noOutput && data.exitCode === 0
          ? "Command completed successfully with no console output."
          : noOutput
            ? "Command produced no output. Check server logs or run in a terminal for details."
            : "—",
      ]);
    }
  }

  if (stderrFiltered) {
    rows.push([
      "Standard error",
      AppUtils.esc(stderrFiltered.slice(0, 5000)) +
        (stderrFiltered.length > 5000 ? "…" : ""),
    ]);
  }

  const LABEL_HTML_SAFE = new Set([
    "Standard error",
    "Output",
    "Download overview",
    "Extraction overview",
    "Overall status",
  ]);
  const METRIC_ROWS = new Set([
    "Status",
    "Brand and purchaser",
    "Staging path",
    "Download overview",
    "Extraction overview",
    "Overall status",
  ]);

  const tableRows = rows.map((r) => {
    const label = r[0];
    const cls =
      (label === "Status" ? "status-row " : "") +
      (METRIC_ROWS.has(label) ? "metric-row" : "");
    const val = LABEL_HTML_SAFE.has(label)
      ? r[1]
      : AppUtils.esc(r[1]).replace(/\n/g, "<br>");
    return `<tr${cls ? ` class="${cls.trim()}"` : ""}><th>${label}</th><td>${val}</td></tr>`;
  });

  return `<table class="result-table-wrap">${tableRows.join("")}</table>`;
}

function showResult(div, data, pass, options) {
  const resultClass = data ? (pass ? "pass" : "fail") : "running";
  div.className = "result " + resultClass;

  if (data) {
    const caseId = (options && options.caseId) || "";
    if (data.type === "report") {
      // Build legacy-matching detailed table from report data
      const stdout = data.stdout ? String(data.stdout).trim() : "";
      const stderr = data.stderr ? String(data.stderr).trim() : "";
      div.innerHTML = buildResultTable(caseId, data, pass, stdout, stderr);
    } else {
      // Error type — show the message as a table row
      const errMsg = data.message || (pass ? "Completed" : "Error");
      const rows = [
        ["Status", pass ? "Success" : "Failed"],
        ["Output", AppUtils.esc(errMsg)],
      ];
      div.innerHTML = `<table class="result-table-wrap">${rows.map((r) => `<tr class="${r[0] === "Status" ? "status-row metric-row" : ""}"><th>${r[0]}</th><td>${r[1]}</td></tr>`).join("")}</table>`;
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
  let label = logMessage || "Starting process…";
  let showDots = !logMessage;

  const hasSync = !!syncProgress;
  const hasExtraction = !!extractionProgress;
  const hasResumeSkipSync = !!resumeSkipSyncProgress;
  const hasResumeSkipExtract = !!resumeSkipExtractProgress;

  if (hasResumeSkipSync && caseId !== "PIPE") {
    const done = Number(resumeSkipSyncProgress.skipped) || 0;
    const total = Number(resumeSkipSyncProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping synced files: ${total > 0 ? done + " / " + total : done + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill ${total > 0 && done === 0 ? "sync-progress-indeterminate" : ""}" style="width:${total > 0 ? pct : 40}%"></div></div>
    `;
  }

  if (hasResumeSkipExtract) {
    const done = Number(resumeSkipExtractProgress.skipped) || 0;
    const total = Number(resumeSkipExtractProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping extracted files: ${total > 0 ? done + " / " + total : done + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill ${total > 0 && done === 0 ? "sync-progress-indeterminate" : ""}" style="width:${total > 0 ? pct : 40}%"></div></div>
    `;
  }

  if (hasSync) {
    const done = Number(syncProgress.done) || 0;
    const total = Number(syncProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap">Runner is syncing file: ${total > 0 ? done + " / " + total : done + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${total > 0 && done === 0 ? "sync-progress-indeterminate" : ""}" style="width:${total > 0 ? pct : 40}%"></div></div>
    `;
  }

  if (hasExtraction) {
    const done = Number(extractionProgress.done) || 0;
    const total = Number(extractionProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap extraction-progress-wrap">Runner is extracting: ${total > 0 ? done + " / " + total : done + " file(s)"}</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${total > 0 && done === 0 ? "sync-progress-indeterminate" : ""}" style="width:${total > 0 ? pct : 40}%"></div></div>
    `;
  }

  if (!logMessage) {
    if (hasResumeSkipSync || hasResumeSkipExtract || hasSync || hasExtraction) {
      showDots = false;
      const showSyncSkipLabel = hasResumeSkipSync && caseId !== "PIPE";
      label = showSyncSkipLabel
        ? "Runner is skipping synced files…"
        : hasResumeSkipExtract && !hasSync && !hasExtraction
          ? "Runner is skipping extracted files…"
          : hasResumeSkipExtract && (hasSync || hasExtraction)
            ? "Runner is skipping extract, syncing/extracting…"
            : hasSync && hasExtraction
              ? "Runner is sync & extract…"
              : hasSync
                ? "Runner is syncing file…"
                : "Runner is extracting…";

      // If we are only extracting and have percent, enrich the label
      if (
        !hasSync &&
        !hasResumeSkipSync &&
        !hasResumeSkipExtract &&
        hasExtraction
      ) {
        const done = Number(extractionProgress.done) || 0;
        const total = Number(extractionProgress.total) || 0;
        const pct =
          total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
        if (total > 0) {
          label = `Runner is extracting… ${pct}% (${done} / ${total})`;
        }
      }
    }
  }

  div.innerHTML = `
    <span class="exit">
      ${AppUtils.esc(label)}${showDots ? '<span class="loading-dots"></span>' : ""}
    </span>
    ${showDots ? '<div class="sync-progress-bar"><div class="sync-progress-fill sync-progress-indeterminate" style="width:40%"></div></div>' : ""}
    ${extra}
  `;
}

function getPairsForRun() {
  const pairs = [];
  if (SELECTED_BRANDS.length > 0) {
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
  } else if (SELECTED_PURCHASERS.length > 0) {
    // Only purchasers selected: find all brands that have these purchasers
    Object.entries(BRAND_PURCHASERS).forEach(([b, allowed]) => {
      SELECTED_PURCHASERS.forEach((p) => {
        if (allowed.includes(p)) pairs.push({ tenant: b, purchaser: p });
      });
    });
  }
  return pairs;
}

function resetCase(div) {
  if (!div) return;
  const caseId = div.id.replace("result-", "");
  clearRowProgress(caseId);
  div.className = "result result-placeholder";
  div.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(caseId)}</span>`;
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
    if (lim.sync)
      html +=
        '<div class="limit-chip"><span class="limit-label">Sync:</span><input type="number" class="limit-sync" min="0" step="1" value="0" title="Max files to download. 0 = no limit"></div>';
    if (lim.extract)
      html +=
        '<div class="limit-chip"><span class="limit-label">Extract:</span><input type="number" class="limit-extract" min="0" step="1" value="0" title="Max files to extract. 0 = no limit"></div>';
  }
  html += '</div><div class="limit-hint">0 = no limit</div></td>';
  return html;
}

// --- Dropdown Management ---

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

  // Ensure dropdowns don't close when clicking labels/inputs
  [brandPanel, purchaserPanel, brandTrigger, purchaserTrigger].forEach((el) => {
    el?.addEventListener("click", (e) => e.stopPropagation());
  });

  document.addEventListener("click", () => {
    brandPanel?.classList.remove("open");
    purchaserPanel?.classList.remove("open");
  });
}

function renderBrandOptions(panel) {
  if (!panel) return;
  var brands = Object.keys(BRAND_PURCHASERS).sort(function (a, b) {
    return AppUtils.formatBrandName(a).localeCompare(
      AppUtils.formatBrandName(b),
    );
  });
  var allHtml =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"> <strong>All</strong></label>';
  panel.innerHTML =
    allHtml +
    brands
      .map(function (b) {
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          AppUtils.esc(b) +
          '" ' +
          (SELECTED_BRANDS.includes(b) ? "checked" : "") +
          "> " +
          AppUtils.esc(AppUtils.formatBrandName(b)) +
          "</label>"
        );
      })
      .join("");

  AppUtils.attachSelectAll(panel.id, function () {
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
          var nameA = AppUtils.formatPurchaserName(a).toLowerCase();
          var nameB = AppUtils.formatPurchaserName(b).toLowerCase();
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
          AppUtils.esc(p) +
          '" ' +
          (SELECTED_PURCHASERS.includes(p) ? "checked" : "") +
          "> " +
          AppUtils.esc(AppUtils.formatPurchaserName(p)) +
          "</label>"
        );
      })
      .join("");

  AppUtils.attachSelectAll(panel.id, function () {
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
    if (SELECTED_BRANDS.length === 0) bt.textContent = "Select brand";
    else if (SELECTED_BRANDS.length === 1)
      bt.textContent = AppUtils.formatBrandName(SELECTED_BRANDS[0]);
    else {
      const brands = Object.keys(BRAND_PURCHASERS);
      if (brands.length > 0 && SELECTED_BRANDS.length === brands.length)
        bt.textContent = "All";
      else bt.textContent = SELECTED_BRANDS.length + " selected";
    }
  }

  const pt = document.getElementById("purchaser-dropdown-trigger");
  if (pt) {
    if (SELECTED_PURCHASERS.length === 0) pt.textContent = "Select purchaser";
    else if (SELECTED_PURCHASERS.length === 1)
      pt.textContent = AppUtils.formatPurchaserName(SELECTED_PURCHASERS[0]);
    else {
      if (
        ALL_PURCHASERS.length > 0 &&
        SELECTED_PURCHASERS.length === ALL_PURCHASERS.length
      )
        pt.textContent = "All";
      else pt.textContent = SELECTED_PURCHASERS.length + " selected";
    }
  }
}

// --- External Actions (Global Bindings) ---

window.initActionButtons = function () {
  const container = document.getElementById("header-actions");
  if (!container || container.hasAttribute("data-initialized")) return;
  container.setAttribute("data-initialized", "true");

  function createBtn(id, iconHtml, label, title, onClick) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.className = "header-action-btn";
    btn.innerHTML = `${iconHtml}<span>${label}</span>`;
    btn.title = title;
    btn.onclick = onClick;
    return btn;
  }

  container.appendChild(
    createBtn(
      "btn-notif",
      AppIcons.NOTIF,
      "Alert Recipients",
      "Configure notification emails",
      () => window.openNotificationSettings(),
    ),
  );
  container.appendChild(
    createBtn(
      "btn-sched",
      AppIcons.SCHED,
      "Add Schedules",
      "Automate operations",
      () => window.openScheduleModal(),
    ),
  );
};

async function updateSystemStatus() {
  try {
    // 1. Check active runs
    const activeRes = await fetch("/api/active-runs");
    const activeData = await activeRes.json();
    const activeRuns = activeData.activeRuns || [];

    const statusText = document.getElementById("system-status-text");
    const pill = document.querySelector(".system-status-pill");

    if (statusText && pill) {
      if (activeRuns.length > 0) {
        statusText.textContent = "Runner is busy";
        pill.classList.add("busy");
        pill.classList.remove("offline");
      } else {
        statusText.textContent = "Runner is active";
        pill.classList.remove("busy");
        pill.classList.remove("offline");
      }

      const systemIsBusy = activeRuns.length > 0;
      // We will handle row inactivation after updating all rows to ensure consistent state
    }

    // 2. Update each row UI based on status
    const rows = document.querySelectorAll("tr[data-case-id]");
    for (const row of rows) {
      const caseId = row.getAttribute("data-case-id");
      const statusRes = await fetch(`/api/run-status?caseId=${caseId}`);
      const status = await statusRes.json();

      updateRowUI(
        row,
        status,
        activeRuns.find((r) => r.caseId === caseId),
      );
    }

    // 3. Finalize row states based on global system status
    const activeCaseId = activeRuns.length > 0 ? activeRuns[0].caseId : null;
    if (activeCaseId) {
      const activeRow = document.querySelector(
        `tr[data-case-id="${activeCaseId}"]`,
      );
      setOtherRowsInactive(activeRow, "Another process is currently running.");
    } else {
      setOtherRowsActive();
    }
  } catch (e) {
    const statusText = document.getElementById("system-status-text");
    const pill = document.querySelector(".system-status-pill");
    if (statusText && pill) {
      statusText.textContent = "System offline";
      pill.classList.add("offline");
      pill.classList.remove("busy");
    }
  }
}

function updateRowUI(row, status, activeInfo) {
  const caseId = row.getAttribute("data-case-id");
  const runBtn = row.querySelector("button.run:not(.retry-failed-btn)");
  const retryBtn = row.querySelector("button.retry-failed-btn");
  const resetBtn = row.querySelector(".reset-case:not(.reset-during-resume)");
  const resetResumeBtn = row.querySelector(".reset-during-resume");
  const resultDiv = document.getElementById(`result-${caseId}`);
  const syncInput = row.querySelector(".limit-sync");
  const extInput = row.querySelector(".limit-extract");

  if (status.isRunning) {
    // RUNNING state
    runBtn.disabled = true;
    if (retryBtn) retryBtn.disabled = true;
    if (syncInput) syncInput.disabled = true;
    if (extInput) extInput.disabled = true;

    const isScheduled = activeInfo && activeInfo.origin === "scheduled";
    if (isScheduled) {
      resetBtn.innerHTML = `${AppIcons.STOP}<span>Stop Auto Extraction</span>`;
      resetBtn.classList.add("stop-btn");
      resetBtn.classList.remove("resume-btn");
      resetBtn.onclick = () => stopCase(caseId, row, resultDiv, "scheduled");
    } else {
      // Manual run - user wants it to show reset button
      resetBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
      resetBtn.classList.remove("stop-btn", "resume-btn");
      resetBtn.onclick = () => resetCase(resultDiv);
    }

    if (activeInfo && activeInfo.progress) {
      handleStreamData(caseId, {
        type: "progress",
        phase: activeInfo.progress.phase || "sync",
        ...activeInfo.progress,
      });
    }
  } else if (status.canResume) {
    // RESUMABLE state
    runBtn.disabled = false;
    if (retryBtn) retryBtn.disabled = false;
    if (syncInput) syncInput.disabled = false;
    if (extInput) extInput.disabled = false;

    runBtn.innerHTML = `${AppIcons.PLAY}<span>Resume</span>`;
    runBtn.onclick = () => runCase(caseId, runBtn, resultDiv, { resume: true });

    resetBtn.innerHTML = `${AppIcons.RESET}<span>Hard Reset</span>`;
    resetBtn.classList.remove("stop-btn", "resume-btn");
    resetBtn.onclick = () => {
      showAppAlert(
        "Hard Reset",
        "This will clear the current progress and start fresh next time. Continue?",
        {
          isConfirm: true,
          onConfirm: async () => {
            await fetch("/api/run-state/clear", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ caseId }),
            });
            resetCase(resultDiv);
            updateSystemStatus();
          },
        },
      );
    };
  } else {
    // READY / IDLE state
    runBtn.disabled = false;
    if (retryBtn) retryBtn.disabled = false;
    if (syncInput) syncInput.disabled = false;
    if (extInput) extInput.disabled = false;

    runBtn.innerHTML = `${AppIcons.PLAY}<span>${getRunButtonLabel(caseId)}</span>`;
    runBtn.onclick = () => runCase(caseId, runBtn, resultDiv);

    resetBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
    resetBtn.classList.remove("stop-btn", "resume-btn");
    resetBtn.onclick = () => resetCase(resultDiv);
  }
}

const OTHER_RUN_DISABLED_TITLE =
  "Another process is currently running. Stop it to run this case.";
const ROW_INACTIVE_HOVER_TITLE =
  "Operation disabled while another run is active";

function setOtherRowsInactive(currentRow, title) {
  const tbody = document.getElementById("rows");
  if (!tbody) return;
  const msg = title || OTHER_RUN_DISABLED_TITLE;
  const rows = tbody.querySelectorAll("tr[data-case-id]");
  rows.forEach((tr) => {
    if (tr === currentRow) return;
    tr.classList.add("row-inactive");
    tr.setAttribute("title", ROW_INACTIVE_HOVER_TITLE);
  });
}

function setOtherRowsActive() {
  const tbody = document.getElementById("rows");
  if (!tbody) return;
  const rows = tbody.querySelectorAll("tr[data-case-id]");
  rows.forEach((tr) => {
    tr.classList.remove("row-inactive");
    tr.removeAttribute("title");
  });
}
