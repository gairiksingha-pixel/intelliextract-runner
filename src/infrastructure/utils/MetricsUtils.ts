import { quantile } from "simple-statistics";

const TOP_SLOWEST_N = 5;

/**
 * Compute run metrics: throughput, latency percentiles, error rate, anomalies,
 * failure breakdown by error type, top 5 slowest files, failures by brand.
 */
export function computeMetrics(
  runId: string,
  records: any[],
  startedAt?: Date,
  finishedAt?: Date,
) {
  const allDone = records.filter((r) => r.status === "done");
  const failed = records.filter((r) => r.status === "error");
  const skippedRecords = records.filter((r) => r.status === "skipped");

  const success = allDone.length;
  const skipped = skippedRecords.length;

  const processedRecordsWithLatency = records.filter(
    (r) =>
      (r.status === "done" || r.status === "error") &&
      typeof r.latencyMs === "number" &&
      r.latencyMs >= 0,
  );

  const latencies = processedRecordsWithLatency.map((r) => r.latencyMs!);
  const totalProcessingTimeMs = latencies.reduce((a, b) => a + b, 0);
  const totalLatencyMs = allDone
    .map((r) => r.latencyMs!)
    .filter((n) => typeof n === "number" && n >= 0)
    .reduce((a, b) => a + b, 0);

  const processedTotal = allDone.length + failed.length;

  // Wall clock duration calculation
  let start = startedAt ? startedAt.getTime() : Infinity;
  let end = finishedAt ? finishedAt.getTime() : 0;

  if (!startedAt || !finishedAt) {
    records.forEach((r) => {
      if (r.startedAt) {
        const s = new Date(r.startedAt).getTime();
        if (s < start) start = s;
      }
      if (r.finishedAt) {
        const f = new Date(r.finishedAt).getTime();
        if (f > end) end = f;
      }
    });
  }

  if (start === Infinity) start = Date.now();
  if (end === 0) end = start + totalProcessingTimeMs;
  const wallClockDurationMs = end - start;
  const wallClockDurationSeconds = wallClockDurationMs / 1000;

  const throughputPerSecond =
    wallClockDurationSeconds > 0
      ? processedTotal / wallClockDurationSeconds
      : 0;
  const throughputPerMinute = throughputPerSecond * 60;

  const avgLatencyMs = latencies.length
    ? totalProcessingTimeMs / latencies.length
    : 0;
  const p50LatencyMs = latencies.length ? quantile(latencies, 0.5) : 0;
  const p95LatencyMs = latencies.length ? quantile(latencies, 0.95) : 0;
  const p99LatencyMs = latencies.length ? quantile(latencies, 0.99) : 0;
  const errorRate = processedTotal > 0 ? failed.length / processedTotal : 0;

  const anomalies = detectAnomalies(records, p95LatencyMs);
  const failureBreakdown = computeFailureBreakdown(failed);
  const topSlowestFiles = computeTopSlowestFiles(allDone);
  const failureCountByBrand = computeFailureCountByBrand(failed);
  const failureDetails = failed.map((r) => {
    let errorMessage: string | undefined = r.errorMessage ?? undefined;
    if (errorMessage != null && errorMessage.length > 300) {
      errorMessage = errorMessage.slice(0, 300) + "…";
    }
    return {
      filePath: r.filePath,
      relativePath: r.relativePath,
      brand: r.brand,
      purchaser: r.purchaser,
      statusCode: r.statusCode,
      errorMessage,
    };
  });

  return {
    runId,
    startedAt: new Date(start).toISOString(),
    finishedAt: new Date(end).toISOString(),
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
    runDurationSeconds: wallClockDurationSeconds,
  };
}

function inferErrorType(
  record: any,
): "timeout" | "clientError" | "serverError" | "readError" | "other" {
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

function computeFailureBreakdown(failed: any[]) {
  const breakdown = {
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

function computeTopSlowestFiles(done: any[]) {
  return done
    .filter((r) => typeof r.latencyMs === "number" && r.latencyMs >= 0)
    .sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0))
    .slice(0, TOP_SLOWEST_N)
    .map((r) => ({
      filePath: r.filePath,
      relativePath: r.relativePath,
      brand: r.brand,
      purchaser: r.purchaser,
      latencyMs: r.latencyMs!,
      patternKey: r.patternKey,
    }));
}

function computeFailureCountByBrand(failed: any[]) {
  const byBrand = new Map<string, number>();
  for (const r of failed) {
    byBrand.set(r.brand, (byBrand.get(r.brand) ?? 0) + 1);
  }
  return Array.from(byBrand.entries())
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count);
}

function detectAnomalies(records: any[], p95: number) {
  const anomalies: any[] = [];
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
