import {
  ListObjectsV2Command,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createWriteStream,
  createReadStream,
  mkdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import {
  IS3Service,
  SyncResult,
  SyncFileSyncedJob,
} from "../../core/domain/services/IS3Service.js";
import {
  ISyncRepository,
  ManifestEntry,
} from "../../core/domain/repositories/ISyncRepository.js";

export class AwsS3Service implements IS3Service {
  private s3Client: S3Client;

  constructor(
    region: string,
    private syncRepo: ISyncRepository,
  ) {
    this.s3Client = new S3Client({ region });
  }

  async syncBucket(
    bucketConfig: any,
    stagingDir: string,
    options?: {
      limitRemaining?: { value: number };
      initialLimit?: number;
      onProgress?: (done: number, total: number) => void;
      onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
      onFileSynced?: (job: SyncFileSyncedJob) => void;
      onStartDownload?: (destPath: string, manifestKey: string) => void;
      alreadyExtractedPaths?: Set<string>;
    },
  ): Promise<SyncResult> {
    const prefix = bucketConfig.prefix ?? "";

    let synced = 0;
    let skipped = 0;
    let errors = 0;
    const downloadedFiles: string[] = [];

    const brand = bucketConfig.name;
    const brandDir = join(stagingDir, brand);
    const purchaser =
      bucketConfig.purchaser ??
      (brand.includes("__") ? brand.split("__")[1] : "");
    if (!existsSync(brandDir)) mkdirSync(brandDir, { recursive: true });

    const initialLimit = options?.initialLimit ?? 0;

    // Total might grow as we discover keys
    let totalDiscovered = 0;

    const reportProgress = () => {
      if (!options?.onProgress) return;
      const done =
        initialLimit > 0 && options.limitRemaining
          ? initialLimit - options.limitRemaining.value
          : synced + skipped + errors;
      const total = initialLimit > 0 ? initialLimit : totalDiscovered;
      options.onProgress(done, Math.max(done, total));
    };

    let continuationToken: string | undefined;
    do {
      // Respect shared limit
      if (options?.limitRemaining && options.limitRemaining.value <= 0) break;

      const cmd = new ListObjectsV2Command({
        Bucket: bucketConfig.bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      });

      const out = await this.s3Client.send(cmd);
      const contents = out.Contents ?? [];
      totalDiscovered += contents.length;

      for (const obj of contents) {
        if (!obj.Key) continue;
        if (options?.limitRemaining && options.limitRemaining.value <= 0) break;

        const key = obj.Key;
        const etag = obj.ETag?.replace(/"/g, "") || "";
        const size = obj.Size ?? 0;

        const keyAfterPrefix =
          prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
        const destPath = purchaser
          ? join(brandDir, purchaser, keyAfterPrefix)
          : join(brandDir, key);
        const mk = `${brand}/${key}`;

        // Fast-skip: already extracted
        if (options?.alreadyExtractedPaths?.has(destPath)) {
          skipped++;
          options.onSyncSkipProgress?.(skipped, skipped + synced);
          if (options.onFileSynced) {
            const relativePath = relative(brandDir, destPath).replace(
              /\\/g,
              "/",
            );
            await options.onFileSynced({
              filePath: destPath,
              relativePath,
              brand,
              purchaser: purchaser || undefined,
            });
          }
          reportProgress();
          continue;
        }

        const shouldSkip = await this.skipIfUnchanged(destPath, mk, {
          etag,
          size,
        });
        if (shouldSkip) {
          skipped++;
          options?.onSyncSkipProgress?.(skipped, skipped + synced);
          if (options?.onFileSynced) {
            const relativePath = relative(brandDir, destPath).replace(
              /\\/g,
              "/",
            );
            await options.onFileSynced({
              filePath: destPath,
              relativePath,
              brand,
              purchaser: purchaser || undefined,
            });
          }
          reportProgress();
          continue;
        }

        try {
          await options?.onStartDownload?.(destPath, mk);
          await this.downloadToFile(bucketConfig.bucket, key, destPath);
          const sha = await this.computeFileSha256(destPath);
          const entry: ManifestEntry = { sha256: sha, etag, size };

          await this.syncRepo.upsertManifestEntry(mk, entry);
          synced++;
          downloadedFiles.push(destPath);

          if (options?.limitRemaining) options.limitRemaining.value--;

          options?.onSyncSkipProgress?.(skipped, skipped + synced);

          if (options?.onFileSynced) {
            const relativePath = relative(brandDir, destPath).replace(
              /\\/g,
              "/",
            );
            await options.onFileSynced({
              filePath: destPath,
              relativePath,
              brand,
              purchaser: purchaser || undefined,
            });
          }

          reportProgress();
        } catch (e) {
          errors++;
          console.error(
            `Failed to download s3://${bucketConfig.bucket}/${key}:`,
            e,
          );
          reportProgress();
        }
      }

      continuationToken = out.NextContinuationToken;
    } while (continuationToken);

    reportProgress();

    return {
      brand,
      purchaser: purchaser || "",
      synced,
      skipped,
      errors,
      files: downloadedFiles,
    };
  }

  private async listAllKeys(
    bucket: string,
    prefix: string,
  ): Promise<{ key: string; etag: string; size: number }[]> {
    const keys: { key: string; etag: string; size: number }[] = [];
    let continuationToken: string | undefined;
    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
      });
      const out = await this.s3Client.send(cmd);
      const contents = out.Contents ?? [];
      for (const obj of contents) {
        if (obj.Key) {
          keys.push({
            key: obj.Key,
            etag: obj.ETag?.replace(/"/g, "") || "",
            size: obj.Size ?? 0,
          });
        }
      }
      continuationToken = out.NextContinuationToken;
    } while (continuationToken);
    return keys;
  }

  /**
   * Returns true if the file should be skipped (already downloaded and unchanged).
   * Handles legacy string SHA entries, modern object entries, and recovery (file on disk, not in manifest).
   */
  private async skipIfUnchanged(
    destPath: string,
    keyInManifest: string,
    s3Metadata: { etag: string; size: number },
  ): Promise<boolean> {
    if (!existsSync(destPath)) return false;

    const entry = await this.syncRepo.getManifestEntry(keyInManifest);
    if (entry) {
      // Modern entry: instant compare via ETag + size
      if (typeof entry === "object") {
        return entry.etag === s3Metadata.etag && entry.size === s3Metadata.size;
      }
      // Legacy entry: string SHA-256 — fall back to disk hash
      try {
        const actualSha = await this.computeFileSha256(destPath);
        return actualSha === entry;
      } catch {
        return false;
      }
    }

    // Recovery path: file exists on disk but not in manifest.
    // If size matches, compute SHA once and treat as unchanged.
    try {
      const stats = statSync(destPath);
      if (stats.size === s3Metadata.size) {
        const sha = await this.computeFileSha256(destPath);
        const entry = {
          sha256: sha,
          etag: s3Metadata.etag,
          size: s3Metadata.size,
        };
        await this.syncRepo.upsertManifestEntry(keyInManifest, entry);
        return true;
      }
    } catch {
      // ignore, re-download
    }

    return false;
  }

  private async downloadToFile(
    bucket: string,
    key: string,
    destPath: string,
  ): Promise<void> {
    const dir = dirname(destPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.s3Client.send(cmd);
    const body = response.Body as Readable;
    if (!body) throw new Error(`No body for s3://${bucket}/${key}`);
    const ws = createWriteStream(destPath);
    await pipeline(body, ws);
  }

  private async computeFileSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const rs = createReadStream(filePath);
      rs.on("data", (chunk: Buffer | string) => hash.update(chunk));
      rs.on("end", () => resolve(hash.digest("hex")));
      rs.on("error", reject);
    });
  }
}
