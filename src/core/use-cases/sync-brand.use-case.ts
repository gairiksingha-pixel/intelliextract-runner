import {
  IS3Service,
  SyncResult,
  SyncFileSyncedJob,
} from "../domain/services/s3.service.js";
import { ISyncRepository } from "../domain/repositories/sync.repository.js";
import PQueue from "p-queue";

export interface SyncBrandRequest {
  buckets: any[];
  stagingDir: string;
  /** Max new downloads across ALL buckets (skipped unchanged files do not count). */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
  /** Called when a file is skipped (already synced). */
  onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
  /** Called after each file is synced or skipped. Enables pipeline mode. */
  onFileSynced?: (job: SyncFileSyncedJob) => void;
  /** Called before each download begins. Used for resume state persistence. */
  onStartDownload?: (destPath: string, manifestKey: string) => void;
  /** Paths already fully extracted — skip without SHA check. */
  alreadyExtractedPaths?: Set<string>;
}

export class SyncBrandUseCase {
  constructor(
    private s3Service: IS3Service,
    private syncRepo: ISyncRepository,
  ) {}

  async execute(request: SyncBrandRequest): Promise<SyncResult[]> {
    const allResults: SyncResult[] = [];
    const timestamp = new Date().toISOString();

    // Shared limit counter across ALL buckets (matching original s3-sync.ts behavior)
    const limit = request.limit;
    const limitRemaining = {
      value: limit !== undefined && limit > 0 ? limit : Number.MAX_SAFE_INTEGER,
    };
    const initialLimit = limit !== undefined && limit > 0 ? limit : 0;

    const brands: string[] = [];
    const purchasers: string[] = [];

    // Per-bucket progress so we can report cumulative progress across all buckets
    const bucketProgress: Record<number, { done: number; total: number }> = {};
    const reportCumulativeProgress = (bucketIndex: number, done: number, total: number) => {
      bucketProgress[bucketIndex] = { done, total };
      const cumDone = Object.values(bucketProgress).reduce((a, p) => a + (p?.done ?? 0), 0);
      const cumTotal = Object.values(bucketProgress).reduce((a, p) => a + (p?.total ?? 0), 0);
      request.onProgress?.(cumDone, Math.max(cumDone, cumTotal));
    };

    const queue = new PQueue({ concurrency: 10 });

    for (let i = 0; i < request.buckets.length; i++) {
      const bucket = request.buckets[i];
      const bucketIndex = i;
      queue.add(async () => {
        if (limitRemaining.value <= 0) return;

        const result = await this.s3Service.syncBucket(
          bucket,
          request.stagingDir,
          {
            limitRemaining,
            initialLimit,
            onProgress: (done, total) =>
              reportCumulativeProgress(bucketIndex, done, total),
            onSyncSkipProgress: request.onSyncSkipProgress,
            onFileSynced: request.onFileSynced,
            onStartDownload: request.onStartDownload,
            alreadyExtractedPaths: request.alreadyExtractedPaths,
          },
        );

        allResults.push(result);
        if (result.brand) brands.push(result.brand);
        if (result.purchaser) purchasers.push(result.purchaser);
      });
    }

    await queue.onIdle();

    const totalSynced = allResults.reduce((s, r) => s + r.synced, 0);
    const totalSkipped = allResults.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = allResults.reduce((s, r) => s + r.errors, 0);

    // Record sync history
    if (totalSynced > 0 || totalSkipped > 0 || totalErrors > 0) {
      await this.syncRepo.appendSyncHistory({
        timestamp,
        synced: totalSynced,
        skipped: totalSkipped,
        errors: totalErrors,
        brands,
        purchasers,
      });
    }

    return allResults;
  }
}
