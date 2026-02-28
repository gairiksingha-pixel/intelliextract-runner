import {
  IS3Service,
  SyncResult,
  SyncFileSyncedJob,
} from "../domain/services/IS3Service.js";
import { ISyncRepository } from "../domain/repositories/ISyncRepository.js";

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

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const brands: string[] = [];
    const purchasers: string[] = [];

    for (const bucket of request.buckets) {
      if (limitRemaining.value <= 0) break;

      const result = await this.s3Service.syncBucket(
        bucket,
        request.stagingDir,
        {
          limitRemaining,
          initialLimit,
          onProgress: request.onProgress,
          onSyncSkipProgress: request.onSyncSkipProgress,
          onFileSynced: request.onFileSynced,
          onStartDownload: request.onStartDownload,
          alreadyExtractedPaths: request.alreadyExtractedPaths,
        },
      );

      allResults.push(result);
      totalSynced += result.synced;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
      if (result.brand) brands.push(result.brand);
      if (result.purchaser) purchasers.push(result.purchaser);
    }

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
