import Database from "better-sqlite3";
import { ExtractionStatus } from "../../core/domain/entities/extraction-record.entity.js";
import {
  IFileRegistry,
  RegisterFileInput,
  UnextractedFile,
  FileStatusMetrics,
} from "../../core/domain/repositories/file-registry.repository.js";

export class SqliteFileRegistryRepository implements IFileRegistry {
  constructor(private db: Database.Database) {}

  async registerFiles(files: RegisterFileInput[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO tbl_file_registry (id, fullPath, brand, purchaser, size, etag, sha256, syncedAt, registeredAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fullPath     = excluded.fullPath,
        size         = excluded.size,
        etag         = excluded.etag,
        sha256       = excluded.sha256,
        syncedAt     = excluded.syncedAt
    `);

    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const f of files) {
        stmt.run(
          f.id,
          f.fullPath,
          f.brand,
          f.purchaser || "",
          f.size || 0,
          f.etag || "",
          f.sha256 || "",
          now,
          now,
        );
      }
    })();
  }

  async getUnextractedFiles(filter?: {
    brand?: string;
    purchaser?: string;
    pairs?: { brand: string; purchaser: string }[];
  }): Promise<UnextractedFile[]> {
    let query =
      "SELECT fullPath, id as relativePath, brand, purchaser FROM tbl_file_registry WHERE (extractStatus IS NULL OR extractStatus != 'done')";
    const params: (string | number)[] = [];

    if (filter?.pairs?.length) {
      const placeholders = filter.pairs
        .map(() => "(brand = ? AND purchaser = ?)")
        .join(" OR ");
      query += " AND (" + placeholders + ")";
      for (const p of filter.pairs) {
        params.push(p.brand, p.purchaser || "");
      }
    } else {
      if (filter?.brand) {
        query += " AND brand = ?";
        params.push(filter.brand);
      }
      if (filter?.purchaser) {
        query += " AND purchaser = ?";
        params.push(filter.purchaser);
      }
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      fullPath: string;
      relativePath: string;
      brand: string;
      purchaser?: string;
    }>;
    return rows.map((r) => ({
      filePath: r.fullPath,
      relativePath: r.relativePath,
      brand: r.brand,
      purchaser: r.purchaser,
    }));
  }

  async updateFileStatus(
    id: string,
    status: ExtractionStatus,
    metrics?: FileStatusMetrics,
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE tbl_file_registry
         SET extractStatus = ?,
             extractedAt   = ?,
             lastRunId     = ?
         WHERE id = ?`,
      )
      .run(status, new Date().toISOString(), metrics?.runId ?? null, id);
  }
}
