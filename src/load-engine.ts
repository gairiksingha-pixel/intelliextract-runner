/**
 * Load engine: run extraction with configurable concurrency and optional rate limiting.
 * Uses p-queue for concurrency and requests-per-second cap.
 */

import PQueue from "p-queue";
import {
  readFileSync,
  existsSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, relative, dirname } from "node:path";
import type { Config, CheckpointRecord, S3BucketConfig } from "./types.js";
import {
  extract,
  getExtractUploadUrl,
  type ExtractResult,
} from "./api-client.js";
import type { CheckpointDb } from "./checkpoint.js";
import {
  openCheckpointDb,
  getOrCreateRunId,
  getCompletedPaths,
  createRunIdOnly,
  upsertCheckpoint,
  upsertCheckpoints,
  getRecordsForRun,
  closeCheckpointDb,
  getCumulativeStats,
} from "./checkpoint.js";
import {
  initRequestResponseLogger,
  logRequestResponse,
  closeRequestResponseLogger,
} from "./logger.js";
import { getStagingSubdir } from "./s3-sync.js";
import { sendConsolidatedFailureEmail } from "./mailer.js";
import { computeMetrics } from "./metrics.js";

export interface ExtractionFailure {
  filePath: string;
  brand: string;
  purchaser?: string;
  patternKey?: string;
  errorMessage?: string;
  statusCode?: number;
}

export interface FileJob {
  filePath: string;
  relativePath: string;
  brand: string;
  purchaser?: string;
}

export interface LoadEngineResult {
  runId: string;
  records: CheckpointRecord[];
  startedAt: Date;
  finishedAt: Date;
}

interface ExtractWithRetryResult {
  result: ExtractResult;
  attempts: number;
}

export class NetworkAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkAbortError";
  }
}

/**
 * Call the extract API with retries.
 * Special handling for network errors (statusCode === 0):
 * - Retry 5 times with 12s delay (total ~60s).
 * - If still failing, throw NetworkAbortError to stop the entire run.
 *
 * Other transient errors (5xx, 429):
 * - Retry based on config.run.maxRetries.
 */
