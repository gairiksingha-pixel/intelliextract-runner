import Database from "better-sqlite3";
import {
  ISyncRepository,
  ManifestEntry,
} from "../../core/domain/repositories/ISyncRepository.js";

export class SqliteSyncRepository implements ISyncRepository {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    return new Database(this.dbPath);
  }

  async getManifest(): Promise<Record<string, ManifestEntry | string>> {
    const db = this.getDb();
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("manifest");
      if (!row) return {};
      return JSON.parse((row as any).value || "{}");
    } catch (_) {
      return {};
    } finally {
      db.close();
    }
  }

  async saveManifest(
    manifest: Record<string, ManifestEntry | string>,
  ): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
        "manifest",
        JSON.stringify(manifest),
      );
    } finally {
      db.close();
    }
  }

  async upsertManifestEntry(key: string, entry: ManifestEntry): Promise<void> {
    const manifest = await this.getManifest();
    manifest[key] = entry;
    await this.saveManifest(manifest);
  }

  async deleteManifestEntry(key: string): Promise<void> {
    const manifest = await this.getManifest();
    delete manifest[key];
    await this.saveManifest(manifest);
  }

  async getSyncHistory(): Promise<any[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare("SELECT * FROM sync_history ORDER BY timestamp ASC")
        .all();
      return rows.map((r: any) => ({
        ...r,
        brands: JSON.parse(r.brands || "[]"),
        purchasers: JSON.parse(r.purchasers || "[]"),
      }));
    } catch (_) {
      return [];
    } finally {
      db.close();
    }
  }

  async appendSyncHistory(entry: {
    timestamp: string;
    synced: number;
    skipped: number;
    errors: number;
    brands: string[];
    purchasers?: string[];
  }): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        "INSERT INTO sync_history (timestamp, synced, skipped, errors, message, brands, purchasers) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        entry.timestamp,
        entry.synced,
        entry.skipped,
        entry.errors,
        "", // message
        JSON.stringify(entry.brands),
        JSON.stringify(entry.purchasers || []),
      );
    } finally {
      db.close();
    }
  }
}
