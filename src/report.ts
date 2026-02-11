/**
 * Executive summary report: HTML and JSON.
 * Includes full API extraction response(s) per file when available.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import type { Config, RunMetrics, ExecutiveSummary } from './types.js';
import { openCheckpointDb, getRecordsForRun, getAllRunIdsOrdered, closeCheckpointDb } from './checkpoint.js';
import { computeMetrics } from './metrics.js';

export interface ExtractionResultEntry {
  filename: string;
  response: unknown;
  /** Whether the API response body had success: true (succeeded folder). */
  extractionSuccess: boolean;
}

export interface HistoricalRunSummary {
  runId: string;
  metrics: RunMetrics;
  extractionResults: ExtractionResultEntry[];
  runDurationSeconds: number;
}

/** Same naming as load-engine so we only show results for files that completed in this run. */
function extractionResultFilenameFromRecord(record: { relativePath: string; brand: string }): string {
  const safe = record.relativePath.replaceAll('/', '_').replaceAll(/[^a-zA-Z0-9._-]/g, '_');
  const base = record.brand + '_' + (safe || 'file');
  return base.endsWith('.json') ? base : base + '.json';
}

function loadJsonEntries(dir: string, extractionSuccess: boolean): ExtractionResultEntry[] {
  const entries: ExtractionResultEntry[] = [];
  const files = readdirSync(dir, { withFileTypes: true }).filter(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.json')
  );
  for (const e of files) {
    const path = join(dir, e.name);
    try {
      const raw = readFileSync(path, 'utf-8');
      const response = JSON.parse(raw) as unknown;
      entries.push({ filename: e.name, response, extractionSuccess });
    } catch {
      // skip unreadable
    }
  }
  return entries;
}

function loadExtractionResults(config: Config, runId: string): ExtractionResultEntry[] {
  const baseDir = join(dirname(config.report.outputDir), 'extractions');
  if (!existsSync(baseDir)) return [];

  const succeededDir = join(baseDir, 'succeeded');
  const failedDir = join(baseDir, 'failed');
  const fromSucceeded = existsSync(succeededDir) ? loadJsonEntries(succeededDir, true) : [];
  const fromFailed = existsSync(failedDir) ? loadJsonEntries(failedDir, false) : [];

  if (fromSucceeded.length > 0 || fromFailed.length > 0) {
    return [...fromSucceeded, ...fromFailed];
  }

  // Backward compatibility: load from run dir and infer extractionSuccess from response.success
  return loadJsonEntries(baseDir, false).map((entry) => ({
    ...entry,
    extractionSuccess:
      typeof entry.response === 'object' &&
      entry.response !== null &&
      (entry.response as { success?: boolean }).success === true,
  }));
}

/** Keep only extraction results for files that completed successfully in this run (so report doesn't show old run's responses). */
function filterExtractionResultsForRun(
  config: Config,
  runId: string,
  allResults: ExtractionResultEntry[]
): ExtractionResultEntry[] {
  const db = openCheckpointDb(config.run.checkpointPath);
  const records = getRecordsForRun(db, runId);
  closeCheckpointDb(db);
  const doneFilenames = new Set(
    records
      .filter((r) => r.status === 'done')
      .map((r) => extractionResultFilenameFromRecord({ relativePath: r.relativePath, brand: r.brand }))
  );
  if (doneFilenames.size === 0) return [];
  return allResults.filter((e) => doneFilenames.has(e.filename));
}

function minMaxDatesFromRecords(records: { startedAt?: string; finishedAt?: string }[]): { start: Date; end: Date } {
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
  const end = Number.isNaN(finishedAt) ? new Date(startedAt || Date.now()) : new Date(finishedAt);
  return { start, end };
}

