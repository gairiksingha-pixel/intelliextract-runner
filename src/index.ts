#!/usr/bin/env node
/**
 * IntelliExtract Runner – CLI
 * Commands: sync | run | sync-extract | report
 */

import { program } from "commander";
import {
  loadConfig,
  getConfigPath,
} from "./infrastructure/utils/ConfigUtils.js";
import { Config } from "./core/domain/entities/Config.js";
import { SqliteCheckpointRepository } from "./infrastructure/database/SqliteCheckpointRepository.js";
import { SqliteSyncRepository } from "./infrastructure/database/SqliteSyncRepository.js";
import { SyncBrandUseCase } from "./core/use-cases/SyncBrandUseCase.js";
import { RunExtractionUseCase } from "./core/use-cases/RunExtractionUseCase.js";
import { AwsS3Service } from "./infrastructure/services/AwsS3Service.js";
import { IntelliExtractService } from "./infrastructure/services/IntelliExtractService.js";
import { JsonLogger } from "./infrastructure/services/JsonLogger.js";
import { DiscoverFilesUseCase } from "./core/use-cases/DiscoverFilesUseCase.js";
import { NodemailerEmailService } from "./infrastructure/services/NodemailerEmailService.js";
import {
  buildSummary,
  writeReports,
  writeReportsForRunId,
} from "./adapters/presenters/report.js";
import { computeMetrics } from "./infrastructure/utils/MetricsUtils.js";
import { join, dirname } from "node:path";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import PQueue from "p-queue";
import {
  clearPartialFileAndResumeState,
  saveResumeState,
} from "./infrastructure/utils/ResumeUtils.js";

const EXTRACTIONS_DIR = join(process.cwd(), "output", "extractions");
const STAGING_DIR = join(process.cwd(), "output", "staging");

// Graceful SIGTERM (needed for ProcessOrchestrator stop signal)
process.on("SIGTERM", () => process.exit(143));

