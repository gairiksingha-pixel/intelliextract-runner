import { ICheckpointRepository } from "../domain/repositories/checkpoint.repository.js";
import { ExtractionFileDetails } from "../domain/types.js";
import { FileMetadataService } from "../domain/services/file-metadata.service.js";

export class GetExtractionDataUseCase {
  constructor(private checkpointRepo: ICheckpointRepository) {}

  async execute(
    brandPurchasers: Record<string, string[]>,
    options?: { limit?: number; offset?: number },
  ): Promise<ExtractionFileDetails[]> {
    const allCheckpoints = await this.checkpointRepo.getAllCheckpoints(
      options?.limit,
      options?.offset,
    );

    return allCheckpoints
      .filter((c) => c.status === "done" || c.status === "error")
      .map((c) => {
        const fullResponse = c.fullResponse || {};
        const status = (c.status === "done" ? "success" : "failed") as
          | "success"
          | "failed";
        const mtime = c.finishedAt ? new Date(c.finishedAt).getTime() : 0;

        // Ensure brand and purchaser are recovered from path if missing in DB record
        let brand = c.brand;
        let purchaser = c.purchaser;
        if (!brand || brand === "null") {
          const parts = (c.relativePath || "").split(/[/\\]/);
          if (parts.length >= 1 && parts[0]) brand = parts[0];
        }
        if (!purchaser || purchaser === "null" || purchaser === "N/A") {
          const parts = (c.relativePath || "").split(/[/\\]/);
          if (parts.length >= 2 && parts[1]) purchaser = parts[1];
        }

        const safe = (c.relativePath || "")
          .replaceAll("/", "_")
          .replaceAll(/[^a-zA-Z0-9._-]/g, "_");

        let base = (brand || "unknown") + "_" + (safe || "file");
        // De-duplicate if brand is already at start of safe
        if (brand && safe.startsWith(brand + "_")) {
          base = safe;
        }

        const filename = base.endsWith(".json") ? base : base + ".json";

        const meta = FileMetadataService.resolveMetadata(
          filename,
          brandPurchasers,
          fullResponse?.pattern?.purchaser_key || purchaser,
        );

        return {
          filename,
          status,
          mtime,
          brand: meta.brand || brand || "N/A",
          purchaser: meta.purchaser || purchaser || "N/A",
          patternKey:
            fullResponse?.pattern?.pattern_key ?? c.patternKey ?? null,
          purchaserKey:
            fullResponse?.pattern?.purchaser_key ?? purchaser ?? null,
          success: fullResponse?.success ?? status === "success",
          json: fullResponse,
          runId: fullResponse?._runId ?? c.runId ?? null,
          sourceRelativePath:
            fullResponse?._relativePath ?? c.relativePath ?? null,
          sourceBrand: fullResponse?._brand ?? brand ?? null,
          sourcePurchaser: fullResponse?._purchaser ?? purchaser ?? null,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }
}