/** Load all runs from checkpoint (latest first) with metrics and extraction results for full historical report. */
export function loadHistoricalRunSummaries(config: Config): HistoricalRunSummary[] {
  const db = openCheckpointDb(config.run.checkpointPath);
  const runIds = getAllRunIdsOrdered(db);
  const out: HistoricalRunSummary[] = [];
  for (const runId of runIds) {
    const records = getRecordsForRun(db, runId);
    if (records.length === 0) continue;
    const { start, end } = minMaxDatesFromRecords(records);
    const metrics = computeMetrics(runId, records, start, end);
    const allResults = loadExtractionResults(config, runId);
    const extractionResults = filterExtractionResultsForRun(config, runId, allResults);
    const runDurationSeconds = (end.getTime() - start.getTime()) / 1000;
    out.push({ runId, metrics, extractionResults, runDurationSeconds });
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

export function buildSummary(metrics: RunMetrics): ExecutiveSummary {
  const start = new Date(metrics.startedAt).getTime();
  const end = new Date(metrics.finishedAt).getTime();
  const runDurationSeconds = (end - start) / 1000;
  return {
    title: 'EntelliExtract Test Run – Executive Summary',
    generatedAt: new Date().toISOString(),
    metrics,
    runDurationSeconds,
  };
}

function sectionForRun(entry: HistoricalRunSummary, isFirst: boolean): string {
  const m = entry.metrics;
  const wallClockMs = entry.runDurationSeconds * 1000;
  const runDuration = formatDuration(wallClockMs);
  const processed = m.success + m.failed;
  const throughputPerSecond = entry.runDurationSeconds > 0 ? processed / entry.runDurationSeconds : 0;
  const throughputPerMinute = throughputPerSecond * 60;
  const totalApiTime = formatDuration(m.totalProcessingTimeMs);
  const anomalyItems = m.anomalies.map((a) => {
    const pathSuffix = a.filePath ? ' (' + escapeHtml(a.filePath) + ')' : '';
    return '<li><strong>' + escapeHtml(a.type) + '</strong>: ' + escapeHtml(a.message) + pathSuffix + '</li>';
  });
  const anomaliesList = m.anomalies.length > 0 ? '<ul>' + anomalyItems.join('') + '</ul>' : '<p>None detected.</p>';

  const succeededResults = entry.extractionResults.filter((e) => e.extractionSuccess);
  const failedResults = entry.extractionResults.filter((e) => !e.extractionSuccess);

  function accordionHtml(results: ExtractionResultEntry[]): string {
    return results
      .map(
        ({ filename, response }) =>
          `<details class="extraction-details"><summary class="extraction-summary"><strong>${escapeHtml(filename)}</strong></summary><pre class="extraction-json">${escapeHtml(JSON.stringify(response, null, 2))}</pre></details>`
      )
      .join('\n  ');
  }

  const extractionSection =
    entry.extractionResults.length > 0
      ? `
  <h3>Extraction results (API response per file)</h3>
  <p class="accordion-hint">Click a filename to expand or collapse the JSON.</p>
  <div class="extraction-tabs">
    <div class="tab-headers">
      <button type="button" class="tab-btn active" data-tab="succeeded">Succeeded (${succeededResults.length})</button>
      <button type="button" class="tab-btn" data-tab="failed">Failed (${failedResults.length})</button>
    </div>
    <div class="tab-pane active extraction-accordion" data-tab-pane="succeeded">${accordionHtml(succeededResults)}</div>
    <div class="tab-pane extraction-accordion" data-tab-pane="failed">${accordionHtml(failedResults)}</div>
  </div>`
      : '';
  const b = m.failureBreakdown;
  const failureBreakdownRows = m.failed > 0
    ? [
        b.timeout ? `<tr><td>Timeout</td><td>${b.timeout}</td></tr>` : '',
        b.clientError ? `<tr><td>Client error (4xx)</td><td>${b.clientError}</td></tr>` : '',
        b.serverError ? `<tr><td>Service error (5xx)</td><td>${b.serverError}</td></tr>` : '',
        b.readError ? `<tr><td>Read file error</td><td>${b.readError}</td></tr>` : '',
        b.other ? `<tr><td>Other</td><td>${b.other}</td></tr>` : '',
      ].filter(Boolean).join('')
    : '';
  const failureBreakdownSection = m.failed > 0
    ? `
  <h3>Failure breakdown by error type</h3>
  <table>
    <tr><th>Error type</th><th>Count</th></tr>
    ${failureBreakdownRows}
  </table>`
    : '';

  const topSlowestRows = m.topSlowestFiles
    .map((e) => `<tr><td class="file-path">${escapeHtml(e.filePath)}</td><td>${e.latencyMs.toFixed(0)}</td></tr>`)
    .join('');
  const topSlowestSection = m.topSlowestFiles.length > 0
    ? `
  <h3>Top ${m.topSlowestFiles.length} slowest files (by processing time)</h3>
  <table>
    <tr><th>File</th><th>Latency (ms)</th></tr>
    ${topSlowestRows}
  </table>`
    : '';

  const failuresByBrandRows = m.failureCountByBrand
    .map((e) => `<tr><td>${escapeHtml(e.brand)}</td><td>${e.count}</td></tr>`)
    .join('');
  const failuresByBrandSection = m.failureCountByBrand.length > 0
    ? `
  <h3>Failures by brand (repeated failures)</h3>
  <table>
    <tr><th>Brand</th><th>Failure count</th></tr>
    ${failuresByBrandRows}
  </table>`
    : '';

  const openAttr = isFirst ? ' open' : '';
  return `
  <details class="run-section"${openAttr}>
  <summary class="run-section-summary"><strong>Extractions</strong> — ${m.success} success, ${m.failed} failed, ${m.skipped} skipped</summary>
  <div class="run-section-body">
  <h3>Overview</h3>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total files</td><td>${m.totalFiles}</td></tr>
    <tr><td>Success</td><td>${m.success}</td></tr>
    <tr><td>Failed</td><td>${m.failed}</td></tr>
    <tr><td>Skipped</td><td>${m.skipped}</td></tr>
    <tr><td>Run duration (wall clock)</td><td>${runDuration}</td></tr>
    <tr><td>Throughput</td><td>${throughputPerSecond.toFixed(2)} files/sec, ${throughputPerMinute.toFixed(2)} files/min</td></tr>
    <tr><td>Total API time (sum of request latencies)</td><td>${totalApiTime}</td></tr>
    <tr><td>Error rate</td><td>${(m.errorRate * 100).toFixed(2)}%</td></tr>
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
  <p><strong>Summary:</strong> At this run&rsquo;s load, the API handled <strong>${processed} files</strong> in <strong>${runDuration}</strong> with <strong>${(m.errorRate * 100).toFixed(2)}%</strong> errors. For a target run of about 5 minutes, aim for batches of <strong>~${Math.round(throughputPerMinute * 5)} files</strong>; for 10 minutes, <strong>~${Math.round(throughputPerMinute * 10)} files</strong>.</p>
  <h3>Latency (ms)</h3>
  <table>
    <tr><th>Percentile</th><th>Value</th></tr>
    <tr><td>Average</td><td>${m.avgLatencyMs.toFixed(2)}</td></tr>
    <tr><td>P50</td><td>${m.p50LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P95</td><td>${m.p95LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P99</td><td>${m.p99LatencyMs.toFixed(2)}</td></tr>
  </table>
  ${failureBreakdownSection}
  ${topSlowestSection}
  ${failuresByBrandSection}
  <h3>Anomalies</h3>
  ${anomaliesList}
  ${extractionSection}
  </div>
  </details>`;
}

const REPORT_TITLE = 'EntelliExtract Test Run – Executive Summary';

function htmlReportFromHistory(historicalSummaries: HistoricalRunSummary[], generatedAt: string): string {
  const runsHtml = historicalSummaries
    .map((entry, i) => sectionForRun(entry, i === 0))
    .join('');
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
    .extraction-accordion { margin-top: 0.5rem; }
    .accordion-hint { color: #666; font-size: 0.85rem; margin-bottom: 0.5rem; }
    details.extraction-details { margin-bottom: 0.5rem; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
    details.extraction-details[open] { border-color: #216c6d; }
    summary.extraction-summary { cursor: pointer; padding: 0.6rem 0.75rem; background: #f9f9f9; list-style: none; display: flex; align-items: center; }
    summary.extraction-summary::-webkit-details-marker { display: none; }
    summary.extraction-summary::before { content: "▶"; display: inline-block; margin-right: 0.5rem; font-size: 0.65rem; color: #666; transition: transform 0.2s; }
    details.extraction-details[open] summary.extraction-summary::before { transform: rotate(90deg); }
    details.extraction-details summary.extraction-summary:hover { background: #eee; }
    .extraction-json { margin: 0; background: #f8f8f8; padding: 1rem; overflow: auto; font-size: 0.85rem; border-top: 1px solid #ddd; max-height: 400px; }
    .extraction-tabs { margin-top: 0.5rem; }
    .tab-headers { display: flex; gap: 0.25rem; margin-bottom: 0.75rem; }
    .tab-btn { padding: 0.4rem 0.75rem; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; cursor: pointer; font-size: 0.9rem; }
    .tab-btn:hover { background: #eee; }
    .tab-btn.active { background: #216c6d; color: #fff; border-color: #216c6d; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    td.file-path { word-break: break-all; max-width: 400px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(REPORT_TITLE)}</h1>
  <p class="meta">Generated: ${escapeHtml(generatedAt)} — ${historicalSummaries.length} run(s) (sync &amp; extract)</p>
  <h2>Historical runs</h2>
  ${runsHtml}
  <script>
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var tabId = this.getAttribute('data-tab');
        var runSection = this.closest('.run-section-body');
        if (!runSection) return;
        runSection.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        runSection.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
        this.classList.add('active');
        var pane = runSection.querySelector('.tab-pane[data-tab-pane="' + tabId + '"]');
        if (pane) pane.classList.add('active');
      });
    });
  </script>
</body>
</html>`;
}

function htmlReport(summary: ExecutiveSummary, extractionResults: ExtractionResultEntry[] = []): string {
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Delete oldest report sets so only the most recent retainCount remain.
 * A "report set" is a base name with .html and/or .json in the output dir.
 */
function pruneOldReports(outDir: string, retainCount: number): void {
  if (retainCount <= 0) return;
  const files = readdirSync(outDir, { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith('.html') || e.name.endsWith('.json')));
  const baseToMtime = new Map<string, number>();
  for (const e of files) {
    const base = basename(e.name, extname(e.name));
    const path = join(outDir, e.name);
    try {
      const mtime = statSync(path).mtimeMs;
      const existing = baseToMtime.get(base);
      if (existing === undefined || mtime > existing) baseToMtime.set(base, mtime);
    } catch {
      // skip unreadable
    }
  }
  const basesByAge = [...baseToMtime.entries()].sort((a, b) => b[1] - a[1]);
  const toKeep = new Set(basesByAge.slice(0, retainCount).map(([base]) => base));
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
    if (config.report.formats.includes('html')) {
      const path = join(outDir, `${base}.html`);
      writeFileSync(path, htmlReportFromHistory(historicalSummaries, generatedAt), 'utf-8');
    }
    if (config.report.formats.includes('json')) {
      const path = join(outDir, `${base}.json`);
      const runsPayload = historicalSummaries.map((r) => {
        const processed = r.metrics.success + r.metrics.failed;
        const throughputPerMinute =
          r.runDurationSeconds > 0 ? (processed / r.runDurationSeconds) * 60 : 0;
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
      const jsonPayload = { title: REPORT_TITLE, generatedAt, runs: runsPayload };
      writeFileSync(path, JSON.stringify(jsonPayload, null, 2), 'utf-8');
    }
  }

  const retain = config.report.retainCount;
  if (typeof retain === 'number' && retain > 0) {
    pruneOldReports(outDir, retain);
  }
}
