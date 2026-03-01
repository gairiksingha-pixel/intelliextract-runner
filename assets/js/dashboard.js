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
let CURRENT_ACTIVE_RUNS = [];
let STAGING_COUNT = null;

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

  BRAND_PURCHASERS = window.BRAND_PURCHASERS || {};

  const set = new Set();
  Object.values(BRAND_PURCHASERS).forEach((arr) =>
    arr.forEach((p) => set.add(p)),
  );
  ALL_PURCHASERS = Array.from(set).sort((a, b) => {
    const nameA = AppUtils.formatPurchaserName(a).toLowerCase();
    const nameB = AppUtils.formatPurchaserName(b).toLowerCase();
    const isTempA = nameA.includes("temp");
    const isTempB = nameB.includes("temp");
    if (isTempA && !isTempB) return 1;
    if (!isTempA && isTempB) return -1;
    return nameA.localeCompare(nameB);
  });

  // Expose to window for schedule-modal
  window.BRAND_PURCHASERS = BRAND_PURCHASERS;
  window.ALL_PURCHASERS = ALL_PURCHASERS;

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

  // Auto-pause on reload/leave
  window.addEventListener("beforeunload", () => {
    // Only stop manual runs, as scheduled ones should be persistent theoretically,
    // but the user requirement implies all current dashboard-visible ops should pause.
    const manualRuns = CURRENT_ACTIVE_RUNS.filter((r) => r.origin === "manual");
    for (const run of manualRuns) {
      const payload = JSON.stringify({ caseId: run.caseId, origin: "manual" });
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon("/api/stop-run", blob);
    }
  });
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
  resultDiv.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(
    c.id,
  )}</span>`;
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
    resultDiv.innerHTML = `<span class="alert-icon-wrap">${AppIcons.ALERT}</span><span class="result-placeholder-text">Please select at least one brand or purchaser from filter.</span>`;
    return;
  }

  const pairs = getPairsForRun();
  if (
    SELECTED_BRANDS.length > 0 &&
    SELECTED_PURCHASERS.length > 0 &&
    pairs.length === 0
  ) {
    resultDiv.className = "result result-placeholder result-validation-alert";
    resultDiv.innerHTML = `<span class="alert-icon-wrap">${AppIcons.ALERT}</span><span class="result-placeholder-text">No valid brand/purchaser combination for the selected filter. Use Reset filter and try again.</span>`;
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
      '<span class="exit">Starting process…<span class="loading-dots"></span></span><div class="sync-progress-bar"><div class="sync-progress-fill sync-progress-indeterminate" style="width:0%"></div></div>';

    const isPipe = caseId === "PIPE";
    row._isRetryFailed = !!options.retryFailed;
    row._isPaused = false; // Clear pause state on new run
    btn.innerHTML = `${AppIcons.PAUSE}<span>Pause</span>`;
    btn.disabled = false;
    btn.onclick = () => stopCase(caseId, row, resultDiv, "manual");
    resetBtn.disabled = true;
    resetBtn.style.display = "none"; // Instant hide

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
      // Safety: If the reader finishes but we're still in 'running' state and haven't shown a result,
      // it means the stream ended without a 'report' JSON. We should force a result check.
      const currentState = getRowProgress(caseId);
      if (currentState && resultDiv.classList.contains("running")) {
        // Fetch status one last time to get the final state
        const statusRes = await fetch(`/api/run-status?caseId=${caseId}`);
        if (statusRes.ok) {
          const finalData = await statusRes.json();
          handleStreamData(caseId, { type: "report", ...finalData });
        }
      }
    } catch (e) {
      if (e.name === "AbortError" || e.message?.includes("aborted")) {
        // Handled by Stop logic
      } else {
        resultDiv.className = "result fail";
        resultDiv.innerHTML = `<span class="exit">Error: ${AppUtils.esc(
          e.message,
        )}</span>`;
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
  const isManual = origin === "manual";
  const title = isManual ? "Pause Operation" : "Stop Operation";
  const message = isManual
    ? "Are you sure you want to pause the current process? Progress will be saved for resumption."
    : "Are you sure you want to stop the current process? Progress will be saved for resumption.";
  const confirmText = isManual ? "Yes, Pause" : "Yes, Stop";

  showAppAlert(title, message, {
    isConfirm: true,
    confirmText,
    onConfirm: async () => {
      try {
        const res = await fetch("/api/stop-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId, origin }),
        });

        if (!res.ok) {
          const errText = await res.text();
          // If process not found, it finished or was stopped already. Silent handle.
          if (res.status === 404 && errText.includes("Process not found")) {
            return;
          }
          throw new Error(errText);
        }

        row._isPaused = isManual; // Mark as paused if manual and stop-run was successful
        resultDiv.innerHTML = '<span class="exit">Stopping process...</span>';
        // Instant reveal for better UX
        const resetBtn = row.querySelector(
          ".reset-case:not(.reset-during-resume)",
        );
        if (resetBtn) {
          resetBtn.style.display = "flex";
          resetBtn.disabled = false;
        }
      } catch (e) {
        showAppAlert("Error", "Failed to stop process: " + e.message, true);
      }
    },
  });
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
  } else if (data.type === "run_id") {
    state.runId = data.runId;
  } else if (data.type === "error") {
    showResult(div, data, false, { caseId });
  }
}

function buildResultTable(caseId, data, pass, stdoutStr, stderrStr) {
  const row = document.getElementById(`result-${caseId}`)?.closest("tr");
  const SYNC_CASES = ["P1", "PIPE", "P5"];
  const EXTRACT_CASES = ["P2", "PIPE", "P5", "P3"];

  function filterResultLine(line) {
    line = line.trim();
    if (!line) return false;
    // Filter out protocol markers (handle both tabs and spaces)
    if (
      /^(SYNC_PROGRESS|SYNC_SUMMARY|EXTRACTION_PROGRESS|RESUME_SKIP|RESUME_SKIP_SYNC|RUN_ID|RUN_PROTOCOL)\b/.test(
        line,
      )
    )
      return false;
    // Filter out JSON markers if they look like system signals
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "run_id" || parsed.runId) return false;
      } catch (e) {}
      return false; // Safely filter out any JSON line in stdout logs
    }
    if (line.indexOf("Report(s) written:") !== -1) return false;
    if (/Run (?:run_|RUN|SKIP-)\S+ finished\./.test(line)) return false;
    return true;
  }

  let statusLabel = pass ? "Success" : "Failed";
  if (row?._isPaused) statusLabel = "Paused";

  const parsed = {
    protocol: { sync: null, extract: null, skipSync: null },
  };

  const allLines = stdoutStr ? stdoutStr.split("\n") : [];
  for (let i = 0; i < allLines.length; i++) {
    const lineRaw = (allLines[i] || "").replace(/\r$/, "");
    const line = lineRaw.trim();
    if (!line) continue;

    // 1. Capture Protocol Markers (Last wins)
    const syncM = /SYNC_PROGRESS\s+(\d+)\s+(\d+)/.exec(line);
    if (syncM)
      parsed.protocol.sync = {
        done: parseInt(syncM[1]),
        total: parseInt(syncM[2]),
      };

    const extM = /EXTRACTION_PROGRESS\s+(\d+)\s+(\d+)/.exec(line);
    if (extM)
      parsed.protocol.extract = {
        done: parseInt(extM[1]),
        total: parseInt(extM[2]),
      };

    const skipM = /RESUME_SKIP_SYNC\s+(\d+)\s+(\d+)/.exec(line);
    if (skipM)
      parsed.protocol.skipSync = {
        done: parseInt(skipM[1]),
        total: parseInt(skipM[2]),
      };

    const runIdM = /RUN_ID\s+(\S+)/.exec(line);
    if (runIdM) parsed.runId = runIdM[1];

    // 2. Capture Identity and Limits
    let m;
    if (line.startsWith("Sync Summary")) {
      parsed.syncSummaryLine = line;
    } else if (
      line.startsWith("------------") &&
      parsed.syncSummaryLine === "Sync Summary"
    ) {
      // ignore divider
    } else if (
      (m = /^(?:Downloaded|Synced)\s*\(new\):\s*(\d+)\s*/i.exec(line)) ||
      (m = /^Downloaded:\s*(\d+)\s*/i.exec(lineRaw))
    ) {
      parsed.downloadedNew = m[1];
    } else if (
      (m = /^Skipped\s*\(already\s*present[^:]*:\s*(\d+)\s*/i.exec(line)) ||
      (m = /^Skipped:\s*(\d+)\s*/i.exec(lineRaw))
    ) {
      parsed.skipped = m[1];
    } else if (
      (m = /^Errors:\s*(\d+)\s*/i.exec(line)) ||
      (m = /^Errors:\s*(\d+)\s*/i.exec(lineRaw))
    ) {
      parsed.errors = m[1];
    } else if ((m = /^Download limit:\s*(.+)$/.exec(line))) {
      parsed.downloadLimit = m[1];
    } else if ((m = /^\s+Staging path:\s*(.+)$/.exec(lineRaw))) {
      if (!parsed.stagingPaths) parsed.stagingPaths = [];
      parsed.stagingPaths.push(m[1].trim());
    } else if (
      (m = /^Scoped to tenant:\s*([^,]+),\s*purchaser:\s*(.+)$/.exec(line))
    ) {
      parsed.brandAndPurchaser = (m[1].trim() + " / " + m[2].trim()).trim();
    } else if (
      (m = /^\s{2}([^:\s][^:/]*\/[^:\s][^:]*)(?::\s*(.*))?$/.exec(lineRaw)) &&
      lineRaw.indexOf("/") !== -1 &&
      !/Staging path|Downloaded:|Skipped:|Errors:|Sync Summary|Limit:/.test(
        lineRaw,
      )
    ) {
      if (!parsed.syncBucketDetails) parsed.syncBucketDetails = [];
      if (!parsed.brandAndPurchaserList) parsed.brandAndPurchaserList = [];

      const fullLine = line.trim();
      const identityPart = m[1].trim();

      if (!parsed.syncBucketDetails.includes(fullLine)) {
        parsed.syncBucketDetails.push(fullLine);
      }
      if (!parsed.brandAndPurchaserList.includes(identityPart)) {
        parsed.brandAndPurchaserList.push(identityPart);
      }
    } else if (
      (m = /^ {4}(Downloaded:\s*\d+,\s*Skipped:\s*\d+,\s*Errors:\s*\d+)$/.exec(
        lineRaw,
      ))
    ) {
      if (parsed.syncBucketDetails && parsed.syncBucketDetails.length > 0) {
        parsed.syncBucketDetails[parsed.syncBucketDetails.length - 1] +=
          ": " + m[1];
      }
    } else if (
      (m =
        /^Extraction (?:metrics|metrics|results):\s*(?:success|done)=(\d+),\s*skipped=(\d+),\s*(?:failed|errors)=(\d+)\s*$/.exec(
          line,
        ))
    ) {
      parsed.extractSuccess = m[1];
      parsed.extractSkipped = m[2];
      parsed.extractFailed = m[3];
    } else if (
      (m = /^(?:Extraction result\(s\)|Results):\s*(.+?)\s*\(full/.exec(line))
    ) {
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
  if (!parsed.runId && data && (data.runId || data.run_id))
    parsed.runId = data.runId || data.run_id;

  // Apply server-provided sync summary so run output always shows counts (e.g. P1 sync-only)
  if (data && data.syncSummary && typeof data.syncSummary === "object") {
    const s = data.syncSummary;
    if (parsed.downloadedNew == null)
      parsed.downloadedNew = String(s.downloaded ?? 0);
    if (parsed.skipped == null) parsed.skipped = String(s.skipped ?? 0);
    if (parsed.errors == null) parsed.errors = String(s.errors ?? 0);
    if (!parsed.syncSummaryLine) parsed.syncSummaryLine = "Sync Summary";
    if (!parsed.downloadLimit) parsed.downloadLimit = "no limit";
  }

  let stdoutFiltered = stdoutStr
    ? stdoutStr.split("\n").filter(filterResultLine).join("\n").trim()
    : "";
  let stderrFiltered = stderrStr
    ? stderrStr.split("\n").filter(filterResultLine).join("\n").trim()
    : "";
  if (caseId === "P3") {
    const stripKeys = (text) =>
      text
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return (
            !/^Download overview\b/i.test(trimmed) &&
            !/^Overall status\b/i.test(trimmed)
          );
        })
        .join("\n")
        .trim();
    stdoutFiltered = stripKeys(stdoutFiltered);
    stderrFiltered = stripKeys(stderrFiltered);
  }

  // Also extract from structured report data if stdout wasn't parsed
  if (data.successCount !== undefined && parsed.extractSuccess === undefined) {
    parsed.extractSuccess = String(data.successCount);
    if (data.skippedCount !== undefined)
      parsed.extractSkipped = String(data.skippedCount);
    if (data.failedCount !== undefined)
      parsed.extractFailed = String(data.failedCount);
  }

  const hasSync = !!caseId && SYNC_CASES.indexOf(caseId) !== -1;
  const hasExtract = !!caseId && EXTRACT_CASES.indexOf(caseId) !== -1;

  const allNewExtractZero =
    (parsed.extractSuccess === "0" ||
      parsed.extractSuccess === 0 ||
      parsed.extractSuccess == null) &&
    (parsed.extractFailed === "0" ||
      parsed.extractFailed === 0 ||
      parsed.extractFailed == null);
  const noSyncDownloaded =
    parsed.downloadedNew == null || parsed.downloadedNew === "0";

  const isNoNewProcessed =
    pass &&
    allNewExtractZero &&
    (noSyncDownloaded || !hasSync) &&
    (parsed.extractSuccess !== undefined ||
      parsed.downloadedNew !== undefined ||
      stdoutFiltered.length > 0);

  const rows = [];
  rows.push(["Status", statusLabel]);

  // Identity Row
  let identity = parsed.brandAndPurchaser;
  if (
    !identity &&
    parsed.brandAndPurchaserList &&
    parsed.brandAndPurchaserList.length
  ) {
    identity = parsed.brandAndPurchaserList.join(", ");
  }
  if (identity) rows.push(["Brand and purchaser", identity]);

  // Sync Progress Row
  if (parsed.protocol.sync) {
    const { done, total } = parsed.protocol.sync;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    rows.push(["Sync Progress", `${done} / ${total} files synced (${pct}%)`]);
  }

  // Extraction Progress Row
  if (parsed.protocol.extract) {
    const { done, total } = parsed.protocol.extract;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    rows.push(["Extraction", `${done} / ${total} files processed (${pct}%)`]);
  }

  // Skipped (Resumed) Row
  if (parsed.protocol.skipSync) {
  }

  if (parsed.stagingPaths && parsed.stagingPaths.length)
    rows.push(["Staging path", parsed.stagingPaths.join("\n")]);

  if (isNoNewProcessed) {
    const hasExistingKnown =
      (parsed.skipped != null &&
        parsed.skipped !== "0" &&
        parsed.skipped !== 0) ||
      (parsed.extractSkipped != null &&
        parsed.extractSkipped !== "0" &&
        parsed.extractSkipped !== 0) ||
      (parsed.cumTotal != null &&
        parsed.cumTotal !== "0" &&
        parsed.cumTotal !== 0);

    let msg = hasExistingKnown
      ? "All files up to date. No new processing required."
      : "No files found to sync or extract.";

    if (row && row._isRetryFailed) {
      msg = "No failed files found to retry.";
    }
    rows.push(["Message", msg]);
  }

  const hasSyncDetails =
    parsed.syncSummaryLine ||
    parsed.downloadLimit ||
    parsed.downloadedNew ||
    (parsed.syncBucketDetails && parsed.syncBucketDetails.length);

  if (hasSync && hasSyncDetails) {
    let output = "";
    if (parsed.downloadLimit)
      output += "Download limit: " + parsed.downloadLimit + "\n";
    if (parsed.downloadedNew != null)
      output += "Downloaded (new): " + parsed.downloadedNew + "\n";
    if (parsed.skipped != null)
      output +=
        "Skipped (already present, unchanged): " + parsed.skipped + "\n";
    if (parsed.errors != null) output += "Errors: " + parsed.errors + "\n";
    const downNum = parseInt(parsed.downloadedNew || "0", 10);
    const skipNum = parseInt(parsed.skipped || "0", 10);

    if (parsed.syncBucketDetails && parsed.syncBucketDetails.length) {
      output +=
        "\nBy brand (staging path → counts):\n  " +
        parsed.syncBucketDetails.join("\n  ");
    }
    const labelName = caseId === "P1" ? "Download overview" : "Output";
    rows.push([labelName, output.trim()]);
  }

  if (hasExtract) {
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

  if (!isNoNewProcessed && !hasSync && !hasExtract && stdoutFiltered) {
    rows.push([
      "Output",
      AppUtils.esc(stdoutFiltered.slice(0, 5000)) +
        (stdoutFiltered.length > 5000 ? "…" : ""),
    ]);
  } else if (!isNoNewProcessed && rows.length === 1 && !hasSyncDetails) {
    const noOutput = !stdoutFiltered && !stderrFiltered;
    let msg = "—";
    if (noOutput) {
      if (pass) {
        msg = "The operation finished successfully.";
        // If it's a sync or extract case and we have nothing else, it's likely just done
        if (hasSync && !hasExtract) msg = "Synchronization complete.";
        if (!hasSync && hasExtract) msg = "Extraction complete.";
      } else {
        msg =
          "Command produced no output. Check server logs or run in a terminal for details.";
      }
    }
    rows.push(["Output", msg]);
  }

  if (stderrFiltered) {
    rows.push([
      "Standard error",
      AppUtils.esc(stderrFiltered.slice(0, 5000)) +
        (stderrFiltered.length > 5000 ? "…" : ""),
    ]);
  }

  if (parsed.runId) {
    const reportUrl = `/reports/summary#history?runId=${parsed.runId}`;
    rows.push([
      "Operation report",
      `<a href="${reportUrl}" class="view-report-btn" target="_self">
        ${AppIcons.SUMMARY}
        <span>Click to view report</span>
      </a>`,
    ]);
  } else if (parsed.reportsPath || parsed.extractionResultsPath) {
    rows.push([
      "Operation report",
      "The reports and extracted data are ready. You can check them in the <b>Reports</b> toolbar.",
    ]);
  }

  const LABEL_HTML_SAFE = new Set([
    "Standard error",
    "Output",
    "Extraction overview",
    "Sync Progress",
    "Extraction",
    "Resumed State",
    "Overall status",
    "Operation report",
  ]);
  const METRIC_ROWS = new Set([
    "Status",
    "Brand and purchaser",
    "Staging path",
    "Download overview",
    "Extraction overview",
    "Message",
    "Sync Progress",
    "Extraction",
    "Resumed State",
    "Overall status",
    "Operation report",
  ]);

  const tableRows = rows.map((r) => {
    const label = r[0];
    const cls =
      (label === "Status" ? "status-row " : "") +
      (METRIC_ROWS.has(label) ? "metric-row" : "");
    const val = LABEL_HTML_SAFE.has(label)
      ? r[1]
      : AppUtils.esc(r[1]).replace(/\n/g, "<br>");
    return `<tr${
      cls ? ` class="${cls.trim()}"` : ""
    }><th>${label}</th><td>${val}</td></tr>`;
  });

  return `<table class="result-table-wrap">${tableRows.join("")}</table>`;
}

