/**
 * Executive summary report: HTML and JSON.
 * Includes full API extraction response(s) per file when available.
 */

import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import type {
  Config,
  RunMetrics,
  ExecutiveSummary,
  CheckpointRecord,
} from "./types.js";
import {
  openCheckpointDb,
  getRecordsForRun,
  getAllRunIdsOrdered,
  closeCheckpointDb,
} from "./checkpoint.js";
import { computeMetrics } from "./metrics.js";

export interface ExtractionResultEntry {
  filename: string;
  response: unknown;
  /** Derived from API response.success when available */
  extractionSuccess: boolean;
}

export interface HistoricalRunSummary {
  runId: string;
  metrics: RunMetrics;
  extractionResults: ExtractionResultEntry[];
  records: CheckpointRecord[];
  start: Date;
  end: Date;
  brand?: string;
  purchaser?: string;
  runDurationSeconds: number;
  sessions?: Array<{
    runId: string;
    start: Date;
    end: Date;
    success: number;
    failed: number;
    skipped: number;
  }>;
}

function extractionResultFilenameFromRecord(record: {
  relativePath: string;
  brand: string;
  purchaser?: string;
}): string {
  const safe = record.relativePath
    .replaceAll("/", "_")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const base = record.brand + "_" + (safe || "file");
  return base.endsWith(".json") ? base : base + ".json";
}

/**
 * 🔥 FIXED:
 * extractionSuccess now respects response.success if present.
 * Folder name is only fallback.
 */
function loadJsonEntries(
  dir: string,
  defaultExtractionSuccess: boolean,
): ExtractionResultEntry[] {
  const entries: ExtractionResultEntry[] = [];

  const files = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(".json"),
  );

  for (const e of files) {
    const path = join(dir, e.name);

    try {
      const raw = readFileSync(path, "utf-8");
      const response = JSON.parse(raw) as unknown;

      let extractionSuccess = defaultExtractionSuccess;

      // ✅ Trust API response.success if present
      if (
        typeof response === "object" &&
        response !== null &&
        "success" in response
      ) {
        const successValue = (response as { success?: unknown }).success;
        if (typeof successValue === "boolean") {
          extractionSuccess = successValue;
        }
      }

      entries.push({
        filename: e.name,
        response,
        extractionSuccess,
      });
    } catch {
      // skip unreadable
    }
  }

  return entries;
}

function loadExtractionResults(
  config: Config,
  runId: string,
): ExtractionResultEntry[] {
  const baseDir = join(dirname(config.report.outputDir), "extractions");
  if (!existsSync(baseDir)) return [];

  const succeededDir = join(baseDir, "succeeded");
  const failedDir = join(baseDir, "failed");

  const fromSucceeded = existsSync(succeededDir)
    ? loadJsonEntries(succeededDir, true)
    : [];

  const fromFailed = existsSync(failedDir)
    ? loadJsonEntries(failedDir, false)
    : [];

  if (fromSucceeded.length > 0 || fromFailed.length > 0) {
    return [...fromSucceeded, ...fromFailed];
  }

  // Backward compatibility: flat structure
  return loadJsonEntries(baseDir, false);
}

function filterExtractionResultsForRecords(
  records: CheckpointRecord[],
  allResults: ExtractionResultEntry[],
): ExtractionResultEntry[] {
  const relevantFilenames = new Set(
    records.map((r) =>
      extractionResultFilenameFromRecord({
        relativePath: r.relativePath,
        brand: r.brand,
        purchaser: r.purchaser ?? undefined,
      }),
    ),
  );

  if (relevantFilenames.size === 0) return [];
  return allResults.filter((e) => relevantFilenames.has(e.filename));
}

