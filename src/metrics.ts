/**
 * Compute run metrics: throughput, latency percentiles, error rate, anomalies,
 * failure breakdown by error type, top 5 slowest files, failures by brand.
 */

import { quantile } from "simple-statistics";
import type {
  CheckpointRecord,
  RunMetrics,
  Anomaly,
  FailureBreakdown,
} from "./types.js";

const TOP_SLOWEST_N = 5;

function inferErrorType(record: CheckpointRecord): keyof FailureBreakdown {
  const code = record.statusCode ?? 0;
  const msg = (record.errorMessage ?? "").toLowerCase();
  if (code === 0) {
    if (/timeout|abort|etimedout|econnaborted/.test(msg)) return "timeout";
    if (/^read file:/i.test(record.errorMessage ?? "")) return "readError";
    return "other";
  }
  if (code >= 500) return "serverError";
  if (code >= 400) return "clientError";
  return "other";
}

function computeFailureBreakdown(failed: CheckpointRecord[]): FailureBreakdown {
  const breakdown: FailureBreakdown = {
    timeout: 0,
    clientError: 0,
    serverError: 0,
    readError: 0,
    other: 0,
  };
  for (const r of failed) {
    breakdown[inferErrorType(r)] += 1;
  }
  return breakdown;
}

function computeTopSlowestFiles(
  done: CheckpointRecord[],
): { filePath: string; latencyMs: number }[] {
  return done
    .filter((r) => typeof r.latencyMs === "number" && r.latencyMs >= 0)
    .sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0))
    .slice(0, TOP_SLOWEST_N)
    .map((r) => ({
      filePath: r.filePath,
      latencyMs: r.latencyMs!,
      patternKey: r.patternKey,
    }));
}

function computeFailureCountByBrand(
  failed: CheckpointRecord[],
): { brand: string; count: number }[] {
  const byBrand = new Map<string, number>();
  for (const r of failed) {
    byBrand.set(r.brand, (byBrand.get(r.brand) ?? 0) + 1);
  }
  return Array.from(byBrand.entries())
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);
}

export function computeMetrics(
  runId: string,
  records: CheckpointRecord[],
  startedAt: Date,
  finishedAt: Date,
): RunMetrics {
  const allDone = records.filter((r) => r.status === "done");
  const failed = records.filter((r) => r.status === "error");
  const skippedRecords = records.filter((r) => r.status === "skipped");

  const success = allDone.length;
  const skipped = skippedRecords.length;

  const latencies = allDone
    .map((r) => r.latencyMs!)
    .filter((n) => typeof n === "number" && n >= 0);
  const totalLatencyMs = latencies.reduce((a, b) => a + b, 0);
  // Total time spent on extraction = sum of latency for all processed files (done + error with latency)
  const totalProcessingTimeMs = records
    .filter(
      (r) =>
        (r.status === "done" || r.status === "error") &&
        typeof r.latencyMs === "number" &&
        r.latencyMs >= 0,
    )
    .reduce((sum, r) => sum + (r.latencyMs ?? 0), 0);
  const processed = allDone.length + failed.length;
  const totalProcessingTimeSeconds = totalProcessingTimeMs / 1000;
  const throughputPerSecond =
    totalProcessingTimeSeconds > 0 ? processed / totalProcessingTimeSeconds : 0;
  const throughputPerMinute = throughputPerSecond * 60;

  const avgLatencyMs = latencies.length ? totalLatencyMs / latencies.length : 0;
  const p50LatencyMs = latencies.length ? quantile(latencies, 0.5) : 0;
  const p95LatencyMs = latencies.length ? quantile(latencies, 0.95) : 0;
  const p99LatencyMs = latencies.length ? quantile(latencies, 0.99) : 0;
  const errorRate = processed > 0 ? failed.length / processed : 0;

  const anomalies = detectAnomalies(records, p95LatencyMs);
  const failureBreakdown = computeFailureBreakdown(failed);
  const topSlowestFiles = computeTopSlowestFiles(allDone);
  const failureCountByBrand = computeFailureCountByBrand(failed);
  const failureDetails =
    failed.length > 0
      ? failed.map((r) => {
          let errorMessage: string | undefined = r.errorMessage ?? undefined;
          if (errorMessage != null && errorMessage.length > 300) {
            errorMessage = errorMessage.slice(0, 300) + "…";
          }
          return {
            filePath: r.filePath,
            statusCode: r.statusCode,
            errorMessage,
          };
        })
      : undefined;

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalFiles: records.length,
    success,
    failed: failed.length,
    skipped,
    totalLatencyMs,
    totalProcessingTimeMs,
    latenciesMs: latencies,
    throughputPerSecond,
    throughputPerMinute,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    p99LatencyMs,
    errorRate,
    anomalies,
    failureBreakdown,
    topSlowestFiles,
    failureCountByBrand,
    failureDetails,
  };
}

function detectAnomalies(records: CheckpointRecord[], p95: number): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const threshold = p95 * 2;
  for (const r of records) {
    if (r.status === "done" && r.latencyMs != null && r.latencyMs > threshold) {
      anomalies.push({
        type: "high_latency",
        message: `Latency ${r.latencyMs}ms exceeds 2x P95 (${p95.toFixed(0)}ms)`,
        filePath: r.filePath,
        value: r.latencyMs,
        threshold,
      });
    }
    if (r.status === "error") {
      anomalies.push({
        type: "unexpected_status",
        message: r.errorMessage ?? `Request failed`,
        filePath: r.filePath,
      });
    }
  }
  return anomalies;
}
