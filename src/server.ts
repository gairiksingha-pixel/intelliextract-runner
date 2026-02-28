#!/usr/bin/env node
import { createServer } from "node:http";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import dotenv from "dotenv";

// Clean Architecture Components
import { SqliteCheckpointRepository } from "./infrastructure/database/sqlite-checkpoint.repository.js";
import { SqliteSyncRepository } from "./infrastructure/database/sqlite-sync.repository.js";
import { SqliteScheduleRepository } from "./infrastructure/database/sqlite-schedule.repository.js";
import { GetExtractionDataUseCase } from "./core/use-cases/get-extraction-data.use-case.js";
import { GetInventoryDataUseCase } from "./core/use-cases/get-inventory-data.use-case.js";
import { SyncBrandUseCase } from "./core/use-cases/sync-brand.use-case.js";
import { RunExtractionUseCase } from "./core/use-cases/run-extraction.use-case.js";
import { ReportingUseCase } from "./core/use-cases/reporting.use-case.js";
import { DiscoverFilesUseCase } from "./core/use-cases/discover-files.use-case.js";
import { DashboardController } from "./adapters/controllers/dashboard.controller.js";
import { ExtractionController } from "./adapters/controllers/extraction.controller.js";
import { ExecuteWorkflowUseCase } from "./core/use-cases/execute-workflow.use-case.js";
import { ScheduleController } from "./adapters/controllers/schedule.controller.js";
import { NodemailerEmailService } from "./infrastructure/services/nodemailer-email.service.js";
import { ReportPageController } from "./adapters/controllers/report-page.controller.js";
import { ReportDataController } from "./adapters/controllers/report-data.controller.js";
import { ProjectController } from "./adapters/controllers/project.controller.js";
import { ExportController } from "./adapters/controllers/export.controller.js";
import { Router } from "./adapters/router.js";

// Infrastructure Services
import { AwsS3Service } from "./infrastructure/services/aws-s3.service.js";
import { IntelliExtractService } from "./infrastructure/services/intelli-extract.service.js";
import { NodemailerService } from "./infrastructure/services/nodemailer.service.js";
import { RunStatusStore } from "./infrastructure/services/run-status-store.service.js";
import { ConfigService } from "./infrastructure/services/config.service.js";
import { SqliteLogger } from "./infrastructure/services/sqlite-logger.service.js";
import { RunStateService } from "./infrastructure/services/run-state.service.js";
import { ProcessOrchestrator } from "./infrastructure/services/process-orchestrator.service.js";
import { CronManager } from "./infrastructure/services/cron-manager.service.js";
import { NodeReportGenerationService } from "./infrastructure/services/node-report-generation.service.js";

// Utilities
import { loadBrandPurchasers } from "./infrastructure/utils/tenant.utils.js";
import { getCaseCommands } from "./infrastructure/utils/command.utils.js";
import { loadStaticAssets } from "./infrastructure/views/constants.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 8767;
const ROOT = resolve(__dirname, "..");
const BRAND_PURCHASERS = loadBrandPurchasers();

// 1. Initialize Configuration and Logging
const configService = new ConfigService();
const appConfig = configService.getConfig();

const REPORTS_DIR = join(ROOT, "output", "reports");
const EXTRACTIONS_DIR = join(ROOT, "output", "extractions");
const STAGING_DIR = join(ROOT, "output", "staging");
const _rawCheckpointPath =
  appConfig.run.checkpointPath ||
  join(ROOT, "output", "checkpoints", "intelliextract.db");
// Always resolve relative to ROOT so the path is absolute regardless of cwd
const CHECKPOINT_PATH = resolve(ROOT, _rawCheckpointPath);

// Ensure required directories exist
[STAGING_DIR, join(CHECKPOINT_PATH, "..")].forEach((dir) =>
  mkdirSync(dir, { recursive: true }),
);

