import { ManifestEntry, SyncHistoryEntry } from "../types.js";
export type { ManifestEntry, SyncHistoryEntry } from "../types.js";

export interface ISyncRepository {
  getManifest(): Promise<Record<string, ManifestEntry>>;
  saveManifest(manifest: Record<string, ManifestEntry>): Promise<void>;
  upsertManifestEntry(key: string, entry: ManifestEntry): Promise<void>;
  deleteManifestEntry(key: string): Promise<void>;

  appendSyncHistory(entry: SyncHistoryEntry): Promise<void>;
  getSyncHistory(): Promise<SyncHistoryEntry[]>;
}
