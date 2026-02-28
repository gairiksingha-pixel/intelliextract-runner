import PQueue from "p-queue";
import {
  IExtractionService,
  NetworkAbortError,
} from "../domain/services/extraction.service.js";
import { ICheckpointRepository } from "../domain/repositories/checkpoint.repository.js";
import { Checkpoint } from "../domain/entities/checkpoint.entity.js";
import { ILogger } from "../domain/services/logger.service.js";
import {
  IEmailService,
  FailureDetail,
} from "../domain/services/email.service.js";
import { computeMetrics } from "../../infrastructure/utils/metrics.utils.js";

export interface RunExtractionRequest {
  files: Array<{
    filePath: string;
    relativePath: string;
    brand: string;
    purchaser?: string;
  }>;
  runId: string;
  concurrency?: number;
  requestsPerSecond?: number;
  /** When true, only skip files that were successfully processed in ANY run */
  skipCompleted?: boolean;
  /** When true, only retry files that previously failed in the specified runId */
  retryFailed?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Filter for cumulative metrics reporting at end of run */
  filter?: { tenant?: string; purchaser?: string };
}

export class RunExtractionUseCase {
  constructor(
    private extractionService: IExtractionService,
    private checkpointRepo: ICheckpointRepository,
    private logger: ILogger,
    private emailService: IEmailService,
  ) {}

  async execute(request: RunExtractionRequest): Promise<void> {
    const stdoutPiped = !process.stdout.isTTY;
    const runId = request.runId;
    const startTime = new Date();
    this.logger.init(runId);
    const failures: FailureDetail[] = [];

    // 1. Determine files to actually process
    // If skipCompleted is true, we check globally. Otherwise, we only check within this run (for resume).
    const completedPaths = await this.checkpointRepo.getCompletedPaths(
      request.skipCompleted ? undefined : runId,
    );

    // When retryFailed is true, the CLI passed only failed files. Process those that are not yet completed.
    // Otherwise we process all request.files that are not completed.
    const toProcess = request.files.filter(
      (f) => !completedPaths.has(f.filePath),
    );

    const total = toProcess.length;
    let done = 0;

    // 2. Report resume skip if piped
    if (stdoutPiped && completedPaths.size > 0 && total > 0) {
      process.stdout.write(
        `RESUME_SKIP\t${completedPaths.size}\t${request.files.length}\n`,
      );
    }

    // 3. Mark skipped records for this run so metrics are accurate
    const skippedRecords = request.files
      .filter((f) => !toProcess.includes(f))
      .map((f) => ({
        ...f,
        status: "skipped" as const,
        runId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      }));

    if (skippedRecords.length > 0) {
      await this.checkpointRepo.upsertCheckpoints(
        skippedRecords as Checkpoint[],
      );
    }

    if (total === 0) {
      this.logger.close();
      return;
    }

    // 4. Setup Queue
    const queueOptions: any = {
      concurrency: request.concurrency || 5,
    };
    if (request.requestsPerSecond && request.requestsPerSecond > 0) {
      queueOptions.intervalCap = request.requestsPerSecond;
      queueOptions.interval = 1000;
    }

    const queue = new PQueue(queueOptions);
    let aborted = false;

    // 5. Execute
    for (const file of toProcess) {
      if (aborted) break;

      queue.add(async () => {
        if (aborted) return;
        const startedAt = new Date().toISOString();

        await this.checkpointRepo.upsertCheckpoint({
          ...file,
          status: "running",
          startedAt,
          runId,
        } as Checkpoint);

        try {
          const result = await this.extractionService.extractFile(
            file.filePath,
            file.brand,
            file.purchaser,
            runId,
            file.relativePath,
          );

          await this.checkpointRepo.upsertCheckpoint({
            ...file,
            status: result.success ? "done" : "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            latencyMs: result.latencyMs,
            statusCode: result.statusCode,
            errorMessage: result.errorMessage,
            patternKey: result.patternKey,
            fullResponse: result.fullResponse,
            runId,
          } as Checkpoint);

          if (!result.success) {
            failures.push({
              filePath: file.filePath,
              brand: file.brand,
              purchaser: file.purchaser,
              statusCode: result.statusCode,
              errorMessage: result.errorMessage,
              patternKey: result.patternKey,
            });
          }

          this.logger.log({
            runId,
            filePath: file.filePath,
            brand: file.brand,
            purchaser: file.purchaser,
            request: { method: "POST", url: "/api/extract" },
            response: {
              statusCode: result.statusCode || 200,
              latencyMs: result.latencyMs || 0,
              bodyLength: 0,
            },
            success: result.success,
          });
        } catch (e) {
          if (e instanceof NetworkAbortError) {
            aborted = true;
            queue.clear();
            if (stdoutPiped) {
              process.stdout.write(
                "LOG\tNetwork interruption detected. Execution stopping. Resume later.\n",
              );
            }
          }
          const errorMsg = e instanceof Error ? e.message : String(e);
          failures.push({
            filePath: file.filePath,
            brand: file.brand,
            purchaser: file.purchaser,
            errorMessage: errorMsg,
          });
          await this.checkpointRepo.upsertCheckpoint({
            ...file,
            status: "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            errorMessage: errorMsg,
            runId,
          } as Checkpoint);
        } finally {
          done++;
          if (request.onProgress) request.onProgress(done, total);
        }
      });
    }

    await queue.onIdle();

    // 6. Report generation and consolidated email
    const records = await this.checkpointRepo.getRecordsForRun(runId);
    const metrics = computeMetrics(runId, records, startTime, new Date());

    if (failures.length > 0) {
      await this.emailService.sendConsolidatedFailureEmail(
        runId,
        failures,
        metrics,
      );
    }

    // 7. Cumulative metrics signal
    if (stdoutPiped) {
      const cumStats = await this.checkpointRepo.getCumulativeStats(
        request.filter,
      );
      process.stdout.write(
        `CUMULATIVE_METRICS\tsuccess=${cumStats.success},failed=${cumStats.failed},total=${cumStats.total}\n`,
      );
    }

    this.logger.close();
  }
}
