import { SyncBrandUseCase } from "./sync-brand.use-case.js";
import { RunExtractionUseCase } from "./run-extraction.use-case.js";
import { ReportingUseCase } from "./reporting.use-case.js";
import { DiscoverFilesUseCase } from "./discover-files.use-case.js";
import { IRunStatusStore } from "../domain/services/run-status-store.service.js";
import { IReportGenerationService } from "../domain/services/report-generation.service.js";
import { IExtractionRecordRepository } from "../domain/repositories/extraction-record.repository.js";
import { relative } from "node:path";
import { normalizeRelativePath } from "../../infrastructure/utils/storage.utils.js";

export type WorkflowCaseId = "PIPE" | "SYNC" | "EXTRACT" | "P1" | "P2";

export interface WorkflowPair {
  tenant: string;
  purchaser: string;
}

export interface WorkflowRequest {
  caseId: WorkflowCaseId | string;
  syncLimit?: number;
  extractLimit?: number;
  tenant?: string;
  purchaser?: string;
  pairs?: WorkflowPair[];
  resume?: boolean;
  concurrency?: number;
  requestsPerSecond?: number;
  skipCompleted?: boolean;
}

export type WorkflowProgressType =
  | "run_id"
  | "log"
  | "progress"
  | "report"
  | "error";
export type WorkflowPhase = "sync" | "extract";
export type WorkflowLogLevel = "info" | "warn" | "error";

export interface WorkflowProgress {
  type: WorkflowProgressType;
  runId?: string;
  message?: string;
  phase?: WorkflowPhase;
  done?: number;
  total?: number;
  percent?: number;
  level?: WorkflowLogLevel;
  [key: string]: unknown;
}

export interface WorkflowFile {
  filePath: string;
  relativePath: string;
  brand: string;
  purchaser?: string;
}

export class ExecuteWorkflowUseCase {
  constructor(
    private syncBrand: SyncBrandUseCase,
    private runExtraction: RunExtractionUseCase,
    private reporting: ReportingUseCase,
    private discoverFiles: DiscoverFilesUseCase,
    private runStatusStore: IRunStatusStore,
    private stagingDir: string,
    private reportGenerationService: IReportGenerationService,
    private recordRepo: IExtractionRecordRepository,
  ) {}

  async execute(
    request: WorkflowRequest,
    onUpdate: (update: WorkflowProgress) => void,
  ) {
    const { caseId, syncLimit, tenant, purchaser, pairs } = request;

    const runId = "RUN-" + Date.now();
    onUpdate({ type: "run_id", runId });

    this.runStatusStore.registerRun({
      caseId,
      runId,
      startTime: new Date().toISOString(),
      origin: "manual",
      status: "running",
      params: { tenant, purchaser, pairs },
    });

    try {
      let filesToExtract: WorkflowFile[] = [];

      // 1. Sync Phase
      if (caseId === "PIPE" || caseId === "SYNC" || caseId === "P1") {
        onUpdate({ type: "log", message: "Starting synchronization..." });

        const syncPairs: WorkflowPair[] =
          pairs || (tenant && purchaser ? [{ tenant, purchaser }] : []);

        for (const pair of syncPairs) {
          const results = await this.syncBrand.execute({
            buckets: [
              {
                bucket: "intelliextract-staging",
                prefix: `${pair.tenant}/`,
                name: pair.tenant,
                purchaser: pair.purchaser,
              },
            ],
            stagingDir: this.stagingDir,
            limit: syncLimit || 0,
            onProgress: (done, total) =>
              onUpdate({
                type: "progress",
                phase: "sync",
                done,
                total,
                percent: Math.round((done / total) * 100),
              }),
          });

          for (const result of results) {
            filesToExtract.push(
              ...result.files.map((f: string) => ({
                filePath: f,
                relativePath: normalizeRelativePath(
                  relative(this.stagingDir, f),
                ),
                brand: pair.tenant,
                purchaser: pair.purchaser,
              })),
            );
          }
        }
      }

      // 2. Extraction Phase
      if (caseId === "PIPE" || caseId === "EXTRACT" || caseId === "P2") {
        onUpdate({ type: "log", message: "Starting extraction..." });

        if (filesToExtract.length === 0) {
          onUpdate({ type: "log", message: "Discovering files in staging..." });
          filesToExtract = this.discoverFiles.execute({
            stagingDir: this.stagingDir,
            pairs: pairs
              ? pairs.map((p) => ({ brand: p.tenant, purchaser: p.purchaser }))
              : tenant && purchaser
                ? [{ brand: tenant, purchaser }]
                : undefined,
          }) as WorkflowFile[];
          onUpdate({
            type: "log",
            message: `Found ${filesToExtract.length} files to process.`,
          });
        }

        if (filesToExtract.length === 0) {
          onUpdate({
            type: "log",
            message: "No files found to extract.",
            level: "warn",
          });
        } else {
          await this.runExtraction.execute({
            files: filesToExtract,
            runId,
            concurrency: request.concurrency,
            requestsPerSecond: request.requestsPerSecond,
            skipCompleted: request.skipCompleted,
            onProgress: (done, total) =>
              onUpdate({
                type: "progress",
                phase: "extract",
                done,
                total,
                percent: Math.round((done / total) * 100),
              }),
          });
        }
      }

      // 3. Report Phase — delegated to injected service (no spawn in domain)
      onUpdate({ type: "log", message: "Generating report..." });
      await this.reportGenerationService.generate(runId);

      const report = await this.reporting.execute(runId);
      onUpdate({ type: "report", ...report });

      // Save summary to cache for 10/10 performance
      await this.recordRepo
        .saveRunSummary(runId, { metrics: report })
        .catch(() => {});

      onUpdate({ type: "log", message: "Operation completed successfully." });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      onUpdate({ type: "log", message: `Error: ${message}`, level: "error" });
      onUpdate({ type: "error", message });
      throw e;
    } finally {
      this.runStatusStore.unregisterRun(caseId);
    }
  }
}
