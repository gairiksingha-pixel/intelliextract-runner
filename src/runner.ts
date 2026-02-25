/**
 * Runner: orchestrates sync (optional) and extraction run, then returns result for reporting.
 */

import PQueue from "p-queue";
import { loadConfig } from "./config.js";
import { syncAllBuckets, type SyncResult } from "./s3-sync.js";
import {
  runExtraction,
  extractOneFile,
  type FileJob,
  type LoadEngineResult,
  type ExtractionFailure,
  NetworkAbortError,
} from "./load-engine.js";
import {
  openCheckpointDb,
  getCurrentRunId,
  startNewRun,
  getCompletedPaths,
  upsertCheckpoints,
  getRecordsForRun,
  closeCheckpointDb,
  getCumulativeStats,
  getErrorPaths,
} from "./checkpoint.js";
import { saveResumeState, clearResumeState } from "./resume-state.js";
import {
  initRequestResponseLogger,
  closeRequestResponseLogger,
} from "./logger.js";
import { computeMetrics } from "./metrics.js";
import { sendConsolidatedFailureEmail } from "./mailer.js";
import type { Config, RunMetrics } from "./types.js";

export interface TenantPurchaserPair {
  tenant: string;
  purchaser: string;
}

export interface RunOptions {
  configPath?: string;
  skipSync?: boolean;
  /** Override max files to sync (e.g. from CLI --sync-limit). */
  syncLimit?: number;
  /** Override max files to extract (e.g. from CLI --extract-limit). */
  extractLimit?: number;
  /** Sync/run only for this tenant (requires purchaser). */
  tenant?: string;
  /** Sync/run only for this purchaser (requires tenant). */
  purchaser?: string;
  /** Sync/run only for these (tenant, purchaser) pairs. When set, overrides single tenant/purchaser. */
  pairs?: TenantPurchaserPair[];
  /** Called after each file completes so the report can be updated. */
  onFileComplete?: (runId: string) => void;
  /** Resume with existing run ID if provided. */
  runId?: string;
  /** When true, only retry files that previously failed. */
  retryFailed?: boolean;
}

/** Single limit for pipeline mode: sync up to N files and extract each as it is synced (in background). */
export interface PipelineOptions extends RunOptions {
  /** Max files to sync; each synced file is extracted immediately in background. */
  limit?: number;
  /** When true, use existing run ID and clear any partial file from previous run before continuing. */
  resume?: boolean;
  /** Optional progress callback for sync phase (done, total). */
  onProgress?: (done: number, total: number) => void;
  /** Optional progress callback for extraction phase (done, total). Total is the number of files queued for extraction. */
  onExtractionProgress?: (done: number, total: number) => void;
  /** Optional callback when resuming: (skipped, total) = already-extracted count and total for this run, so UI can show "Skipping extracted files". */
  onResumeSkip?: (skipped: number, total: number) => void;
  /** Optional callback during sync when files are skipped (already present): (skipped, totalProcessed) for "Skipping synced files" progress. */
  onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
}

export interface FullRunResult {
  config: Config;
  syncResults?: SyncResult[];
  run: LoadEngineResult;
  metrics: RunMetrics;
}

function filterBucketsByTenantPurchaser(
  buckets: Config["s3"]["buckets"],
  tenant?: string,
  purchaser?: string,
): Config["s3"]["buckets"] {
  if (!tenant || !purchaser) return buckets;
  return buckets.filter(
    (b) => b.tenant === tenant && b.purchaser === purchaser,
  );
}

function filterBucketsByPairs(
  buckets: Config["s3"]["buckets"],
  pairs: { tenant: string; purchaser: string }[],
): Config["s3"]["buckets"] {
  if (!pairs || pairs.length === 0) return buckets;
  const set = new Set(
    pairs.map(({ tenant, purchaser }) => `${tenant}\0${purchaser}`),
  );
  return buckets.filter(
    (b) =>
      b.tenant != null &&
      b.purchaser != null &&
      set.has(`${b.tenant}\0${b.purchaser}`),
  );
}

/**
 * Sync S3, run extraction with checkpointing, and compute metrics.
 */
export async function runFull(
  options: RunOptions = {},
): Promise<FullRunResult> {
  const config = loadConfig(options.configPath);
  const bucketsFilter =
    options.pairs && options.pairs.length > 0
      ? filterBucketsByPairs(config.s3.buckets, options.pairs)
      : options.tenant && options.purchaser
        ? filterBucketsByTenantPurchaser(
            config.s3.buckets,
            options.tenant,
            options.purchaser,
          )
        : undefined;

  let syncResults: SyncResult[] | undefined;
  if (!options.skipSync) {
    syncResults = await syncAllBuckets(config, {
      syncLimit: options.syncLimit,
      buckets: bucketsFilter,
    });
  }

  const runResult = await runExtraction(config, {
    extractLimit: options.extractLimit,
    tenant: options.tenant,
    purchaser: options.purchaser,
    pairs: options.pairs,
    runId: options.runId,
    onFileComplete: options.onFileComplete,
    retryFailed: options.retryFailed,
  });
  const metrics = computeMetrics(
    runResult.runId,
    runResult.records,
    runResult.startedAt,
    runResult.finishedAt,
  );

  return {
    config,
    syncResults,
    run: runResult,
    metrics,
  };
}

/**
 * Run extraction only (no sync). Use when staging is already populated.
 */
export async function runExtractionOnly(
  options: RunOptions = {},
): Promise<FullRunResult> {
  return runFull({ ...options, skipSync: true });
}