function minMaxDatesFromRecords(
  records: { startedAt?: string; finishedAt?: string; runId?: string }[],
) {
  let startedAt = Number.NaN;
  let finishedAt = Number.NaN;

  for (const r of records) {
    if (r.startedAt) {
      const t = new Date(r.startedAt).getTime();
      startedAt = Number.isNaN(startedAt) ? t : Math.min(startedAt, t);
    }
    if (r.finishedAt) {
      const t = new Date(r.finishedAt).getTime();
      finishedAt = Number.isNaN(finishedAt) ? t : Math.max(finishedAt, t);
    }
  }

  let start: Date;
  if (!Number.isNaN(startedAt)) {
    start = new Date(startedAt);
  } else {
    // Fallback: try to parse date from runId of the first record
    const runId = records[0]?.runId;
    if (runId) {
      if (runId.startsWith("run_")) {
        // Old format: run_YYYY-MM-DD_HH-mm-ss_suffix
        const parts = runId.split("_");
        if (parts.length >= 3) {
          const datePart = parts[1]; // YYYY-MM-DD
          const timePart = parts[2]; // HH-mm-ss
          try {
            const d = new Date(`${datePart}T${timePart.replace(/-/g, ":")}`);
            start = !Number.isNaN(d.getTime()) ? d : new Date();
          } catch {
            start = new Date();
          }
        } else {
          start = new Date();
        }
      } else if (runId.startsWith("SKIP-")) {
        // New format: SKIP-YYYYMMDD-HHmmss-suffix
        const parts = runId.split("-");
        if (parts.length >= 3) {
          const dateStr = parts[1]; // YYYYMMDD
          const timeStr = parts[2]; // HHmmss
          const yr = dateStr.slice(0, 4);
          const mo = dateStr.slice(4, 6);
          const dy = dateStr.slice(6, 8);
          const hr = timeStr.slice(0, 2);
          const mn = timeStr.slice(2, 4);
          const sc = timeStr.slice(4, 6);
          try {
            const d = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}`);
            start = !Number.isNaN(d.getTime()) ? d : new Date();
          } catch {
            start = new Date();
          }
        } else {
          start = new Date();
        }
      } else {
        // For RUN1, etc. if no record has startedAt, we just use current time
        // to avoid the 1970/insane duration issue.
        start = new Date();
      }
    } else {
      start = new Date();
    }
  }

  const end = Number.isNaN(finishedAt)
    ? new Date(start.getTime() || Date.now())
    : new Date(finishedAt);

  return { start, end };
}

export function loadHistoricalRunSummaries(
  config: Config,
): HistoricalRunSummary[] {
  const db = openCheckpointDb(config.run.checkpointPath);
  const runIds = getAllRunIdsOrdered(db);

  // 1. Collect raw data for all runs
  const rawSummaries: Array<{
    runId: string;
    records: any[];
    start: Date;
    end: Date;
    brand?: string;
    purchaser?: string;
    results: ExtractionResultEntry[];
  }> = [];

  for (const runId of runIds) {
    const records = getRecordsForRun(db, runId);
    if (records.length === 0) continue;

    const allResultsForRun = loadExtractionResults(config, runId);

    // Group records in this run by (brand, purchaser)
    const recordsByGroup = new Map<string, CheckpointRecord[]>();
    for (const r of records) {
      const key = `${r.brand}|${r.purchaser || ""}`;
      if (!recordsByGroup.has(key)) recordsByGroup.set(key, []);
      recordsByGroup.get(key)!.push(r);
    }

    for (const [key, groupRecords] of recordsByGroup) {
      const { start, end } = minMaxDatesFromRecords(groupRecords);
      let [brand, purchaser] = key.split("|");

      // Robust detection for display
      if (!purchaser || purchaser === "") {
        const pSet = new Set<string>();
        for (const r of groupRecords) {
          if (r.purchaser) pSet.add(r.purchaser);
          else if (r.relativePath) {
            const first = r.relativePath.split(/[\\/]/)[0];
            if (first && first !== "output" && first !== "staging")
              pSet.add(first);
          }
        }
        if (pSet.size === 1) purchaser = [...pSet][0];
      }

      const results = filterExtractionResultsForRecords(
        groupRecords,
        allResultsForRun,
      );

      rawSummaries.push({
        runId,
        records: groupRecords,
        start,
        end,
        brand: brand || undefined,
        purchaser: purchaser || undefined,
        results,
      });
    }
  }
  closeCheckpointDb(db);

  // 2. Group by Brand + Purchaser
  const groups = new Map<string, typeof rawSummaries>();
  for (const s of rawSummaries) {
    const key = (s.brand || "") + "|" + (s.purchaser || "");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const out: HistoricalRunSummary[] = [];
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

  // 3. Cluster by time and Merge
  for (const [, groupItems] of groups) {
    // Sort by start time just in case
    groupItems.sort((a, b) => a.start.getTime() - b.start.getTime());

    const clusters: Array<typeof groupItems> = [];
    if (groupItems.length > 0) {
      let currentCluster = [groupItems[0]];
      for (let i = 1; i < groupItems.length; i++) {
        const prev = groupItems[i - 1];
        const curr = groupItems[i];
        // Merge if gap between rounds is <= 2 hours
        if (curr.start.getTime() - prev.end.getTime() <= TWO_HOURS_MS) {
          currentCluster.push(curr);
        } else {
          clusters.push(currentCluster);
          currentCluster = [curr];
        }
      }
      clusters.push(currentCluster);
    }

    for (const cluster of clusters) {
      const latestRun = cluster[cluster.length - 1];
      const allRecordsPooled = cluster.flatMap((c) => c.records);
      const allResultsPooled = cluster.flatMap((c) => c.results);

      // Dedupe records by filePath.
      // Priority: done > error > skipped. Within same status, latest wins.
      const statusPriority = {
        done: 3,
        error: 2,
        skipped: 1,
        pending: 0,
        running: 0,
      };
      const recordMap = new Map<string, any>();
      for (const r of allRecordsPooled) {
        const existing = recordMap.get(r.filePath);
        if (!existing) {
          recordMap.set(r.filePath, r);
          continue;
        }
        const pExisting =
          statusPriority[existing.status as keyof typeof statusPriority] ?? 0;
        const pCurr =
          statusPriority[r.status as keyof typeof statusPriority] ?? 0;
        if (pCurr > pExisting) {
          recordMap.set(r.filePath, r);
        } else if (pCurr === pExisting) {
          const tExisting = new Date(
            existing.finishedAt || existing.startedAt || 0,
          ).getTime();
          const tCurr = new Date(r.finishedAt || r.startedAt || 0).getTime();
          if (tCurr >= tExisting) {
            recordMap.set(r.filePath, r);
          }
        }
      }
      const dedupedRecords = Array.from(recordMap.values());

      // Dedupe results by filename. Keep latest (latest cluster member)
      const resultsMap = new Map<string, ExtractionResultEntry>();
      for (const res of allResultsPooled) {
        const existing = resultsMap.get(res.filename);
        if (!existing || res.extractionSuccess) {
          resultsMap.set(res.filename, res);
        }
      }
      const dedupedResults = Array.from(resultsMap.values());

      const clusterStart = new Date(
        Math.min(...cluster.map((c) => c.start.getTime())),
      );
      const clusterEnd = new Date(
        Math.max(...cluster.map((c) => c.end.getTime())),
      );

      // Recompute metrics for the whole cluster using deduped records
      const metrics = computeMetrics(
        latestRun.runId,
        dedupedRecords,
        clusterStart,
        clusterEnd,
      );

      // Fix for the title: the user wants the latest activity time as the accordion header (e.g. FEB-16-2026-09:30:PM).
      // Use the completion time of the latest file in the cluster, but fallback to the newest run's start time if no files were processed.
      const clusterLatestActivity = Math.max(
        clusterEnd.getTime(),
        latestRun.start.getTime(),
      );
      metrics.startedAt = new Date(clusterLatestActivity).toISOString();

      const runDurationSeconds = cluster.reduce(
        (sum, c) => sum + (c.end.getTime() - c.start.getTime()) / 1000,
        0,
      );

      const sessions = cluster
        .map((c) => {
          const m = computeMetrics(c.runId, c.records, c.start, c.end);
          return {
            runId: c.runId,
            start: c.start,
            end: c.end,
            success: m.success,
            failed: m.failed,
            skipped: m.skipped,
          };
        })
        .sort((a, b) => b.start.getTime() - a.start.getTime()); // Newest first

      const merged: HistoricalRunSummary = {
        runId: latestRun.runId,
        metrics,
        extractionResults: dedupedResults,
        records: dedupedRecords,
        start: clusterStart,
        end: clusterEnd,
        runDurationSeconds,
        brand: latestRun.brand,
        purchaser: latestRun.purchaser,
        sessions,
      };
      out.push(merged);
    }
  }

  // Final sort by run number descending, fallback to start time
  return out.sort((a, b) => {
    const getNum = (id: string) => {
      const m = id.match(/RUN(\d+)/i);
      return m ? parseInt(m[1], 10) : -1;
    };
    const numA = getNum(a.runId);
    const numB = getNum(b.runId);
    if (numA !== numB && numA !== -1 && numB !== -1) {
      return numB - numA;
    }
    return b.start.getTime() - a.start.getTime();
  });
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const h = Math.floor(min / 60);
  if (h > 0) return `${h}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

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

function dayOrdinal(day: number): string {
  const s = String(day);
  if (day >= 11 && day <= 13) return s + "th";
  const last = s.slice(-1);
  if (last === "1") return s + "st";
  if (last === "2") return s + "nd";
  if (last === "3") return s + "rd";
  return s + "th";
}

/** Human-readable date and time for a run (e.g. "Feb-2nd-2026 09:32-AM") for accordion labels. */
function formatRunDateTime(iso: string): string {
  const d = new Date(iso);
  const month = MONTH_NAMES[d.getMonth()].toUpperCase();
  const day = d.getDate();
  const year = d.getFullYear();
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 || 12;
  const h = String(hours12).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours24 < 12 ? "AM" : "PM";
  // Format: FEB-14-2026-12:19:PM
  return `${month}-${day}-${year}-${h}:${min}:${ampm}`;
}

function formatBrandDisplayName(brandId?: string): string {
  if (!brandId) return "";
  if (brandId.includes("no-cow")) return "No Cow";
  if (brandId.includes("sundia")) return "Sundia";
  if (brandId.includes("tractor-beverage")) return "Tractor";
  return brandId;
}

function formatPurchaserDisplayName(purchaserId?: string): string {
  if (!purchaserId) return "";
  if (purchaserId.includes("8c03bc63-a173-49d2-9ef4-d3f4c540fae8"))
    return "Temp 1";
  if (purchaserId.includes("a451e439-c9d1-41c5-b107-868b65b596b8"))
    return "Temp 2";
  return purchaserId;
}

export function buildSummary(metrics: RunMetrics): ExecutiveSummary {
  const start = new Date(metrics.startedAt).getTime();
  const end = new Date(metrics.finishedAt).getTime();
  const runDurationSeconds = (end - start) / 1000;
  return {
    title: "IntelliExtract Operation – Executive Summary",
    generatedAt: new Date().toISOString(),
    metrics,
    runDurationSeconds,
  };
}

function sectionForRun(entry: HistoricalRunSummary): string {
  const m = entry.metrics;
  const wallClockMs =
    entry.runDurationSeconds !== undefined
      ? entry.runDurationSeconds * 1000
      : entry.end.getTime() - entry.start.getTime();
  const runDuration = formatDuration(wallClockMs);
  const succeededCount = entry.extractionResults.filter(
    (e) => e.extractionSuccess,
  ).length;
  const failedCount = entry.extractionResults.filter(
    (e) => !e.extractionSuccess,
  ).length;
  // Reclassify successes as failures when API response.success === false.
  // We partition "processed" into 3 disjoint sets:
  // 1. displaySuccess: Status=Done AND JSON success=true
  // 2. displayApiFailed: Status=Done AND JSON success=false (or missing)
  // 3. displayInfraFailed: Status=Error
  const displaySuccess = succeededCount;
  const displayInfraFailed = m.failed;
  const displayApiFailed = Math.max(0, m.success - displaySuccess);
  const processed = m.success + m.failed;
  const throughputPerSecond =
    entry.runDurationSeconds > 0 ? processed / entry.runDurationSeconds : 0;
  const throughputPerMinute = throughputPerSecond * 60;
  const totalApiTime = formatDuration(m.totalProcessingTimeMs);
  const avgConcurrency =
    wallClockMs > 0
      ? (m.totalProcessingTimeMs / wallClockMs).toFixed(1)
      : "0.0";
  // Error rate = Infrastructure failures / Total processed.
  // Logical failures (API success: false) are NOT counted as system errors.
  const displayErrorRate = processed > 0 ? displayInfraFailed / processed : 0;
  const falseResponseRate = processed > 0 ? displayApiFailed / processed : 0;
  const anomalyItems = m.anomalies.map((a) => {
    const pathSuffix = a.filePath ? " (" + escapeHtml(a.filePath) + ")" : "";
    return (
      "<li><strong>" +
      escapeHtml(a.type) +
      "</strong>: " +
      escapeHtml(a.message) +
      pathSuffix +
      "</li>"
    );
  });
  const anomaliesList =
    m.anomalies.length > 0
      ? "<ul>" + anomalyItems.join("") + "</ul>"
      : "<p>None detected.</p>";

  const b = m.failureBreakdown;
  const failureBreakdownRows =
    m.failed > 0
      ? [
          b.timeout ? `<tr><td>Timeout</td><td>${b.timeout}</td></tr>` : "",
          b.clientError
            ? `<tr><td>Client error (4xx)</td><td>${b.clientError}</td></tr>`
            : "",
          b.serverError
            ? `<tr><td>Service error (5xx)</td><td>${b.serverError}</td></tr>`
            : "",
          b.readError
            ? `<tr><td>Failed file uploads</td><td>${b.readError}</td></tr>`
            : "",
          b.other ? `<tr><td>Other</td><td>${b.other}</td></tr>` : "",
        ]
          .filter(Boolean)
          .join("")
      : "";
  const failureBreakdownSection =
    m.failed > 0
      ? `
  <h3>Failure breakdown by error type</h3>
   <div class="table-responsive">
    <table>
      <tr><th>Error type</th><th>Count</th></tr>
      ${failureBreakdownRows}
    </table>
  </div>`
      : "";

  const failureDetailsRows =
    (m.failureDetails?.length ?? 0) > 0
      ? m
          .failureDetails!.map((f) => {
            const msg = (f.errorMessage ?? "").trim();
            const snippet =
              msg.length > 0
                ? escapeHtml(msg)
                : '<span class="muted">(no response body)</span>';
            return `<tr><td>${f.statusCode ?? "—"}</td><td class="file-path">${escapeHtml(f.filePath)}</td><td>${snippet}</td></tr>`;
          })
          .join("")
      : "";
  const failureDetailsSection =
    failureDetailsRows.length > 0
      ? `
  <h3>Failure details (API response)</h3>
  <p>Use these to debug 4xx/5xx: HTTP status and error body snippet per file.</p>
  <div class="table-responsive">
    <table class="failure-details-table">
      <tr><th>Status</th><th>File</th><th>Message snippet</th></tr>
      ${failureDetailsRows}
    </table>
  </div>`
      : "";

  const topSlowestRows = m.topSlowestFiles
    .map(
      (e) =>
        `<tr><td class="file-path">${escapeHtml(e.filePath)}</td><td>${e.latencyMs.toFixed(0)}</td><td>${escapeHtml(e.patternKey ?? "—")}</td></tr>`,
    )
    .join("");
  const topSlowestSection =
    m.topSlowestFiles.length > 0
      ? `
<h3>Top ${m.topSlowestFiles.length} slowest files (by processing time)</h3>
 <div class="table-responsive">
  <table>
    <tr><th>File</th><th>Latency (ms)</th><th>Pattern Key</th></tr>
    ${topSlowestRows}
  </table>
</div>`
      : "";

  const failuresByBrandRows = m.failureCountByBrand
    .map(
      (e) =>
        `<tr><td>${escapeHtml(formatBrandDisplayName(e.brand))}</td><td>${e.count}</td></tr>`,
    )
    .join("");
  const failuresByBrandSection =
    m.failureCountByBrand.length > 0
      ? `
  <h3>Failures by brand (repeated failures)</h3>
  <div class="table-responsive">
    <table>
      <tr><th>Brand</th><th>Failure count</th></tr>
      ${failuresByBrandRows}
    </table>
  </div>`
      : "";

  // Lightweight "agent-style" summary: highlight top anomalies and hotspots.
  const agentSummaryPoints: string[] = [];
  if (displayInfraFailed + displayApiFailed > 0) {
    agentSummaryPoints.push(
      `Error rate is ${(displayErrorRate * 100).toFixed(2)}% with ${displayInfraFailed + displayApiFailed} total failures (${displayApiFailed} from API).`,
    );
  }
  if (m.failureCountByBrand.length > 0) {
    const topBrand = m.failureCountByBrand[0];
    agentSummaryPoints.push(
      `Most failures are for brand "${formatBrandDisplayName(topBrand.brand)}" (${
        topBrand.count
      } failed file${topBrand.count === 1 ? "" : "s"}).`,
    );
  }
  const highLatency = m.anomalies.filter((a) => a.type === "high_latency");
  if (highLatency.length > 0) {
    agentSummaryPoints.push(
      `${highLatency.length} file${
        highLatency.length === 1 ? "" : "s"
      } exceeded 2× P95 latency (${m.p95LatencyMs.toFixed(0)}ms).`,
    );
  }
  if (agentSummaryPoints.length === 0 && processed > 0) {
    const skipSuffix = m.skipped > 0 ? ` (+${m.skipped} skipped)` : "";
    agentSummaryPoints.push(
      `Run completed without notable anomalies: ${processed} files${skipSuffix} in ${runDuration} at ${throughputPerMinute.toFixed(1)} files/min.`,
    );
  }
  const agentSummaryHtml =
    agentSummaryPoints.length > 0
      ? `<ul>${agentSummaryPoints
          .map((p) => `<li>${escapeHtml(p)}</li>`)
          .join("")}</ul>`
      : '<p class="muted">No notable anomalies detected.</p>';

  const runBatchId =
    entry.runId.startsWith("RUN") || entry.runId.startsWith("SKIP")
      ? `#${entry.runId}`
      : entry.runId;
  const runLabel = formatRunDateTime(m.startedAt);

  const brandDisplay = entry.brand
    ? formatBrandDisplayName(entry.brand).toUpperCase()
    : "";
  const purchaserDisplay = entry.purchaser
    ? formatPurchaserDisplayName(entry.purchaser)
        .toUpperCase()
        .replace(/_/g, "-")
    : "";

  let sectionClass = "run-section";
  if (displayInfraFailed > 0) sectionClass += " status-error";
  else if (displayApiFailed > 0) sectionClass += " status-warning";

  const runBadge = `<span class="chip batch-id">${escapeHtml(runBatchId)}</span>`;
  const purchaserBadge = purchaserDisplay
    ? `<span class="badge-purchaser">${escapeHtml(purchaserDisplay)}</span>`
    : "";
  const brandLabel = brandDisplay
    ? `<span class="badge-brand">[${escapeHtml(brandDisplay)}]</span> `
    : "";

  const successBadge = `<span class="badge-status success">${displaySuccess} SUCCESS</span>`;
  const apiFailBadge = `<span class="badge-status secondary">${displayApiFailed} API FAIL</span>`;
  const infraFailBadge = `<span class="badge-status fail">${displayInfraFailed} INFRA FAIL</span>`;

  // Create full log rows from records
  const fullLogRows = entry.records
    .map((rec) => {
      const isSuccess = rec.status === "done";
      const status = isSuccess
        ? '<span class="status-icon success">✅</span> SUCCESS'
        : '<span class="status-icon error">❌</span> FAILED';
      return `<tr class="log-row" data-search="${escapeHtml((rec.filePath + status + (rec.patternKey || "")).toLowerCase())}">
      <td>${status}</td>
      <td class="file-path">${escapeHtml(rec.filePath)}</td>
      <td>${escapeHtml(rec.patternKey ?? "—")}</td>
      <td><span class="chip">${rec.latencyMs ? rec.latencyMs.toFixed(0) : "—"} ms</span></td>
    </tr>`;
    })
    .join("");

  const fullLogSection = `
    <details class="full-log-container">
      <summary class="run-section-summary" style="border-radius: 8px; border: 1px solid var(--border-light);">
        <div class="summary-content">
          <div style="font-weight: 800; font-size: 0.85rem; text-transform: uppercase;">📦 View Full Extraction Log (${entry.records.length} files)</div>
        </div>
      </summary>
      <div style="padding: 1.5rem 0;">
        <div class="log-search-container">
          <input type="text" placeholder="Search files, patterns, or status..." onkeyup="filterSectionLog(this)">
          <span>Showing results for this mission</span>
        </div>
        <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
          <table class="log-table">
            <thead>
              <tr><th style="width: 140px;">Status</th><th>File Path</th><th style="width: 200px;">Pattern</th><th style="width: 100px;">Latency</th></tr>
            </thead>
            <tbody>
              ${fullLogRows}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  `;

  const sessionsRows = (entry.sessions || [])
    .map((s) => {
      const runIdLabel =
        s.runId.startsWith("RUN") || s.runId.startsWith("SKIP")
          ? `#${s.runId}`
          : s.runId;
      const startTime = formatRunDateTime(s.start.toISOString());
      const duration = formatDuration(s.end.getTime() - s.start.getTime());
      return `<tr>
        <td><span class="chip batch-id" style="background:#475569 !important">${escapeHtml(runIdLabel)}</span></td>
        <td>${escapeHtml(startTime)}</td>
        <td>${escapeHtml(duration)}</td>
        <td><span class="chip success">${s.success}</span></td>
        <td><span class="chip fail">${s.failed}</span></td>
        <td><span class="chip secondary">${s.skipped}</span></td>
      </tr>`;
    })
    .join("");

  const sessionsSection =
    (entry.sessions?.length ?? 0) > 1
      ? `
  <details class="full-log-container" style="margin-top: 1rem; margin-bottom: 2rem;">
    <summary class="run-section-summary" style="border-radius: 8px; border: 1px solid var(--border-light); background: #f8fafc;">
      <div class="summary-content">
        <div style="font-weight: 800; font-size: 0.85rem; text-transform: uppercase;">🕒 Execution Timeline (${entry.sessions!.length} Sessions)</div>
      </div>
    </summary>
    <div style="padding: 1rem 0;">
      <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 1rem;">This operation consists of multiple sessions executed within a 2-hour window. Consolidated metrics above reflect the final state.</p>
      <div class="table-responsive">
        <table>
          <thead>
            <tr><th>Session ID</th><th>Started At</th><th>Duration</th><th>Success</th><th>Failed</th><th>Skipped</th></tr>
          </thead>
          <tbody>
            ${sessionsRows}
          </tbody>
        </table>
      </div>
    </div>
  </details>`
      : "";

  return `
  <details class="${sectionClass}">
  <summary class="run-section-summary">
    <div class="summary-content">
      <div class="mission-pointer">
        ${runBadge}
        ${brandLabel}${purchaserBadge}
        <span class="run-time">${escapeHtml(runLabel)}</span>
      </div>
      <div class="summary-badges">
        ${successBadge} ${apiFailBadge} ${infraFailBadge}
      </div>
    </div>
  </summary>
  <div class="run-section-body">
    ${sessionsSection}
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
      <div style="flex: 1;">
        <h3 style="margin-top: 0;">Consolidated Overview</h3>
      </div>
      <div class="retry-action-wrap">
        <button class="btn-retry-batch" onclick="triggerRetry('${entry.brand || ""}', '${entry.purchaser || ""}')">
          <span>🔄 Retry failures from this operation</span>
        </button>
      </div>
    </div>
  <div class="table-responsive">
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total synced files</td><td><span class="chip secondary">${m.totalFiles}</span></td></tr>
      <tr><td>Total extraction results available</td><td><span class="chip secondary">${displaySuccess + displayApiFailed}</span></td></tr>
      <tr><td>Files processed in this operation</td><td><span class="chip secondary">${processed}</span></td></tr>
      <tr><td>Files skipped (already handled)</td><td><span class="chip secondary">${m.skipped}</span></td></tr>
      <tr><td>Successful Response (Success: true)</td><td><span class="chip success">${displaySuccess}</span></td></tr>
      <tr><td>Successful Response (Success: false)</td><td><span class="chip secondary">${displayApiFailed}</span></td></tr>
      <tr><td>Failure (Infrastructure)</td><td><span class="chip fail">${displayInfraFailed}</span></td></tr>
      <tr><td>Operation duration (wall clock)</td><td><span class="chip">${runDuration}</span></td></tr>
      <tr><td>Average API concurrency</td><td><span class="chip">${avgConcurrency}x</span></td></tr>
      <tr><td>Total API processing time</td><td><span class="chip">${totalApiTime}</span> <span class="muted small">(sum of latencies)</span></td></tr>
      <tr><td>Throughput (observed)</td><td><span class="chip">${throughputPerMinute.toFixed(2)} files/min</span></td></tr>
      <tr><td>Error rate (Infrastructure failures)</td><td><span class="chip fail">${(displayErrorRate * 100).toFixed(2)}%</span></td></tr>
    </table>
  </div>
  <h3>Load testing / API capability</h3>
  <p>Use these as a guide for operation sizes and expected capacity at similar concurrency and file mix.</p>
  <div class="table-responsive">
    <table>
      <tr><th>Attribute</th><th>Value</th></tr>
      <tr><td>Observed throughput</td><td>${throughputPerMinute.toFixed(1)} files/min, ${throughputPerSecond.toFixed(2)} files/sec</td></tr>
      <tr><td>API response time (P50 / P95 / P99)</td><td>${m.p50LatencyMs.toFixed(0)} ms / ${m.p95LatencyMs.toFixed(0)} ms / ${m.p99LatencyMs.toFixed(0)} ms</td></tr>
      <tr><td>Error rate at this load (Infra failures)</td><td>${(displayErrorRate * 100).toFixed(2)}%</td></tr>
      <tr><td>False Response Rate at this load</td><td>${(falseResponseRate * 100).toFixed(2)}%</td></tr>
      <tr><td>Ideal extract count (≈5 min operation)</td><td>~${Math.round(throughputPerMinute * 5)} files</td></tr>
      <tr><td>Ideal extract count (≈10 min operation)</td><td>~${Math.round(throughputPerMinute * 10)} files</td></tr>
      <tr><td>Ideal extract count (≈15 min operation)</td><td>~${Math.round(throughputPerMinute * 15)} files</td></tr>
    </table>
  </div>
  <p><strong>Summary:</strong> At this operation&rsquo;s load, the API handled <strong>${processed} files</strong> (${m.skipped} skipped) in <strong>${runDuration}</strong> with <strong>${(displayErrorRate * 100).toFixed(2)}%</strong> infrastructure errors and <strong>${(falseResponseRate * 100).toFixed(2)}%</strong> false responses. For a target operation of about 5 minutes, aim for chunks of <strong>~${Math.round(throughputPerMinute * 5)} files</strong>; for 10 minutes, <strong>~${Math.round(throughputPerMinute * 10)} files</strong>.</p>
  <h3>Latency (ms)</h3>
  <div class="table-responsive">
    <table>
      <tr><th>Percentile</th><th>Value</th></tr>
      <tr><td>Average</td><td><span class="chip">${m.avgLatencyMs.toFixed(2)}</span></td></tr>
      <tr><td>P50</td><td><span class="chip">${m.p50LatencyMs.toFixed(2)}</span></td></tr>
      <tr><td>P95</td><td><span class="chip">${m.p95LatencyMs.toFixed(2)}</span></td></tr>
      <tr><td>P99</td><td><span class="chip">${m.p99LatencyMs.toFixed(2)}</span></td></tr>
    </table>
  </div>
  <h3>Automated summary</h3>
  <div class="agent-style-summary">
    ${agentSummaryHtml}
  </div>
  ${failureBreakdownSection}
  ${failureDetailsSection}
  ${topSlowestSection}
  ${failuresByBrandSection}
  <h3>Anomalies</h3>
  <div class="anomalies-container">
    ${anomaliesList}
  </div>
  ${fullLogSection}
  </div>
  </details>`;
  // Note: I will need to properly integrate this into the sectionForRun string.
  // I will do a single replacement for the whole return block to be safe.
}

const REPORT_TITLE = "IntelliExtract Operation Summary";

function htmlReportFromHistory(
  historicalSummaries: HistoricalRunSummary[],
  generatedAt: string,
): string {
  const runsHtml = historicalSummaries
    .map((entry) => sectionForRun(entry))
    .join("");
  let logoDataUri = "";
  try {
    const logoRelPath = join(process.cwd(), "assets", "logo.png");
    if (existsSync(logoRelPath)) {
      const logoBuffer = readFileSync(logoRelPath);
      logoDataUri = `data:image/png;base64,${logoBuffer.toString("base64")}`;
    }
  } catch (e) {
    // Fallback to relative if read fails
    logoDataUri = "../../assets/logo.png";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(REPORT_TITLE)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f7f9;
      --surface: #ffffff;
      --text: #2c2c2c;
      --text-secondary: #5a5a5a;
      --border: #b0bfc9;
      --border-light: #cbd5e1;
      --header-bg: #216c6d;
      --header-text: #ffffff;
      --header-border: #1a5758;
      --primary: #2d9d5f;
      --accent: #2d9d5f;
      --accent-light: #e8f5ee;
      --radius: 12px;
      --radius-sm: 8px;
    }
    body { font-family: 'JetBrains Mono', 'Consolas', monospace; max-width: 1250px; margin: 0 auto; padding: 0 1rem; color: var(--text); background: var(--bg); }
    
    .report-header {
      background: var(--surface);
      color: var(--header-bg);
      padding: 1.5rem 2rem;
      border-radius: 0 0 var(--radius) var(--radius);
      margin-bottom: 2rem;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid var(--border-light);
    }
    .report-header-left { display: flex; align-items: center; gap: 1.5rem; }
    .report-header .logo { height: 32px; width: auto; object-fit: contain; }
    .report-header-title { margin: 0; font-size: 1.25rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
    
    h1 { color: var(--header-bg); font-size: 1.75rem; margin-bottom: 0.5rem; text-align: center; }
    h2 { color: var(--text-secondary); font-size: 1.1rem; font-weight: 500; margin-bottom: 1.5rem; text-align: center; }
    h3 { color: var(--header-bg); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 1.5rem 0 0.75rem; border-bottom: 2px solid var(--border-light); padding-bottom: 0.4rem; }
    
    .meta { color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    
    .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 1.5rem; border-radius: var(--radius-sm); box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--border); background: var(--surface); }
    table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: auto; min-width: 800px; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; overflow-wrap: anywhere; }
    th { background: var(--surface); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }

    /* Column Sizing for Failure Details */
    .failure-details-table th:nth-child(1) { width: 80px; }
    .failure-details-table th:nth-child(2) { min-width: 400px; }
    .failure-details-table th:nth-child(3) { min-width: 400px; }
    
    .run-section { margin-bottom: 1.25rem; background: white; border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid var(--border); overflow: hidden; border-left: 6px solid #cbd5e1; transition: all 0.2s; }
    .run-section[open] { border-color: var(--header-bg); }
    .run-section.status-error { border-left-color: #ef4444; }
    .run-section.status-warning { border-left-color: #f59e0b; }
    .run-section.status-error[open] { border-color: #ef4444; }
    .run-section.status-warning[open] { border-color: #f59e0b; }
    
    .run-section-summary { cursor: pointer; padding: 1rem 1.25rem; background: #f8fafc; list-style: none; transition: background 0.2s; border-bottom: 1px solid var(--border-light); }
    .run-section-summary::-webkit-details-marker { display: none; }
    .run-section-summary:hover { background: #f1f5f9; }
    
    .summary-content { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    
    .mission-pointer {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: var(--header-bg);
      color: white;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.4rem 2rem 0.4rem 1rem;
      clip-path: polygon(0% 0%, calc(100% - 15px) 0%, 100% 50%, calc(100% - 15px) 100%, 0% 100%);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.4));
    }
    
    .batch-id { background: rgba(255,255,255,0.2) !important; color: white !important; border: 1px solid rgba(255,255,255,0.3) !important; padding: 0.1rem 0.4rem !important; font-family: monospace; }
    .badge-brand { opacity: 0.85; }
    .badge-purchaser { background: #ffffff !important; color: var(--header-bg) !important; padding: 0.1rem 0.5rem !important; border-radius: 4px; font-weight: 800; }
    .run-time { font-weight: 400; opacity: 0.9; margin-left: auto; }
    
    .summary-badges { display: flex; gap: 0.5rem; align-items: center; }
    .badge-status { font-size: 0.65rem; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-status.success { background: var(--accent-light); color: var(--primary); border: 1px solid rgba(45, 157, 95, 0.2); }
    .badge-status.fail { background: #fee2e2; color: #b91c1c; border: 1px solid rgba(185, 28, 28, 0.2); }
    .badge-status.secondary { background: #f1f5f9; color: var(--text-secondary); border: 1px solid var(--border-light); }
    
    .run-section-body { padding: 0.5rem 1.5rem 1.5rem; }
    
    .chip { display: inline-flex; align-items: center; background: #f1f5f9; color: var(--text); padding: 0.2rem 0.6rem; border-radius: 100px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); }
    .chip.success { background: var(--accent-light); color: var(--primary); border-color: rgba(45, 157, 95, 0.2); }
    .chip.fail { background: #fee2e2; color: #b91c1c; border-color: rgba(185, 28, 28, 0.2); }
    .chip.secondary { background: #f8fafc; color: var(--header-bg); font-weight: 700; border-color: var(--border-light); }
    
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 2rem; background: rgba(176, 191, 201, 0.15); padding: 5px; border-radius: var(--radius); border: 1px solid var(--border-light); }
    .tab-btn { flex: 1; background: none; border: none; padding: 0.65rem 1.5rem; font-family: inherit; font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; color: var(--text-secondary); border-radius: calc(var(--radius) - 4px); transition: all 0.25s ease; }
    .tab-btn.active { background: var(--header-bg); color: white; box-shadow: 0 4px 12px rgba(33, 108, 109, 0.25); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .chart-card { 
      background: linear-gradient(145deg, #ffffff, #f1f5f9); 
      border: 1px solid rgba(171, 185, 200, 0.3); 
      border-radius: 16px; 
      padding: 1.6rem; 
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .chart-card:hover {
      transform: translateY(-6px) scale(1.01);
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.08);
    }
    .chart-card h4 { margin: 0 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--header-bg); border-bottom: 2px solid rgba(33, 108, 109, 0.1); padding-bottom: 0.6rem; font-weight: 800; }
    .chart-scroll-wrapper { 
      overflow-x: auto; 
      overflow-y: hidden; 
      padding-bottom: 8px;
    }

    .chart-container { position: relative; height: 300px; width: 100%; min-width: 100%; }
    
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .stat-card { 
      background: #f8fafc; 
      border: 1px solid rgba(171, 185, 200, 0.4); 
      border-radius: 14px; 
      padding: 1.4rem; 
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      transition: transform 0.2s ease;
    }
    .stat-card:hover { transform: scale(1.03); }
    .stat-value { display: block; font-size: 1.7rem; font-weight: 800; color: var(--header-bg); text-shadow: 1px 1px 0px rgba(255,255,255,0.8); }
    .stat-label { font-size: 0.72rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; margin-top: 0.4rem; letter-spacing: 0.05em; }

    .agent-style-summary, .anomalies-container {
      background: #f8fafc;
      border-left: 4px solid var(--header-bg);
      padding: 1rem;
      border-radius: 0 6px 6px 0;
      margin: 0.5rem 0 1rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    
    .muted { color: var(--text-secondary); font-style: italic; }
    .small { font-size: 0.75rem; }
    td.file-path { font-family: inherit; font-size: 0.72rem; color: var(--text-secondary); overflow-wrap: anywhere; word-break: break-all; }
    
    .full-log-container { margin-top: 1.5rem; }
    .log-search-container { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .log-search-container input { flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit; font-size: 0.85rem; }
    .log-search-container span { font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); }
    
    .status-icon { font-size: 1rem; margin-right: 4px; }
    .status-icon.success { color: #2d9d5f; }
    .status-icon.error { color: #ef4444; }
    
    .log-table th { position: sticky; top: 0; z-index: 10; background: #f8fafc; }
    .log-row-hidden { display: none !important; }

    /* Premium Scrollbar */
    .chart-scroll-wrapper::-webkit-scrollbar { height: 6px; }
    .chart-scroll-wrapper::-webkit-scrollbar-track { background: rgba(0,0,0,0.02); border-radius: 10px; }
    .chart-scroll-wrapper::-webkit-scrollbar-thumb { background: rgba(33, 108, 109, 0.15); border-radius: 10px; }
    .chart-scroll-wrapper::-webkit-scrollbar-thumb:hover { background: rgba(33, 108, 109, 0.3); }

    .btn-retry-batch {
      background: var(--header-bg);
      color: white;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 8px;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(33, 108, 109, 0.2);
    }
    .btn-retry-batch:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 15px rgba(33, 108, 109, 0.3);
      filter: brightness(1.1);
    }
    .btn-retry-batch:active {
      transform: translateY(0);
    }
    .retry-action-wrap {
      flex-shrink: 0;
      margin-left: 2rem;
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    function triggerRetry(brand, purchaser) {
      const baseUrl = window.location.protocol === 'file:' ? 'http://localhost:8765' : window.location.origin;
      const url = new URL(baseUrl);
      if (brand) url.searchParams.set('brand', brand);
      if (purchaser) url.searchParams.set('purchaser', purchaser);
      url.searchParams.set('caseId', 'P2');
      url.searchParams.set('retryFailed', 'true');
      url.searchParams.set('autoRun', 'true');
      
      const confirmMsg = "This will open the runner and automatically start retrying failures for: " + (purchaser || brand || "all") + ". Proceed?";
      if (window.confirm(confirmMsg)) {
        window.open(url.toString(), '_blank');
      }
    }
  </script>
</head>
<body>
  <div class="report-header">
    <div class="report-header-left">
      <img src="${logoDataUri}" alt="intellirevenue" class="logo">
      <h1 class="report-header-title">${escapeHtml(REPORT_TITLE)}</h1>
    </div>
    <div class="meta">Generated: ${escapeHtml(formatRunDateTime(generatedAt))} — ${historicalSummaries.length} operation(s)</div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('dashboard')">Analytics Dashboard</button>
    <button class="tab-btn" onclick="switchTab('history')">Operation History</button>
  </div>

  <div id="dashboard" class="tab-content active">
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-value">${historicalSummaries.reduce((a, b) => a + b.metrics.success + b.metrics.failed, 0)}</span>
        <span class="stat-label">Total Processed</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${(
          (historicalSummaries.reduce((a, b) => a + b.metrics.success, 0) /
            (historicalSummaries.reduce(
              (a, b) => a + b.metrics.success + b.metrics.failed,
              0,
            ) || 1)) *
          100
        ).toFixed(1)}%</span>
        <span class="stat-label">Success Rate</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${Math.round(
          historicalSummaries.reduce((a, b) => a + b.metrics.avgLatencyMs, 0) /
            (historicalSummaries.length || 1),
        )}ms</span>
        <span class="stat-label">Avg Latency</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">${historicalSummaries.length}</span>
        <span class="stat-label">Total Operations</span>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="chart-card">
        <h4>Extraction Volume Trend</h4>
        <div class="chart-scroll-wrapper">
          <div class="chart-container" id="volChartContainer">
            <canvas id="volChart"></canvas>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <h4>Latency Performance (P50/P95)</h4>
        <div class="chart-scroll-wrapper">
          <div class="chart-container" id="latencyChartContainer">
            <canvas id="latencyChart"></canvas>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <h4>System Throughput</h4>
        <div class="chart-scroll-wrapper">
          <div class="chart-container" id="throughputChartContainer">
            <canvas id="throughputChart"></canvas>
          </div>
        </div>
      </div>
      <div class="chart-card">
        <h4>Error Distribution (Infra)</h4>
        <div class="chart-container">
          <canvas id="errorChart"></canvas>
        </div>
      </div>
    </div>
  </div>

  <div id="history" class="tab-content">
    ${runsHtml}
  </div>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      event.target.classList.add('active');
    }

    // Dashboard Data
    const runData = ${JSON.stringify(
      historicalSummaries.map((s) => ({
        runId: s.runId,
        time: s.metrics.startedAt,
        success: s.metrics.success,
        failed: s.metrics.failed,
        skipped: s.metrics.skipped,
        p50: s.metrics.p50LatencyMs,
        p95: s.metrics.p95LatencyMs,
        throughput:
          ((s.metrics.success + s.metrics.failed) /
            (s.runDurationSeconds || 1)) *
          60,
        errors: s.metrics.failureBreakdown,
      })),
    )};

    window.onload = () => {
      initCharts();
    };

    function initCharts() {
      // Scale to last 100 runs. Beyond that, the history tab handles full audit. 
      // Individual charts will auto-expand horizontally with scrollbars to prevent label overlap.
      const sortedData = [...runData].sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-100);
      
      const chartWidth = Math.max(100, sortedData.length * 60) + "px";
      ['volChartContainer', 'latencyChartContainer', 'throughputChartContainer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.width = chartWidth;
      });

      const labels = sortedData.map(d => {
        const d_obj = new Date(d.time);
        return d_obj.toLocaleDateString('en-US', {month:'short', day:'numeric'}) + ' ' + 
               d_obj.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit'});
      });

      // Volume Trend
      new Chart(document.getElementById('volChart'), {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Success', data: sortedData.map(d => d.success), backgroundColor: '#2d9d5f', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
            { label: 'Failed', data: sortedData.map(d => d.failed), backgroundColor: '#ef4444', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
            { label: 'Skipped', data: sortedData.map(d => d.skipped), backgroundColor: '#94a3b8', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
          plugins: { legend: { position: 'bottom' } }
        }
      });

      // Latency Trend
      new Chart(document.getElementById('latencyChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'P50 Latency (ms)', data: sortedData.map(d => d.p50), borderColor: '#216c6d', tension: 0.3, borderWidth: 3, pointRadius: 4, pointHoverRadius: 6 },
            { label: 'P95 Latency (ms)', data: sortedData.map(d => d.p95), borderColor: '#f59e0b', tension: 0.3, borderWidth: 3, pointRadius: 4, pointHoverRadius: 6 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { position: 'bottom' } }
        }
      });

      // Throughput compare
      new Chart(document.getElementById('throughputChart'), {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            { label: 'Throughput (files/min)', data: sortedData.map(d => d.throughput), borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', fill: true, tension: 0.1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { position: 'bottom' } }
        }
      });

      // Error Distribution
      const errs = runData.reduce((acc, d) => {
        acc.timeout += d.errors.timeout;
        acc.client += d.errors.clientError;
        acc.server += d.errors.serverError;
        acc.read += d.errors.readError;
        acc.other += d.errors.other;
        return acc;
      }, { timeout: 0, client: 0, server: 0, read: 0, other: 0 });

      new Chart(document.getElementById('errorChart'), {
        type: 'doughnut',
        data: {
          labels: ['Timeout', 'Client (4xx)', 'Server (5xx)', 'Read Error', 'Other'],
          datasets: [{
            data: [errs.timeout, errs.client, errs.server, errs.read, errs.other],
            backgroundColor: ['#f59e0b', '#ef4444', '#7f1d1d', '#6366f1', '#94a3b8']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }

    function filterSectionLog(input) {
      const filter = input.value.toLowerCase();
      const container = input.closest('.run-section-body');
      const rows = container.querySelectorAll('.log-row');
      rows.forEach(row => {
        const text = row.getAttribute('data-search') || '';
        if (text.includes(filter)) {
          row.classList.remove('log-row-hidden');
        } else {
          row.classList.add('log-row-hidden');
        }
      });
    }
  </script>
</body>
</html>`;
}

function htmlReport(
  summary: ExecutiveSummary,
  extractionResults: ExtractionResultEntry[] = [],
): string {
  const single: HistoricalRunSummary = {
    runId: summary.metrics.runId,
    metrics: summary.metrics,
    extractionResults,
    records: [], // Single run view might not have full records in memory
    start: new Date(summary.metrics.startedAt),
    end: new Date(summary.metrics.finishedAt),
    runDurationSeconds: summary.runDurationSeconds,
  };
  return htmlReportFromHistory([single], summary.generatedAt);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Delete oldest report sets so only the most recent retainCount remain.
 * A "report set" is a base name with .html and/or .json in the output dir.
 */
function pruneOldReports(outDir: string, retainCount: number): void {
  if (retainCount <= 0) return;
  const files = readdirSync(outDir, { withFileTypes: true }).filter(
    (e) => e.isFile() && (e.name.endsWith(".html") || e.name.endsWith(".json")),
  );
  const baseToMtime = new Map<string, number>();
  for (const e of files) {
    const base = basename(e.name, extname(e.name));
    const path = join(outDir, e.name);
    try {
      const mtime = statSync(path).mtimeMs;
      const existing = baseToMtime.get(base);
      if (existing === undefined || mtime > existing)
        baseToMtime.set(base, mtime);
    } catch {
      // skip unreadable
    }
  }
  const basesByAge = [...baseToMtime.entries()].sort((a, b) => b[1] - a[1]);
  const toKeep = new Set(
    basesByAge.slice(0, retainCount).map(([base]) => base),
  );
  for (const e of files) {
    const base = basename(e.name, extname(e.name));
    if (toKeep.has(base)) continue;
    try {
      unlinkSync(join(outDir, e.name));
    } catch {
      // ignore delete errors
    }
  }
}

/**
 * Write reports for a single run ID (e.g. after each file completes so the summary is up to date).
 * Reads current checkpoint state, computes metrics, and calls writeReports.
 */
export function writeReportsForRunId(config: Config, runId: string): void {
  const db = openCheckpointDb(config.run.checkpointPath);
  const records = getRecordsForRun(db, runId);
  closeCheckpointDb(db);
  if (records.length === 0) return;
  const { start, end } = minMaxDatesFromRecords(records);
  const metrics = computeMetrics(runId, records, start, end);
  const summary = buildSummary(metrics);
  writeReports(config, summary);
}

/**
 * Write reports to config.report.outputDir in requested formats.
 * Includes all historical sync & extract runs (from checkpoint) so downloaded reports have full history.
 * If report.retainCount is set, older report sets are deleted after writing so only the last N are kept.
 */
export function writeReports(config: Config, summary: ExecutiveSummary): void {
  const outDir = config.report.outputDir;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const runId = summary.metrics.runId;
  const historicalSummaries = loadHistoricalRunSummaries(config);
  const generatedAt = new Date().toISOString();

  if (runId) {
    const base = `report_${runId}_${Date.now()}`;
    if (config.report.formats.includes("html")) {
      const path = join(outDir, `${base}.html`);
      writeFileSync(
        path,
        htmlReportFromHistory(historicalSummaries, generatedAt),
        "utf-8",
      );
    }
    if (config.report.formats.includes("json")) {
      const path = join(outDir, `${base}.json`);
      const operationsPayload = historicalSummaries.map((r) => {
        const processed = r.metrics.success + r.metrics.failed;
        const throughputPerMinute =
          r.runDurationSeconds > 0
            ? (processed / r.runDurationSeconds) * 60
            : 0;
        const throughputPerSecond = throughputPerMinute / 60;
        return {
          runId: r.runId,
          metrics: r.metrics,
          runDurationSeconds: r.runDurationSeconds,
          loadTesting: {
            throughputPerMinute: Math.round(throughputPerMinute * 10) / 10,
            throughputPerSecond: Math.round(throughputPerSecond * 100) / 100,
            errorRatePercent: Math.round(r.metrics.errorRate * 10000) / 100,
            idealExtractCount5Min: Math.round(throughputPerMinute * 5),
            idealExtractCount10Min: Math.round(throughputPerMinute * 10),
            idealExtractCount15Min: Math.round(throughputPerMinute * 15),
            p50LatencyMs: r.metrics.p50LatencyMs,
            p95LatencyMs: r.metrics.p95LatencyMs,
            p99LatencyMs: r.metrics.p99LatencyMs,
          },
          extractionResults: r.extractionResults.map((e) => ({
            filename: e.filename,
            response: e.response,
            extractionSuccess: e.extractionSuccess,
          })),
        };
      });
      const jsonPayload = {
        title: REPORT_TITLE,
        generatedAt,
        operations: operationsPayload,
      };
      writeFileSync(path, JSON.stringify(jsonPayload, null, 2), "utf-8");
    }
  }

  const retain = config.report.retainCount;
  if (typeof retain === "number" && retain > 0) {
    pruneOldReports(outDir, retain);
  }
}
