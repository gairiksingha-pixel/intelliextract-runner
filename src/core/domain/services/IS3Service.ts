export interface SyncResult {
  brand: string;
  purchaser: string;
  synced: number;
  skipped: number;
  errors: number;
  files: string[];
}

export interface SyncFileSyncedJob {
  filePath: string;
  relativePath: string;
  brand: string;
  purchaser?: string;
}

export interface IS3Service {
  syncBucket(
    bucketConfig: any,
    localDir: string,
    options?: {
      /** Max new downloads. Skipped (unchanged) files do not count. */
      limitRemaining?: { value: number };
      initialLimit?: number;
      onProgress?: (done: number, total: number) => void;
      /** Called when a file is skipped (already synced): shows "Skipping synced files" in UI. */
      onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
      /** Called after each file is synced or skipped — enables pipeline extraction. */
      onFileSynced?: (job: SyncFileSyncedJob) => void | Promise<void>;
      /** Called before a download begins — allows saving resume state. */
      onStartDownload?: (
        destPath: string,
        manifestKey: string,
      ) => void | Promise<void>;
      /** Paths already extracted — skip without disk I/O. */
      alreadyExtractedPaths?: Set<string>;
    },
  ): Promise<SyncResult>;
}
