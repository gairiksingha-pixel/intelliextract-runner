/**
 * Shared types for EntelliExtract test stub
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
}

export interface LoggingConfig {
  dir: string;
  requestResponseLog: string;
  maxResponseBodyLength: number;
}

export interface ReportConfig {
  outputDir: string;
  formats: ('markdown' | 'html' | 'json')[];
}

export interface Config {
  api: ApiConfig;
  s3: S3Config;
  run: RunConfig;
  logging: LoggingConfig;
  report: ReportConfig;
}

export type CheckpointStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

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

export interface RunMetrics {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalFiles: number;
  success: number;
  failed: number;
  skipped: number;
  totalLatencyMs: number;
  latenciesMs: number[];
  throughputPerSecond: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  anomalies: Anomaly[];
}

export interface Anomaly {
  type: 'high_latency' | 'error_spike' | 'timeout' | 'unexpected_status';
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
