/**
 * Executive summary report: Markdown, HTML, and JSON.
 * Includes full API extraction response(s) per file when available.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, RunMetrics, ExecutiveSummary } from './types.js';
import { openCheckpointDb, getRecordsForRun, closeCheckpointDb } from './checkpoint.js';
import { getExtractionOutputDir } from './load-engine.js';

export interface ExtractionResultEntry {
  filename: string;
  response: unknown;
}

/** Load extraction results from staging per-file folders (brand/purchaser/<file-name>/response.json). */
function loadExtractionResults(config: Config, runId: string): ExtractionResultEntry[] {
  const db = openCheckpointDb(config.run.checkpointPath);
  const records = getRecordsForRun(db, runId);
  closeCheckpointDb(db);
  const doneRecords = records.filter((r) => r.status === 'done');
  const entries: ExtractionResultEntry[] = [];
  for (const record of doneRecords) {
    const fileOutputDir = getExtractionOutputDir(record.filePath);
    const responsePath = join(fileOutputDir, 'response.json');
    if (!existsSync(responsePath)) continue;
    try {
      const raw = readFileSync(responsePath, 'utf-8');
      const response = JSON.parse(raw) as unknown;
      const filename = fileOutputDir.split(/[/\\]/).pop() ?? record.relativePath;
      entries.push({ filename, response });
    } catch {
      // skip
    }
  }
  return entries;
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

function markdownReport(summary: ExecutiveSummary, extractionResults: ExtractionResultEntry[] = []): string {
  const m = summary.metrics;
  const duration = formatDuration(summary.runDurationSeconds * 1000);
  let md = `# ${summary.title}\n\n`;
  md += `**Generated:** ${summary.generatedAt}\n\n`;
  md += `## Overview\n\n`;
  md += `| Metric | Value |\n|--------|------|\n`;
  md += `| Total files | ${m.totalFiles} |\n`;
  md += `| Success | ${m.success} |\n`;
  md += `| Failed | ${m.failed} |\n`;
  md += `| Skipped | ${m.skipped} |\n`;
  md += `| Run duration | ${duration} |\n`;
  md += `| Throughput | ${m.throughputPerSecond.toFixed(2)} files/sec |\n`;
  md += `| Error rate | ${(m.errorRate * 100).toFixed(2)}% |\n\n`;
  md += `## Latency (ms)\n\n`;
  md += `| Percentile | Value |\n|------------|-------|\n`;
  md += `| Average | ${m.avgLatencyMs.toFixed(2)} |\n`;
  md += `| P50 | ${m.p50LatencyMs.toFixed(2)} |\n`;
  md += `| P95 | ${m.p95LatencyMs.toFixed(2)} |\n`;
  md += `| P99 | ${m.p99LatencyMs.toFixed(2)} |\n\n`;
  if (m.anomalies.length > 0) {
    md += `## Anomalies\n\n`;
    for (const a of m.anomalies) {
      md += `- **${a.type}**: ${a.message}`;
      if (a.filePath) md += ` (${a.filePath})`;
      md += `\n`;
    }
  }
  if (extractionResults.length > 0) {
    md += `\n## Extraction results (API response per file)\n\n`;
    for (const { filename, response } of extractionResults) {
      md += `### ${filename}\n\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\`\n\n`;
    }
  }
  md += `\n---\n*Run ID: ${m.runId}*\n`;
  return md;
}

function htmlReport(summary: ExecutiveSummary, extractionResults: ExtractionResultEntry[] = []): string {
  const m = summary.metrics;
  const duration = formatDuration(summary.runDurationSeconds * 1000);
  const anomalyItems = m.anomalies.map((a) => {
    const pathSuffix = a.filePath ? ' (' + escapeHtml(a.filePath) + ')' : '';
    return '<li><strong>' + escapeHtml(a.type) + '</strong>: ' + escapeHtml(a.message) + pathSuffix + '</li>';
  });
  const anomaliesList = m.anomalies.length > 0 ? '<ul>' + anomalyItems.join('') + '</ul>' : '<p>None detected.</p>';
  const extractionSection =
    extractionResults.length > 0
      ? `
  <h2>Extraction results (API response per file)</h2>
  ${extractionResults
    .map(
      ({ filename, response }) =>
        `<details open><summary><strong>${escapeHtml(filename)}</strong></summary><pre class="extraction-json">${escapeHtml(JSON.stringify(response, null, 2))}</pre></details>`
    )
    .join('\n  ')}`
      : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(summary.title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    h1 { color: #333; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .extraction-json { background: #f8f8f8; padding: 1rem; overflow: auto; font-size: 0.85rem; border: 1px solid #ddd; }
    details { margin-bottom: 1rem; }
    details summary { cursor: pointer; }
  </style>
</head>
<body>
  <h1>${escapeHtml(summary.title)}</h1>
  <p class="meta">Generated: ${escapeHtml(summary.generatedAt)}</p>
  <h2>Overview</h2>
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
  <h2>Latency (ms)</h2>
  <table>
    <tr><th>Percentile</th><th>Value</th></tr>
    <tr><td>Average</td><td>${m.avgLatencyMs.toFixed(2)}</td></tr>
    <tr><td>P50</td><td>${m.p50LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P95</td><td>${m.p95LatencyMs.toFixed(2)}</td></tr>
    <tr><td>P99</td><td>${m.p99LatencyMs.toFixed(2)}</td></tr>
  </table>
  <h2>Anomalies</h2>
  ${anomaliesList}
  ${extractionSection}
  <p><small>Run ID: ${escapeHtml(m.runId)}</small></p>
</body>
</html>`;
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
 * Loads extraction result JSON from output/extractions/<runId>/ and includes it in all report formats.
 */
export function writeReports(config: Config, summary: ExecutiveSummary): string[] {
  const outDir = config.report.outputDir;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const runId = summary.metrics.runId;
  const written: string[] = [];
  const extractionResults = loadExtractionResults(config, runId);

  if (summary.metrics.runId) {
    const base = `report_${runId}_${Date.now()}`;
    if (config.report.formats.includes('markdown')) {
      const path = join(outDir, `${base}.md`);
      writeFileSync(path, markdownReport(summary, extractionResults), 'utf-8');
      written.push(path);
    }
    if (config.report.formats.includes('html')) {
      const path = join(outDir, `${base}.html`);
      writeFileSync(path, htmlReport(summary, extractionResults), 'utf-8');
      written.push(path);
    }
    if (config.report.formats.includes('json')) {
      const path = join(outDir, `${base}.json`);
      const jsonPayload = extractionResults.length > 0
        ? { ...summary, extractionResults: extractionResults.map((e) => ({ filename: e.filename, response: e.response })) }
        : summary;
      writeFileSync(path, JSON.stringify(jsonPayload, null, 2), 'utf-8');
      written.push(path);
    }
  }
  return written;
}
