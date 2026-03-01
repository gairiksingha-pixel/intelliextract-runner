import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ISyncRepository } from "../../core/domain/repositories/sync.repository.js";
import { ManifestEntry, SyncHistoryEntry } from "../../core/domain/types.js";

export class SqliteSyncRepository implements ISyncRepository {
  private _db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb() {
    if (this._db) return this._db;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this._db = new Database(this.dbPath);
    this._db.pragma("journal_mode = DELETE");
    this._db.pragma("synchronous = FULL");
    this._db.pragma("busy_timeout = 5000");
    return this._db;
  }

  async getManifest(): Promise<Record<string, ManifestEntry>> {
    const db = this.getDb();
    const manifest: Record<string, ManifestEntry> = {};
    try {
      const rows = db
        .prepare(
          "SELECT id, sha256, etag, size, fullPath FROM tbl_file_registry",
        )
        .all() as any[];
      for (const r of rows) {
        manifest[r.id] = {
          sha256: r.sha256,
          etag: r.etag,
          size: r.size,
          fullPath: r.fullPath,
        };
      }
      return manifest;
    } catch (_) {
      return {};
    }
  }

  async saveManifest(manifest: Record<string, ManifestEntry>): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO tbl_file_registry (id, sha256, etag, size, syncedAt)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sha256   = excluded.sha256,
        etag     = excluded.etag,
        size     = excluded.size,
        syncedAt = excluded.syncedAt
    `);
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const [k, v] of Object.entries(manifest)) {
        stmt.run(k, v.sha256, v.etag || "", v.size || 0, now);
      }
    })();
  }

  async getManifestEntry(key: string): Promise<ManifestEntry | null> {
    const db = this.getDb();
    try {
      const row = db
        .prepare(
          "SELECT sha256, etag, size, fullPath FROM tbl_file_registry WHERE id = ?",
        )
        .get(key) as any;
      if (!row) return null;
      return {
        sha256: row.sha256,
        etag: row.etag,
        size: row.size,
        fullPath: row.fullPath,
      };
    } catch (_) {
      return null;
    }
  }

  async upsertManifestEntry(
    key: string,
    entry: ManifestEntry,
    brand?: string,
    purchaser?: string,
    fullPath?: string,
  ): Promise<void> {
    const db = this.getDb();
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO tbl_file_registry (id, sha256, etag, size, syncedAt, brand, purchaser, fullPath)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sha256    = excluded.sha256,
        etag      = excluded.etag,
        size      = excluded.size,
        syncedAt  = excluded.syncedAt,
        brand     = COALESCE(excluded.brand, tbl_file_registry.brand),
        purchaser = COALESCE(excluded.purchaser, tbl_file_registry.purchaser),
        fullPath  = COALESCE(excluded.fullPath, tbl_file_registry.fullPath)
    `,
    ).run(
      key,
      entry.sha256,
      entry.etag || "",
      entry.size || 0,
      now,
      brand || null,
      purchaser || null,
      fullPath || null,
    );
  }

  async deleteManifestEntry(key: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM tbl_file_registry WHERE id = ?").run(key);
  }

  async getSyncHistory(): Promise<SyncHistoryEntry[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM tbl_sync_history ORDER BY timestamp ASC")
      .all() as any[];
    return rows.map((r) => ({
      timestamp: r.timestamp,
      synced: r.synced,
      skipped: r.skipped,
      errors: r.errors,
      brands: JSON.parse(r.brands || "[]"),
      purchasers: JSON.parse(r.purchasers || "[]"),
    }));
  }

  async appendSyncHistory(entry: SyncHistoryEntry): Promise<void> {
    const db = this.getDb();
    db.prepare(
      "INSERT INTO tbl_sync_history (timestamp, synced, skipped, errors, brands, purchasers) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      entry.timestamp,
      entry.synced,
      entry.skipped,
      entry.errors,
      JSON.stringify(entry.brands),
      JSON.stringify(entry.purchasers || []),
    );
  }
}
