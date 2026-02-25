export interface ApiConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface S3BucketConfig {
  name: string;
  bucket: string;
  prefix?: string;
  tenant?: string;
  purchaser?: string;
}

export interface S3Config {
  buckets: S3BucketConfig[];
  stagingDir: string;
  region: string;
  syncLimit?: number;
}

export interface RunConfig {
  concurrency: number;
  requestsPerSecond: number;
  checkpointPath: string;
  skipCompleted: boolean;
  maxRetries?: number;
  retryBackoffMs?: number;
  retryFailed?: boolean;
}

export interface LoggingConfig {
  dir: string;
  requestResponseLog: string;
  maxResponseBodyLength: number;
}

export interface ReportConfig {
  outputDir: string;
  formats: ("markdown" | "html" | "json")[];
  retainCount?: number;
}

export interface Config {
  api: ApiConfig;
  s3: S3Config;
  run: RunConfig;
  logging: LoggingConfig;
  report: ReportConfig;
}