// 2. Initialize Repositories
const checkpointRepo = new SqliteCheckpointRepository(CHECKPOINT_PATH);
await checkpointRepo.initialize();
const syncRepo = new SqliteSyncRepository(CHECKPOINT_PATH);
const scheduleRepo = new SqliteScheduleRepository(CHECKPOINT_PATH);
const logger = new SqliteLogger(checkpointRepo);

// 3. Initialize Use Cases
const getExtractionDataUseCase = new GetExtractionDataUseCase(checkpointRepo);
const getInventoryDataUseCase = new GetInventoryDataUseCase(
  checkpointRepo,
  syncRepo,
  STAGING_DIR,
);
const discoverFilesUseCase = new DiscoverFilesUseCase();
const reportingUseCase = new ReportingUseCase(checkpointRepo);
// 4. Initialize Services
const s3Service = new AwsS3Service(appConfig.s3.region, syncRepo);
const extractionService = new IntelliExtractService(appConfig);
const runStatusStore = new RunStatusStore(new Map());
const notificationService = new NodemailerService(
  await checkpointRepo.getEmailConfig(),
);
const runStateService = new RunStateService(checkpointRepo);

const syncBrandUseCase = new SyncBrandUseCase(s3Service, syncRepo);
const emailService = new NodemailerEmailService(checkpointRepo);
const runExtractionUseCase = new RunExtractionUseCase(
  extractionService,
  checkpointRepo,
  logger,
  emailService,
);

const reportGenerationService = new NodeReportGenerationService(ROOT);

const executeWorkflowUseCase = new ExecuteWorkflowUseCase(
  syncBrandUseCase,
  runExtractionUseCase,
  reportingUseCase,
  discoverFilesUseCase,
  runStatusStore,
  STAGING_DIR,
  reportGenerationService,
  checkpointRepo,
);

const caseCommands = getCaseCommands(ROOT, async () => {
  try {
    return await checkpointRepo.getCurrentRunId();
  } catch (err) {
    console.error("[server] Failed to get current run ID:", err);
    return null;
  }
});
const orchestrator = new ProcessOrchestrator(caseCommands);

const RESUME_CAPABLE_CASES = new Set(["P1", "P2", "PIPE", "P5", "P6"]);

const cronManager = new CronManager(
  orchestrator,
  runStatusStore,
  scheduleRepo,
  runStateService,
  checkpointRepo,
  BRAND_PURCHASERS,
  RESUME_CAPABLE_CASES,
);

// 5. Initialize Controllers
const dashboardController = new DashboardController(
  getExtractionDataUseCase,
  getInventoryDataUseCase,
);
const extractionController = new ExtractionController(
  orchestrator,
  runStatusStore,
  runStateService,
  checkpointRepo,
  RESUME_CAPABLE_CASES,
);

const staticAssets = loadStaticAssets(ROOT);

const scheduleController = new ScheduleController(
  scheduleRepo,
  cronManager,
  checkpointRepo,
);
const reportPageController = new ReportPageController(
  dashboardController,
  checkpointRepo,
  appConfig,
  staticAssets,
  BRAND_PURCHASERS,
);
const reportDataController = new ReportDataController(
  checkpointRepo,
  appConfig,
);
const projectController = new ProjectController(
  dashboardController,
  runStatusStore,
  checkpointRepo,
  runStateService,
  notificationService,
  orchestrator,
  ROOT,
  STAGING_DIR,
  BRAND_PURCHASERS,
  RESUME_CAPABLE_CASES,
  staticAssets,
);

const exportController = new ExportController(
  checkpointRepo,
  ROOT,
  EXTRACTIONS_DIR,
  STAGING_DIR,
  REPORTS_DIR,
);

// 6. Initialize Router
const router = new Router(
  extractionController,
  scheduleController,
  reportPageController,
  reportDataController,
  projectController,
  exportController,
);

// 7. Start the HTTP Server
createServer(async (req, res) => {
  await router.handleRequest(req, res);
}).listen(PORT, () => {
  console.log(`IntelliExtract app: http://localhost:${PORT}/`);
  cronManager.bootstrap();
});