const LAST_RUN_FILE = "last-run-id.txt";
function getLastRunIdPath(checkpointPath: string): string {
  return join(dirname(checkpointPath), LAST_RUN_FILE);
}
function saveLastRunId(checkpointPath: string, runId: string): void {
  try {
    writeFileSync(getLastRunIdPath(checkpointPath), runId, "utf-8");
  } catch (_) {}
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

type TenantPurchaserPair = { tenant: string; purchaser: string };

function parsePairs(
  pairsJson: string | undefined,
): TenantPurchaserPair[] | undefined {
  if (!pairsJson) return undefined;
  try {
    const arr = JSON.parse(pairsJson) as unknown;
    if (!Array.isArray(arr)) return undefined;
    return arr.filter(
      (x): x is TenantPurchaserPair =>
        x != null &&
        typeof x === "object" &&
        typeof (x as TenantPurchaserPair).tenant === "string" &&
        typeof (x as TenantPurchaserPair).purchaser === "string",
    );
  } catch {
    return undefined;
  }
}

function filterBuckets(
  config: Config,
  tenant?: string,
  purchaser?: string,
  pairs?: TenantPurchaserPair[],
) {
  if (pairs && pairs.length > 0) {
    const set = new Set(pairs.map((p) => `${p.tenant}\0${p.purchaser}`));
    return config.s3.buckets.filter(
      (b) => b.tenant && b.purchaser && set.has(`${b.tenant}\0${b.purchaser}`),
    );
  }
  if (tenant || purchaser) {
    return config.s3.buckets.filter((b) => {
      const matchTenant = !tenant || b.tenant === tenant;
      const matchPurchaser = !purchaser || b.purchaser === purchaser;
      return matchTenant && matchPurchaser;
    });
  }
  return config.s3.buckets;
}

function validateTenantPurchaser(
  tenant?: string,
  purchaser?: string,
  pairs?: TenantPurchaserPair[],
): void {
  // Relaxed: allow single filters
}

const stdoutPiped = !process.stdout.isTTY;

// ─── sync ─────────────────────────────────────────────────────────────────────

program
  .name("intelliextract-runner")
  .description("IntelliExtract CLI - Clean Architecture Edition")
  .option("-c, --config <path>", "Config file path", getConfigPath());

program
  .command("sync")
  .description("Sync S3 bucket (tenant/purchaser folders) to staging")
  .option(
    "--limit <n>",
    "Max new files to download (skipped unchanged do not count)",
    Number.parseInt,
  )
  .option("--tenant <name>", "Sync only this tenant (requires --purchaser)")
  .option("--purchaser <name>", "Sync only this purchaser (requires --tenant)")
  .option("--pairs <json>", "JSON array of {tenant, purchaser} pairs")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const pairs = parsePairs(opts.pairs);
      validateTenantPurchaser(opts.tenant, opts.purchaser, pairs);

      const syncRepo = new SqliteSyncRepository(config.run.checkpointPath);
      const s3Service = new AwsS3Service(config.s3.region, syncRepo);
      const syncUseCase = new SyncBrandUseCase(s3Service, syncRepo);

      const buckets = filterBuckets(config, opts.tenant, opts.purchaser, pairs);
      if (buckets.length === 0) {
        console.error(
          pairs?.length
            ? "No bucket config matches the given --pairs."
            : `No bucket config for tenant "${opts.tenant}" / purchaser "${opts.purchaser}".`,
        );
        process.exit(1);
      }

      const syncLimit =
        opts.limit === undefined || Number.isNaN(opts.limit)
          ? undefined
          : opts.limit;
      const syncLimitNum =
        syncLimit !== undefined && syncLimit > 0 ? syncLimit : 0;
      if (stdoutPiped)
        process.stdout.write(`SYNC_PROGRESS\t0\t${syncLimitNum}\n`);

      const results = await syncUseCase.execute({
        buckets,
        stagingDir: STAGING_DIR,
        limit: syncLimit,
        onProgress: (done, total) => {
          if (stdoutPiped)
            process.stdout.write(`SYNC_PROGRESS\t${done}\t${total}\n`);
        },
      });

      const totalSynced = results.reduce((s, r) => s + r.synced, 0);
      const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
      const totalErrors = results.reduce((s, r) => s + r.errors, 0);
      console.log(
        `\nSync Summary — Downloaded: ${totalSynced}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`,
      );
      for (const r of results) {
        console.log(
          `  ${r.brand}/${r.purchaser}: synced=${r.synced} skipped=${r.skipped} errors=${r.errors}`,
        );
      }
    } catch (e) {
      console.error("Sync failed:", e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

// ─── run ──────────────────────────────────────────────────────────────────────

program
  .command("run")
  .description("Run extraction against staging files (with optional S3 sync)")
  .option("--no-sync", "Skip S3 sync; use existing staging files")
  .option("--no-report", "Do not write report after run")
  .option("--sync-limit <n>", "Max new files to sync", Number.parseInt)
  .option(
    "--extract-limit <n>",
    "Max files to extract (0 = no limit)",
    Number.parseInt,
  )
  .option("--concurrency <n>", "Extraction concurrency", Number.parseInt)
  .option("--rps <n>", "Requests per second", Number.parseInt)
  .option("--tenant <name>", "Run only for this tenant (requires --purchaser)")
  .option(
    "--purchaser <name>",
    "Run only for this purchaser (requires --tenant)",
  )
  .option("--pairs <json>", "JSON array of {tenant, purchaser} pairs")
  .option("-r, --run-id <id>", "Resume with existing run ID")
  .option("--retry-failed", "Only retry files with status 'error'")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const pairs = parsePairs(opts.pairs);
      const tenant = !pairs?.length ? opts.tenant?.trim() : undefined;
      const purchaser = !pairs?.length ? opts.purchaser?.trim() : undefined;
      validateTenantPurchaser(tenant, purchaser, pairs);

      const doReport = opts.report !== false;
      const syncLimit =
        opts.syncLimit === undefined || Number.isNaN(opts.syncLimit)
          ? undefined
          : opts.syncLimit;
      const extractLimit =
        opts.extractLimit === undefined || Number.isNaN(opts.extractLimit)
          ? undefined
          : opts.extractLimit;

      const checkpointRepo = new SqliteCheckpointRepository(
        config.run.checkpointPath,
      );
      await checkpointRepo.initialize();
      const syncRepo = new SqliteSyncRepository(config.run.checkpointPath);
      const emailService = new NodemailerEmailService(checkpointRepo);
      const logger = new JsonLogger(
        config.logging.dir,
        config.logging.requestResponseLog,
      );
      const extractionService = new IntelliExtractService(
        config,
        EXTRACTIONS_DIR,
      );
      const discoverFiles = new DiscoverFilesUseCase();
      const runExtraction = new RunExtractionUseCase(
        extractionService,
        checkpointRepo,
        logger,
        emailService,
      );

      const runId = opts.runId || (await checkpointRepo.startNewRun());
      if (stdoutPiped) process.stdout.write(`RUN_ID\t${runId}\n`);
      console.log(`Starting Run: ${runId}`);

      let filesToExtract: any[] = [];

      if (opts.sync !== false) {
        const s3Service = new AwsS3Service(config.s3.region, syncRepo);
        const syncUseCase = new SyncBrandUseCase(s3Service, syncRepo);
        const buckets = filterBuckets(config, tenant, purchaser, pairs);
        const syncLimitNum =
          syncLimit !== undefined && syncLimit > 0 ? syncLimit : 0;
        if (stdoutPiped)
          process.stdout.write(`SYNC_PROGRESS\t0\t${syncLimitNum}\n`);
        console.log("Syncing...");

        const syncResults = await syncUseCase.execute({
          buckets,
          stagingDir: STAGING_DIR,
          limit: syncLimit,
          onProgress: (done, total) => {
            if (stdoutPiped)
              process.stdout.write(`SYNC_PROGRESS\t${done}\t${total}\n`);
          },
        });

        for (const res of syncResults) {
          filesToExtract.push(
            ...res.files.map((f) => ({
              filePath: f,
              relativePath: f.split("staging")[1] || f,
              brand: res.brand,
              purchaser: res.purchaser,
            })),
          );
        }
        const totalSynced = syncResults.reduce((s, r) => s + r.synced, 0);
        const totalSkipped = syncResults.reduce((s, r) => s + r.skipped, 0);
        console.log(
          `Sync complete — Downloaded: ${totalSynced}, Skipped: ${totalSkipped}`,
        );
      }

      if (filesToExtract.length === 0) {
        console.log("Discovering files in staging...");
        let resolvedPairs = pairs?.map((p) => ({
          brand: p.tenant,
          purchaser: p.purchaser,
        }));
        if (!resolvedPairs && (tenant || purchaser)) {
          // Resolve pairs from filesystem if only one filter is provided
          resolvedPairs = [];
          const brands = existsSync(STAGING_DIR)
            ? readdirSync(STAGING_DIR)
            : [];
          for (const b of brands) {
            if (tenant && b !== tenant) continue;
            const bPath = join(STAGING_DIR, b);
            if (!statSync(bPath).isDirectory()) continue;
            const purchasers = readdirSync(bPath);
            for (const p of purchasers) {
              if (purchaser && p !== purchaser) continue;
              if (statSync(join(bPath, p)).isDirectory()) {
                resolvedPairs.push({ brand: b, purchaser: p });
              }
            }
          }
        }

        filesToExtract = discoverFiles.execute({
          stagingDir: STAGING_DIR,
          pairs: resolvedPairs,
        });
      }

      if (extractLimit && extractLimit > 0) {
        filesToExtract = filesToExtract.slice(0, extractLimit);
      }

      if (stdoutPiped)
        process.stdout.write(
          `EXTRACTION_PROGRESS\t0\t${filesToExtract.length}\n`,
        );
      console.log(`Extracting ${filesToExtract.length} files...`);

      await runExtraction.execute({
        files: filesToExtract,
        runId,
        concurrency: opts.concurrency || config.run.concurrency,
        requestsPerSecond: opts.rps || config.run.requestsPerSecond,
        retryFailed: opts.retryFailed,
        filter: tenant && purchaser ? { tenant, purchaser } : undefined,
        onProgress: (done, total) => {
          if (stdoutPiped)
            process.stdout.write(`EXTRACTION_PROGRESS\t${done}\t${total}\n`);
          else process.stdout.write(`\rProgress: ${done}/${total}`);
        },
      });

      console.log("\nExtraction completed.");
      saveLastRunId(config.run.checkpointPath, runId);

      if (doReport) {
        console.log("Generating report...");
        await writeReportsForRunId(checkpointRepo, config, runId);
        console.log(`Reports path: ${config.report.outputDir}`);
      }
    } catch (e) {
      console.error("Run failed:", e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

// ─── sync-extract (pipeline mode) ────────────────────────────────────────────

program
  .command("sync-extract")
  .description(
    "Pipeline: sync up to N files; as each is synced, extract it immediately in the background.",
  )
  .option(
    "--limit <n>",
    "Max files to sync (and extract). Each synced file is extracted automatically.",
    Number.parseInt,
  )
  .option("--resume", "Resume from last run: continue with same run ID")
  .option(
    "--tenant <name>",
    "Sync/extract only for this tenant (requires --purchaser)",
  )
  .option(
    "--purchaser <name>",
    "Sync/extract only for this purchaser (requires --tenant)",
  )
  .option("--pairs <json>", "JSON array of {tenant, purchaser} pairs")
  .option("--no-report", "Do not write report after run")
  .option("-r, --run-id <id>", "Specify run ID (for resume)")
  .option("--retry-failed", "Only retry files that previously failed")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const pairs = parsePairs(opts.pairs);
      const tenant = !pairs?.length ? opts.tenant?.trim() : undefined;
      const purchaser = !pairs?.length ? opts.purchaser?.trim() : undefined;
      validateTenantPurchaser(tenant, purchaser, pairs);

      const doReport = opts.report !== false;
      const limit =
        opts.limit === undefined || Number.isNaN(opts.limit)
          ? undefined
          : opts.limit;
      const limitNum = limit !== undefined && limit > 0 ? limit : 0;

      const checkpointRepo = new SqliteCheckpointRepository(
        config.run.checkpointPath,
      );
      await checkpointRepo.initialize();
      const syncRepo = new SqliteSyncRepository(config.run.checkpointPath);
      const emailService = new NodemailerEmailService(checkpointRepo);
      const logger = new JsonLogger(
        config.logging.dir,
        config.logging.requestResponseLog,
      );
      const extractionService = new IntelliExtractService(
        config,
        EXTRACTIONS_DIR,
      );

      // Resolve run ID (resume or fresh)
      const runId =
        opts.runId ||
        (opts.resume ? await checkpointRepo.getCurrentRunId() : null) ||
        (await checkpointRepo.startNewRun());

      if (stdoutPiped) {
        process.stdout.write(`SYNC_PROGRESS\t0\t${limitNum}\n`);
        process.stdout.write(`RUN_ID\t${runId}\n`);
        process.stdout.write(`EXTRACTION_PROGRESS\t0\t0\n`);
      }

      if (opts.resume) {
        clearPartialFileAndResumeState(config);
      } else {
        clearPartialFileAndResumeState(config);
      }

      if (pairs?.length) console.log(`Scoped to ${pairs.length} pair(s).`);
      else if (tenant && purchaser)
        console.log(`Scoped to tenant: ${tenant}, purchaser: ${purchaser}`);

      // Global skipping logic (across all runs) vs Run-specific resume logic
      const globalCompleted = config.run.skipCompleted
        ? await checkpointRepo.getCompletedPaths()
        : new Set<string>();

      const runCompleted = await checkpointRepo.getCompletedPaths(runId);
      const runRecords = await checkpointRepo.getRecordsForRun(runId);

      if (opts.resume && runCompleted.size > 0) {
        if (stdoutPiped)
          process.stdout.write(
            `RESUME_SKIP\t${runCompleted.size}\t${runRecords.length}\n`,
          );
      }

      const concurrency = config.run.concurrency || 5;
      const extractionQueue = new PQueue({ concurrency });
      let extractionQueued = 0;
      let extractionDone = 0;
      let aborted = false;
      const startTime = new Date();
      const failures: any[] = [];
      logger.init(runId);

      const s3Service = new AwsS3Service(config.s3.region, syncRepo);
      const syncUseCase = new SyncBrandUseCase(s3Service, syncRepo);
      const buckets = filterBuckets(config, tenant, purchaser, pairs);

      await syncUseCase.execute({
        buckets,
        stagingDir: STAGING_DIR,
        limit: limit,
        alreadyExtractedPaths: globalCompleted,
        onStartDownload: (destPath, manifestKey) => {
          saveResumeState(config, {
            syncInProgressPath: destPath,
            syncInProgressManifestKey: manifestKey,
          });
        },
        onProgress: (done, total) => {
          if (stdoutPiped)
            process.stdout.write(`SYNC_PROGRESS\t${done}\t${total}\n`);
        },
        onSyncSkipProgress: (skipped, totalProcessed) => {
          if (stdoutPiped)
            process.stdout.write(
              `RESUME_SKIP_SYNC\t${skipped}\t${totalProcessed}\n`,
            );
        },
        onFileSynced: (job) => {
          if (aborted) return;
          if (globalCompleted.has(job.filePath)) {
            extractionDone++;
            if (stdoutPiped) {
              process.stdout.write(
                `RESUME_SKIP_SYNC\t${extractionDone}\t${++extractionQueued}\n`,
              );
              process.stdout.write(
                `EXTRACTION_PROGRESS\t${extractionDone}\t${extractionQueued}\n`,
              );
            }
            return;
          }
          extractionQueued++;
          extractionQueue.add(async () => {
            if (aborted) return;
            try {
              const startedAt = new Date().toISOString();
              await checkpointRepo.upsertCheckpoint({
                ...job,
                status: "running",
                startedAt,
                runId,
              } as any);
              const result = await extractionService.extractFile(
                job.filePath,
                job.brand,
                job.purchaser,
                runId,
                job.relativePath,
              );
              await checkpointRepo.upsertCheckpoint({
                ...job,
                status: result.success ? "done" : "error",
                startedAt,
                finishedAt: new Date().toISOString(),
                latencyMs: result.latencyMs,
                statusCode: result.statusCode,
                errorMessage: result.errorMessage,
                patternKey: result.patternKey,
                runId,
              } as any);

              if (!result.success) {
                failures.push({ ...job, ...result });
              }

              logger.log({
                runId,
                filePath: job.filePath,
                brand: job.brand,
                request: { method: "POST", url: "/api/extract" },
                response: {
                  statusCode: result.statusCode || 200,
                  latencyMs: result.latencyMs || 0,
                  bodyLength: 0,
                },
                success: result.success,
              });
              if (doReport) {
                try {
                  await writeReportsForRunId(checkpointRepo, config, runId);
                } catch (_) {}
              }
            } catch (err: any) {
              if (err?.message?.includes("Network")) {
                aborted = true;
                extractionQueue.clear();
                if (stdoutPiped)
                  process.stdout.write(
                    "LOG\tNetwork interruption detected. Execution stopping. Resume later.\n",
                  );
                return;
              }
              failures.push({ ...job, errorMessage: err.message });
              await checkpointRepo.upsertCheckpoint({
                ...job,
                status: "error",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                errorMessage: err.message || String(err),
                runId,
              } as any);
            } finally {
              extractionDone++;
              if (stdoutPiped)
                process.stdout.write(
                  `EXTRACTION_PROGRESS\t${extractionDone}\t${extractionQueued}\n`,
                );
            }
          });
        },
      });

      await extractionQueue.onIdle();
      logger.close();

      const records = await checkpointRepo.getRecordsForRun(runId);
      const metrics = computeMetrics(runId, records, startTime, new Date());

      if (failures.length > 0) {
        await emailService.sendConsolidatedFailureEmail(
          runId,
          failures,
          metrics,
        );
      }

      if (stdoutPiped) {
        process.stdout.write(
          `CUMULATIVE_METRICS\tsuccess=${metrics.success},failed=${metrics.failed},total=${metrics.totalFiles}\n`,
        );
      }

      console.log(
        `\nSync-extract complete — success=${metrics.success}, skipped=${metrics.skipped}, failed=${metrics.failed}`,
      );
      saveLastRunId(config.run.checkpointPath, runId);

      if (doReport) {
        const summary = buildSummary(metrics);
        await writeReports(checkpointRepo, config, summary);
        console.log(`Reports path: ${config.report.outputDir}`);
      }
    } catch (e) {
      console.error(
        "Sync-extract failed:",
        e instanceof Error ? e.message : String(e),
      );
      process.exit(1);
    }
  });

