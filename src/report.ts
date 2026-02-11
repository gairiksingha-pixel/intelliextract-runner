/**
 * Executive summary report: HTML and JSON.
 * Includes full API extraction response(s) per file when available.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  const baseDir = join(dirname(config.report.outputDir), 'extractions', runId);
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
  const duration = formatDuration(entry.runDurationSeconds * 1000);
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
  const openAttr = isFirst ? ' open' : '';
  return `
  <details class="run-section"${openAttr}>
  <summary class="run-section-summary"><strong>${escapeHtml(m.runId)}</strong> — ${m.success} success, ${m.failed} failed, ${m.skipped} skipped</summary>
  <div class="run-section-body">
  <h3>Overview</h3>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Total files</td><td>${m.totalFiles}</td></tr>
    <tr><td>Success</td><td>${m.success}</td></tr>
    <tr><td>Failed</td><td>${m.failed}</td></tr>
    <tr><td>Skipped</td><td>${m.skipped}</td></tr>
    <tr><td>Run duration</td><td>${duration}</td></tr>
    <tr><td>Throughput</td><td>${m.throughputPerSecond.toFixed(2)} files/sec</td></tr>
    <tr><td>Error rate</td><td>${(m.errorRate * 100).toFixed(2)}%</td></tr>
  </table>
  <h3>Latency (ms)</h3>
  <table>
    <tr><th>Percentile</th><th>Value</th></tr>
    <tr><td>Average</td><td>${m.avgLatencyMs.toFixed(2)}</td></tr>
    <tr><td>P50</td><td>${m.p50LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P95</td><td>${m.p95LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P99</td><td>${m.p99LatencyMs.toFixed(2)}</td></tr>
  </table>
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
 * Write reports to config.report.outputDir in requested formats.
 * Includes all historical sync & extract runs (from checkpoint) so downloaded reports have full history.
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
      const jsonPayload = {
        title: REPORT_TITLE,
        generatedAt,
        runs: historicalSummaries.map((r) => ({
          runId: r.runId,
          metrics: r.metrics,
          runDurationSeconds: r.runDurationSeconds,
          extractionResults: r.extractionResults.map((e) => ({
            filename: e.filename,
            response: e.response,
            extractionSuccess: e.extractionSuccess,
          })),
        })),
      };
      writeFileSync(path, JSON.stringify(jsonPayload, null, 2), 'utf-8');
    }
  }
}
