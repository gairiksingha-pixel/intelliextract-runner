import PQueue from "p-queue";
import { IExtractionService } from "../domain/services/IExtractionService.js";
import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";
import { Checkpoint } from "../domain/entities/Checkpoint.js";
import { ILogger } from "../domain/services/ILogger.js";

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
  onProgress?: (done: number, total: number) => void;
}

export class RunExtractionUseCase {
  constructor(
    private extractionService: IExtractionService,
    private checkpointRepo: ICheckpointRepository,
    private logger: ILogger,
  ) {}

  async execute(request: RunExtractionRequest): Promise<void> {
    this.logger.init(request.runId);
    const completedPaths = await this.checkpointRepo.getCompletedPaths(
      request.runId,
    );
    const total = request.files.length;
    let done = 0;

    const queueOptions: any = {
      concurrency: request.concurrency || 5,
    };
    if (request.requestsPerSecond && request.requestsPerSecond > 0) {
      queueOptions.intervalCap = request.requestsPerSecond;
      queueOptions.interval = 1000;
    }

    const queue = new PQueue(queueOptions);

    for (const file of request.files) {
      if (completedPaths.has(file.relativePath)) {
        done++;
        if (request.onProgress) request.onProgress(done, total);
        continue;
      }

      queue.add(async () => {
        const startedAt = new Date().toISOString();

        // Update checkpoint to running
        await this.checkpointRepo.upsertCheckpoint({
          ...file,
          status: "running",
          startedAt,
          runId: request.runId,
        } as Checkpoint);

        try {
          const result = await this.extractionService.extractFile(
            file.filePath,
            file.brand,
            file.purchaser,
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
            runId: request.runId,
          } as Checkpoint);

          this.logger.log({
            runId: request.runId,
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
          await this.checkpointRepo.upsertCheckpoint({
            ...file,
            status: "error",
            startedAt,
            finishedAt: new Date().toISOString(),
            errorMessage: e instanceof Error ? e.message : String(e),
            runId: request.runId,
          } as Checkpoint);
        } finally {
          done++;
          if (request.onProgress) request.onProgress(done, total);
        }
      });
    }

    await queue.onIdle();
    this.logger.close();
  }
}