/**
 * Pipeline: sync with a single limit; as each file is synced, queue it for extraction in the background.
 * When sync finishes, wait for all extraction jobs to complete, then return metrics and report.
 * limit 0 or undefined = no limit (sync and extract all).
 */
export async function runSyncExtractPipeline(
  options: PipelineOptions = {},
): Promise<FullRunResult> {
  const config = loadConfig(options.configPath);
  const bucketsFilter =
    options.pairs && options.pairs.length > 0
      ? filterBucketsByPairs(config.s3.buckets, options.pairs)
      : options.tenant && options.purchaser
        ? filterBucketsByTenantPurchaser(
            config.s3.buckets,
            options.tenant,
            options.purchaser,
          )
        : undefined;

  const limit = options.limit;
  const effectiveSyncLimit =
    limit !== undefined && limit > 0 ? limit : undefined;

  const db = openCheckpointDb(config.run.checkpointPath);
  const runId =
    options.runId ??
    (options.resume
      ? (getCurrentRunId(db) ?? startNewRun(db))
      : startNewRun(db));
  initRequestResponseLogger(config, runId);

  const stdoutPiped = !process.stdout.isTTY;
  const limitNum = limit ?? 0; // Use 0 if limit is undefined for output purposes

  if (stdoutPiped) {
    process.stdout.write(`SYNC_PROGRESS\t0\t${limitNum}\n`);
    process.stdout.write(`RUN_ID\t${runId}\n`);
  }
  if (stdoutPiped) process.stdout.write("EXTRACTION_PROGRESS\t0\t0\n");

  const completed = config.run.skipCompleted
    ? getCompletedPaths(db)
    : new Set<string>();

  if (options.resume && options.onResumeSkip) {
    const records = getRecordsForRun(db, runId);
    const doneCount = records.filter((r) => r.status === "done").length;
    if (doneCount > 0) {
      options.onResumeSkip(doneCount, records.length);
    }
  }

  const concurrency = config.run.concurrency;
  const extractionQueue = new PQueue({ concurrency });

  // If retryFailed is on, we ONLY want to extract files that previously failed
  const errorPaths = options.retryFailed ? getErrorPaths(db) : null;

  const startedAt = new Date();
  let syncResults: SyncResult[] = [];
  let extractionQueued = 0;
  let extractionDone = 0;
  const failures: ExtractionFailure[] = [];
  const skippedRecords: Array<{
    filePath: string;
    relativePath: string;
    brand: string;
    status: "skipped";
    runId: string;
  }> = [];

  let aborted = false;

  const onFileSynced = (job: FileJob) => {
    if (aborted) return;
    clearResumeState(config);
    extractionQueued++;

    if (errorPaths && !errorPaths.has(job.filePath)) {
      extractionDone++;
      options.onExtractionProgress?.(extractionDone, extractionQueued);
      return;
    }

    if (completed.has(job.filePath) && !errorPaths?.has(job.filePath)) {
      extractionDone++;
      options.onExtractionProgress?.(extractionDone, extractionQueued);
      skippedRecords.push({
        filePath: job.filePath,
        relativePath: job.relativePath,
        brand: job.brand,
        status: "skipped",
        runId,
      });
      try {
        options.onFileComplete?.(runId);
      } catch (_) {}
      return; // Skip adding to queue
    }
    extractionQueue.add(async () => {
      if (aborted) return;
      try {
        await extractOneFile(config, runId, db, job, (f) => {
          failures.push(f);
        });
      } catch (err) {
        if (err instanceof NetworkAbortError) {
          aborted = true;
          extractionQueue.clear();
          if (stdoutPiped) {
            process.stdout.write(
              `LOG\tNetwork interruption detected. Execution stopping. Resume later.\n`,
            );
          }
          return;
        }
        throw err;
      } finally {
        extractionDone++;
        options.onExtractionProgress?.(extractionDone, extractionQueued);
        try {
          options.onFileComplete?.(runId);
        } catch (_) {}
      }
    });
  };

  syncResults = await syncAllBuckets(config, {
    syncLimit: effectiveSyncLimit,
    buckets: bucketsFilter,
    onProgress: options.onProgress,
    onSyncSkipProgress: options.onSyncSkipProgress,
    onFileSynced,
    onStartDownload: (destPath, manifestKey) => {
      saveResumeState(config, {
        syncInProgressPath: destPath,
        syncInProgressManifestKey: manifestKey,
      });
    },
    alreadyExtractedPaths: completed.size > 0 ? completed : undefined,
  });

  if (skippedRecords.length > 0) {
    upsertCheckpoints(db, skippedRecords);
  }

  await extractionQueue.onIdle();

  const finishedAt = new Date();
  const records = getRecordsForRun(db, runId);

  const metrics = computeMetrics(runId, records, startedAt, finishedAt);

  // Send consolidated failure email if any failures occurred
  if (failures.length > 0) {
    void sendConsolidatedFailureEmail(
      config.run.checkpointPath,
      runId,
      failures,
      metrics,
    );
  }

  if (stdoutPiped) {
    process.stdout.write(
      `Extraction metrics: success=${metrics.success}, skipped=${metrics.skipped}, failed=${metrics.failed}\n`,
    );
    const cumStats = getCumulativeStats(db, {
      tenant: options.tenant,
      purchaser: options.purchaser,
    });
    process.stdout.write(
      `CUMULATIVE_METRICS\tsuccess=${cumStats.success},failed=${cumStats.failed},total=${cumStats.total}\n`,
    );
  }

  closeRequestResponseLogger();
  closeCheckpointDb(db);
  const runResult: LoadEngineResult = {
    runId,
    records,
    startedAt,
    finishedAt,
  };

  return {
    config,
    syncResults,
    run: runResult,
    metrics,
  };
}
