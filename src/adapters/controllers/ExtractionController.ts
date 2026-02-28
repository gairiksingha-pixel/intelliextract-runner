import { ServerResponse } from "node:http";
import { ProcessOrchestrator } from "../../infrastructure/services/ProcessOrchestrator.js";
import { IRunStatusStore } from "../../core/domain/services/IRunStatusStore.js";
import { RunStateService } from "../../infrastructure/services/RunStateService.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";
import { Checkpoint } from "../../core/domain/entities/Checkpoint.js";

export interface RunRequest {
  caseId: string;
  syncLimit?: number;
  extractLimit?: number;
  tenant?: string;
  purchaser?: string;
  pairs?: { tenant: string; purchaser: string }[];
  retryFailed?: boolean;
}

export class ExtractionController {
  constructor(
    private orchestrator: ProcessOrchestrator,
    private runStatusStore: IRunStatusStore,
    private runStateService: RunStateService,
    private checkpointRepo: ICheckpointRepository,
    private resumeCapableCases: Set<string>,
  ) {}

  async handleRunRequest(body: RunRequest, res: ServerResponse) {
    const {
      caseId,
      syncLimit,
      extractLimit,
      tenant,
      purchaser,
      pairs,
      retryFailed,
    } = body;

    if (!caseId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing caseId" }));
      return;
    }

    if (this.runStatusStore.isActive(caseId)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Case ${caseId} is already running` }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
    });

    const writeLine = (obj: any) => {
      if (!res.writableEnded) {
        res.write(JSON.stringify(obj) + "\n");
      }
    };

    const params = {
      caseId,
      syncLimit,
      extractLimit,
      tenant,
      purchaser,
      pairs,
      retryFailed,
    };

    // Check resume state
    let runOpts: any = null;
    if (this.resumeCapableCases.has(caseId)) {
      const state = await this.runStateService.getRunState(caseId);
      if (state && state.status === "stopped" && state.runId) {
        runOpts = { resume: true, runId: state.runId, ...state };
        writeLine({
          type: "log",
          message: `Resuming previous run ${state.runId}...`,
        });
      }
    }

    const runInfo: any = {
      caseId,
      params,
      startTime: new Date().toISOString(),
      status: "running",
      origin: "manual",
    };
    this.runStatusStore.registerRun(runInfo);

    try {
      const result = await this.orchestrator.runCase(
        caseId,
        params,
        {
          onChild: (child) => {
            writeLine({ type: "log", message: "Process started." });
          },
          onSyncProgress: (done, total) => {
            writeLine({ type: "progress", phase: "sync", done, total });
          },
          onExtractionProgress: (done, total) => {
            writeLine({ type: "progress", phase: "extract", done, total });
          },
          onResumeSkipSync: (skipped, total) => {
            writeLine({ type: "resume_skip", phase: "sync", skipped, total });
          },
          onResumeSkip: (skipped, total) => {
            writeLine({
              type: "resume_skip",
              phase: "extract",
              skipped,
              total,
            });
          },
        },
        { ...runOpts, runKey: caseId },
      );

      if (result.exitCode === 0) {
        // Clear resume state on success
        if (this.resumeCapableCases.has(caseId)) {
          await this.runStateService.clearRunState(caseId);
        }

        // Fetch real stats from DB
        const status = await this.checkpointRepo.getRunStatus();
        const records = await this.checkpointRepo.getRecordsForRun(
          status.runId,
        );
        const doneRecords = records.filter(
          (r: Checkpoint) => r.status === "done",
        );
        const avgLat =
          doneRecords.length > 0
            ? Math.round(
                doneRecords.reduce(
                  (a: number, b: Checkpoint) => a + (b.latencyMs || 0),
                  0,
                ) / doneRecords.length,
              )
            : 0;

        writeLine({
          type: "report",
          message: "Operation completed successfully.",
          successCount: status.done,
          avgLatency: avgLat,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } else {
        // Save state for resume if interrupted
        if (this.resumeCapableCases.has(caseId) && result.exitCode !== 0) {
          const s = await this.checkpointRepo.getRunStatus();
          await this.runStateService.updateRunState(caseId, {
            status: "stopped",
            runId: s.runId,
          });
        }
        writeLine({
          type: "error",
          message:
            result.stderr ||
            result.stdout ||
            `Process exited with code ${result.exitCode}`,
        });
      }
    } catch (e: any) {
      writeLine({ type: "error", message: e.message || "Unknown error" });
    } finally {
      this.runStatusStore.unregisterRun(caseId);
      if (!res.writableEnded) res.end();
    }
  }
}
