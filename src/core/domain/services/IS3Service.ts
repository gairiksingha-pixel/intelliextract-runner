export interface SyncResult {
  brand: string;
  purchaser: string;
  synced: number;
  skipped: number;
  errors: number;
  files: string[];
}

export interface IS3Service {
  syncBucket(
    bucketConfig: any,
    localDir: string,
    options?: {
      limit?: number;
      onProgress?: (done: number, total: number) => void;
    },
  ): Promise<SyncResult>;
}
