import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ISyncRepository } from "../../core/domain/repositories/ISyncRepository.js";
import { ManifestEntry, SyncHistoryEntry } from "../../core/domain/types.js";

export class SqliteSyncRepository implements ISyncRepository {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    return new Database(this.dbPath);
  }

  async getManifest(): Promise<Record<string, ManifestEntry>> {
    const db = this.getDb();
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("manifest") as { value: string } | undefined;
      if (!row) return {};
      return JSON.parse(row.value || "{}");
    } catch (_) {
      return {};
    } finally {
      db.close();
    }
  }

  async saveManifest(manifest: Record<string, ManifestEntry>): Promise<void> {
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

  async getSyncHistory(): Promise<SyncHistoryEntry[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare("SELECT * FROM sync_history ORDER BY timestamp ASC")
        .all() as any[];
      return rows.map((r) => ({
        timestamp: r.timestamp,
        synced: r.synced,
        skipped: r.skipped,
        errors: r.errors,
        brands: JSON.parse(r.brands || "[]"),
        purchasers: JSON.parse(r.purchasers || "[]"),
      }));
    } catch (_) {
      return [];
    } finally {
      db.close();
    }
  }

  async appendSyncHistory(entry: SyncHistoryEntry): Promise<void> {
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
