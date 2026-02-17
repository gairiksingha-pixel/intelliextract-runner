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
import type { Config, RunMetrics, ExecutiveSummary } from "./types.js";
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
  runDurationSeconds: number;
  /** When all records in a run share the same brand, include it for display. */
  brand?: string;
  /** When all records in a run share the same purchaser (stagingDir/<brand>/<purchaser>/...), include it for display. */
  purchaser?: string;
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

function filterExtractionResultsForRun(
  config: Config,
  runId: string,
  allResults: ExtractionResultEntry[],
): ExtractionResultEntry[] {
  const db = openCheckpointDb(config.run.checkpointPath);

  // FIXED: Only include files from the current run to ensure metrics match execution
  const relevantRecords = db._data.checkpoints.filter(
    (r) => r.run_id === runId,
  );

  closeCheckpointDb(db);

  const relevantFilenames = new Set(
    relevantRecords.map((r) =>
      extractionResultFilenameFromRecord({
        relativePath: r.relative_path,
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
    if (runId && runId.startsWith("run_")) {
      // run_YYYY-MM-DD_HH-mm-ss_suffix
      const parts = runId.split("_");
      if (parts.length >= 3) {
        const datePart = parts[1]; // YYYY-MM-DD
        const timePart = parts[2]; // HH-mm-ss
        const iso = `${datePart}T${timePart.replace(/-/g, ":")}Z`; // Treat as UTC or local? Original format uses local components but Date() might need help.
        // Actually, formatRunId uses local time components.
        // Let's try constructing it.
        try {
          // run_2026-02-14_13-53-49 -> 2026-02-14T13:53:49
          const d = new Date(`${datePart}T${timePart.replace(/-/g, ":")}`);
          if (!Number.isNaN(d.getTime())) {
            start = d;
          } else {
            start = new Date(0);
          }
        } catch {
          start = new Date(0);
        }
      } else {
        start = new Date(0);
      }
    } else {
      start = new Date(0);
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

    const { start, end } = minMaxDatesFromRecords(records);

    // Find brand and purchaser
    const brandSet = new Set<string>();
    const purchaserSet = new Set<string>();
    for (const r of records) {
      if (r.brand) brandSet.add(r.brand);
      if (r.purchaser) {
        // Prefer explicit purchaser from record
        purchaserSet.add(r.purchaser);
      } else if (r.relativePath) {
        // Fallback: infer from relativePath (legacy)
        const firstSegment = r.relativePath.split(/[\\/]/)[0];
        if (firstSegment) purchaserSet.add(firstSegment);
      }
    }
    const brands = [...brandSet];
    const purchasers = [...purchaserSet];
    const brand = brands.length === 1 ? brands[0] : undefined;
    const purchaser = purchasers.length === 1 ? purchasers[0] : undefined;

    const allResults = loadExtractionResults(config, runId);
    const results = filterExtractionResultsForRun(config, runId, allResults);

    rawSummaries.push({
      runId,
      records,
      start,
      end,
      brand,
      purchaser,
      results,
    });
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

      out.push({
        runId: latestRun.runId,
        metrics,
        extractionResults: dedupedResults,
        runDurationSeconds,
        brand: latestRun.brand,
        purchaser: latestRun.purchaser,
      });
    }
  }

  // Final sort by start time descending (newest groups first)
  return out.sort(
    (a, b) =>
      new Date(b.metrics.startedAt).getTime() -
      new Date(a.metrics.startedAt).getTime(),
  );
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
    title: "IntelliExtract Test Run – Executive Summary",
    generatedAt: new Date().toISOString(),
    metrics,
    runDurationSeconds,
  };
}

function sectionForRun(entry: HistoricalRunSummary): string {
  const m = entry.metrics;
  const wallClockMs = entry.runDurationSeconds * 1000;
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

  const extractionSection =
    entry.extractionResults.length > 0
      ? `
  <h3>Extraction results</h3>
  <p class="extraction-note">${succeededCount} successful responses, ${failedCount} failed responses.</p>`
      : "";
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

  const runLabel = formatRunDateTime(m.startedAt);
  let prefix = "";
  if (entry.brand && entry.purchaser) {
    const b = formatBrandDisplayName(entry.brand).toUpperCase();
    const p = formatPurchaserDisplayName(entry.purchaser)
      .toUpperCase()
      .replace(/_/g, "-");
    prefix = `[${b}]-${p}-`;
  } else if (entry.brand) {
    const b = formatBrandDisplayName(entry.brand).toUpperCase();
    prefix = `[${b}]-`;
  } else if (entry.purchaser) {
    const p = formatPurchaserDisplayName(entry.purchaser)
      .toUpperCase()
      .replace(/_/g, "-");
    prefix = `${p}-`;
  }
  const labelWithPrefix = `${prefix}${runLabel}`;
  const successBadge = `<span class="badge-status success">${displaySuccess} SUCCESS</span>`;
  const apiFailBadge = `<span class="badge-status secondary">${displayApiFailed} API FAIL</span>`;
  const infraFailBadge = `<span class="badge-status fail">${displayInfraFailed} INFRA FAIL</span>`;

  return `
  <details class="run-section">
  <summary class="run-section-summary">
    <div class="summary-content">
      <div class="mission-pointer">${escapeHtml(labelWithPrefix)}</div>
      <div class="summary-badges">
        ${successBadge} ${apiFailBadge} ${infraFailBadge}
      </div>
    </div>
  </summary>
  <div class="run-section-body">
  <h3>Overview</h3>
  <div class="table-responsive">
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total synced files</td><td><span class="chip secondary">${m.totalFiles}</span></td></tr>
      <tr><td>Total extraction results available</td><td><span class="chip secondary">${displaySuccess + displayApiFailed}</span></td></tr>
      <tr><td>Files processed in this run</td><td><span class="chip secondary">${processed}</span></td></tr>
      <tr><td>Files skipped (already handled)</td><td><span class="chip secondary">${m.skipped}</span></td></tr>
      <tr><td>Successful Response (Success: true)</td><td><span class="chip success">${displaySuccess}</span></td></tr>
      <tr><td>Successful Response (Success: false)</td><td><span class="chip secondary">${displayApiFailed}</span></td></tr>
      <tr><td>Failure (Infrastructure)</td><td><span class="chip fail">${displayInfraFailed}</span></td></tr>
      <tr><td>Run duration (wall clock)</td><td><span class="chip">${runDuration}</span></td></tr>
      <tr><td>Average API concurrency</td><td><span class="chip">${avgConcurrency}x</span></td></tr>
      <tr><td>Total API processing time</td><td><span class="chip">${totalApiTime}</span> <span class="muted small">(sum of latencies)</span></td></tr>
      <tr><td>Throughput (observed)</td><td><span class="chip">${throughputPerMinute.toFixed(2)} files/min</span></td></tr>
      <tr><td>Error rate (Infrastructure failures)</td><td><span class="chip fail">${(displayErrorRate * 100).toFixed(2)}%</span></td></tr>
    </table>
  </div>
  <h3>Load testing / API capability</h3>
  <p>Use these as a guide for batch sizes and expected capacity at similar concurrency and file mix.</p>
  <div class="table-responsive">
    <table>
      <tr><th>Attribute</th><th>Value</th></tr>
      <tr><td>Observed throughput</td><td>${throughputPerMinute.toFixed(1)} files/min, ${throughputPerSecond.toFixed(2)} files/sec</td></tr>
      <tr><td>API response time (P50 / P95 / P99)</td><td>${m.p50LatencyMs.toFixed(0)} ms / ${m.p95LatencyMs.toFixed(0)} ms / ${m.p99LatencyMs.toFixed(0)} ms</td></tr>
      <tr><td>Error rate at this load (Infra failures)</td><td>${(displayErrorRate * 100).toFixed(2)}%</td></tr>
      <tr><td>False Response Rate at this load</td><td>${(falseResponseRate * 100).toFixed(2)}%</td></tr>
      <tr><td>Ideal extract count (≈5 min run)</td><td>~${Math.round(throughputPerMinute * 5)} files</td></tr>
      <tr><td>Ideal extract count (≈10 min run)</td><td>~${Math.round(throughputPerMinute * 10)} files</td></tr>
      <tr><td>Ideal extract count (≈15 min run)</td><td>~${Math.round(throughputPerMinute * 15)} files</td></tr>
    </table>
  </div>
  <p><strong>Summary:</strong> At this run&rsquo;s load, the API handled <strong>${processed} files</strong> (${m.skipped} skipped) in <strong>${runDuration}</strong> with <strong>${(displayErrorRate * 100).toFixed(2)}%</strong> infrastructure errors and <strong>${(falseResponseRate * 100).toFixed(2)}%</strong> false responses. For a target run of about 5 minutes, aim for batches of <strong>~${Math.round(throughputPerMinute * 5)} files</strong>; for 10 minutes, <strong>~${Math.round(throughputPerMinute * 10)} files</strong>.</p>
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
  ${extractionSection}
  </div>
  </details>`;
}

const REPORT_TITLE = "IntelliExtract Test Run – Executive Summary";

function htmlReportFromHistory(
  historicalSummaries: HistoricalRunSummary[],
  generatedAt: string,
): string {
  const runsHtml = historicalSummaries
    .map((entry) => sectionForRun(entry))
    .join("");
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
      --primary: #2d9d5f;
      --header-bg: #216c6d;
      --bg: #ffffff;
      --surface: #f8fafc;
      --border: #abb9c8;
      --text: #1e293b;
      --text-secondary: #475569;
      --pass-bg: #dcf2e6;
      --fail-bg: #fee2e2;
      --fail-text: #b91c1c;
    }
    body { font-family: 'Ubuntu', sans-serif; max-width: 1250px; margin: 2rem auto; padding: 0 1rem; color: var(--text); background: #f1f5f9; }
    h1 { color: var(--header-bg); font-size: 1.75rem; margin-bottom: 0.5rem; text-align: center; }
    h2 { color: var(--text-secondary); font-size: 1.1rem; font-weight: 500; margin-bottom: 1.5rem; text-align: center; }
    h3 { color: var(--header-bg); font-size: 0.95rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5rem 0 0.75rem; border-bottom: 1.5px solid var(--border); padding-bottom: 0.25rem; }
    
    .meta { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 2rem; text-align: center; }
    
    .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 1.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--border); background: white; }
    table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: auto; min-width: 800px; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; overflow-wrap: anywhere; }
    th { background: var(--surface); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }

    /* Column Sizing for Failure Details */
    .failure-details-table th:nth-child(1) { width: 80px; }
    .failure-details-table th:nth-child(2) { min-width: 400px; }
    .failure-details-table th:nth-child(3) { min-width: 400px; }
    
    .run-section { margin-bottom: 1.25rem; background: white; border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid var(--border); overflow: hidden; }
    .run-section[open] { border-color: var(--header-bg); }
    
    .run-section-summary { cursor: pointer; padding: 1rem 1.25rem; background: var(--surface); list-style: none; transition: background 0.2s; }
    .run-section-summary::-webkit-details-marker { display: none; }
    .run-section-summary:hover { background: #f1f5f9; }
    
    .summary-content { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    
    .mission-pointer {
      background: var(--header-bg);
      color: white;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.4rem 1.75rem 0.4rem 1rem;
      clip-path: polygon(0% 0%, calc(100% - 15px) 0%, 100% 50%, calc(100% - 15px) 100%, 0% 100%);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      filter: drop-shadow(0 0 1.5px rgba(0,0,0,0.4));
    }
    
    .summary-badges { display: flex; gap: 0.5rem; align-items: center; }
    .badge-status { font-size: 0.65rem; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-status.success { background: var(--pass-bg); color: var(--primary); }
    .badge-status.fail { background: var(--fail-bg); color: var(--fail-text); }
    .badge-status.secondary { background: #e2e8f0; color: #475569; }
    
    .run-section-body { padding: 0.5rem 1.5rem 1.5rem; }
    
    .chip { display: inline-flex; align-items: center; background: #f1f5f9; color: var(--text); padding: 0.2rem 0.6rem; border-radius: 100px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); }
    .chip.success { background: var(--pass-bg); color: var(--primary); border-color: rgba(45, 157, 95, 0.2); }
    .chip.fail { background: var(--fail-bg); color: var(--fail-text); border-color: rgba(185, 28, 28, 0.2); }
    .chip.secondary { background: #f8fafc; color: var(--header-bg); font-weight: 700; }
    
    .tabs { display: flex; gap: 1rem; border-bottom: 2px solid var(--border); margin-bottom: 2rem; }
    .tab-btn { background: none; border: none; padding: 0.75rem 1.5rem; font-family: inherit; font-size: 0.95rem; font-weight: 600; cursor: pointer; color: var(--text-secondary); border-bottom: 2px solid transparent; margin-bottom: -2px; }
    .tab-btn.active { color: var(--header-bg); border-bottom-color: var(--header-bg); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }
    .chart-card { 
      background: linear-gradient(145deg, #ffffff, #f1f5f9); 
      border: 1px solid rgba(171, 185, 200, 0.3); 
      border-radius: 16px; 
      padding: 1.6rem; 
      box-shadow: 
        8px 8px 16px #e2e8f0,
        -4px -4px 12px #ffffff;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .chart-card:hover {
      transform: translateY(-6px) scale(1.01);
      box-shadow: 
        12px 12px 24px #cbd5e1,
        -4px -4px 12px #ffffff;
    }
    .chart-card h4 { margin: 0 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--header-bg); border-bottom: 2px solid rgba(33, 108, 109, 0.1); padding-bottom: 0.6rem; font-weight: 800; }
    .chart-container { position: relative; height: 300px; width: 100%; }
    
    .stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.25rem; margin-bottom: 2rem; }
    .stat-card { 
      background: #f8fafc; 
      border: 1px solid rgba(171, 185, 200, 0.4); 
      border-radius: 14px; 
      padding: 1.4rem; 
      text-align: center;
      box-shadow: 
        4px 4px 8px #e2e8f0,
        -2px -2px 6px #ffffff;
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
    td.file-path { font-family: monospace; font-size: 0.72rem; color: var(--text-secondary); overflow-wrap: anywhere; word-break: break-all; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
</head>
<body>
  <h1>${escapeHtml(REPORT_TITLE)}</h1>
  <p class="meta">Generated: ${escapeHtml(formatRunDateTime(generatedAt))} — ${historicalSummaries.length} run(s) (sync &amp; extract)</p>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('dashboard')">Analytics Dashboard</button>
    <button class="tab-btn" onclick="switchTab('history')">Historical Runs</button>
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
        <span class="stat-label">Total Batches</span>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="chart-card">
        <h4>Extraction Volume Trend</h4>
        <div class="chart-container">
          <canvas id="volChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h4>Latency Performance (P50/P95)</h4>
        <div class="chart-container">
          <canvas id="latencyChart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h4>System Throughput</h4>
        <div class="chart-container">
          <canvas id="throughputChart"></canvas>
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
    <h2>Mission Activity History</h2>
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
      // Limit to last 30 runs for the charts to prevent design distortion while maintaining performance trends
      const sortedData = [...runData].sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-30);
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
      const runsPayload = historicalSummaries.map((r) => {
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
        runs: runsPayload,
      };
      writeFileSync(path, JSON.stringify(jsonPayload, null, 2), "utf-8");
    }
  }

  const retain = config.report.retainCount;
  if (typeof retain === "number" && retain > 0) {
    pruneOldReports(outDir, retain);
  }
}
