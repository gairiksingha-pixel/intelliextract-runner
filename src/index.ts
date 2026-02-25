#!/usr/bin/env node
/**
 * IntelliExtract Runner – CLI
 * Refactored to use Clean Architecture Use Cases.
 */

import { program } from "commander";
import { loadConfig, getConfigPath } from "./config.js";
import { Config } from "./core/domain/entities/Config.js";
import { SqliteCheckpointRepository } from "./infrastructure/database/SqliteCheckpointRepository.js";
import { SqliteSyncRepository } from "./infrastructure/database/SqliteSyncRepository.js";
import { SyncBrandUseCase } from "./core/use-cases/SyncBrandUseCase.js";
import { RunExtractionUseCase } from "./core/use-cases/RunExtractionUseCase.js";
import { ReportingUseCase } from "./core/use-cases/ReportingUseCase.js";
import { AwsS3Service } from "./infrastructure/services/AwsS3Service.js";
import { IntelliExtractService } from "./infrastructure/services/IntelliExtractService.js";
import { JsonLogger } from "./infrastructure/services/JsonLogger.js";
import { DiscoverFilesUseCase } from "./core/use-cases/DiscoverFilesUseCase.js";
import { RunStatusStore } from "./infrastructure/services/RunStatusStore.js";
import {
  buildSummary,
  writeReportsForRunId,
} from "./adapters/presenters/report.js";
import { join } from "node:path";

const EXTRACTIONS_DIR = join(process.cwd(), "output", "extractions");
const STAGING_DIR = join(process.cwd(), "output", "staging");

program
  .name("intelliextract-runner")
  .description("IntelliExtract CLI - Clean Architecture Edition")
  .option("-c, --config <path>", "Config file path", getConfigPath());

// Shared filters
type TenantPurchaserPair = { tenant: string; purchaser: string };
function parsePairs(
  pairsJson: string | undefined,
): TenantPurchaserPair[] | undefined {
  if (!pairsJson) return undefined;
  try {
    return JSON.parse(pairsJson);
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
  if (tenant && purchaser) {
    return config.s3.buckets.filter(
      (b) => b.tenant === tenant && b.purchaser === purchaser,
    );
  }
  return config.s3.buckets;
}

program
  .command("sync")
  .description("Sync S3 bucket to staging")
  .option("--limit <n>", "Max files to download", Number.parseInt)
  .option("--tenant <name>", "Tenant filter")
  .option("--purchaser <name>", "Purchaser filter")
  .option("--pairs <json>", "JSON pairs filter")
  .action(async (opts) => {
    const config = loadConfig(program.opts().config);
    const syncRepo = new SqliteSyncRepository(config.run.checkpointPath);
    const checkpointRepo = new SqliteCheckpointRepository(
      config.run.checkpointPath,
    );
    await checkpointRepo.initialize();
    const s3Service = new AwsS3Service(config.s3.region, syncRepo);
    const syncUseCase = new SyncBrandUseCase(s3Service, syncRepo);

    const buckets = filterBuckets(
      config,
      opts.tenant,
      opts.purchaser,
      parsePairs(opts.pairs),
    );

    console.log(`Starting sync for ${buckets.length} bucket configs...`);
    const results = await syncUseCase.execute({
      buckets,
      stagingDir: STAGING_DIR,
      limit: opts.limit,
      onProgress: (done, total) => {
        process.stdout.write(`\rProgress: ${done}/${total}`);
      },
    });
    console.log("\nSync completed.");
    console.table(
      results.map((r) => ({
        brand: r.brand,
        synced: r.synced,
        skipped: r.skipped,
        errors: r.errors,
      })),
    );
  });

program
  .command("run")
  .description("Run extraction")
  .option("--no-sync", "Skip sync")
  .option("--sync-limit <n>", "Sync limit", Number.parseInt)
  .option("--concurrency <n>", "Concurrency", Number.parseInt)
  .option("--rps <n>", "Requests per second", Number.parseInt)
  .option("--tenant <name>", "Tenant filter")
  .option("--purchaser <name>", "Purchaser filter")
  .option("--pairs <json>", "JSON pairs filter")
  .action(async (opts) => {
    const config = loadConfig(program.opts().config);
    const checkpointRepo = new SqliteCheckpointRepository(
      config.run.checkpointPath,
    );
    await checkpointRepo.initialize();
    const syncRepo = new SqliteSyncRepository(config.run.checkpointPath);
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
    );

    const runId = await checkpointRepo.startNewRun();
    console.log(`Starting Run: ${runId}`);

    let filesToExtract: any[] = [];

    if (opts.sync) {
      const s3Service = new AwsS3Service(config.s3.region, syncRepo);
      const syncUseCase = new SyncBrandUseCase(s3Service, syncRepo);
      const buckets = filterBuckets(
        config,
        opts.tenant,
        opts.purchaser,
        parsePairs(opts.pairs),
      );
      console.log("Syncing...");
      const syncResults = await syncUseCase.execute({
        buckets,
        stagingDir: STAGING_DIR,
        limit: opts.syncLimit,
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
    }

    if (filesToExtract.length === 0) {
      console.log("Discovering files...");
      const pairs =
        parsePairs(opts.pairs) ||
        (opts.tenant && opts.purchaser
          ? [{ brand: opts.tenant, purchaser: opts.purchaser }]
          : undefined);
      filesToExtract = discoverFiles.execute({
        stagingDir: STAGING_DIR,
        pairs: pairs
          ? pairs.map((p) => ({
              brand: (p as any).tenant || (p as any).brand,
              purchaser: p.purchaser,
            }))
          : undefined,
      });
    }

    console.log(`Extracting ${filesToExtract.length} files...`);
    await runExtraction.execute({
      files: filesToExtract,
      runId,
      concurrency: opts.concurrency || config.run.concurrency,
      requestsPerSecond: opts.rps || config.run.requestsPerSecond,
      onProgress: (done, total) => {
        process.stdout.write(`\rProgress: ${done}/${total}`);
      },
    });

    console.log("\nExtraction completed. Generating report...");
    await writeReportsForRunId(config, runId);
    console.log("Report generated.");
  });

program
  .command("report")
  .description("Generate report for a run")
  .option("--run-id <id>", "Run ID")
  .action(async (opts) => {
    const config = loadConfig(program.opts().config);
    const checkpointRepo = new SqliteCheckpointRepository(
      config.run.checkpointPath,
    );
    await checkpointRepo.initialize();
    const runId = opts.runId || (await checkpointRepo.getCurrentRunId());
    if (!runId) {
      console.error("No run ID specified and no current run found.");
      process.exit(1);
    }
    console.log(`Generating report for ${runId}...`);
    await writeReportsForRunId(config, runId);
    console.log("Done.");
  });

program.parse();
