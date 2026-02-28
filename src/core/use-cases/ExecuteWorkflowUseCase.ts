import { SyncBrandUseCase } from "./SyncBrandUseCase.js";
import { RunExtractionUseCase } from "./RunExtractionUseCase.js";
import { ReportingUseCase } from "./ReportingUseCase.js";
import { DiscoverFilesUseCase } from "./DiscoverFilesUseCase.js";
import { IRunStatusStore } from "../domain/services/IRunStatusStore.js";
import { spawn } from "node:child_process";

export interface WorkflowRequest {
  caseId: string;
  syncLimit?: number;
  extractLimit?: number;
  tenant?: string;
  purchaser?: string;
  pairs?: { tenant: string; purchaser: string }[];
  resume?: boolean;
  concurrency?: number;
  requestsPerSecond?: number;
}

export interface WorkflowProgress {
  type: "run_id" | "log" | "progress" | "report" | "error";
  runId?: string;
  message?: string;
  phase?: "sync" | "extract";
  done?: number;
  total?: number;
  percent?: number;
  level?: "info" | "warn" | "error";
  [key: string]: any;
}

export class ExecuteWorkflowUseCase {
  constructor(
    private syncBrand: SyncBrandUseCase,
    private runExtraction: RunExtractionUseCase,
    private reporting: ReportingUseCase,
    private discoverFiles: DiscoverFilesUseCase,
    private runStatusStore: IRunStatusStore,
    private stagingDir: string,
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
      startedAt: new Date().toISOString(),
      origin: "manual",
    });

    try {
      let filesToExtract: any[] = [];

      // 1. Sync Phase
      if (caseId === "PIPE" || caseId === "SYNC" || caseId === "P1") {
        onUpdate({ type: "log", message: "Starting synchronization..." });

        const syncPairs =
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
                relativePath: f.split("staging")[1] || f,
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
          });
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

      // 3. Reporting Phase
      onUpdate({ type: "log", message: "Generating report..." });

      // Execute legacy report generation for physical files
      await new Promise((resolve) => {
        const child = spawn(
          "node",
          ["dist/index.js", "report", "--run-id", runId],
          { shell: false },
        );
        child.on("close", resolve);
        child.on("error", () => resolve(1));
      });

      const report = await this.reporting.execute(runId);
      onUpdate({ type: "report", ...report });

      onUpdate({ type: "log", message: "Operation completed successfully." });
    } catch (e: any) {
      onUpdate({
        type: "log",
        message: `Error: ${e.message}`,
        level: "error",
      });
      onUpdate({ type: "error", message: e.message });
      throw e;
    } finally {
      this.runStatusStore.unregisterRun(caseId);
    }
  }
}
