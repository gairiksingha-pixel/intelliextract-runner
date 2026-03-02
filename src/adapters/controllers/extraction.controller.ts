import { ServerResponse } from "node:http";
import { ProcessOrchestrator } from "../../infrastructure/services/process-orchestrator.service.js";
import { IRunStatusStore } from "../../core/domain/services/run-status-store.service.js";
import {
  IRunStateService,
  RunState,
} from "../../core/domain/services/run-state.service.js";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";
import { ExtractionRecord } from "../../core/domain/entities/extraction-record.entity.js";
import { hasOverlap } from "../../infrastructure/utils/concurrency.utils.js";

import { z } from "zod";
import { RunRequestSchema } from "../validation.js";
import { parseSyncSummaryFromStdout } from "../../infrastructure/utils/stdout-parser.utils.js";
import type { RunOptions } from "../../infrastructure/utils/command.utils.js";

export type RunRequest = z.infer<typeof RunRequestSchema>;

/** Typed shape for the in-memory active run info object. */
interface ActiveRunInfo {
  caseId: string;
  params: Record<string, unknown>;
  startTime: string;
  status: "running" | "syncing" | "extracting";
  origin: "manual";
  runId?: string;
  syncProgress?: { done: number; total: number };
  extractProgress?: { done: number; total: number };
  resumeSkipSyncProgress?: { skipped: number; total: number };
  resumeSkipExtractProgress?: { skipped: number; total: number };
  syncSummary?: {
    downloaded: number;
    skipped: number;
    errors: number;
    totalInInventory: number;
  };
}

export class ExtractionController {
  constructor(
    private orchestrator: ProcessOrchestrator,
    private runStatusStore: IRunStatusStore,
    private runStateService: IRunStateService,
    private recordRepo: IExtractionRecordRepository,
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
      tenant: tenant ?? undefined,
      purchaser: purchaser ?? undefined,
      pairs: pairs ?? undefined,
      retryFailed,
    };

    // Check resume state
    let runOpts: RunOptions | null = null;
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

    const runInfo: ActiveRunInfo = {
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
            runInfo.status = "syncing";
            runInfo.syncProgress = { done, total };
            writeLine({ type: "progress", phase: "sync", done, total });
          },
          onExtractionProgress: (done, total) => {
            runInfo.status = "extracting";
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
          onSyncSummary: (downloaded, skipped, errors) => {
            runInfo.syncSummary = {
              downloaded,
              skipped,
              errors,
              totalInInventory: downloaded + skipped,
            };
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
        const status = await this.recordRepo.getRunStatus();
        if (status.runId) {
          const records = await this.recordRepo.getRecordsForRun(status.runId);
          const doneRecords = records.filter(
            (r: ExtractionRecord) => r.status === "done",
          );
          const avgLat =
            doneRecords.length > 0
              ? Math.round(
                  doneRecords.reduce(
                    (a: number, b: ExtractionRecord) => a + (b.latencyMs || 0),
                    0,
                  ) / doneRecords.length,
                )
              : 0;

          writeLine({
            type: "report",
            message: "Operation completed successfully.",
            runId: status.runId,
            successCount: status.done,
            skippedCount: status.skipped,
            failedCount: status.failed,
            avgLatency: avgLat,
            stdout: result.stdout,
            stderr: result.stderr,
            syncSummary:
              runInfo.syncSummary ||
              parseSyncSummaryFromStdout(result.stdout) ||
              undefined,
          });
        } else {
          // Sync-only (e.g. P1): no run in DB; still send report so UI can show sync counts
          writeLine({
            type: "report",
            message: "Synchronization completed successfully.",
            runId: runInfo.runId || null,
            stdout: result.stdout,
            stderr: result.stderr,
            syncSummary:
              runInfo.syncSummary || parseSyncSummaryFromStdout(result.stdout),
          });
        }
      } else {
        // Save state for resume if interrupted
        if (this.resumeCapableCases.has(caseId) && result.exitCode !== 0) {
          const s = await this.recordRepo.getRunStatus();
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
