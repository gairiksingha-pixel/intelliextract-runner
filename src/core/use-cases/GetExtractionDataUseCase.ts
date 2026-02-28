import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";
import { ExtractionFileDetails } from "../domain/types.js";
import { FileMetadataService } from "../domain/services/FileMetadataService.js";

export class GetExtractionDataUseCase {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private extractionsDir: string,
  ) {}

  async execute(
    brandPurchasers: Record<string, string[]>,
  ): Promise<ExtractionFileDetails[]> {
    const succDir = join(this.extractionsDir, "succeeded");
    const failDir = join(this.extractionsDir, "failed");

    const allCheckpoints = await this.checkpointRepo.getAllCheckpoints();
    // Map filename to metadata for recovery
    const filenameToMetadata: Record<string, any> = {};
    allCheckpoints.forEach((c) => {
      const safe = (c.relativePath || "")
        .replaceAll("/", "_")
        .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
      const base = c.brand + "_" + (safe || "file");
      const jsonName = base.endsWith(".json") ? base : base + ".json";
      filenameToMetadata[jsonName] = {
        relativePath: c.relativePath,
        brand: c.brand,
        purchaser: c.purchaser,
        runId: c.runId,
      };
    });

    const loadFiles = (
      dir: string,
      status: "success" | "failed",
    ): ExtractionFileDetails[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const path = join(dir, f);
          let content: any = null;
          let mtime = 0;
          try {
            content = JSON.parse(readFileSync(path, "utf-8"));
            mtime = statSync(path).mtimeMs;
          } catch (_) {}

          const meta = FileMetadataService.resolveMetadata(
            f,
            brandPurchasers,
            content?.pattern?.purchaser_key || filenameToMetadata[f]?.purchaser,
          );

          const checkpoint = filenameToMetadata[f];

          return {
            filename: f,
            status,
            mtime,
            brand: meta.brand,
            purchaser: meta.purchaser,
            patternKey:
              content?.pattern?.pattern_key ?? checkpoint?.patternKey ?? null,
            purchaserKey:
              content?.pattern?.purchaser_key ?? checkpoint?.purchaser ?? null,
            success: content?.success ?? (status === "success" ? true : false),
            json: content,
            runId: content?._runId ?? checkpoint?.runId ?? null,
            sourceRelativePath:
              content?._relativePath ?? checkpoint?.relativePath ?? null,
            sourceBrand: content?._brand ?? meta.brand ?? null,
            sourcePurchaser: content?._purchaser ?? meta.purchaser ?? null,
          };
        });
    };

    const succFiles = loadFiles(succDir, "success");
    const failFiles = loadFiles(failDir, "failed");

    return [...succFiles, ...failFiles].sort((a, b) => b.mtime - a.mtime);
  }
}
