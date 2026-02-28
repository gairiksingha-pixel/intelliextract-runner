import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";
import { ExtractionFileDetails } from "../domain/types.js";
import { FileMetadataService } from "../domain/services/FileMetadataService.js";

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

        const safe = (c.relativePath || "")
          .replaceAll("/", "_")
          .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
        const base = c.brand + "_" + (safe || "file");
        const filename = base.endsWith(".json") ? base : base + ".json";

        const meta = FileMetadataService.resolveMetadata(
          filename,
          brandPurchasers,
          fullResponse?.pattern?.purchaser_key || c.purchaser,
        );

        return {
          filename,
          status,
          mtime,
          brand: meta.brand || c.brand,
          purchaser: meta.purchaser || c.purchaser || "N/A",
          patternKey:
            fullResponse?.pattern?.pattern_key ?? c.patternKey ?? null,
          purchaserKey:
            fullResponse?.pattern?.purchaser_key ?? c.purchaser ?? null,
          success: fullResponse?.success ?? status === "success",
          json: fullResponse,
          runId: fullResponse?._runId ?? c.runId ?? null,
          sourceRelativePath:
            fullResponse?._relativePath ?? c.relativePath ?? null,
          sourceBrand: fullResponse?._brand ?? c.brand ?? null,
          sourcePurchaser: fullResponse?._purchaser ?? c.purchaser ?? null,
        };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }
}
