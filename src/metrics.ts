/**
 * Compute run metrics: throughput, latency percentiles, error rate, anomalies.
 */

import { quantile } from 'simple-statistics';
import type { CheckpointRecord, RunMetrics, Anomaly } from './types.js';

export function computeMetrics(
  runId: string,
  records: CheckpointRecord[],
  startedAt: Date,
  finishedAt: Date
): RunMetrics {
  const done = records.filter((r) => r.status === 'done');
  const failed = records.filter((r) => r.status === 'error');
  const skipped = records.filter((r) => r.status === 'skipped');
  const latencies = done.map((r) => r.latencyMs!).filter((n) => typeof n === 'number' && n >= 0);
  const totalLatencyMs = latencies.reduce((a, b) => a + b, 0);
  const durationSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1000;
  const processed = done.length + failed.length;
  const throughputPerSecond = durationSeconds > 0 ? processed / durationSeconds : 0;

  const avgLatencyMs = latencies.length ? totalLatencyMs / latencies.length : 0;
  const p50LatencyMs = latencies.length ? quantile(latencies, 0.5) : 0;
  const p95LatencyMs = latencies.length ? quantile(latencies, 0.95) : 0;
  const p99LatencyMs = latencies.length ? quantile(latencies, 0.99) : 0;
  const errorRate = processed > 0 ? failed.length / processed : 0;

  const anomalies = detectAnomalies(records, p95LatencyMs);

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalFiles: records.length,
    success: done.length,
    failed: failed.length,
    skipped: skipped.length,
    totalLatencyMs,
    latenciesMs: latencies,
    throughputPerSecond,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    errorRate,
    anomalies,
  };
}

function detectAnomalies(records: CheckpointRecord[], p95: number): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const threshold = p95 * 2;
  for (const r of records) {
    if (r.status === 'done' && r.latencyMs != null && r.latencyMs > threshold) {
      anomalies.push({
        type: 'high_latency',
        message: `Latency ${r.latencyMs}ms exceeds 2x P95 (${p95.toFixed(0)}ms)`,
        filePath: r.filePath,
        value: r.latencyMs,
        threshold,
      });
    }
    if (r.status === 'error') {
      anomalies.push({
        type: 'unexpected_status',
        message: r.errorMessage ?? `Request failed`,
        filePath: r.filePath,
      });
    }
  }
  return anomalies;
}