async function extractWithRetries(
  config: Config,
  job: FileJob,
  bodyBase64: string,
): Promise<ExtractWithRetryResult> {
  const maxRetries = Number.isInteger(config.run.maxRetries ?? 0)
    ? Math.max(0, config.run.maxRetries ?? 0)
    : 0;
  const backoffBaseMs = Number.isFinite(config.run.retryBackoffMs ?? 0)
    ? Math.max(0, config.run.retryBackoffMs ?? 0)
    : 500;

  let attempt = 0;
  let last: ExtractResult;

  // Network retry settings
  const NETWORK_MAX_RETRIES = 5;
  const NETWORK_RETRY_DELAY_MS = 12000;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    last = await extract(config, {
      filePath: job.filePath,
      fileContentBase64: bodyBase64,
      brand: job.brand,
    });

    // Check for Network Error (statusCode === 0)
    if (last.statusCode === 0) {
      if (attempt <= NETWORK_MAX_RETRIES) {
        // Log to stdout so user sees it
        if (typeof process !== "undefined" && !process.stdout.isTTY) {
          process.stdout.write(
            `LOG\tNetwork interruption detected. Retry ${attempt}/${NETWORK_MAX_RETRIES} in ${NETWORK_RETRY_DELAY_MS / 1000}s...\n`,
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, NETWORK_RETRY_DELAY_MS),
        );
        continue;
      } else {
        // Failed after all retries
        throw new NetworkAbortError(
          "Network interruption detected (max retries exceeded). Aborting run.",
        );
      }
    }

    if (last.success) break;

    // Handle other retriable errors (5xx, 429)
    const code = last.statusCode;
    const isRetriable = code === 429 || (code >= 500 && code < 600);

    if (!isRetriable) break;
    if (attempt > maxRetries) break;

    if (backoffBaseMs > 0) {
      const delay = backoffBaseMs * attempt; // simple linear backoff
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { result: last!, attempts: attempt };
}

function discoverStagingFiles(
  stagingDir: string,
  buckets: S3BucketConfig[],
): FileJob[] {
  const jobs: FileJob[] = [];
  for (const bucket of buckets) {
    const subdir = getStagingSubdir(bucket);
    const brandDir = join(stagingDir, subdir);
    if (!existsSync(brandDir)) continue;

    // If bucket config specifies a purchaser, ONLY scan that purchaser's subdirectory.
    // Otherwise scan indefinitely? No, the structure is staging/<brand>/<purchaser>/...
    // If no purchaser specified in config, we might scan all.
    // However, the issue is that "purchaser 1" config might share the same brand bucket as "purchaser 2".
    // We must respect bucket.purchaser if present.

    const targetDirs: { dir: string; purchaser?: string }[] = [];

    if (bucket.purchaser) {
      // Scoped to specific purchaser
      targetDirs.push({
        dir: join(brandDir, bucket.purchaser),
        purchaser: bucket.purchaser,
      });
    } else {
      // Scan all direct subdirectories of brandDir as purchasers?
      // Or just walk brandDir?
      // If we walk brandDir directly, we might pick up multiple purchasers.
      // We should probably try to infer purchaser from the first level subdir if possible.
      // For now, let's keep original behavior but try to infer purchaser if we benefit from it.
      // BUT: The bug states "leakage".
      // If I configure "Purchaser 1", I get a bucket config with purchaser="purchaser1".
      // Then I should ONLY scan brandDir/purchaser1.
      // The previous code scanned `brandDir` recursively, effectively ignoring `bucket.purchaser`.
      // EXISTING CODE WAS:
      // const brandDir = join(stagingDir, subdir);
      // const walk = (dir: string) => ...
      // walk(brandDir);
      // This is the bug. It walks the whole brand directory regardless of bucket.purchaser!

      // FIX:
      targetDirs.push({ dir: brandDir });
    }

    for (const { dir: startDir, purchaser: forcedPurchaser } of targetDirs) {
      if (!existsSync(startDir)) continue;

      const walk = (dir: string) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            walk(full);
          } else {
            // Infer purchaser if not forced and we are deeper than brandDir
            let purchaser = forcedPurchaser;
            if (!purchaser) {
              // try to infer from relative path from brandDir
              // schema: brandDir/PURCHASER/file.ext
              const relFromBrand = relative(brandDir, full);
              const parts = relFromBrand.split(/[\\/]/);
              if (parts.length > 1) {
                purchaser = parts[0];
              }
            }
            // relativePath should probably be relative to brandDir?
            // Original code: relative(brandDir, full). This includes purchaser folder in path.
            // That is correct for syncing back?
            const rel = relative(brandDir, full);
            jobs.push({
              filePath: full,
              relativePath: rel,
              brand: bucket.name,
              purchaser,
            });
          }
        }
      };
      walk(startDir);
    }
  }
  return jobs;
}

/** Safe filename for extraction result JSON (one per file per run). */
function extractionResultFilename(job: FileJob): string {
  const safe = job.relativePath
    .replaceAll("/", "_")
    .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const base = job.brand + "_" + (safe || "file");
  return base.endsWith(".json") ? base : base + ".json";
}

/** Write full API response JSON to succeeded/ or failed/ based on response.success in the body. */
function writeExtractionResult(
  config: Config,
  runId: string,
  job: FileJob,
  responseBody: string,
  latencyMs?: number,
): string | null {
  try {
    const baseDir = join(dirname(config.report.outputDir), "extractions");
    let data: unknown;
    try {
      data = JSON.parse(responseBody) as unknown;
    } catch {
      data = { raw: responseBody.slice(0, 10000) };
    }
    const success =
      typeof data === "object" &&
      data !== null &&
      (data as { success?: boolean }).success === true;

    // Add metadata for easier source file recovery in reports
    if (typeof data === "object" && data !== null) {
      (data as any)._relativePath = job.relativePath;
      (data as any)._brand = job.brand;
      (data as any)._purchaser = job.purchaser;
      (data as any)._runId = runId;
      if (typeof latencyMs === "number") {
        (data as any)._latencyMs = latencyMs;
      }
    }

    const subdir = success ? "succeeded" : "failed";
    const extractionsDir = join(baseDir, subdir);
    mkdirSync(extractionsDir, { recursive: true });
    const filename = extractionResultFilename(job);
    const path = join(extractionsDir, filename);
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    return path;
  } catch {
    return null;
  }
}

