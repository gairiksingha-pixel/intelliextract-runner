/**
 * Load engine: run extraction with configurable concurrency and optional rate limiting.
 * Uses p-queue for concurrency and requests-per-second cap.
 */

import PQueue from 'p-queue';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import type { Config, CheckpointRecord, S3BucketConfig } from './types.js';
import { extract, getExtractUploadUrl } from './api-client.js';
import { openCheckpointDb, getOrCreateRunId, getCompletedPaths, upsertCheckpoint, getRecordsForRun, closeCheckpointDb } from './checkpoint.js';
import { initRequestResponseLogger, logRequestResponse, closeRequestResponseLogger } from './logger.js';
import { getStagingSubdir } from './s3-sync.js';

export interface FileJob {
  filePath: string;
  relativePath: string;
  brand: string;
}

export interface LoadEngineResult {
  runId: string;
  records: CheckpointRecord[];
  startedAt: Date;
  finishedAt: Date;
}

function discoverStagingFiles(stagingDir: string, buckets: S3BucketConfig[]): FileJob[] {
  const jobs: FileJob[] = [];
  for (const bucket of buckets) {
    const subdir = getStagingSubdir(bucket);
    const brandDir = join(stagingDir, subdir);
    if (!existsSync(brandDir)) continue;
    const walk = (dir: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        const rel = relative(brandDir, full);
        if (e.isDirectory()) walk(full);
        else {
          const parentName = basename(dir);
          const fileBase = basename(full, extname(full));
          if (parentName === fileBase) continue;
          jobs.push({ filePath: full, relativePath: rel, brand: bucket.name });
        }
      }
    };
    walk(brandDir);
  }
  return jobs;
}