// ─── report ───────────────────────────────────────────────────────────────────

program
  .command("report")
  .description(
    "Generate executive summary report from last run (or specified run-id)",
  )
  .option("-r, --run-id <id>", "Run ID to report (default: last run)")
  .action(async (opts) => {
    try {
      const config = loadConfig(program.opts().config);
      const checkpointRepo = new SqliteCheckpointRepository(
        config.run.checkpointPath,
      );
      await checkpointRepo.initialize();

      let runId = opts.runId;
      if (!runId) {
        const lastPath = getLastRunIdPath(config.run.checkpointPath);
        if (existsSync(lastPath)) {
          runId = readFileSync(lastPath, "utf-8").trim();
        } else {
          runId = await checkpointRepo.getCurrentRunId();
        }
      }
      if (!runId) {
        console.error(
          'No run ID found. Run "run" or "sync-extract" first, or pass --run-id.',
        );
        process.exit(1);
      }

      const records = await checkpointRepo.getRecordsForRun(runId);
      if (records.length === 0) {
        console.error(`No records found for run ${runId}`);
        process.exit(1);
      }

      const metrics = computeMetrics(runId, records);
      const summary = buildSummary(metrics);
      await writeReports(checkpointRepo, config, summary);
      console.log(`Reports path: ${config.report.outputDir}`);
    } catch (e) {
      console.error(
        "Report failed:",
        e instanceof Error ? e.message : String(e),
      );
      process.exit(1);
    }
  });

program.parse(process.argv);
