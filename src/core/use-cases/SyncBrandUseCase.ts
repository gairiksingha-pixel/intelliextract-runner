import { IS3Service, SyncResult } from "../domain/services/IS3Service.js";
import { ISyncRepository } from "../domain/repositories/ISyncRepository.js";

export interface SyncBrandRequest {
  buckets: any[];
  stagingDir: string;
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}

export class SyncBrandUseCase {
  constructor(
    private s3Service: IS3Service,
    private syncRepo: ISyncRepository,
  ) {}

  async execute(request: SyncBrandRequest): Promise<SyncResult[]> {
    const allResults: SyncResult[] = [];
    const timestamp = new Date().toISOString();

    let totalSynced = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    const brands: string[] = [];
    const purchasers: string[] = [];

    for (const bucket of request.buckets) {
      const result = await this.s3Service.syncBucket(
        bucket,
        request.stagingDir,
        {
          limit: request.limit,
          onProgress: request.onProgress,
        },
      );

      allResults.push(result);

      totalSynced += result.synced;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
      if (result.brand) brands.push(result.brand);
      if (result.purchaser) purchasers.push(result.purchaser);
    }

    // Save sync history
    await this.syncRepo.appendSyncHistory({
      timestamp,
      synced: totalSynced,
      skipped: totalSkipped,
      errors: totalErrors,
      brands,
      purchasers,
    });

    return allResults;
  }
}
