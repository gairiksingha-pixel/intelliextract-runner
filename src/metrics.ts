import { median, quantile } from "simple-statistics";

export function computeMetrics(
  runId: string,
  records: any[],
  startTimeOverride?: Date,
  endTimeOverride?: Date,
) {
  const total = records.length;
  const success = records.filter((r) => r.status === "done").length;
  const error = records.filter((r) => r.status === "error").length;
  const skipped = records.filter((r) => r.status === "skipped").length;

  let startedAt = startTimeOverride ? startTimeOverride.getTime() : Infinity;
  let finishedAt = endTimeOverride ? endTimeOverride.getTime() : 0;

  const latencies: number[] = [];
  const failureBreakdown = {
    timeout: 0,
    clientError: 0,
    serverError: 0,
    readError: 0,
    other: 0,
  };

  records.forEach((r) => {
    if (!startTimeOverride || !endTimeOverride) {
      if (r.startedAt) {
        const s = new Date(r.startedAt).getTime();
        if (s < startedAt) startedAt = s;
      }
      if (r.finishedAt) {
        const f = new Date(r.finishedAt).getTime();
        if (f > finishedAt) finishedAt = f;
      }
    }
    if (r.latencyMs !== undefined && r.latencyMs !== null) {
      latencies.push(r.latencyMs);
    }
    if (r.status === "error") {
      const code = r.statusCode;
      if (code === 0) failureBreakdown.readError++;
      else if (code >= 500) failureBreakdown.serverError++;
      else if (code >= 400) failureBreakdown.clientError++;
      else failureBreakdown.other++;
    }
  });

  if (startedAt === Infinity) startedAt = Date.now();
  if (finishedAt === 0) finishedAt = Date.now();

  const durationMs = finishedAt > startedAt ? finishedAt - startedAt : 0;
  const totalLatencyMs = latencies.reduce((a, b) => a + b, 0);
  const avgLatencyMs =
    latencies.length > 0 ? totalLatencyMs / latencies.length : 0;

  const latenciesSorted = [...latencies].sort((a, b) => a - b);

  return {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    startTime: new Date(startedAt).toISOString(),
    endTime: new Date(finishedAt).toISOString(),
    totalFiles: total,
    total,
    success,
    error,
    failed: error,
    skipped,
    totalLatencyMs,
    totalProcessingTimeMs: durationMs,
    latenciesMs: latencies,
    throughputPerSecond: durationMs > 0 ? (total / durationMs) * 1000 : 0,
    throughputPerMinute: durationMs > 0 ? (total / durationMs) * 60000 : 0,
    avgLatencyMs,
    p50LatencyMs: latenciesSorted.length > 0 ? median(latenciesSorted) : 0,
    p95LatencyMs:
      latenciesSorted.length > 0 ? quantile(latenciesSorted, 0.95) : 0,
    p99LatencyMs:
      latenciesSorted.length > 0 ? quantile(latenciesSorted, 0.99) : 0,
    errorRate: total > 0 ? error / total : 0,
    anomalies: [],
    failureBreakdown,
    topSlowestFiles: [],
    failureCountByBrand: [],
    failureDetails: [],
    runDurationSeconds: durationMs / 1000,
    durationMs,
  };
}
