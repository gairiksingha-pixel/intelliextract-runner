#!/usr/bin/env node
import { createServer } from "node:http";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import dotenv from "dotenv";

// Clean Architecture Components
import { SqliteCheckpointRepository } from "./infrastructure/database/SqliteCheckpointRepository.js";
import { SqliteSyncRepository } from "./infrastructure/database/SqliteSyncRepository.js";
import { SqliteScheduleRepository } from "./infrastructure/database/SqliteScheduleRepository.js";
import { GetExtractionDataUseCase } from "./core/use-cases/GetExtractionDataUseCase.js";
import { GetInventoryDataUseCase } from "./core/use-cases/GetInventoryDataUseCase.js";
import { SyncBrandUseCase } from "./core/use-cases/SyncBrandUseCase.js";
import { RunExtractionUseCase } from "./core/use-cases/RunExtractionUseCase.js";
import { ReportingUseCase } from "./core/use-cases/ReportingUseCase.js";
import { DiscoverFilesUseCase } from "./core/use-cases/DiscoverFilesUseCase.js";
import { DashboardController } from "./adapters/controllers/DashboardController.js";
import { ExtractionController } from "./adapters/controllers/ExtractionController.js";
import { ExecuteWorkflowUseCase } from "./core/use-cases/ExecuteWorkflowUseCase.js";
import { ScheduleController } from "./adapters/controllers/ScheduleController.js";
import { NodemailerEmailService } from "./infrastructure/services/NodemailerEmailService.js";
import { ReportController } from "./adapters/controllers/ReportController.js";
import { ProjectController } from "./adapters/controllers/ProjectController.js";
import { Router } from "./adapters/Router.js";

// Infrastructure Services
import { AwsS3Service } from "./infrastructure/services/AwsS3Service.js";
import { IntelliExtractService } from "./infrastructure/services/IntelliExtractService.js";
import { NodemailerService } from "./infrastructure/services/NodemailerService.js";
import { RunStatusStore } from "./infrastructure/services/RunStatusStore.js";
import { ConfigService } from "./infrastructure/services/ConfigService.js";
import { SqliteLogger } from "./infrastructure/services/SqliteLogger.js";
import { RunStateService } from "./infrastructure/services/RunStateService.js";
import { ProcessOrchestrator } from "./infrastructure/services/ProcessOrchestrator.js";
import { CronManager } from "./infrastructure/services/CronManager.js";

// Utilities
import { loadBrandPurchasers } from "./infrastructure/utils/TenantUtils.js";
import { getCaseCommands } from "./infrastructure/utils/CommandUtils.js";
import { loadStaticAssets } from "./infrastructure/views/Constants.js";

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

const executeWorkflowUseCase = new ExecuteWorkflowUseCase(
  syncBrandUseCase,
  runExtractionUseCase,
  reportingUseCase,
  discoverFilesUseCase,
  runStatusStore,
  STAGING_DIR,
);

const caseCommands = getCaseCommands(ROOT, async () => {
  try {
    return await checkpointRepo.getCurrentRunId();
  } catch (_) {
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
const reportController = new ReportController(
  dashboardController,
  REPORTS_DIR,
  EXTRACTIONS_DIR,
  STAGING_DIR,
  ROOT,
  checkpointRepo,
  appConfig,
  staticAssets,
  BRAND_PURCHASERS,
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

// 6. Initialize Router
const router = new Router(
  extractionController,
  scheduleController,
  reportController,
  projectController,
);

// 7. Start the HTTP Server
createServer(async (req, res) => {
  await router.handleRequest(req, res);
}).listen(PORT, () => {
  console.log(`IntelliExtract app: http://localhost:${PORT}/`);
  cronManager.bootstrap();
});
