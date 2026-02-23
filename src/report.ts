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

  // 1. Build a global latency map to enrich skipped records later
  const globalLatencyMap = new Map<string, number>();
  for (const rid of runIds) {
    const recs = getRecordsForRun(db, rid);
    for (const r of recs) {
      if (r.status === "done" && r.latencyMs) {
        globalLatencyMap.set(r.filePath, r.latencyMs);
      }
    }
  }

  // 2. Collect raw data for all runs
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
      let p = r.purchaser;
      if (!p && r.relativePath) {
        // Try to infer purchaser from path if missing in metadata
        const parts = r.relativePath.split(/[\\/]/);
        if (
          parts.length > 1 ||
          (parts.length === 1 && !parts[0].includes("."))
        ) {
          const first = parts[0];
          if (first && first !== "output" && first !== "staging") {
            p = first;
          }
        }
      }
      const key = `${r.brand}|${p || ""}`;
      if (!recordsByGroup.has(key)) recordsByGroup.set(key, []);

      // Enrich skipped records with previous latency if available
      if (r.status === "skipped" && !r.latencyMs) {
        const prevLatency = globalLatencyMap.get(r.filePath);
        if (prevLatency) {
          (r as any).latencyMs = prevLatency;
        }
      }

      recordsByGroup.get(key)!.push(r);
    }

    for (const [key, groupRecords] of recordsByGroup) {
      const { start, end } = minMaxDatesFromRecords(groupRecords);
      let [brand, purchaser] = key.split("|");

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
  const istDate = new Date(
    d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const month = MONTH_NAMES[istDate.getMonth()].toUpperCase();
  const day = istDate.getDate();
  const year = istDate.getFullYear();
  const hours24 = istDate.getHours();
  const hours12 = hours24 % 12 || 12;
  const h = String(hours12).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  const ampm = hours24 < 12 ? "AM" : "PM";
  // Format: FEB-14-2026-12:19:PM
  return `${month}-${day}-${year}-${h}:${min}:${ampm}`;
}

function formatDateHuman(d: Date): string {
  const months = [
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
  const istDate = new Date(
    d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );
  const day = istDate.getDate();
  return `${dayOrdinal(day)} ${months[istDate.getMonth()]} ${istDate.getFullYear()}`;
}

function formatBrandDisplayName(brandId?: string): string {
  if (!brandId) return "N/A";
  const b = brandId.toLowerCase();
  if (b.includes("no-cow")) return "No Cow";
  if (b.includes("sundia")) return "Sundia";
  if (b.includes("tractor-beverage")) return "Tractor";
  if (b === "p3" || b === "pipe") return "PIPE";
  return brandId;
}

function formatPurchaserDisplayName(purchaserId?: string): string {
  if (!purchaserId) return "N/A";
  const p = purchaserId.toLowerCase();
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
  // displaySuccess is succeededCount (JSONs on disk), which already includes skipped files.
  // We set processed to the total attempt count (Success + Failed + Skipped) so metrics correctly
  // represent the full scope of the operation.
  const displaySuccess = succeededCount;
  const displayInfraFailed = m.failed;
  const displayApiFailed = Math.max(0, m.success - displaySuccess);
  const processed = m.success + m.failed + m.skipped;
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
            const sourcePath = `output/staging/${f.brand}/${f.relativePath}`;
            const jsonPath = `output/extractions/failed/${extractionResultFilenameFromRecord({ relativePath: f.relativePath, brand: f.brand, purchaser: f.purchaser })}`;
            return `<tr><td>${f.statusCode ?? "—"}</td><td class="file-path">${escapeHtml(f.filePath)}</td><td>${snippet}</td><td class="action-cell">
        <a href="javascript:void(0)" onclick="downloadFile('${sourcePath}', this)" class="action-btn" title="Download Source File">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </a>
        <a href="javascript:void(0)" onclick="downloadFile('${jsonPath}', this)" class="action-btn" title="Download Response">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </a>
      </td></tr>`;
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
      <tr><th>Status</th><th>File</th><th>Message snippet</th><th class="action-cell">Action</th></tr>
      ${failureDetailsRows}
    </table>
  </div>`
      : "";

  const topSlowestRows = m.topSlowestFiles
    .map((e) => {
      const jsonName = extractionResultFilenameFromRecord({
        relativePath: e.relativePath,
        brand: e.brand,
        purchaser: e.purchaser,
      });
      const jsonPath = `output/extractions/succeeded/${jsonName}`;
      const sourcePath = `output/staging/${e.brand}/${e.relativePath}`;

      return `<tr><td class="file-path">${escapeHtml(e.filePath)}</td><td>${e.latencyMs.toFixed(0)}</td><td>${escapeHtml(e.patternKey ?? "—")}</td><td class="action-cell">
        <a href="javascript:void(0)" onclick="downloadFile('${sourcePath}', this)" class="action-btn" title="Download Source File">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </a>
        <a href="javascript:void(0)" onclick="downloadFile('${jsonPath}', this)" class="action-btn" title="Download Extraction JSON">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </a>
      </td></tr>`;
    })
    .join("");
  const topSlowestSection =
    m.topSlowestFiles.length > 0
      ? `
<h3>Top ${m.topSlowestFiles.length} slowest files (by processing time)</h3>
 <div class="table-responsive">
  <table>
    <tr><th>File</th><th>Latency (ms)</th><th>Pattern Key</th><th class="action-cell">Action</th></tr>
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

  const brandDisplay = entry.brand ? formatBrandDisplayName(entry.brand) : "";
  const purchaserDisplay = entry.purchaser
    ? formatPurchaserDisplayName(entry.purchaser).replace(/_/g, "-")
    : "";

  let sectionClass = "run-section history-item";
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
  const itemCountBadge = `<span class="badge-status secondary" style="background: rgba(33, 108, 109, 0.1); color: var(--header-bg); border: 1px solid rgba(33, 108, 109, 0.2);">${processed} ITEMS</span>`;

  // Build a lookup map from extraction results (actual JSON files on disk)
  // so we can enrich skipped records and verify file existence for buttons
  const extractionResultMap = new Map<
    string,
    { patternKey?: string; success: boolean; latencyMs?: number }
  >();
  for (const er of entry.extractionResults) {
    const resp = er.response as Record<string, any> | null;
    const pattern = resp?.pattern as Record<string, any> | undefined;
    const meta = resp?.meta as Record<string, any> | undefined;

    // Try to find latency in various standard locations
    const foundLatency =
      resp?.latency_ms ??
      meta?.latency_ms ??
      resp?._latencyMs ??
      resp?.latencyMs ??
      meta?.latencyMs;

    extractionResultMap.set(er.filename, {
      patternKey: (pattern?.pattern_key as string) ?? undefined,
      success: er.extractionSuccess,
      latencyMs: typeof foundLatency === "number" ? foundLatency : undefined,
    });
  }

  // Create full log rows from records
  const fullLogRows = entry.records
    .map((rec) => {
      const jsonName = extractionResultFilenameFromRecord({
        relativePath: rec.relativePath,
        brand: rec.brand,
        purchaser: rec.purchaser,
      });

      // Check if extraction JSON actually exists on disk
      const extractionResult = extractionResultMap.get(jsonName);
      const jsonExists = !!extractionResult;

      let statusDisplay = "";
      let jsonDir = "output/extractions/failed";
      let showJson = false;
      let showSource = false;
      let displayPatternKey = rec.patternKey;
      let displayLatency = rec.latencyMs;

      if (rec.status === "done") {
        statusDisplay = '<span class="status-icon success">✅</span> SUCCESS';
        jsonDir =
          extractionResult?.success !== false
            ? "output/extractions/succeeded"
            : "output/extractions/failed";
        showJson = jsonExists;
        if (!displayPatternKey && extractionResult?.patternKey) {
          displayPatternKey = extractionResult.patternKey;
        }
        if (!displayLatency && extractionResult?.latencyMs) {
          displayLatency = extractionResult.latencyMs;
        }
      } else if (rec.status === "skipped") {
        if (jsonExists) {
          // File was extracted in a previous session — show as SUCCESS with enriched data
          statusDisplay =
            '<span class="status-icon success">✅</span> SUCCESS <span class="muted small" style="font-weight:400">(SKIPPED)</span>';
          jsonDir =
            extractionResult?.success !== false
              ? "output/extractions/succeeded"
              : "output/extractions/failed";
          showJson = true;
          if (!displayPatternKey && extractionResult?.patternKey) {
            displayPatternKey = extractionResult.patternKey;
          }
          if (!displayLatency && extractionResult?.latencyMs) {
            displayLatency = extractionResult.latencyMs;
          }
        } else {
          // Skipped but no extraction JSON found — interrupted run
          statusDisplay =
            '<span class="status-icon secondary">⏭️</span> SKIPPED';
          showJson = false;
          showSource = true;
        }
      } else if (rec.status === "error") {
        statusDisplay = '<span class="status-icon error">❌</span> FAILED';
        jsonDir = "output/extractions/failed";
        showJson = jsonExists;
      } else {
        statusDisplay = `<span class="status-icon secondary">⏳</span> ${rec.status.toUpperCase()}`;
        showJson = false;
      }

      const jsonPath = `${jsonDir}/${jsonName}`;
      const sourcePath = `output/staging/${rec.brand}/${rec.relativePath}`;
      showSource = existsSync(sourcePath);

      const jsonBtn = showJson
        ? `<a href="javascript:void(0)" onclick="downloadFile('${jsonPath}', this)" class="action-btn" title="Download Extraction JSON" data-type="json" data-path="${jsonPath}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </a>`
        : "";

      const sourceBtn = showSource
        ? `<a href="javascript:void(0)" onclick="downloadFile('${sourcePath}', this)" class="action-btn" title="Download Source File" data-type="source" data-path="${sourcePath}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        </a>`
        : "";

      return `<tr class="log-row" data-search="${escapeHtml((rec.filePath + statusDisplay + (displayPatternKey || "")).toLowerCase())}">
      <td>${statusDisplay}</td>
      <td class="file-path">${escapeHtml(rec.filePath)}</td>
      <td>${escapeHtml(displayPatternKey ?? "—")}</td>
      <td><span class="chip">${displayLatency ? displayLatency.toFixed(0) : "—"} ms</span></td>
      <td class="action-cell">
        ${sourceBtn}
        ${jsonBtn}
      </td>
    </tr>`;
    })
    .join("");

  const accordionArrow = `<svg class="accordion-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 12px; flex-shrink: 0;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

  const fullLogSection = `
    <details class="full-log-container">
      <summary class="run-section-summary" style="border: none;">
        <div class="summary-content" style="justify-content: flex-start;">
          <div style="font-weight: 800; font-size: 0.85rem; text-transform: uppercase;">📦 View Full Extraction Log (${entry.records.length} files)</div>
          ${accordionArrow}
        </div>
      </summary>
      <div class="run-section-body" style="padding: 1.5rem 1.5rem;">
        <div class="log-search-container" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
          <input type="text" placeholder="Search files, patterns, or status..." onkeyup="filterSectionLog(this)" style="flex: 1;">
          <div style="display: flex; gap: 8px;">
            <button class="pg-btn" onclick="exportRun('${entry.runId}', this, 'source')" title="Export source files for this run (ZIP)" style="height: 38px; white-space: nowrap; font-family: 'JetBrains Mono', monospace;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Source
            </button>
            <button class="pg-btn" onclick="exportRun('${entry.runId}', this, 'json')" title="Export extraction JSONs for this run (ZIP)" style="height: 38px; white-space: nowrap; font-family: 'JetBrains Mono', monospace;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export JSON
            </button>
          </div>
        </div>
        <div class="table-responsive" style="max-height: 500px; overflow-y: auto;">
          <table class="log-table">
            <thead>
              <tr><th style="width: 140px;">Status</th><th>File Path</th><th style="width: 200px;">Pattern</th><th style="width: 100px;">Latency</th><th style="width: 100px;" class="action-cell">Action</th></tr>
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
    <summary class="run-section-summary" style="border: none; background: #f8fafc;">
      <div class="summary-content" style="justify-content: flex-start;">
        <div style="font-weight: 800; font-size: 0.85rem; text-transform: uppercase;">🕒 Execution Timeline (${entry.sessions!.length} Sessions)</div>
        ${accordionArrow}
      </div>
    </summary>
    <div class="run-section-body" style="padding: 1rem 1.5rem;">
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

  const dataStatus =
    displayInfraFailed > 0 || displayApiFailed > 0 ? "failed" : "success";

  return `
  <details class="${sectionClass} history-item" data-runid="${entry.runId}" data-brand="${entry.brand || ""}" data-purchaser="${entry.purchaser || ""}" data-items="${processed}" data-status="${dataStatus}">
  <summary class="run-section-summary">
    <div class="summary-content">
      <div class="operation-pointer">
        ${runBadge}
        ${brandLabel}${purchaserBadge}
        <span class="run-time">${escapeHtml(runLabel)}</span>
      </div>
      <div class="summary-badges">
        ${itemCountBadge} ${successBadge} ${apiFailBadge} ${infraFailBadge}
        ${accordionArrow}
      </div>
    </div>
  </summary>
  <div class="run-section-body">
    <div class="run-section-body-inner" style="padding: 0.5rem 1.5rem 1.5rem;">
    ${sessionsSection}
    <div style="margin-bottom: 2rem;">
      <h3 style="margin-top: 0;">Consolidated Overview</h3>
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
  </div>
  </details>`;
}

const REPORT_TITLE = "Run Summary Report";

export function htmlReportFromHistory(
  historicalSummaries: HistoricalRunSummary[],
  generatedAt: string,
): string {
  const allBrands = Array.from(
    new Set(historicalSummaries.map((s) => s.brand).filter(Boolean)),
  );
  const allPurchasers = Array.from(
    new Set(historicalSummaries.map((s) => s.purchaser).filter(Boolean)),
  ).sort((a, b) => {
    const nameA = formatPurchaserDisplayName(a!).toLowerCase();
    const nameB = formatPurchaserDisplayName(b!).toLowerCase();
    const isTempA = nameA.includes("temp");
    const isTempB = nameB.includes("temp");
    if (isTempA && !isTempB) return 1;
    if (!isTempA && isTempB) return -1;
    return nameA.localeCompare(nameB);
  });

  const brandNamesMap: Record<string, string> = {};
  allBrands.forEach((id) => (brandNamesMap[id!] = formatBrandDisplayName(id!)));
  const purchaserNamesMap: Record<string, string> = {};
  allPurchasers.forEach(
    (id) => (purchaserNamesMap[id!] = formatPurchaserDisplayName(id!)),
  );

  const brandPurchaserMap: Record<string, string[]> = {};
  historicalSummaries.forEach((s) => {
    if (s.brand && s.purchaser) {
      if (!brandPurchaserMap[s.brand]) {
        brandPurchaserMap[s.brand] = [];
      }
      if (!brandPurchaserMap[s.brand].includes(s.purchaser)) {
        brandPurchaserMap[s.brand].push(s.purchaser);
      }
    }
  });

  const runsWithStatus = historicalSummaries.map((s) => {
    const succeededCount = s.extractionResults.filter(
      (e) => e.extractionSuccess,
    ).length;
    const displayInfraFailed = s.metrics.failed;
    const displayApiFailed = Math.max(0, s.metrics.success - succeededCount);
    const status =
      displayInfraFailed > 0 || displayApiFailed > 0 ? "failed" : "success";
    return { status };
  });
  const countAll = runsWithStatus.length;
  const countSuccess = runsWithStatus.filter(
    (r) => r.status === "success",
  ).length;
  const countFailed = runsWithStatus.filter(
    (r) => r.status === "failed",
  ).length;

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
    logoDataUri = "../../assets/logo.png";
  }

  let faviconDataUri = "";
  try {
    const favRelPath = join(process.cwd(), "assets", "favicon.ico");
    if (existsSync(favRelPath)) {
      const favBuffer = readFileSync(favRelPath);
      faviconDataUri = `data:image/x-icon;base64,${favBuffer.toString("base64")}`;
    }
  } catch (e) {
    faviconDataUri = "../../assets/favicon.ico";
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(REPORT_TITLE)}</title>
  ${faviconDataUri ? `<link rel="icon" href="${faviconDataUri}" type="image/x-icon">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
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
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.06);
    }
    * { box-sizing: border-box; }
    html { overflow-y: scroll; scrollbar-gutter: stable; }
    body {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .page-body { padding: 1.25rem; }
    
    .report-header {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      padding: 0.6rem 1.25rem;
      border-radius: var(--radius);
      margin: 0.75rem auto 0.5rem auto;
      max-width: 1820px;
      width: calc(100% - 2.5rem);
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid rgba(176, 191, 201, 0.3);
      position: sticky;
      top: 0;
      z-index: 1000;
      min-height: 72px;
    }
    .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
    .report-header .logo { height: 32px; width: auto; object-fit: contain; cursor: pointer; }
    .report-header-title {
      margin: 0;
      height: 34px;
      font-size: 0.85rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #ffffff;
      background: var(--header-bg);
      padding: 0 1.25rem;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      line-height: 1;
      font-family: inherit;
      box-shadow: 0 2px 5px rgba(0,0,0,0.15);
    }
    
    h1:not(.report-header-title) { color: var(--header-bg); font-size: 1.75rem; margin-bottom: 0.5rem; text-align: center; }
    h2 { color: var(--text-secondary); font-size: 1.1rem; font-weight: 500; margin-bottom: 1.5rem; text-align: center; }
    h3 { color: var(--header-bg); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 2rem 0 1rem; border-bottom: 2px solid var(--border-light); padding-bottom: 0.4rem; }
    
    .meta { color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: right; opacity: 0.85; }
    .meta p { margin: 2px 0; }

    @keyframes rowEntry {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    /* Page Loader Overlay */
    #page-loader {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      flex-direction: column;
      gap: 1.5rem;
      animation: fadeIn 0.3s ease;
    }
    .loader-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid var(--primary);
      border-bottom-color: transparent;
      border-radius: 50%;
      display: inline-block;
      box-sizing: border-box;
      animation: rotation 1s linear infinite;
    }
    .loader-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: var(--header-bg);
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    @keyframes rotation {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    tr { animation: rowEntry 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
    tr:nth-child(1) { animation-delay: 0.05s; }
    tr:nth-child(2) { animation-delay: 0.1s; }
    tr:nth-child(3) { animation-delay: 0.15s; }
    tr:nth-child(4) { animation-delay: 0.2s; }
    tr:nth-child(5) { animation-delay: 0.25s; }

    /* Filtering Styles */
    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-filter-row { display: flex; align-items: center; gap: 0.75rem; }
    .header-field-wrap { display: flex; flex-direction: column; align-items: center; }
    .filter-dropdown { position: relative; }
    .filter-chip { 
      display: flex; align-items: center; height: 34px; background: #fff; 
      border: 1px solid rgba(176,191,201,0.6); border-radius: 8px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .filter-chip .header-label {
      font-size: 0.7rem; color: var(--primary); font-weight: 800; background: var(--accent-light);
      padding: 0 0.75rem; height: 100%; display: flex; align-items: center;
      border-right: 1px solid rgba(45,157,95,0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .filter-dropdown-trigger {
      border: none; background: transparent; height: 100%; padding: 0 1.5rem 0 0.75rem;
      font-size: 0.85rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .brand-field-wrap .filter-dropdown-trigger { min-width: 185px; max-width: 185px; }
    .purchaser-field-wrap .filter-dropdown-trigger { min-width: 185px; max-width: 185px; }

    .filter-dropdown-panel {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      min-width: 230px;
      max-height: 400px;
      overflow-y: auto;
      background: white;
      border: 1px solid var(--border-light);
      border-radius: 10px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.05);
      z-index: 2000;
      padding: 0.5rem 0;
      display: none;
      transform-origin: top;
    }
    @keyframes slideDownPanel {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .filter-dropdown-panel.open { 
      display: block; 
      animation: slideDownPanel 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; 
      will-change: transform, opacity;
    }
    .filter-dropdown-option {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      font-size: 0.85rem; cursor: pointer; transition: background 0.1s;
    }
    .filter-dropdown-option:hover { background: #f8fafc; }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }
    
    .header-btn-reset {
      height: 34px; 
      padding: 0 1.1rem; 
      width: 185px;
      background: var(--header-bg); 
      color: #fff;
      border: none; 
      border-radius: 6px; 
      font-size: 0.82rem; 
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer; 
      box-shadow: 0 2px 5px rgba(33,108,109,0.2); 
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      font-family: inherit;
    }
    
    .table-responsive { width: 100%; overflow-x: auto; margin-bottom: 1.5rem; border-radius: var(--radius-sm); box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--border); background: var(--surface); }
    table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: auto; min-width: 800px; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; overflow-wrap: anywhere; }
    th {
      background: var(--header-bg);
      color: white;
      font-size: 0.725rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      border-right: 1px solid rgba(255, 255, 255, 0.15);
      border-bottom: none;
      padding: 0.85rem 1rem;
    }
    th:last-child { border-right: none; }
    td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border-light); border-right: 1px solid var(--border-light); word-break: break-all; overflow-wrap: anywhere; }
    td:last-child { border-right: none; }

    /* Column Sizing for Failure Details */
    .failure-details-table th:nth-child(1) { width: 80px; }
    .failure-details-table th:nth-child(2) { min-width: 400px; }
    .failure-details-table th:nth-child(3) { min-width: 400px; }
    
    .run-section { 
      margin-bottom: 1.25rem; 
      background: white; 
      border-radius: 10px; 
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); 
      border: 1px solid var(--border); 
      overflow: hidden; 
      border-left: 6px solid #cbd5e1; 
      transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease; 
    }
    .run-section[open] { 
      border-color: var(--header-bg); 
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      transform: translateY(-2px);
    }
    .run-section.status-error { border-left-color: #ef4444; }
    .run-section.status-warning { border-left-color: #f59e0b; }
    .run-section.status-error[open] { border-color: #ef4444; }
    .run-section.status-warning[open] { border-color: #f59e0b; }

    .run-section-body { overflow: hidden; }
    /* Animation helper classes */
    .collapsing { transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    .expanding { transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
    
    .run-section-summary { cursor: pointer; padding: 1rem 1.25rem; background: #f8fafc; list-style: none; transition: background 0.2s; border-bottom: 1px solid var(--border-light); }
    .run-section-summary::-webkit-details-marker { display: none; }
    .run-section-summary:hover { background: #f1f5f9; }
    
    .summary-content { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    
    .operation-pointer {
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

    /* Custom Alert Modal Styles */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.65);
      backdrop-filter: blur(5px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 5000;
      animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes modalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes modalFadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    .modal-overlay.open { display: flex; }
    .modal-overlay.closing { animation: fadeOut 0.15s ease-in forwards; }
    
    .modal {
      background: var(--surface);
      border-radius: 16px;
      box-shadow: 
        0 20px 25px -5px rgba(0, 0, 0, 0.2),
        0 10px 10px -5px rgba(0, 0, 0, 0.1),
        0 0 0 1px rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255,255,255,0.1);
      width: 420px;
      font-family: 'JetBrains Mono', monospace;
      max-width: 90vw;
      padding: 0;
      display: flex;
      flex-direction: column;
      animation: modalSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      overflow: hidden;
    }
    .modal-overlay.closing .modal { animation: modalSlideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .modal-overlay.closing { animation: modalFadeOut 0.25s ease-in forwards; }

    .modal-header {
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-light);
    }
    .modal-title { display: flex; align-items: center; gap: 0.75rem; }
    .title-badge {
      font-size: 0.65rem;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      color: white;
      text-transform: uppercase;
    }
    .modal-body { padding: 2rem 1.5rem; text-align: center; }
    .modal-message { 
      margin-bottom: 1.5rem; 
      font-size: 1rem; 
      line-height: 1.6; 
      color: var(--text-secondary); 
      font-weight: 500; 
    }
    .modal-footer { display: flex; justify-content: center; gap: 1rem; }

    .btn-alert-confirm {
      background: var(--header-bg);
      color: white;
      border: none;
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      height: 42px;
      padding: 0 1.5rem;
      font-weight: 700;
      cursor: pointer;
      min-width: 120px;
      transition: all 0.2s;
    }
    .btn-alert-confirm:hover { background: var(--primary); transform: translateY(-1px); }
    .btn-alert-cancel {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
    }

    /* Reports Toolbar */
    .main-container {
      padding: 0 0 1.25rem 0;
      max-width: 1820px;
      width: calc(100% - 2.5rem);
      margin: 0 auto;
      box-sizing: border-box;
    }
    .report-card-box {
      background: var(--surface);
      border: 1px solid rgba(176, 191, 201, 0.55);
      border-radius: var(--radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .download-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem 1.25rem;
      background: #f8fafc;
      border-bottom: 1px solid rgba(176, 191, 201, 0.45);
      flex-wrap: wrap;
    }
    .download-chip {
      display: flex;
      align-items: center;
      height: 36px;
      background: white;
      border: 1px solid rgba(176, 191, 201, 0.6);
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .home-btn {
      display: flex;
      align-items: center;
      padding: 0 1.25rem;
      height: 100%;
      width: 170px;
      justify-content: center;
      background: var(--header-bg) !important;
      color: white !important;
      text-transform: uppercase;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      border: none;
      border-right: 1.2px solid rgba(255, 255, 255, 0.15);
      text-decoration: none;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .home-btn:hover {
      background: var(--primary) !important;
    }
    .download-bar-btns {
      display: flex;
      align-items: center;
      height: 100%;
      gap: 0;
    }
    .download-bar-btns a {
      height: 100%;
      width: 170px;
      border: none;
      border-radius: 0;
      background: transparent !important;
      color: var(--text-secondary) !important;
      padding: 0 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      box-shadow: none;
      border-right: 1px solid rgba(203, 213, 225, 0.5);
      margin: 0;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      white-space: nowrap;
    }
    .download-bar-btns a:hover {
      background: #f1f5f9 !important;
      color: var(--primary) !important;
    }
    .download-bar-btns a svg {
      transition: transform 0.2s;
    }
    .download-bar-btns a:hover svg {
      transform: translateY(-1px);
      color: var(--primary);
    }
    .download-bar-btns a:last-child {
      border-right: none;
    }
    .download-bar-btns a.active {
      background: #f0fdf4 !important;
      color: var(--primary) !important;
    }


    .btn-alert-cancel:hover { background: #e2e8f0; }

    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes modalSlideUp { 
      from { opacity: 0; transform: translateY(16px); } 
      to { opacity: 1; transform: translateY(0); } 
    }
    @keyframes modalSlideDown { 
      from { opacity: 1; transform: translateY(0); } 
      to { opacity: 0; transform: translateY(16px); } 
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
    
    .run-section-body { padding: 0; }
    
    .chip { display: inline-flex; align-items: center; background: #f1f5f9; color: var(--text); padding: 0.2rem 0.6rem; border-radius: 100px; font-size: 0.75rem; font-weight: 600; border: 1px solid var(--border); }
    .chip.success { background: var(--accent-light); color: var(--primary); border-color: rgba(45, 157, 95, 0.2); }
    .chip.fail { background: #fee2e2; color: #b91c1c; border-color: rgba(185, 28, 28, 0.2); }
    .chip.secondary { background: #f8fafc; color: var(--header-bg); font-weight: 700; border-color: var(--border-light); }
    
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; background: rgba(176, 191, 201, 0.15); padding: 5px; border-radius: var(--radius); border: 1px solid var(--border-light); }
    .tab-btn { flex: 1; background: none; border: none; padding: 0.65rem 1.5rem; font-family: inherit; font-size: 0.85rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; color: var(--text-secondary); border-radius: calc(var(--radius) - 4px); transition: all 0.25s ease; }
    .tab-btn.active { background: var(--header-bg); color: white; box-shadow: 0 4px 12px rgba(33, 108, 109, 0.25); }
    @keyframes tabFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; animation: tabFadeIn 0.3s cubic-bezier(0.2, 0, 0, 1); }

    .dashboard-grid { 
      display: grid; 
      grid-template-columns: repeat(2, 1fr); 
      gap: 1rem; 
      margin-bottom: 2rem; 
    }
    @media (max-width: 1000px) {
      .dashboard-grid { grid-template-columns: 1fr; }
    }
    .chart-card { 
      background: var(--surface); 
      border: 1px solid var(--border-light); 
      border-radius: var(--radius); 
      padding: 1.6rem; 
      box-shadow: 0 4px 12px rgba(0,0,0,0.03), 0 1px 2px rgba(0,0,0,0.02);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .chart-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 24px rgba(0,0,0,0.06);
    }
    .chart-card h4 { 
      margin: 0 0 1.25rem; 
      font-size: 0.85rem; 
      text-transform: uppercase; 
      letter-spacing: 0.1em; 
      color: var(--header-bg); 
      border-bottom: 1px solid rgba(176,191,201,0.2); 
      padding-bottom: 0.75rem; 
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .chart-card h4::before {
      content: '';
      display: inline-block;
      width: 4px;
      height: 16px;
      background: var(--primary);
      border-radius: 2px;
    }
    .chart-scroll-wrapper { 
      overflow-x: auto; 
      overflow-y: hidden; 
      padding-bottom: 8px;
    }

    .chart-container { position: relative; height: 300px; width: 100%; min-width: 100%; }
    
    .stats-grid { 
      display: grid; 
      grid-template-columns: repeat(4, 1fr); 
      gap: 1rem; 
      margin-bottom: 2rem; 
    }
    @media (max-width: 900px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .stat-card { 
      background: var(--surface); 
      border: 1px solid var(--border-light); 
      border-radius: var(--radius); 
      padding: 1.25rem 1.5rem; 
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .stat-card .stat-label { font-size: 0.65rem; color: var(--muted); text-transform: uppercase; font-weight: 800; letter-spacing: 0.07em; }
    .stat-card .stat-value { font-size: 2rem; font-weight: 700; color: var(--header-bg); line-height: 1; }
    .stat-card.success .stat-value { color: var(--pass); }
    .stat-card.failed .stat-value { color: var(--fail); }

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
    
    .full-log-container { margin-top: 1.5rem; overflow: hidden; border-radius: 8px; border: 1px solid var(--border-light); }
    .full-log-container[open] { border-color: var(--header-bg); }
    .accordion-arrow { transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1); color: #94a3b8; }
    details[open] .accordion-arrow { transform: rotate(180deg); color: var(--header-bg); }
    .log-search-container { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .log-search-container input { flex: 1; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border); font-family: inherit; font-size: 0.85rem; }
    .log-search-container span { font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); }
    
    .status-icon { font-size: 1rem; margin-right: 4px; }
    .status-icon.success { color: #2d9d5f; }
    .status-icon.error { color: #ef4444; }
    
    .log-table th { 
      position: sticky; 
      top: 0; 
      z-index: 100; 
      background: var(--header-bg) !important; 
      color: white !important;
      text-align: left;
      padding: 0.85rem 1rem;
      border-bottom: 2px solid rgba(0,0,0,0.1);
      height: 44px;
      line-height: 1.2;
    }
    .log-table th.action-cell {
      text-align: center;
    }
    .log-row-hidden { display: none !important; }

    /* Premium Scrollbar */
    .chart-scroll-wrapper::-webkit-scrollbar-thumb:hover { background: rgba(33, 108, 109, 0.3); }

    /* History Pagination */
    .history-pagination {
      display: flex;
      gap: 0.5rem;
      justify-content: center;
      margin: 2.5rem 0;
      padding: 1rem;
    }
    .pg-btn {
      padding: 0.55rem 1.1rem;
      border: 1px solid var(--border);
      background: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--header-bg);
      font-family: inherit;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
    }
    .pg-btn:hover:not(:disabled) { 
      background: var(--accent-light);
      border-color: var(--primary);
      color: var(--primary);
      transform: translateY(-1px);
    }
    .pg-btn.active { 
      background: var(--header-bg); 
      color: white; 
      border-color: var(--header-bg);
      box-shadow: 0 4px 10px rgba(33, 108, 109, 0.2);
    }
    .pg-btn:disabled { 
      opacity: 0.4; 
      cursor: not-allowed; 
      background: #f8fafc;
    }
    .pg-ellipsis {
      padding: 0.5rem;
      color: var(--text-secondary);
      font-weight: 700;
      display: flex;
      align-items: flex-end;
    }

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
    
    /* Filtering Styles */
    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-filter-row { display: flex; align-items: center; gap: 0.75rem; }
    .header-field-wrap { display: flex; flex-direction: column; align-items: center; }
    .filter-dropdown { position: relative; }
    .filter-chip { 
      display: flex; align-items: center; height: 34px; background: #fff; 
      border: 1px solid rgba(176,191,201,0.6); border-radius: 8px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .filter-chip .header-label {
      font-size: 0.7rem; color: var(--primary); font-weight: 800; background: var(--accent-light);
      padding: 0 0.75rem; height: 100%; display: flex; align-items: center;
      border-right: 1px solid rgba(45,157,95,0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .filter-dropdown-trigger {
      border: none; background: transparent; height: 100%; padding: 0 1.5rem 0 0.75rem;
      font-size: 0.85rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .brand-field-wrap .filter-dropdown-trigger { min-width: 162px; max-width: 162px; }
    .purchaser-field-wrap .filter-dropdown-trigger { min-width: 187px; max-width: 187px; }
    .filter-dropdown-panel {
      display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
      min-width: 220px; max-height: 400px; overflow-y: auto; background: white;
      border: 1px solid var(--border-light); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      z-index: 1100; padding: 0.5rem 0;
    }
    .filter-dropdown-panel.open { display: block; animation: slideDown 0.2s ease-out; }
    .filter-dropdown-option {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      font-size: 0.85rem; cursor: pointer; transition: background 0.1s;
    }
    .filter-dropdown-option:hover { background: #f8fafc; }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }
    
    .header-btn-reset {
      height: 34px; 
      padding: 0 1.1rem; 
      background: var(--header-bg); 
      color: #fff;
      border: none; 
      border-radius: 6px; 
      font-size: 0.82rem; 
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer; 
      box-shadow: 0 2px 5px rgba(33,108,109,0.2); 
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      font-family: inherit;
    }
    .header-btn-reset:hover { filter: brightness(1.1); transform: translateY(-1px); }
    
    .controls-bar {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin: 1.5rem 0 1.25rem;
      background: #fff;
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(176, 191, 201, 0.4);
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      flex-wrap: wrap;
    }
    .status-group {
      display: flex;
      background: #f1f5f9;
      padding: 4px;
      border-radius: 10px;
      gap: 2px;
    }
    .status-tab {
      border: none;
      background: none;
      padding: 0.5rem 1.1rem;
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 800;
      color: #64748b;
      cursor: pointer;
      border-radius: 7px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .status-tab.active {
      background: white;
      color: var(--header-bg);
      box-shadow: 0 2px 5px rgba(0,0,0,0.06);
    }
    .status-tab .count {
      background: #e2e8f0;
      color: #475569;
      padding: 1px 6.5px;
      border-radius: 4.5px;
      font-size: 0.65rem;
    }
    .status-tab.active .count {
      background: var(--accent-light);
      color: var(--primary);
    }
    .search-wrap {
      flex: 1;
      min-width: 300px;
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-wrap svg {
      position: absolute;
      left: 12px;
      color: #94a3b8;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 1.25rem 0 2.5rem;
      border-radius: 8px;
      border: 1px solid transparent;
      font-family: inherit;
      font-size: 0.82rem;
      background: #f1f5f9;
      color: var(--text);
      transition: all 0.2s;
    }
    .search-input:focus {
      outline: none;
      border-color: var(--primary);
      background: white;
      box-shadow: 0 0 0 3px var(--accent-light);
    }
    .results-info { font-size: 0.72rem; font-weight: 800; color: var(--header-bg); text-transform: uppercase; letter-spacing: 0.05em; }
    
    .action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #f1f5f9;
      color: #64748b;
      transition: all 0.2s;
      text-decoration: none;
      border: 1px solid var(--border-light);
    }
    .action-btn:hover {
      background: var(--accent-light);
      color: var(--primary);
      border-color: var(--primary);
    }
    .action-cell {
      text-align: center;
      vertical-align: middle;
      white-space: nowrap;
    }
    .action-cell .action-btn {
      margin: 0 2px;
    }

    .filtered-out { display: none !important; }

    @media (max-width: 1080px) {
      .report-header { padding: 0.75rem 1rem; min-height: 64px; }
      .report-header-title { font-size: 0.75rem; padding: 0 0.75rem; }
      .header-filter-row { gap: 0.5rem; }
      .brand-field-wrap .filter-dropdown-trigger { min-width: 140px; max-width: 140px; }
      .purchaser-field-wrap .filter-dropdown-trigger { min-width: 160px; max-width: 160px; }
      .header-btn-reset { width: 140px; font-size: 0.75rem; padding: 0 0.8rem; }
    }
  </style>
  <!-- Custom Alert Modal -->
  <div id="app-alert-modal-overlay" class="modal-overlay" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="app-alert-title">
      <div class="modal-header">
        <div class="modal-title" id="app-alert-title">
          <span class="title-badge" id="app-alert-badge">INFO</span>
          <span id="app-alert-header-text" style="font-weight: 700">Notification</span>
        </div>
        <button type="button" style="background:transparent; border:none; cursor:pointer; font-size:1.2rem;" onclick="closeAppAlert()">&#10005;</button>
      </div>
      <div class="modal-body">
        <div id="app-alert-message" class="modal-message"></div>
        <div class="modal-footer">
           <button type="button" class="btn-alert-cancel" id="app-alert-cancel-btn" onclick="closeAppAlert()">Cancel</button>
           <button type="button" class="btn-alert-confirm" id="app-alert-confirm-btn">
             <span id="app-alert-confirm-text">Dismiss</span>
           </button>
        </div>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>


    // Modal Helpers
    let currentConfirmCallback = null;
    function showAppAlert(title, message, options) {
      const overlay = document.getElementById("app-alert-modal-overlay");
      const headerText = document.getElementById("app-alert-header-text");
      const msgEl = document.getElementById("app-alert-message");
      const badge = document.getElementById("app-alert-badge");
      const cancelBtn = document.getElementById("app-alert-cancel-btn");
      const confirmBtn = document.getElementById("app-alert-confirm-btn");
      const confirmText = document.getElementById("app-alert-confirm-text");

      if (!overlay || !msgEl) return;

      if (typeof options === "boolean") options = { isError: options };
      options = options || {};

      headerText.textContent = title || "Notification";
      msgEl.textContent = message || "";
      
      if (badge) {
        badge.textContent = options.isError ? "ERROR" : (options.isConfirm ? "CONFIRM" : "INFO");
        badge.style.background = options.isError ? "#ef4444" : "var(--header-bg)";
      }

      if (options.isConfirm) {
        cancelBtn.style.display = "block";
        cancelBtn.textContent = options.cancelText || "Cancel";
        confirmText.textContent = options.confirmText || "Confirm";
        currentConfirmCallback = options.onConfirm || null;
      } else {
        cancelBtn.style.display = "none";
        confirmText.textContent = "Dismiss";
        currentConfirmCallback = null;
      }

      confirmBtn.onclick = function() {
        if (currentConfirmCallback) currentConfirmCallback();
        closeAppAlert();
      };

      overlay.classList.add("open");
      overlay.setAttribute("aria-hidden", "false");
      window._alertIsOpen = true;
    }

    function closeAppAlert() {
      const overlay = document.getElementById("app-alert-modal-overlay");
      if (!overlay) return;
      window._alertIsOpen = false;
      overlay.classList.add("closing");
      overlay.setAttribute("aria-hidden", "true");
      setTimeout(function () {
        overlay.classList.remove("open");
        overlay.classList.remove("closing");
      }, 160);
    }

    // Keyboard shortcuts for Alert Modal
    window.addEventListener("keydown", function (e) {
      if (!window._alertIsOpen) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const btn = document.getElementById("app-alert-confirm-btn");
        if (btn) btn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        const btn = document.getElementById("app-alert-cancel-btn");
        if (btn && btn.style.display !== "none") {
          btn.click();
        } else {
          closeAppAlert();
        }
      }
    });

    function goToHome() {
      if (typeof showLoader === 'function') showLoader();
      try {
        if (window.parent && typeof window.parent.closeReportView === 'function') {
          window.parent.closeReportView();
          return;
        }
      } catch (e) {}
      const baseUrl = window.location.protocol === 'file:' ? 'http://localhost:8765' : window.location.origin;
      window.location.href = baseUrl;
    }

    // Push a history entry so pressing browser Back navigates home instead of leaving the app
    if (window.history && window.history.pushState) {
      history.pushState({ page: 'report' }, document.title, window.location.href);
    }
    window.addEventListener('popstate', function() {
      goToHome();
    });
  </script>
  <style>
    .report-header-left .logo { cursor: pointer; }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="report-header-left">
      <a href="javascript:void(0)" onclick="goToHome()" title="Go to Home" style="display: flex; align-items: center; height: 34px;">
        <img src="${logoDataUri}" alt="intellirevenue" class="logo">
      </a>
      <h1 class="report-header-title">${escapeHtml(REPORT_TITLE)}</h1>
      <div class="meta" style="opacity: 0.85;">
        <p>${historicalSummaries.length} operation(s)</p>
        <p>Generated: ${escapeHtml(formatDateHuman(new Date(generatedAt)))}</p>
      </div>
    </div>
    <div class="report-header-right">
      <div class="header-filter-row" style="gap: 1.25rem;">
        <div class="header-field-wrap brand-field-wrap">
          <div id="brand-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="brand-dropdown-trigger">Brand</label>
              <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">
                Select brand
              </button>
            </div>
            <div id="brand-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
          </div>
        </div>
        <div class="header-field-wrap purchaser-field-wrap">
          <div id="purchaser-dropdown" class="filter-dropdown">
            <div class="filter-chip">
              <label class="header-label" for="purchaser-dropdown-trigger">Purchaser</label>
              <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">
                Select purchaser
              </button>
            </div>
            <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
          </div>
        </div>
        <div class="header-field-wrap header-filter-reset-wrap">
          <button type="button" id="filter-reset-btn" class="header-btn-reset" onclick="resetFilters()">Reset Filter</button>
        </div>
      </div>
    </div>
  </div>

  <main class="main-container">
    <div class="report-card-box">
      <div class="download-bar">
        <div class="download-chip">
          <a href="javascript:void(0)" onclick="goToHome()" class="home-btn" title="Back to Dashboard">
            <svg style="width:14px;height:14px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>Home</span>
          </a>
          <div class="download-bar-btns">
            <a href="/reports/inventory" title="View staging inventory report">
              <svg style="width:14px;height:14px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
              <span>Inventory</span>
            </a>
            <a href="/reports/summary" class="active" title="View latest operation summary report">
              <svg style="width:14px;height:14px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2-2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
              <span>Run Summary</span>
            </a>
            <a href="/reports/explorer" title="Explore extraction data — view full JSON responses">
              <svg style="width:14px;height:14px;margin-right:6px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              <span>Data Explorer</span>
            </a>
          </div>
        </div>
      </div>

      <div class="page-body">
        <div class="tabs">
          <button class="tab-btn active" onclick="switchTab('dashboard')">Analytics Dashboard</button>
          <button class="tab-btn" onclick="switchTab('history')">Operation History</button>
        </div>

    <div id="dashboard" class="tab-content active">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Items Processed</div>
          <div class="stat-value">${historicalSummaries.reduce((a, b) => a + b.metrics.success + b.metrics.failed + (b.metrics.skipped || 0), 0)}</div>
        </div>
        <div class="stat-card success">
          <div class="stat-label">Success Rate</div>
          <div class="stat-value">${(
            (historicalSummaries.reduce(
              (a, b) => a + b.metrics.success + (b.metrics.skipped || 0),
              0,
            ) /
              (historicalSummaries.reduce(
                (a, b) =>
                  a +
                  b.metrics.success +
                  b.metrics.failed +
                  (b.metrics.skipped || 0),
                0,
              ) || 1)) *
            100
          ).toFixed(1)}%</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Latency</div>
          <div class="stat-value">${Math.round(
            historicalSummaries.reduce(
              (a, b) => a + b.metrics.avgLatencyMs,
              0,
            ) / (historicalSummaries.length || 1),
          )}ms</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Operations</div>
          <div class="stat-value">${historicalSummaries.length}</div>
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
      <div class="controls-bar">
        <div class="status-group">
          <button class="status-tab active" data-filter="all">All <span class="count" id="c-all">${countAll}</span></button>
          <button class="status-tab" data-filter="success">Success <span class="count" id="c-succ">${countSuccess}</span></button>
          <button class="status-tab" data-filter="failed">Failed <span class="count" id="c-fail">${countFailed}</span></button>
        </div>
        <div class="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" class="search-input" id="search-input" placeholder="Search Run ID, brand, purchaser…">
        </div>
        <div class="results-info" id="results-info"></div>
      </div>
      <div id="history-items-container">
        ${runsHtml}
      </div>
    </div>
    <div id="history-pagination" class="history-pagination"></div>
      </div>
    </div>
  </main>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      if (event && event.target) {
        event.target.classList.add('active');
      }
      if (tabId === 'history') {
        renderHistory();
      } else if (tabId === 'dashboard') {
        applyFilteringToUI();
      }
    }

    let currentStatusFilter = 'all';
    let currentSearch = '';
    let historyPage = 1;
    const historyPageSize = 20;

    function renderHistory() {
      const allItems = Array.from(document.querySelectorAll('.history-item'));
      
      const visibleItems = allItems.filter(item => {
        // Filter out if brand/purchaser filters don't match (prev logic)
        if (item.classList.contains('filtered-out')) return false;

        // Filter by status tab
        if (currentStatusFilter !== 'all') {
          if (item.getAttribute('data-status') !== currentStatusFilter) return false;
        }

        // Filter by search text
        if (currentSearch) {
          const content = item.innerText.toLowerCase();
          if (!content.includes(currentSearch)) return false;
        }

        return true;
      });
      
      const total = visibleItems.length;
      const pages = Math.ceil(total / historyPageSize);
      
      if (historyPage > pages) historyPage = pages;
      if (historyPage < 1) historyPage = 1;

      allItems.forEach(i => i.style.display = 'none');
      visibleItems.forEach((item, idx) => {
        const start = (historyPage - 1) * historyPageSize;
        const end = start + historyPageSize;
        if (idx >= start && idx < end) {
          item.style.display = 'block';
        }
      });

      // Render pagination buttons
      const pgContainer = document.getElementById('history-pagination');
      if (pages <= 1) { pgContainer.innerHTML = ''; return; }
      
      let html = '';
      html += '<button class="pg-btn" ' + (historyPage === 1 ? 'disabled' : '') + ' onclick="goHistoryPage(' + (historyPage - 1) + ')">Prev</button>';
      
      const dots = '<span class="pg-ellipsis">...</span>';
      
      for (let i = 1; i <= pages; i++) {
        // Always show first, last, current, and one around current
        if (i === 1 || i === pages || (i >= historyPage - 1 && i <= historyPage + 1)) {
          html += '<button class="pg-btn ' + (i === historyPage ? 'active' : '') + '" onclick="goHistoryPage(' + i + ')">' + i + '</button>';
        } else if (i === historyPage - 2 || i === historyPage + 2) {
          html += dots;
        }
      }

      html += '<button class="pg-btn" ' + (historyPage === pages ? 'disabled' : '') + ' onclick="goHistoryPage(' + (historyPage + 1) + ')">Next</button>';
      pgContainer.innerHTML = html;

      const info = document.getElementById('results-info');
      if (info) {
        info.innerText = 'Showing ' + (total ? (historyPage - 1) * historyPageSize + 1 : 0) + '-' + Math.min(historyPage * historyPageSize, total) + ' of ' + total + ' operation(s)';
      }
    }

    async function exportRun(runId, btn, type) {
      if (!runId) return;

      const container = btn.closest('.run-section-body');
      const rows = Array.from(container.querySelectorAll('.log-row:not(.log-row-hidden)'));
      const files = rows.map(r => {
        const link = r.querySelector('a[data-type="' + (type || 'json') + '"]');
        if (!link) return null;
        const path = link.getAttribute('data-path');
        return path;
      }).filter(Boolean);

      if (files.length === 0) {
        alert('No files visible to export.');
        return;
      }

      const originalHtml = btn.innerHTML;
      btn.innerHTML = 'Preparing...';
      btn.disabled = true;

      try {
        const response = await fetch('/api/export-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            files,
            zipName: 'extractions_' + runId + '_' + new Date().getTime()
          })
        });
        
        if (!response.ok) throw new Error('Export failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const prefix = type === 'source' ? 'source_' : 'extractions_';
        a.download = prefix + runId + '_' + new Date().getTime() + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        alert('Export failed: ' + e.message);
      } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }
    }

    async function downloadFile(path, btn) {
      if (!path) return;
      
      const originalHtml = btn.innerHTML;
      btn.innerHTML = '...';
      btn.style.pointerEvents = 'none';

      try {
        const checkUrl = '/api/download-file?file=' + encodeURIComponent(path);
        const response = await fetch(checkUrl, { method: 'HEAD' });
        
        if (response.status === 404) {
          showAppAlert('File Not Found', 'The requested file was not found on the server. It may not have been generated yet or was moved.', { isError: true });
        } else if (!response.ok) {
          throw new Error('Download check failed');
        } else {
          window.location.href = checkUrl;
        }
      } catch (e) {
        showAppAlert('Error', 'Failed to retrieve file: ' + e.message, { isError: true });
      } finally {
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.style.pointerEvents = 'auto';
        }, 300);
      }
    }

    function goHistoryPage(p) {
      historyPage = p;
      renderHistory();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /* Filter Data */
    const CONFIG = {
      brands: ${JSON.stringify(allBrands)},
      purchasers: ${JSON.stringify(allPurchasers)},
      brandPurchaserMap: ${JSON.stringify(brandPurchaserMap)},
      brandNames: ${JSON.stringify(brandNamesMap)},
      purchaserNames: ${JSON.stringify(purchaserNamesMap)}
    };

    let selectedBrands = [];
    let selectedPurchasers = [];

    function initFilters() {
      // Populate Brand Dropdown
      const brandPanel = document.getElementById('brand-dropdown-panel');
      CONFIG.brands.forEach(b => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.brandNames[b] || b;
        div.innerHTML = '<input type="checkbox" value="' + b + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          if (e.target.tagName !== 'INPUT') {
            const cb = div.querySelector('input');
            cb.checked = !cb.checked;
          }
          updateFilters();
        };
        brandPanel.appendChild(div);
      });

      // Populate Purchaser Dropdown
      const purchaserPanel = document.getElementById('purchaser-dropdown-panel');
      CONFIG.purchasers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.purchaserNames[p] || p;
        div.innerHTML = '<input type="checkbox" value="' + p + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          if (e.target.tagName !== 'INPUT') {
            const cb = div.querySelector('input');
            cb.checked = !cb.checked;
          }
          updateFilters();
        };
        purchaserPanel.appendChild(div);
      });

      // Dropdown toggle logic
      document.querySelectorAll('.filter-dropdown-trigger').forEach(trigger => {
        trigger.onclick = (e) => {
          e.stopPropagation();
          const panel = trigger.parentElement.nextElementSibling;
          const isOpen = panel.classList.contains('open');
          closeAllPanels();
          if (!isOpen) panel.classList.add('open');
        };
      });

      document.addEventListener('click', closeAllPanels);

      // Status filters
      document.querySelectorAll('.status-tab').forEach(btn => {
        btn.onclick = () => {
          document.querySelectorAll('.status-tab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentStatusFilter = btn.getAttribute('data-filter');
          historyPage = 1;
          renderHistory();
        };
      });

      // Search filters
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.oninput = (e) => {
          currentSearch = e.target.value.toLowerCase();
          historyPage = 1;
          renderHistory();
        };
      }
    }

    function closeAllPanels() {
      document.querySelectorAll('.filter-dropdown-panel').forEach(p => p.classList.remove('open'));
    }

    function updateFilters() {
      // Update selected brands
      selectedBrands = Array.from(document.querySelectorAll('#brand-dropdown-panel input:checked')).map(i => i.value);
      selectedPurchasers = Array.from(document.querySelectorAll('#purchaser-dropdown-panel input:checked')).map(i => i.value);

      // Update triggers text
      const bTrigger = document.getElementById('brand-dropdown-trigger');
      bTrigger.innerText = selectedBrands.length === 0 ? 'Select Brand' : 
                           (selectedBrands.length === 1 ? (CONFIG.brandNames[selectedBrands[0]] || selectedBrands[0]) : selectedBrands.length + ' Brands');
      
      const pTrigger = document.getElementById('purchaser-dropdown-trigger');
      pTrigger.innerText = selectedPurchasers.length === 0 ? 'Select Purchaser' : 
                               (selectedPurchasers.length === 1 ? (CONFIG.purchaserNames[selectedPurchasers[0]] || selectedPurchasers[0]) : selectedPurchasers.length + ' Purchasers');

      // Cascading logic: disable purchasers not belonging to selected brands
      const purchaserInputs = document.querySelectorAll('#purchaser-dropdown-panel .filter-dropdown-option');
      purchaserInputs.forEach(div => {
        const input = div.querySelector('input');
        const p = input.value;
        let possible = true;
        if (selectedBrands.length > 0) {
          possible = selectedBrands.some(b => CONFIG.brandPurchaserMap[b] && CONFIG.brandPurchaserMap[b].includes(p));
        }
        if (!possible) {
          div.style.opacity = '0.4';
          div.style.pointerEvents = 'none';
          input.checked = false;
        } else {
          div.style.opacity = '1';
          div.style.pointerEvents = 'auto';
        }
      });

      applyFilteringToUI();
    }

    function resetFilters() {
      document.querySelectorAll('.filter-dropdown-panel input').forEach(i => i.checked = false);
      selectedBrands = [];
      selectedPurchasers = [];
      updateFilters();
    }

    function updateStatusCounts() {
      const allItems = Array.from(document.querySelectorAll('.history-item'));
      const activeItems = allItems.filter(i => !i.classList.contains('filtered-out'));
      
      const all = activeItems.length;
      const success = activeItems.filter(i => i.getAttribute('data-status') === 'success').length;
      const failed = activeItems.filter(i => i.getAttribute('data-status') === 'failed').length;
      
      const cAll = document.getElementById('c-all');
      if (cAll) cAll.innerText = all;
      const cSucc = document.getElementById('c-succ');
      if (cSucc) cSucc.innerText = success;
      const cFail = document.getElementById('c-fail');
      if (cFail) cFail.innerText = failed;
    }

    function applyFilteringToUI() {
      const items = document.querySelectorAll('.history-item');
      let visibleCount = 0;

      const filteredRunData = runData.filter(d => {
        let match = true;
        if (selectedBrands.length > 0 && !selectedBrands.includes(d.brand)) match = false;
        if (selectedPurchasers.length > 0 && !selectedPurchasers.includes(d.purchaser)) match = false;
        
        if (currentStatusFilter !== 'all') {
          if (d.status !== currentStatusFilter) return false;
        }

        if (currentSearch) {
          const q = currentSearch.toLowerCase();
          const haystack = (d.runId + ' ' + d.brand + ' ' + d.purchaser).toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        return match;
      });

      updateDashboardStats(filteredRunData);
      initCharts(filteredRunData);

      items.forEach(item => {
        const b = item.getAttribute('data-brand');
        const p = item.getAttribute('data-purchaser');

        let match = true;
        if (selectedBrands.length > 0 && !selectedBrands.includes(b)) match = false;
        if (selectedPurchasers.length > 0 && !selectedPurchasers.includes(p)) match = false;

        item.classList.toggle('filtered-out', !match);
        if (match) visibleCount++;
      });

      // We need to re-render history because of pagination
      historyPage = 1;
      renderHistory();
      
      document.getElementById('operation-count-label').innerText = visibleCount + ' operation(s)';
      
      updateStatusCounts();
    }

    initFilters();

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
        brand: s.brand || "",
        purchaser: s.purchaser || "",
        throughput:
          ((s.metrics.success + s.metrics.failed + s.metrics.skipped) /
            (s.runDurationSeconds || 1)) *
          60,
        errors: s.metrics.failureBreakdown,
        status:
          s.metrics.failed > 0 ||
          Math.max(
            0,
            s.metrics.success -
              s.extractionResults.filter((e) => e.extractionSuccess).length,
          ) > 0
            ? "failed"
            : "success",
      })),
    )};

    let chartInstances = {};

    window.onload = () => {
      if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'JetBrains Mono', 'Consolas', monospace";
        Chart.defaults.font.size = 11;
        Chart.defaults.color = "#5a5a5a";
      }
      initCharts(runData);
      updateDashboardStats(runData);
      renderHistory();
      setupSmoothAccordion();
    };

    function setupSmoothAccordion() {
      document.querySelectorAll('.run-section, .full-log-container').forEach(el => {
        const summary = el.querySelector('.run-section-summary');
        const content = el.querySelector('.run-section-body');
        
        summary.onclick = (e) => {
          e.preventDefault();
          if (el.classList.contains('collapsing') || el.classList.contains('expanding')) return;

          if (el.hasAttribute('open')) {
            // Close
            const startHeight = el.offsetHeight;
            el.classList.add('collapsing');
            el.style.height = startHeight + 'px';
            
            // Reflow
            el.offsetHeight;
            
            el.style.height = summary.offsetHeight + 'px';
            
            setTimeout(() => {
              el.removeAttribute('open');
              el.classList.remove('collapsing');
              el.style.height = '';
            }, 350);
          } else {
            // Open
            const startHeight = el.offsetHeight;
            el.setAttribute('open', '');
            const endHeight = el.offsetHeight;
            
            el.classList.add('expanding');
            el.style.height = startHeight + 'px';
            
            // Reflow
            el.offsetHeight;
            
            el.style.height = endHeight + 'px';
            
            setTimeout(() => {
              el.classList.remove('expanding');
              el.style.height = '';
            }, 350);
          }
        };
      });
    }

    function updateDashboardStats(data) {
      const totalProcessed = data.reduce((a, b) => a + b.success + b.failed + (b.skipped || 0), 0);
      const totalSuccess = data.reduce((a, b) => a + b.success + (b.skipped || 0), 0);
      const successRate = totalProcessed > 0 ? (totalSuccess / totalProcessed * 100).toFixed(1) : "0.0";
      const avgLatency = data.length > 0 ? Math.round(data.reduce((a, b) => a + (b.p50 || 0), 0) / data.length) : 0;
      
      const dashboard = document.getElementById('dashboard');
      if (dashboard) {
        const values = dashboard.querySelectorAll('.stat-value');
        if (values.length >= 4) {
          values[0].innerText = totalProcessed;
          values[1].innerText = successRate + '%';
          values[2].innerText = avgLatency + 'ms';
          values[3].innerText = data.length;
        }
      }
    }

    function initCharts(dataToUse) {
      // Scale to last 100 runs.
      const sortedData = [...dataToUse].sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-100);
      
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

      const chartConfigs = {
        volChart: {
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
        },
        latencyChart: {
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
        },
        throughputChart: {
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
        }
      };

      // Error Distribution
      const errs = dataToUse.reduce((acc, d) => {
        acc.timeout += (d.errors.timeout || 0);
        acc.client += (d.errors.clientError || 0);
        acc.server += (d.errors.serverError || 0);
        acc.read += (d.errors.readError || 0);
        acc.other += (d.errors.other || 0);
        return acc;
      }, { timeout: 0, client: 0, server: 0, read: 0, other: 0 });

      chartConfigs.errorChart = {
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
      };

      Object.keys(chartConfigs).forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (chartInstances[id]) chartInstances[id].destroy();

        // Implement Gradients based on chart type
        const config = chartConfigs[id];
        if (id === 'volChart') {
          const gSucc = ctx.createLinearGradient(0, 0, 0, 300);
          gSucc.addColorStop(0, '#2d9d5f');
          gSucc.addColorStop(1, '#1e6b41');
          config.data.datasets[0].backgroundColor = gSucc;
          config.data.datasets[0].borderRadius = 4;

          const gFail = ctx.createLinearGradient(0, 0, 0, 300);
          gFail.addColorStop(0, '#ef4444');
          gFail.addColorStop(1, '#991b1b');
          config.data.datasets[1].backgroundColor = gFail;
          config.data.datasets[1].borderRadius = 4;

          const gSkip = ctx.createLinearGradient(0, 0, 0, 300);
          gSkip.addColorStop(0, '#94a3b8');
          gSkip.addColorStop(1, '#64748b');
          config.data.datasets[2].backgroundColor = gSkip;
          config.data.datasets[2].borderRadius = 4;
        } else if (id === 'latencyChart') {
          // Line charts usually look better with just the colors, but we can add a subtle glow/shadow
          config.options.plugins.tooltip = {
            backgroundColor: 'rgba(33, 108, 109, 0.95)',
            padding: 12,
            cornerRadius: 8
          };
        } else if (id === 'throughputChart') {
          const gThrough = ctx.createLinearGradient(0, 0, 0, 300);
          gThrough.addColorStop(0, 'rgba(33, 108, 109, 0.4)');
          gThrough.addColorStop(1, 'rgba(33, 108, 109, 0.05)');
          config.data.datasets[0].backgroundColor = gThrough;
          config.data.datasets[0].borderColor = '#216c6d';
        } else if (id === 'errorChart') {
          // Doughnut gradient is more complex (conic), we'll use slightly better solid colors
          config.data.datasets[0].backgroundColor = [
            '#f59e0b', // timeout
            '#ef4444', // 4xx
            '#991b1b', // 5xx
            '#3b82f6', // read
            '#64748b'  // other
          ];
          config.options.cutout = '70%';
        }
        
        // Universal premium options
        config.options.plugins = config.options.plugins || {};
        config.options.plugins.legend = {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 15, font: { weight: '600' } }
        };

        chartInstances[id] = new Chart(canvas, config);
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
  <!-- Page Loader Overlay -->
  <div id="page-loader">
    <div class="loader-spinner"></div>
    <div class="loader-text">Loading...</div>
  </div>
  <script>
    function showLoader() {
      var l = document.getElementById("page-loader");
      if (l) l.style.display = "flex";
    }
    function hideLoader() {
      var l = document.getElementById("page-loader");
      if (l) l.style.display = "none";
    }
    (function () {
      if (document.readyState === "complete") hideLoader(); window.addEventListener("pageshow", function(e) { hideLoader(); }); setTimeout(hideLoader, 5000);
      window.addEventListener("load", hideLoader);
      document.addEventListener("click", function (e) {
        var t = e.target.closest("a");
        if (
          t &&
          t.href &&
          !t.href.startsWith("javascript:") &&
          !t.href.startsWith("#") &&
          t.target !== "_blank" &&
          !e.ctrlKey &&
          !e.metaKey
        ) {
          showLoader();
        }
      });
      document.addEventListener("submit", function () {
        showLoader();
      });
    })();
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
          itemCount: processed,
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
