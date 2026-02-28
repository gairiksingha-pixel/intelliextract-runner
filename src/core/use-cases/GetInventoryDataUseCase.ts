import { readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";
import { ISyncRepository } from "../domain/repositories/ISyncRepository.js";
import { InventoryDataDTO, InventoryFileDetails } from "../domain/types.js";

export class GetInventoryDataUseCase {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private syncRepo: ISyncRepository,
    private stagingDir: string,
  ) {}

  async execute(): Promise<InventoryDataDTO> {
    const rawFiles = this.listStagingFiles(
      this.stagingDir,
      this.stagingDir,
      [],
    );
    rawFiles.sort((a, b) => b.mtime - a.mtime);

    const cpRecords = await this.checkpointRepo.getAllCheckpoints();
    const pathToRunId: Record<string, string> = {};
    cpRecords.forEach((c) => {
      const key = (c.brand + "/" + (c.relativePath || "")).replace(/\\/g, "/");
      pathToRunId[key] = c.runId;
    });

    const files: InventoryFileDetails[] = rawFiles.map((f) => {
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

    const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const totalSizeStr = (totalSize / (1024 * 1024)).toFixed(1) + " MB";

    // Build the config part as well to fully satisfy the DTO if needed by the controller
    // But wait, the controller should probably build the brandPurchaserMap based on the data.
    // To be 10/10, the Use Case should provide the full DTO.

    const brandPurchasers: Record<string, string[]> = {};
    const brandNames: Record<string, string> = {};
    const purchaserNames: Record<string, string> = {};

    // We'll leave the display name formatting to the ViewHelper or the Controller's DTO builder
    // for now, but the mapping should be here.
    files.forEach((f) => {
      if (f.brand && f.purchaser) {
        if (!brandPurchasers[f.brand]) brandPurchasers[f.brand] = [];
        if (!brandPurchasers[f.brand].includes(f.purchaser))
          brandPurchasers[f.brand].push(f.purchaser);
      }
    });

    return {
      files,
      history: recentHistory,
      manifestEntries: manifest,
      config: {
        brands: Object.keys(brandPurchasers).sort(),
        purchasers: Array.from(
          new Set(files.map((f) => f.purchaser).filter(Boolean)),
        ).sort(),
        brandPurchaserMap: brandPurchasers,
        brandNames: {}, // Controller will fill these using ViewHelper if needed, or we could pass it in
        purchaserNames: {},
      },
      stats: {
        totalFiles: files.length,
        totalSizeStr,
      },
    };
  }

  private listStagingFiles(
    dir: string,
    baseDir: string,
    list: { path: string; size: number; mtime: number }[],
  ) {
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
