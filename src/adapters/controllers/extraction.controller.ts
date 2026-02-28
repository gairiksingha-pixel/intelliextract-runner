import { ServerResponse } from "node:http";
import { ProcessOrchestrator } from "../../infrastructure/services/process-orchestrator.service.js";
import { IRunStatusStore } from "../../core/domain/services/run-status-store.service.js";
import {
  IRunStateService,
  RunState,
} from "../../core/domain/services/run-state.service.js";
import { ICheckpointRepository } from "../../core/domain/repositories/checkpoint.repository.js";
import { Checkpoint } from "../../core/domain/entities/checkpoint.entity.js";
import { hasOverlap } from "../../infrastructure/utils/concurrency.utils.js";

import { z } from "zod";
import { RunRequestSchema } from "../validation.js";

export type RunRequest = z.infer<typeof RunRequestSchema>;

export class ExtractionController {
  constructor(
    private orchestrator: ProcessOrchestrator,
    private runStatusStore: IRunStatusStore,
    private runStateService: IRunStateService,
    private checkpointRepo: ICheckpointRepository,
    private resumeCapableCases: Set<string>,
  ) {}

  async handleRunRequest(body: unknown, res: ServerResponse) {
    const parseRes = RunRequestSchema.safeParse(body);
    if (!parseRes.success) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: parseRes.error.issues[0]?.message || "Invalid input",
        }),
      );
      return;
    }
    const validatedBody = parseRes.data;
    const {
      caseId,
      syncLimit,
      extractLimit,
      tenant,
      purchaser,
      pairs,
      retryFailed,
    } = validatedBody;

    if (this.runStatusStore.isActive(caseId)) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Case ${caseId} is already running` }));
      return;
    }

    const requestedScope = { tenant, purchaser, pairs };
    const overlappingRun = this.runStatusStore
      .getActiveRuns()
      .find((r: any) => hasOverlap(requestedScope, r.params || {}));
    if (overlappingRun) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: `Scope Conflict: Another operation (${overlappingRun.caseId}) is already processing some of these brands/purchasers. Please wait for it to finish.`,
        }),
      );
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
            runInfo.syncProgress = { done, total };
            writeLine({ type: "progress", phase: "sync", done, total });
          },
          onExtractionProgress: (done, total) => {
            runInfo.extractProgress = { done, total };
            writeLine({ type: "progress", phase: "extract", done, total });
          },
          onResumeSkipSync: (skipped, total) => {
            runInfo.resumeSkipSyncProgress = { skipped, total };
            writeLine({ type: "resume_skip", phase: "sync", skipped, total });
          },
          onRunId: (runId) => {
            runInfo.runId = runId;
            writeLine({ type: "run_id", runId });
          },
          onResumeSkip: (skipped, total) => {
            runInfo.resumeSkipExtractProgress = { skipped, total };
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
        if (status.runId) {
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
            runId: status.runId,
            successCount: status.done,
            avgLatency: avgLat,
            stdout: result.stdout,
            stderr: result.stderr,
          });
        }
      } else {
        // Save state for resume if interrupted
        if (this.resumeCapableCases.has(caseId) && result.exitCode !== 0) {
          const s = await this.checkpointRepo.getRunStatus();
          if (s.runId) {
            await this.runStateService.updateRunState(caseId, {
              status: "stopped",
              runId: s.runId,
            });
          }
        }
        writeLine({
          type: "error",
          message: result.stderr
            ? "Process produced errors."
            : result.exitCode !== 0
              ? "Process was interrupted."
              : "Process finished.",
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
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
