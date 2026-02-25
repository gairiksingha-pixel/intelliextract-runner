export interface ManifestEntry {
  sha256: string;
  etag: string;
  size: number;
}

export interface ISyncRepository {
  getManifest(): Promise<Record<string, ManifestEntry | string>>;
  saveManifest(manifest: Record<string, ManifestEntry | string>): Promise<void>;
  upsertManifestEntry(key: string, entry: ManifestEntry): Promise<void>;
  deleteManifestEntry(key: string): Promise<void>;

  appendSyncHistory(entry: {
    timestamp: string;
    synced: number;
    skipped: number;
    errors: number;
    brands: string[];
    purchasers?: string[];
  }): Promise<void>;
  getSyncHistory(): Promise<any[]>;
}
