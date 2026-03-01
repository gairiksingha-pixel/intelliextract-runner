import { join, relative } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { normalizeRelativePath } from "../../infrastructure/utils/storage.utils.js";

export interface DiscoverFilesRequest {
  stagingDir: string;
  pairs?: Array<{ brand: string; purchaser: string }>;
}

export class DiscoverFilesUseCase {
  execute(request: DiscoverFilesRequest): any[] {
    const files: any[] = [];

    if (request.pairs && request.pairs.length > 0) {
      for (const pair of request.pairs) {
        const purchaserPath = join(
          request.stagingDir,
          pair.brand,
          pair.purchaser,
        );
        if (existsSync(purchaserPath)) {
          this.walkDir(purchaserPath, (filePath) => {
            files.push({
              filePath,
              relativePath: normalizeRelativePath(
                relative(request.stagingDir, filePath),
              ),
              brand: pair.brand,
              purchaser: pair.purchaser,
            });
          });
        }
      }
    } else {
      // Discover all
      const brands = readdirSync(request.stagingDir).filter((f) => {
        const fullPath = join(request.stagingDir, f);
        return statSync(fullPath).isDirectory();
      });

      for (const brand of brands) {
        const brandPath = join(request.stagingDir, brand);
        const purchasers = readdirSync(brandPath).filter((f) => {
          const fullPath = join(brandPath, f);
          return statSync(fullPath).isDirectory();
        });

        for (const purchaser of purchasers) {
          const purchaserPath = join(brandPath, purchaser);
          this.walkDir(purchaserPath, (filePath) => {
            files.push({
              filePath,
              relativePath: normalizeRelativePath(
                relative(request.stagingDir, filePath),
              ),
              brand,
              purchaser,
            });
          });
        }
      }
    }

    return files;
  }

  private walkDir(dir: string, callback: (path: string) => void) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const res = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walkDir(res, callback);
      } else {
        callback(res);
      }
    }
  }
}
