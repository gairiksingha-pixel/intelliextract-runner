import { SyncBrandUseCase } from "../../core/use-cases/SyncBrandUseCase.js";
import { RunExtractionUseCase } from "../../core/use-cases/RunExtractionUseCase.js";
import { ReportingUseCase } from "../../core/use-cases/ReportingUseCase.js";
import { INotificationService } from "../../core/domain/services/INotificationService.js";
import { DiscoverFilesUseCase } from "../../core/use-cases/DiscoverFilesUseCase.js";
import { spawn } from "node:child_process";
import { IRunStatusStore } from "../../core/domain/services/IRunStatusStore.js";

export class ExtractionController {
  private stagingDir = "./output/staging";

  constructor(
    private syncBrand: SyncBrandUseCase,
    private runExtraction: RunExtractionUseCase,
    private reporting: ReportingUseCase,
    private discoverFiles: DiscoverFilesUseCase,
    private notificationService: INotificationService,
    private runStatusStore: IRunStatusStore,
  ) {}

  async handleRunRequest(body: any, res: any) {
    const {
      caseId,
      syncLimit,
      extractLimit,
      tenant,
      purchaser,
      pairs,
      resume,
    } = body;

    // Orchestrate based on caseId (PIPE, P1, etc.)
    // For now, let's assume a full run or sync

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    });
    const writeLine = (obj: any) => res.write(JSON.stringify(obj) + "\n");

    try {
      const runId = "RUN-" + Date.now();
      writeLine({ type: "run_id", runId });

      this.runStatusStore.registerRun({
        caseId,
        runId,
        startedAt: new Date().toISOString(),
        origin: "manual",
      });

      let filesToExtract: any[] = [];

      // 1. Sync Phase
      if (caseId === "PIPE" || caseId === "SYNC" || caseId === "P1") {
        writeLine({ type: "log", message: "Starting synchronization..." });

        // In a real implementation, we would get the buckets from config
        // For this demo/refactor, we'll assume a single bucket config or use the pairs
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
            stagingDir: "./output/staging",
            limit: syncLimit || 0,
            onProgress: (done, total) =>
              writeLine({
                type: "progress",
                phase: "sync",
                done,
                total,
                percent: Math.round((done / total) * 100),
              }),
          });

          // Collect files for extraction if in PIPE mode
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
        writeLine({ type: "log", message: "Starting extraction..." });

        // If not from sync (P2), discover files from staging
        if (filesToExtract.length === 0) {
          writeLine({
            type: "log",
            message: "Discovering files in staging...",
          });
          filesToExtract = this.discoverFiles.execute({
            stagingDir: this.stagingDir,
            pairs:
              pairs ||
              (tenant && purchaser
                ? [{ brand: tenant, purchaser }]
                : undefined),
          });
          writeLine({
            type: "log",
            message: `Found ${filesToExtract.length} files to process.`,
          });
        }

        if (filesToExtract.length === 0) {
          writeLine({
            type: "log",
            message: "No files found to extract.",
            level: "warn",
          });
        } else {
          await this.runExtraction.execute({
            files: filesToExtract,
            runId,
            concurrency: body.concurrency,
            requestsPerSecond: body.requestsPerSecond,
            onProgress: (done, total) =>
              writeLine({
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
      writeLine({ type: "log", message: "Generating report..." });

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
      writeLine({ type: "report", ...report });

      writeLine({ type: "log", message: "Operation completed successfully." });
      res.end();
    } catch (e: any) {
      writeLine({
        type: "log",
        message: `Error: ${e.message}`,
        level: "error",
      });
      writeLine({ type: "error", message: e.message });
      res.end();
    } finally {
      this.runStatusStore.unregisterRun(caseId);
    }
  }
}