/**
 * Extract a single file (for pipeline: called as each file is synced). Caller must have opened the checkpoint db and initialized the request/response logger.
 */
export async function extractOneFile(
  config: Config,
  runId: string,
  db: CheckpointDb,
  job: FileJob,
  onFailure?: (failure: ExtractionFailure) => void,
): Promise<void> {
  // Already handled in this run (done or error). Do not re-process or overwrite so the report
  // counts success/failed correctly.
  const existingRow = db._data.checkpoints.find(
    (c) => c.file_path === job.filePath && c.run_id === runId,
  );
  if (
    existingRow &&
    (existingRow.status === "done" || existingRow.status === "error")
  ) {
    return;
  }

  const started = new Date().toISOString();
  upsertCheckpoint(db, {
    filePath: job.filePath,
    relativePath: job.relativePath,
    brand: job.brand,
    purchaser: job.purchaser,
    status: "running",
    startedAt: started,
    runId,
  });

  let bodyBase64: string | undefined;
  try {
    bodyBase64 = readFileSync(job.filePath, { encoding: "base64" });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    upsertCheckpoint(db, {
      filePath: job.filePath,
      relativePath: job.relativePath,
      brand: job.brand,
      purchaser: job.purchaser,
      status: "error",
      startedAt: started,
      finishedAt: new Date().toISOString(),
      errorMessage: `Read file: ${errMsg}`,
      runId,
    });
    // Record failure for consolidation
    onFailure?.({
      filePath: job.filePath,
      brand: job.brand,
      purchaser: job.purchaser,
      errorMessage: `Read file: ${errMsg}`,
    });
    return;
  }

  const { result, attempts } = await extractWithRetries(
    config,
    job,
    bodyBase64,
  );

  logRequestResponse({
    runId,
    filePath: job.filePath,
    brand: job.brand,
    request: {
      method: "POST",
      url: getExtractUploadUrl(config),
      bodyPreview: undefined,
      bodyLength: bodyBase64?.length,
    },
    response: {
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      bodyPreview: result.body.slice(0, 500),
      bodyLength: result.body.length,
      headers: result.headers,
    },
    success: result.success,
  });

  const isHttpSuccess = result.success;
  let isAppSuccess = isHttpSuccess;
  let appErrorMessage: string | undefined;
  let patternKey: string | undefined;

  if (result.body) {
    try {
      const parsed = JSON.parse(result.body);
      if (typeof parsed === "object" && parsed !== null) {
        if (parsed.success === false) {
          isAppSuccess = false;
          appErrorMessage = parsed.error || parsed.message;
        }
        patternKey = parsed.pattern?.pattern_key;
      }
    } catch (_) {
      // If we can't parse JSON but HTTP was 2xx, we'll still call it success
      // unless we want to be strict. For now, keep as is.
    }
  }

  const finalSuccess = isAppSuccess;
  const status = finalSuccess ? "done" : "error";

  if (result.body) {
    writeExtractionResult(config, runId, job, result.body, result.latencyMs);
  }

  const baseErrorSnippet = finalSuccess ? undefined : result.body.slice(0, 500);
  const errorMessage =
    finalSuccess || (!baseErrorSnippet && !appErrorMessage)
      ? undefined
      : appErrorMessage ||
        (attempts > 1
          ? `${baseErrorSnippet} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`
          : baseErrorSnippet);

  upsertCheckpoint(db, {
    filePath: job.filePath,
    relativePath: job.relativePath,
    brand: job.brand,
    purchaser: job.purchaser,
    status,
    startedAt: started,
    finishedAt: new Date().toISOString(),
    latencyMs: result.latencyMs,
    statusCode: result.statusCode,
    errorMessage,
    patternKey,
    runId,
  });

  // Record failure for consolidation
  if (!finalSuccess) {
    onFailure?.({
      filePath: job.filePath,
      brand: job.brand,
      purchaser: job.purchaser,
      patternKey,
      errorMessage,
      statusCode: result.statusCode,
    });
  }
}