/** Per-file output dir under staging: staging/.../brand/purchaser/<file-basename-no-ext>/ */
export function getExtractionOutputDir(filePath: string): string {
  return join(dirname(filePath), basename(filePath, extname(filePath)));
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Write extraction response and per-file reports under staging/.../brand/purchaser/<file-name>/ */
function writeExtractionResult(
  config: Config,
  runId: string,
  job: FileJob,
  responseBody: string
): string | null {
  try {
    const fileOutputDir = getExtractionOutputDir(job.filePath);
    mkdirSync(fileOutputDir, { recursive: true });
    let data: unknown;
    try {
      data = JSON.parse(responseBody);
    } catch {
      data = { raw: responseBody.slice(0, 10000) };
    }
    const jsonStr = JSON.stringify(data, null, 2);
    writeFileSync(join(fileOutputDir, 'response.json'), jsonStr, 'utf-8');
    const fileLabel = basename(job.filePath);
    writeFileSync(
      join(fileOutputDir, 'report.md'),
      `# Extraction: ${fileLabel}\n\n**Run ID:** ${runId}\n\n## Response\n\n\`\`\`json\n${jsonStr}\n\`\`\`\n`,
      'utf-8'
    );
    writeFileSync(
      join(fileOutputDir, 'report.json'),
      JSON.stringify({ filePath: job.filePath, runId, response: data }, null, 2),
      'utf-8'
    );
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Extraction: ${escapeHtml(fileLabel)}</title><style>body{font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem;} pre{background:#f8f8f8;padding:1rem;overflow:auto;}</style></head><body><h1>Extraction: ${escapeHtml(fileLabel)}</h1><p><strong>Run ID:</strong> ${escapeHtml(runId)}</p><h2>Response</h2><pre>${escapeHtml(jsonStr)}</pre></body></html>`;
    writeFileSync(join(fileOutputDir, 'report.html'), html, 'utf-8');
    const destFile = join(fileOutputDir, basename(job.filePath));
    if (existsSync(job.filePath)) renameSync(job.filePath, destFile);
    return fileOutputDir;
  } catch {
    return null;
  }
}

/**
 * Run extraction against all staging files with concurrency and optional rate limit.
 * Checkpoints each file so the run can be resumed.
 * @param options.extractLimit - Max number of files to process (0 = no limit). Overrides config when set from CLI.
 * @param options.tenant - When set with purchaser, only process files for this tenant/purchaser.
 * @param options.purchaser - When set with tenant, only process files for this tenant/purchaser.
 */
export async function runExtraction(
  config: Config,
  options?: { extractLimit?: number; tenant?: string; purchaser?: string }
): Promise<LoadEngineResult> {
  const db = openCheckpointDb(config.run.checkpointPath);
  const runId = getOrCreateRunId(db);
  const completed = config.run.skipCompleted ? getCompletedPaths(db, runId) : new Set<string>();
  initRequestResponseLogger(config, runId);

  const buckets =
    options?.tenant && options?.purchaser
      ? config.s3.buckets.filter(
          (b) => b.tenant === options.tenant && b.purchaser === options.purchaser
        )
      : config.s3.buckets;
  const jobs = discoverStagingFiles(config.s3.stagingDir, buckets);
  let toProcess = jobs.filter((j) => !completed.has(j.filePath));
  const extractLimit = options?.extractLimit;
  if (extractLimit !== undefined && extractLimit > 0) {
    toProcess = toProcess.slice(0, extractLimit);
  }
  const concurrency = config.run.concurrency;
  const intervalCap = config.run.requestsPerSecond > 0 ? config.run.requestsPerSecond : undefined;
  const queueOptions: { concurrency: number; interval?: number; intervalCap?: number } = { concurrency };
  if (intervalCap != null) {
    queueOptions.interval = 1000;
    queueOptions.intervalCap = intervalCap;
  }
  const queue = new PQueue(queueOptions);
  const startedAt = new Date();
  const total = toProcess.length;
  let done = 0;
  const isTTY = typeof process !== 'undefined' && process.stdout?.isTTY === true;
  const barWidth = 24;

  function updateProgress(): void {
    if (!isTTY || total === 0) return;
    const pct = total === 0 ? 100 : Math.min(100, Math.round((100 * done) / total));
    const filled = Math.round((barWidth * done) / total);
    const bar = '='.repeat(filled) + ' '.repeat(barWidth - filled);
    process.stdout.write(`\rExtraction: [${bar}] ${pct}% (${done}/${total})`);
  }

  for (const job of toProcess) {
    queue.add(async () => {
      const started = new Date().toISOString();
      upsertCheckpoint(db, {
        filePath: job.filePath,
        relativePath: job.relativePath,
        brand: job.brand,
        status: 'running',
        startedAt: started,
        runId,
      });

      let bodyBase64: string | undefined;
      try {
        bodyBase64 = readFileSync(job.filePath, { encoding: 'base64' });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        upsertCheckpoint(db, {
          filePath: job.filePath,
          relativePath: job.relativePath,
          brand: job.brand,
          status: 'error',
          startedAt: started,
          finishedAt: new Date().toISOString(),
          errorMessage: `Read file: ${errMsg}`,
          runId,
        });
        return;
      }

      const result = await extract(config, {
        filePath: job.filePath,
        fileContentBase64: bodyBase64,
        brand: job.brand,
      });

      logRequestResponse({
        runId,
        filePath: job.filePath,
        brand: job.brand,
        request: {
          method: 'POST',
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

      const status = result.success ? 'done' : 'error';
      if (result.success && result.body) {
        writeExtractionResult(config, runId, job, result.body);
      }
      upsertCheckpoint(db, {
        filePath: job.filePath,
        relativePath: job.relativePath,
        brand: job.brand,
        status,
        startedAt: started,
        finishedAt: new Date().toISOString(),
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        errorMessage: result.success ? undefined : result.body.slice(0, 500),
        runId,
      });
    }).finally(() => {
      done++;
      updateProgress();
    });
  }

  if (isTTY && total > 0) updateProgress();
  await queue.onIdle();
  if (isTTY && total > 0) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }
  const finishedAt = new Date();
  const records = getRecordsForRun(db, runId);
  closeRequestResponseLogger();
  closeCheckpointDb(db);
  return { runId, records, startedAt, finishedAt };
}
