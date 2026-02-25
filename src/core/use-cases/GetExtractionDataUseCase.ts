import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { ICheckpointRepository } from "../domain/repositories/ICheckpointRepository.js";

export class GetExtractionDataUseCase {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private extractionsDir: string,
  ) {}

  async execute() {
    const succDir = join(this.extractionsDir, "succeeded");
    const failDir = join(this.extractionsDir, "failed");

    const allCheckpoints = await this.checkpointRepo.getAllCheckpoints();
    // Map filename to metadata for recovery
    const filenameToMetadata: Record<string, any> = {};
    (allCheckpoints as any[]).forEach((c) => {
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

    const loadFiles = (dir: string, status: string) => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => {
          const path = join(dir, f);
          let content: any = {};
          let mtime = 0;
          try {
            content = JSON.parse(readFileSync(path, "utf-8"));
            mtime = statSync(path).mtimeMs;
          } catch (_) {}

          if (content && filenameToMetadata[f]) {
            content._relativePath =
              content._relativePath || filenameToMetadata[f].relativePath;
            content._brand = content._brand || filenameToMetadata[f].brand;
            content._purchaser =
              content._purchaser || filenameToMetadata[f].purchaser;
            content._runId = content._runId || filenameToMetadata[f].runId;
          }

          return { filename: f, status, content, mtime };
        });
    };

    const succFiles = loadFiles(succDir, "success");
    const failFiles = loadFiles(failDir, "failed");

    return [...succFiles, ...failFiles].sort((a, b) => b.mtime - a.mtime);
  }
}
