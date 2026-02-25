import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";
import { ISyncRepository } from "../domain/repositories/ISyncRepository.js";

export class GetInventoryDataUseCase {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private syncRepo: ISyncRepository,
    private stagingDir: string,
  ) {}

  async execute() {
    const files = this.listStagingFiles(this.stagingDir, this.stagingDir, []);
    files.sort((a, b) => b.mtime - a.mtime);

    const cpRecords = await this.checkpointRepo.getAllCheckpoints();
    const pathToRunId: Record<string, string> = {};
    cpRecords.forEach((c) => {
      const key = (c.brand + "/" + (c.relativePath || "")).replace(/\\/g, "/");
      pathToRunId[key] = c.runId;
    });

    const filesData = files.map((f) => {
      const parts = f.path.split("/");
      const brand = parts[0] || "";
      const purchaser = parts[1] || "";
      return {
        path: f.path,
        size: f.size,
        mtime: f.mtime,
        brand,
        purchaser,
        runId: pathToRunId[f.path] || null,
      };
    });

    const manifest = await this.syncRepo.getManifest();
    const history = await this.syncRepo.getSyncHistory();
    // Limit to last 30 entries for UI
    const recentHistory = history.length > 30 ? history.slice(-30) : history;

    return {
      filesData,
      manifestEntries: Object.keys(manifest).length,
      history: recentHistory,
    };
  }

  private listStagingFiles(dir: string, baseDir: string, list: any[]) {
    if (!existsSync(dir)) return list;
    const entries = readdirSync(dir, { withFileTypes: true });
    const base = baseDir || dir;
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(base, full).replace(/\\/g, "/");
      if (e.isDirectory()) {
        this.listStagingFiles(full, base, list);
      } else {
        try {
          const s = statSync(full);
          list.push({ path: rel, size: s.size, mtime: s.mtimeMs });
        } catch (_) {}
      }
    }
    return list;
  }
}
