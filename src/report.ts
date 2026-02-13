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

  // Include ALL successful files from any run + all files from current run
  // This ensures resumed runs show complete history, not just newly processed files
  const relevantRecords = db._data.checkpoints.filter(
    (r) => r.status === "done" || r.run_id === runId,
  );

  closeCheckpointDb(db);

  const relevantFilenames = new Set(
    relevantRecords.map((r) =>
      extractionResultFilenameFromRecord({
        relativePath: r.relative_path,
        brand: r.brand,
      }),
    ),
  );

  if (relevantFilenames.size === 0) return [];

  return allResults.filter((e) => relevantFilenames.has(e.filename));
}

function minMaxDatesFromRecords(
  records: { startedAt?: string; finishedAt?: string }[],
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

  const start = Number.isNaN(startedAt) ? new Date(0) : new Date(startedAt);
  const end = Number.isNaN(finishedAt)
    ? new Date(startedAt || Date.now())
    : new Date(finishedAt);

  return { start, end };
}

export function loadHistoricalRunSummaries(
  config: Config,
): HistoricalRunSummary[] {
  const db = openCheckpointDb(config.run.checkpointPath);
  const runIds = getAllRunIdsOrdered(db);

  const out: HistoricalRunSummary[] = [];

  for (const runId of runIds) {
    const records = getRecordsForRun(db, runId);
    if (records.length === 0) continue;

    const { start, end } = minMaxDatesFromRecords(records);
    const metrics = computeMetrics(runId, records, start, end);

    // Derive brand and purchaser for this run from checkpoint records.
    // Structure: stagingDir/<brand>/<purchaser>/<key after prefix>.
    const brandSet = new Set<string>();
    const purchaserSet = new Set<string>();
    for (const r of records) {
      if (r.brand) brandSet.add(r.brand);
      if (r.relativePath) {
        const firstSegment = r.relativePath.split(/[\\/]/)[0];
        if (firstSegment) purchaserSet.add(firstSegment);
      }
    }
    const brands = [...brandSet];
    const purchasers = [...purchaserSet];
    const brand = brands.length === 1 ? brands[0] : undefined;
    const purchaser = purchasers.length === 1 ? purchasers[0] : undefined;

    const allResults = loadExtractionResults(config, runId);
    const extractionResults = filterExtractionResultsForRun(
      config,
      runId,
      allResults,
    );

    const runDurationSeconds = (end.getTime() - start.getTime()) / 1000;

    out.push({
      runId,
      metrics,
      extractionResults,
      runDurationSeconds,
      brand,
      purchaser,
    });
  }

  closeCheckpointDb(db);
  return out;
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
  const month = MONTH_NAMES[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 || 12;
  const h = String(hours12).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours24 < 12 ? "AM" : "PM";
  return `${month}-${dayOrdinal(day)}-${year} ${h}:${min}-${ampm}`;
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
  // Reclassify successes as failures when API response.success === false,
  // but always keep total processed = m.success + m.failed.
  const reclassifiedFailuresFromResponses = failedCount;
  const displaySuccess = Math.max(
    0,
    m.success - reclassifiedFailuresFromResponses,
  );
  const displayInfraFailed = m.failed;
  const displayApiFailed = reclassifiedFailuresFromResponses;
  const processed = m.success + m.failed;
  const throughputPerSecond =
    entry.runDurationSeconds > 0 ? processed / entry.runDurationSeconds : 0;
  const throughputPerMinute = throughputPerSecond * 60;
  const totalApiTime = formatDuration(m.totalProcessingTimeMs);
  const displayErrorRate =
    processed > 0
      ? (displayInfraFailed + displayApiFailed) / processed
      : m.errorRate;
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
  <table>
    <tr><th>Error type</th><th>Count</th></tr>
    ${failureBreakdownRows}
  </table>`
      : "";

  const failureDetailsRows =
    (m.failureDetails?.length ?? 0) > 0
      ? m
          .failureDetails!.map((f) => {
            const msg = (f.errorMessage ?? "").trim();
            const snippet =
              msg.length > 0
                ? escapeHtml(msg.slice(0, 200)) + (msg.length > 200 ? "…" : "")
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
  <table>
    <tr><th>Status</th><th>File</th><th>Message snippet</th></tr>
    ${failureDetailsRows}
  </table>`
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
<table>
  <tr><th>File</th><th>Latency (ms)</th><th>Pattern Key</th></tr>
  ${topSlowestRows}
</table>`
      : "";

  const failuresByBrandRows = m.failureCountByBrand
    .map((e) => `<tr><td>${escapeHtml(e.brand)}</td><td>${e.count}</td></tr>`)
    .join("");
  const failuresByBrandSection =
    m.failureCountByBrand.length > 0
      ? `
  <h3>Failures by brand (repeated failures)</h3>
  <table>
    <tr><th>Brand</th><th>Failure count</th></tr>
    ${failuresByBrandRows}
  </table>`
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
      `Most failures are for brand "${topBrand.brand}" (${topBrand.count} failed file${
        topBrand.count === 1 ? "" : "s"
      }).`,
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
    agentSummaryPoints.push(
      `Run completed without notable anomalies: ${processed} files in ${runDuration} at ${throughputPerMinute.toFixed(1)} files/min.`,
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
    prefix = `${entry.brand}-${entry.purchaser}-`;
  } else if (entry.brand) {
    prefix = `${entry.brand}-`;
  } else if (entry.purchaser) {
    prefix = `${entry.purchaser}-`;
  }
  const labelWithPrefix = `${prefix}${runLabel}`;
  return `
  <details class="run-section">
  <summary class="run-section-summary"><strong>${escapeHtml(labelWithPrefix)}</strong> — Successful Response (Success: true): ${displaySuccess}, Successful Response (Success: false): ${displayApiFailed}, Failure: ${displayInfraFailed}</summary>
  <div class="run-section-body">
  <h3>Overview</h3>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total files</td><td>${m.totalFiles}</td></tr>
    <tr><td>Successful Response (Success: true)</td><td>${displaySuccess}</td></tr>
    <tr><td>Successful Response (Success: false)</td><td>${displayApiFailed}</td></tr>
    <tr><td>Failure</td><td>${displayInfraFailed}</td></tr>
    <tr><td>Run duration (wall clock)</td><td>${runDuration}</td></tr>
    <tr><td>Throughput</td><td>${throughputPerSecond.toFixed(2)} files/sec, ${throughputPerMinute.toFixed(2)} files/min</td></tr>
    <tr><td>Total API time (sum of request latencies)</td><td>${totalApiTime}</td></tr>
    <tr><td>Error rate</td><td>${(displayErrorRate * 100).toFixed(2)}%</td></tr>
  </table>
  <h3>Load testing / API capability</h3>
  <p>Use these as a guide for batch sizes and expected capacity at similar concurrency and file mix.</p>
  <table>
    <tr><th>Attribute</th><th>Value</th></tr>
    <tr><td>Observed throughput</td><td>${throughputPerMinute.toFixed(1)} files/min, ${throughputPerSecond.toFixed(2)} files/sec</td></tr>
    <tr><td>API response time (P50 / P95 / P99)</td><td>${m.p50LatencyMs.toFixed(0)} ms / ${m.p95LatencyMs.toFixed(0)} ms / ${m.p99LatencyMs.toFixed(0)} ms</td></tr>
    <tr><td>Error rate at this load</td><td>${(m.errorRate * 100).toFixed(2)}%</td></tr>
    <tr><td>Ideal extract count (≈5 min run)</td><td>~${Math.round(throughputPerMinute * 5)} files</td></tr>
    <tr><td>Ideal extract count (≈10 min run)</td><td>~${Math.round(throughputPerMinute * 10)} files</td></tr>
    <tr><td>Ideal extract count (≈15 min run)</td><td>~${Math.round(throughputPerMinute * 15)} files</td></tr>
  </table>
  <p><strong>Summary:</strong> At this run&rsquo;s load, the API handled <strong>${processed} files</strong> in <strong>${runDuration}</strong> with <strong>${(displayErrorRate * 100).toFixed(2)}%</strong> total errors. For a target run of about 5 minutes, aim for batches of <strong>~${Math.round(throughputPerMinute * 5)} files</strong>; for 10 minutes, <strong>~${Math.round(throughputPerMinute * 10)} files</strong>.</p>
  <h3>Latency (ms)</h3>
  <table>
    <tr><th>Percentile</th><th>Value</th></tr>
    <tr><td>Average</td><td>${m.avgLatencyMs.toFixed(2)}</td></tr>
    <tr><td>P50</td><td>${m.p50LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P95</td><td>${m.p95LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P99</td><td>${m.p99LatencyMs.toFixed(2)}</td></tr>
  </table>
  <h3>Automated summary</h3>
  ${agentSummaryHtml}
  ${failureBreakdownSection}
  ${failureDetailsSection}
  ${topSlowestSection}
  ${failuresByBrandSection}
  <h3>Anomalies</h3>
  ${anomaliesList}
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
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    h1, h2 { color: #333; }
    h3 { color: #444; font-size: 1rem; margin-top: 1rem; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .run-section { margin-bottom: 1rem; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
    .run-section[open] { border-color: #216c6d; }
    .run-section-summary { cursor: pointer; padding: 0.6rem 0.75rem; background: #f5f5f5; list-style: none; font-size: 1rem; }
    .run-section-summary::-webkit-details-marker { display: none; }
    .run-section-summary::before { content: "▶"; display: inline-block; margin-right: 0.5rem; font-size: 0.65rem; color: #666; transition: transform 0.2s; }
    .run-section[open] .run-section-summary::before { transform: rotate(90deg); }
    .run-section-summary:hover { background: #eee; }
    .run-section-body { padding: 0 0.75rem 0.75rem; }
    .extraction-note { color: #555; font-size: 0.9rem; margin: 0.5rem 0; }
    td.file-path { word-break: break-all; max-width: 700px; }
    .muted { color: #888; font-style: italic; }
  </style>
</head>
<body>
  <h1>${escapeHtml(REPORT_TITLE)}</h1>
  <p class="meta">Generated: ${escapeHtml(formatRunDateTime(generatedAt))} — ${historicalSummaries.length} run(s) (sync &amp; extract)</p>
  <h2>Historical runs</h2>
  ${runsHtml}
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
