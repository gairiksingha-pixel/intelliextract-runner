/**
 * Shared types for IntelliExtract test stub
 */

export interface ApiConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface S3BucketConfig {
  name: string;
  bucket: string;
  prefix?: string;
  /** Tenant folder name (when using single-bucket tenant/purchaser layout). */
  tenant?: string;
  /** Purchaser folder name (when using single-bucket tenant/purchaser layout). */
  purchaser?: string;
}

export interface S3Config {
  buckets: S3BucketConfig[];
  stagingDir: string;
  region: string;
  /** Max number of files to download per sync (optional). Skipped (checksum match) do not count. */
  syncLimit?: number;
  /** Path to JSON file storing key -> SHA-256 for skip-on-checksum. Default: output/checkpoints/sync-manifest.json */
  syncManifestPath?: string;
}

export interface RunConfig {
  concurrency: number;
  requestsPerSecond: number;
  checkpointPath: string;
  skipCompleted: boolean;
  /** Max number of retries per file when the API call fails with timeout/5xx/429. Default: 0 (no retries). */
  maxRetries?: number;
  /** Base delay in milliseconds between retries (simple linear backoff). Default: 500ms. */
  retryBackoffMs?: number;
}

export interface LoggingConfig {
  dir: string;
  requestResponseLog: string;
  maxResponseBodyLength: number;
}

export interface ReportConfig {
  outputDir: string;
  formats: ("markdown" | "html" | "json")[];
  /** Keep only this many report sets (each run = one .html + one .json). Older reports are deleted after each write. Omit or 0 = keep all. */
  retainCount?: number;
}

export interface Config {
  api: ApiConfig;
  s3: S3Config;
  run: RunConfig;
  logging: LoggingConfig;
  report: ReportConfig;
}

export type CheckpointStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "skipped";

export interface CheckpointRecord {
  filePath: string;
  relativePath: string;
  brand: string;
  status: CheckpointStatus;
  startedAt?: string;
  finishedAt?: string;
  latencyMs?: number;
  statusCode?: number;
  errorMessage?: string;
  patternKey?: string;
  runId: string;
}

export interface RequestResponseLogEntry {
  timestamp: string;
  runId: string;
  filePath: string;
  brand: string;
  request: {
    method: string;
    url: string;
    bodyPreview?: string;
    bodyLength?: number;
  };
  response: {
    statusCode: number;
    latencyMs: number;
    bodyPreview?: string;
    bodyLength?: number;
    headers?: Record<string, string>;
  };
  success: boolean;
}

/** Failure counts by inferred error type (timeout, 4xx, 5xx, read error, other). */
export interface FailureBreakdown {
  timeout: number;
  clientError: number;
  serverError: number;
  readError: number;
  other: number;
}

export interface RunMetrics {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalFiles: number;
  success: number;
  failed: number;
  skipped: number;
  totalLatencyMs: number;
  /** Sum of extraction latency for all processed files (done + error). Used for "Run duration" in report. */
  totalProcessingTimeMs: number;
  latenciesMs: number[];
  throughputPerSecond: number;
  throughputPerMinute: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  anomalies: Anomaly[];
  /** Failure counts by error type (only when failed > 0). */
  failureBreakdown: FailureBreakdown;
  /** Top 5 slowest files by processing time (from completed requests). */
  topSlowestFiles: {
    filePath: string;
    latencyMs: number;
    patternKey?: string;
  }[];
  /** Failure count per brand (only brands with at least one failure). */
  failureCountByBrand: { brand: string; count: number }[];
  /** Per-failure API status and message (for debugging 4xx/5xx). */
  failureDetails?: {
    filePath: string;
    statusCode?: number;
    errorMessage?: string;
  }[];
}

export interface Anomaly {
  type: "high_latency" | "error_spike" | "timeout" | "unexpected_status";
  message: string;
  filePath?: string;
  value?: number;
  threshold?: number;
}

export interface ExecutiveSummary {
  title: string;
  generatedAt: string;
  metrics: RunMetrics;
  runDurationSeconds: number;
}