/**
 * Run extraction against all staging files with concurrency and optional rate limit.
 * Checkpoints each file so the run can be resumed.
 * @param options.extractLimit - Max number of files to process (0 = no limit). Overrides config when set from CLI.
 * @param options.tenant - When set with purchaser, only process files for this tenant/purchaser.
 * @param options.purchaser - When set with tenant, only process files for this tenant/purchaser.
 * @param options.pairs - When set, only process files for these (tenant, purchaser) pairs.
 */
export async function runExtraction(
  config: Config,
  options?: {
    extractLimit?: number;
    tenant?: string;
    purchaser?: string;
    pairs?: { tenant: string; purchaser: string }[];
    runId?: string;
    /** Called after each file completes (done or error) so the report can be updated. */
    onFileComplete?: (runId: string) => void;
    /** When true, only retry files that previously failed. */
    retryFailed?: boolean;
  },
): Promise<LoadEngineResult> {
  const db = openCheckpointDb(config.run.checkpointPath);
  const runId = options?.runId ?? getOrCreateRunId(db);
  const completed = config.run.skipCompleted
    ? getCompletedPaths(db)
    : new Set<string>();

  // If retryFailed is on, we ALSO want to know which files have "error" status
  const errorPaths = options?.retryFailed
    ? new Set(
        db._data.checkpoints
          .filter((c) => c.status === "error")
          .map((c) => c.file_path),
      )
    : null;

  initRequestResponseLogger(config, runId);

  let buckets = config.s3.buckets;
  if (options?.pairs && options.pairs.length > 0) {
    const set = new Set(
      options.pairs.map(({ tenant, purchaser }) => `${tenant}\0${purchaser}`),
    );
    buckets = buckets.filter(
      (b) =>
        b.tenant != null &&
        b.purchaser != null &&
        set.has(`${b.tenant}\0${b.purchaser}`),
    );
  } else if (options?.tenant && options?.purchaser) {
    buckets = buckets.filter(
      (b) => b.tenant === options.tenant && b.purchaser === options.purchaser,
    );
  }
  const jobs = discoverStagingFiles(config.s3.stagingDir, buckets);

  // Get records already associated with this run so we don't overwrite "done" with "skipped"
  const existingRecordsParams = getRecordsForRun(db, runId);
  const alreadyInRun = new Set(existingRecordsParams.map((r) => r.filePath));

  let toProcess = jobs.filter((j) => {
    const isCompleted = completed.has(j.filePath);
    if (options?.retryFailed && errorPaths?.has(j.filePath)) {
      return true; // Bypass completed check if we are explicitly retrying failures
    }
    return !isCompleted;
  });

  if (errorPaths) {
    toProcess = toProcess.filter((j) => errorPaths.has(j.filePath));
  }
  const extractLimit = options?.extractLimit;
  if (extractLimit !== undefined && extractLimit > 0) {
    toProcess = toProcess.slice(0, extractLimit);
  }

  // Determine the final run ID to use.
  // When there is nothing to extract (all done or no files), use a new SKIP- style ID
  // so we don't consume a "RUNn" sequence number for a no-op, and metrics remain 0-based for the session.
  const runIdToUse = toProcess.length === 0 ? createRunIdOnly() : runId;

  // Record files already completed as 'skipped' for this specific run so metrics
  // correctly identify them as such (not Success, not Failed). Batch upsert to avoid N file writes.
  // IMPORTANT: Use runIdToUse so skipped records belong to the same session as the metrics.
  const skippedRecords = jobs
    .filter((j) => completed.has(j.filePath) && !alreadyInRun.has(j.filePath))
    .map((job) => ({
      filePath: job.filePath,
      relativePath: job.relativePath,
      brand: job.brand,
      purchaser: job.purchaser,
      status: "skipped" as const,
      runId: runIdToUse,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }));

  if (skippedRecords.length > 0) {
    upsertCheckpoints(db, skippedRecords);
  }

  if (toProcess.length === 0) {
    initRequestResponseLogger(config, runIdToUse);
  }
  const concurrency = config.run.concurrency;
  const intervalCap =
    config.run.requestsPerSecond > 0 ? config.run.requestsPerSecond : undefined;
  const queueOptions: {
    concurrency: number;
    interval?: number;
    intervalCap?: number;
  } = { concurrency };
  if (intervalCap != null) {
    queueOptions.interval = 1000;
    queueOptions.intervalCap = intervalCap;
  }
  const queue = new PQueue(queueOptions);
  const startedAt = new Date();
  const failures: ExtractionFailure[] = [];
  const total = toProcess.length;
  let done = 0;
  const isTTY =
    typeof process !== "undefined" && process.stdout?.isTTY === true;
  const barWidth = 24;
  const stdoutPiped =
    typeof process !== "undefined" && process.stdout?.isTTY !== true;

  if (stdoutPiped && completed.size > 0 && total > 0) {
    process.stdout.write(`RESUME_SKIP\t${completed.size}\t${jobs.length}\n`);
  }
  if (stdoutPiped) {
    process.stdout.write(`RUN_ID\t${runIdToUse}\n`);
  }
  if (stdoutPiped && total > 0) {
    process.stdout.write(`EXTRACTION_PROGRESS\t0\t${total}\n`);
  }

  function updateProgress(): void {
    if (isTTY && total > 0) {
      const pct =
        total === 0 ? 100 : Math.min(100, Math.round((100 * done) / total));
      const filled = Math.round((barWidth * done) / total);
      const bar = "=".repeat(filled) + " ".repeat(barWidth - filled);
      process.stdout.write(`\rExtraction: [${bar}] ${pct}% (${done}/${total})`);
    } else if (stdoutPiped && total > 0) {
      process.stdout.write(`EXTRACTION_PROGRESS\t${done}\t${total}\n`);
    }
  }

  let aborted = false;

  for (const job of toProcess) {
    // If already aborted, don't add more jobs
    if (aborted) break;

    queue
      .add(async () => {
        if (aborted) return;

        const started = new Date().toISOString();
        upsertCheckpoint(db, {
          filePath: job.filePath,
          relativePath: job.relativePath,
          brand: job.brand,
          purchaser: job.purchaser,
          status: "running",
          startedAt: started,
          runId: runIdToUse,
        });

        let bodyBase64: string | undefined;
        try {
          bodyBase64 = readFileSync(job.filePath, { encoding: "base64" });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          const failure = {
            filePath: job.filePath,
            brand: job.brand,
            purchaser: job.purchaser,
            errorMessage: `Read file: ${errMsg}`,
          };
          failures.push(failure);
          upsertCheckpoint(db, {
            filePath: job.filePath,
            relativePath: job.relativePath,
            brand: job.brand,
            purchaser: job.purchaser,
            status: "error",
            startedAt: started,
            finishedAt: new Date().toISOString(),
            errorMessage: `Read file: ${errMsg}`,
            runId: runIdToUse,
          });
          return;
        }

        try {
          const { result, attempts } = await extractWithRetries(
            config,
            job,
            bodyBase64,
          );

          logRequestResponse({
            runId: runIdToUse,
            filePath: job.filePath,
            brand: job.brand,
            request: {
              method: "POST",
              url: getExtractUploadUrl(config),
              bodyPreview: undefined,
              bodyLength: bodyBase64?.length,
            },
            response: {
              statusCode: result.statusCode,
              latencyMs: result.latencyMs,
              bodyPreview: result.body.slice(0, 500),
              bodyLength: result.body.length,
              headers: result.headers,
            },
            success: result.success,
          });

          const isHttpSuccess = result.success;
          let isAppSuccess = isHttpSuccess;
          let appErrorMessage: string | undefined;
          let patternKey: string | undefined;

          if (result.body) {
            try {
              const parsed = JSON.parse(result.body);
              if (typeof parsed === "object" && parsed !== null) {
                if (parsed.success === false) {
                  isAppSuccess = false;
                  appErrorMessage = parsed.error || parsed.message;
                }
                patternKey = parsed.pattern?.pattern_key;
              }
            } catch (_) {}
          }

          const finalSuccess = isAppSuccess;
          const status = finalSuccess ? "done" : "error";
          if (result.body) {
            writeExtractionResult(
              config,
              runIdToUse,
              job,
              result.body,
              result.latencyMs,
            );
          }
          const baseErrorSnippet = finalSuccess
            ? undefined
            : result.body.slice(0, 500);
          const errorMessage =
            finalSuccess || (!baseErrorSnippet && !appErrorMessage)
              ? undefined
              : appErrorMessage ||
                (attempts > 1
                  ? `${baseErrorSnippet} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`
                  : baseErrorSnippet);

          upsertCheckpoint(db, {
            filePath: job.filePath,
            relativePath: job.relativePath,
            brand: job.brand,
            purchaser: job.purchaser,
            status,
            startedAt: started,
            finishedAt: new Date().toISOString(),
            latencyMs: result.latencyMs,
            statusCode: result.statusCode,
            errorMessage,
            patternKey,
            runId: runIdToUse,
          });

          if (status === "error") {
            failures.push({
              filePath: job.filePath,
              brand: job.brand,
              purchaser: job.purchaser,
              patternKey,
              errorMessage,
              statusCode: result.statusCode,
            });
          }
        } catch (err) {
          if (err instanceof NetworkAbortError) {
            aborted = true;
            queue.clear(); // remove pending jobs
            if (stdoutPiped) {
              process.stdout.write(
                `LOG\tNetwork interruption detected. Execution stopping. Resume later.\n`,
              );
            }
            // Mark this current file as error/interrupted if needed, or leave as running?
            // Best to mark as error so it can be picked up later? Or delete the running state?
            // Since we have "running" checkpoint, if we leave it, Resume will retry it.
            // But let's actally mark it as error so user knows why it stopped.
            upsertCheckpoint(db, {
              filePath: job.filePath,
              relativePath: job.relativePath,
              brand: job.brand,
              purchaser: job.purchaser,
              status: "error",
              startedAt: started,
              finishedAt: new Date().toISOString(),
              errorMessage:
                typeof err.message === "string" ? err.message : "Network Abort",
              runId: runIdToUse,
            });
            return;
          }
          throw err;
        }
      })
      .finally(() => {
        done++;
        updateProgress();
        try {
          options?.onFileComplete?.(runIdToUse);
        } catch (_) {}
      });
  }

  if (isTTY && total > 0) updateProgress();
  await queue.onIdle();

  if (isTTY && total > 0) {
    process.stdout.write("\r" + " ".repeat(60) + "\r");
  }
  const finishedAt = new Date();
  const records = getRecordsForRun(db, runIdToUse);
  const metrics = computeMetrics(runIdToUse, records, startedAt, finishedAt);

  // Send consolidated failure email if any failures occurred
  if (failures.length > 0) {
    void sendConsolidatedFailureEmail(runIdToUse, failures, metrics);
  }

  const cumStats = getCumulativeStats(db, {
    tenant: options?.tenant,
    purchaser: options?.purchaser,
  });
  const isPiped =
    typeof process !== "undefined" && process.stdout?.isTTY !== true;
  if (isPiped) {
    process.stdout.write(
      `CUMULATIVE_METRICS\tsuccess=${cumStats.success},failed=${cumStats.failed},total=${cumStats.total}\n`,
    );
  }

  closeRequestResponseLogger();
  closeCheckpointDb(db);
  return { runId: runIdToUse, records, startedAt, finishedAt };
}