function showResult(div, data, pass, options) {
  const resultClass = data ? (pass ? "pass" : "fail") : "running";
  div.className = "result " + resultClass;

  if (data) {
    const caseId = (options && options.caseId) || "";
    if (!data.runId && options && options.runId) data.runId = options.runId;
    if (data.type === "report" || data.type === "error") {
      // Use built-in structured table logic for both success and error/interrupt reports
      const stdout = data.stdout
        ? String(data.stdout).trim()
        : data.message && data.type === "error"
          ? data.message
          : "";
      const stderr = data.stderr ? String(data.stderr).trim() : "";
      div.innerHTML = buildResultTable(caseId, data, pass, stdout, stderr);
    } else {
      // Fallback for simple error objects
      const errMsg = data.message || "Unknown error";
      const rows = [
        ["Status", "Failed"],
        ["Output", AppUtils.esc(errMsg)],
      ];
      div.innerHTML = `<table class="result-table-wrap">${rows
        .map(
          (r) =>
            `<tr class="status-row metric-row"><th>${r[0]}</th><td>${r[1]}</td></tr>`,
        )
        .join("")}</table>`;
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

  const hasSync = !!syncProgress;
  const hasExtraction = !!extractionProgress;
  const hasResumeSkipSync = !!resumeSkipSyncProgress;
  const hasResumeSkipExtract = !!resumeSkipExtractProgress;

  if (hasResumeSkipSync && caseId !== "PIPE") {
    const done = Number(resumeSkipSyncProgress.skipped) || 0;
    const total = Number(resumeSkipSyncProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping synced files: ${
        total > 0 ? done + " / " + total : done + " file(s)"
      } skipped</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill ${
        done === 0 ? "sync-progress-indeterminate" : ""
      }" style="width:${total > 0 ? pct : 0}%"></div></div>
    `;
  }

  if (hasResumeSkipExtract) {
    const done = Number(resumeSkipExtractProgress.skipped) || 0;
    const total = Number(resumeSkipExtractProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap skip-progress-wrap">Runner is skipping extracted files: ${
        total > 0 ? done + " / " + total : done + " file(s)"
      } skipped</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill skip-fill ${
        done === 0 ? "sync-progress-indeterminate" : ""
      }" style="width:${total > 0 ? pct : 0}%"></div></div>
    `;
  }

  if (hasSync) {
    const done = Number(syncProgress.done) || 0;
    const total = Number(syncProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap">Runner is syncing file: ${
        total > 0 ? done + " / " + total : done + " file(s)"
      }</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${
        done === 0 ? "sync-progress-indeterminate" : ""
      }" style="width:${total > 0 ? pct : 0}%"></div></div>
    `;
  }

  if (hasExtraction) {
    const done = Number(extractionProgress.done) || 0;
    const total = Number(extractionProgress.total) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
    extra += `
      <div class="sync-progress-wrap extraction-progress-wrap">Runner is extracting: ${
        total > 0 ? done + " / " + total : done + " file(s)"
      }</div>
      <div class="sync-progress-bar"><div class="sync-progress-fill ${
        done === 0 ? "sync-progress-indeterminate" : ""
      }" style="width:${total > 0 ? pct : 0}%"></div></div>
    `;
  }

  if (!logMessage) {
    if (hasResumeSkipSync || hasResumeSkipExtract || hasSync || hasExtraction) {
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

  // Always show dots and indeterminate bar if no real progress bars (extra) are present yet
  const showActiveState =
    !hasResumeSkipSync && !hasResumeSkipExtract && !hasSync && !hasExtraction;

  div.innerHTML = `
    <span class="exit">
      ${AppUtils.esc(label)}<span class="loading-dots"></span>
    </span>
    ${
      showActiveState
        ? '<div class="sync-progress-bar"><div class="sync-progress-fill sync-progress-indeterminate" style="width:0%"></div></div>'
        : ""
    }
    ${extra}
  `;
}

const ICON_MINI_RESET =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

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
  div.innerHTML = `<span class="result-placeholder-text">${getPlaceholderText(
    caseId,
  )}</span>`;
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
    html += `
      <div class="limit-chip">
        <span class="limit-label">Limit:</span>
        <input type="number" class="limit-sync" min="0" step="1" value="0" title="Max files to sync; each is extracted in background as it is synced. 0 = no limit">
        <button type="button" class="field-reset" title="Reset to 0">${ICON_MINI_RESET}</button>
      </div>`;
  } else {
    if (lim.sync)
      html += `
        <div class="limit-chip">
          <span class="limit-label">Sync:</span>
          <input type="number" class="limit-sync" min="0" step="1" value="0" title="Max files to download. 0 = no limit">
          <button type="button" class="field-reset" title="Reset to 0">${ICON_MINI_RESET}</button>
        </div>`;
    if (lim.extract)
      html += `
        <div class="limit-chip">
          <span class="limit-label">Extract:</span>
          <input type="number" class="limit-extract" min="0" step="1" value="0" title="Max files to extract. 0 = no limit">
          <button type="button" class="field-reset" title="Reset to 0">${ICON_MINI_RESET}</button>
        </div>`;
  }
  html += '</div><div class="limit-hint">0 = no limit</div></td>';
  return html;
}

// --- Dropdown Management ---

// --- Event Delegation ---
document.addEventListener("click", (e) => {
  const fieldReset = e.target.closest(".field-reset");
  if (fieldReset) {
    const chip = fieldReset.closest(".limit-chip");
    const input = chip?.querySelector('input[type="number"]');
    if (input) {
      input.value = 0;
      input.dispatchEvent(new Event("change"));
    }
  }
});

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
    CURRENT_ACTIVE_RUNS = activeRuns;
    try {
      const invRes = await fetch("/api/staging-stats");
      const invData = await invRes.json();
      if (typeof invData.count === "number") STAGING_COUNT = invData.count;
    } catch (_) {}

    const statusText = document.getElementById("system-status-text");
    const pill = document.querySelector(".system-status-pill");

    if (statusText && pill) {
      if (activeRuns.length > 0) {
        const run = activeRuns[0];
        let text = "Runner is busy";

        // Initial label based on caseId if no specific status or progress yet
        if (run.caseId === "P1" || run.caseId === "PIPE") {
          text = "Syncing files...";
        } else if (run.caseId === "P2") {
          text = "Extracting data...";
        }

        if (
          run.status === "syncing" ||
          (run.syncProgress && run.syncProgress.total > 0)
        ) {
          const p = run.syncProgress;
          text =
            p && p.total > 0
              ? `Syncing files (${p.done}/${p.total})`
              : "Syncing files...";
        } else if (
          run.status === "extracting" ||
          (run.extractProgress && run.extractProgress.total > 0) ||
          (run.progress && run.progress.total > 0)
        ) {
          const p = run.extractProgress || run.progress;
          if (p && p.total > 0) {
            text = `Extracting data (${p.done}/${p.total})`;
          } else if (p && p.percent !== undefined) {
            text = `Extracting data (${p.percent}%)`;
          } else {
            text = "Extracting data...";
          }
        }

        if (statusText.textContent !== text) {
          statusText.textContent = text;
        }
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
  const allFieldResets = row.querySelectorAll(".field-reset");

  const setFieldResetsDisabled = (isDisabled) => {
    allFieldResets.forEach((b) => (b.disabled = isDisabled));
  };

  if (status.isRunning) {
    // RUNNING state
    runBtn.disabled = true;
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.innerHTML = `${AppIcons.RETRY}<span>Retry Failed</span>`;
    }
    if (syncInput) syncInput.disabled = true;
    if (extInput) extInput.disabled = true;
    setFieldResetsDisabled(true);

    const isScheduled = activeInfo && activeInfo.origin === "scheduled";
    if (isScheduled) {
      runBtn.disabled = true;
      resetBtn.innerHTML = `${AppIcons.STOP}<span>Stop Auto Extraction</span>`;
      resetBtn.classList.add("stop-btn");
      resetBtn.classList.remove("resume-btn");
      resetBtn.onclick = () => stopCase(caseId, row, resultDiv, "scheduled");
      resetBtn.disabled = false;
      resetBtn.style.display = "flex";
    } else {
      // Manual run
      runBtn.disabled = false;
      runBtn.innerHTML = `${AppIcons.PAUSE}<span>Pause</span>`;
      runBtn.onclick = () => stopCase(caseId, row, resultDiv, "manual");

      resetBtn.style.display = "none";
      resetBtn.disabled = true;
    }

    if (activeInfo) {
      if (activeInfo.syncProgress) {
        handleStreamData(caseId, {
          type: "progress",
          phase: "sync",
          ...activeInfo.syncProgress,
        });
      }
      if (activeInfo.extractProgress) {
        handleStreamData(caseId, {
          type: "progress",
          phase: "extract",
          ...activeInfo.extractProgress,
        });
      }
      if (activeInfo.resumeSkipSyncProgress) {
        handleStreamData(caseId, {
          type: "resume_skip",
          phase: "sync",
          ...activeInfo.resumeSkipSyncProgress,
        });
      }
      if (activeInfo.resumeSkipExtractProgress) {
        handleStreamData(caseId, {
          type: "resume_skip",
          phase: "extract",
          ...activeInfo.resumeSkipExtractProgress,
        });
      }
      if (activeInfo.progress) {
        // Fallback for scheduled/legacy
        handleStreamData(caseId, {
          type: "progress",
          phase: activeInfo.progress.phase || "sync",
          ...activeInfo.progress,
        });
      }
    }
  } else if (status.canResume) {
    // RESUMABLE state
    runBtn.disabled = false;
    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.innerHTML = `${AppIcons.RETRY}<span>Retry Failed</span>`;
      retryBtn.onclick = () =>
        runCase(caseId, retryBtn, resultDiv, { retryFailed: true });
    }
    if (syncInput) syncInput.disabled = false;
    if (extInput) extInput.disabled = false;
    setFieldResetsDisabled(false);

    runBtn.innerHTML = `${AppIcons.PLAY}<span>Resume</span>`;
    runBtn.onclick = () => runCase(caseId, runBtn, resultDiv, { resume: true });

    resetBtn.innerHTML = `${AppIcons.RESET}<span>Reset</span>`;
    resetBtn.classList.remove("stop-btn", "resume-btn");
    resetBtn.disabled = false;
    resetBtn.style.display = "flex";
    resetBtn.onclick = () => {
      showAppAlert(
        "Hard Reset",
        "Resetting will clear the result view and current pause point. The next run will check all files from the beginning (skipping those already done). Continue?",
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
    if (retryBtn) {
      retryBtn.disabled = false;
      retryBtn.innerHTML = `${AppIcons.RETRY}<span>Retry Failed</span>`;
      retryBtn.onclick = () =>
        runCase(caseId, retryBtn, resultDiv, { retryFailed: true });
    }
    if (syncInput) syncInput.disabled = false;
    if (extInput) extInput.disabled = false;
    setFieldResetsDisabled(false);

    runBtn.innerHTML = `${AppIcons.PLAY}<span>${getRunButtonLabel(
      caseId,
    )}</span>`;
    runBtn.onclick = () => runCase(caseId, runBtn, resultDiv);

    resetBtn.style.display = "none"; // Hide reset when no action is ongoing
    resetBtn.disabled = true;
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

/**
 * Report Overlay Management
 */
window.showReportOverlay = function (event, url) {
  if (event) event.preventDefault();
  const overlay = document.getElementById("report-view-overlay");
  const frame = document.getElementById("report-view-frame");
  const loader = document.getElementById("report-view-loader");

  if (!overlay || !frame) return;

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  if (loader) loader.style.display = "flex";

  frame.onload = () => {
    if (loader) loader.style.display = "none";
  };
  frame.src = url;

  // Add close button listener if not already there
  if (!window._reportOverlayCloseInited) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) window.hideReportOverlay();
    });
    window._reportOverlayCloseInited = true;
  }
};

window.hideReportOverlay = function () {
  const overlay = document.getElementById("report-view-overlay");
  const frame = document.getElementById("report-view-frame");
  if (!overlay || !frame) return;

  overlay.style.display = "none";
  overlay.setAttribute("aria-hidden", "true");
  frame.src = "";
};

// Global escape key for all overlays
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.hideReportOverlay();
  }
});
