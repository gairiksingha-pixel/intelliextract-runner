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
      limit?: number;
      onProgress?: (done: number, total: number) => void;
    },
  ): Promise<SyncResult> {
    const prefix = bucketConfig.prefix ?? "";
    const keys = await this.listAllKeys(bucketConfig.bucket, prefix);
    const manifest = await this.syncRepo.getManifest();

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

    const totalToProcess =
      options?.limit && options.limit > 0 ? options.limit : keys.length;

    for (const { key, etag, size } of keys) {
      if (options?.limit && synced >= options.limit) break;

      const keyAfterPrefix =
        prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
      const destPath = purchaser
        ? join(brandDir, purchaser, keyAfterPrefix)
        : join(brandDir, key);
      const mk = `${brand}/${key}`;

      const shouldSkip = await this.skipIfUnchanged(destPath, mk, manifest, {
        etag,
        size,
      });
      if (shouldSkip) {
        skipped++;
        if (options?.onProgress)
          options.onProgress(synced + skipped, totalToProcess);
        continue;
      }

      try {
        await this.downloadToFile(bucketConfig.bucket, key, destPath);
        const sha = await this.computeFileSha256(destPath);
        const entry: ManifestEntry = { sha256: sha, etag, size };

        await this.syncRepo.upsertManifestEntry(mk, entry);
        synced++;
        downloadedFiles.push(destPath);

        if (options?.onProgress)
          options.onProgress(synced + skipped, totalToProcess);
      } catch (e) {
        errors++;
        console.error(
          `Failed to download s3://${bucketConfig.bucket}/${key}:`,
          e,
        );
      }
    }

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

  private async skipIfUnchanged(
    destPath: string,
    keyInManifest: string,
    manifest: Record<string, ManifestEntry | string>,
    s3Metadata: { etag: string; size: number },
  ): Promise<boolean> {
    if (!existsSync(destPath)) return false;
    const entry = manifest[keyInManifest];
    if (entry) {
      if (typeof entry === "object") {
        if (entry.etag === s3Metadata.etag && entry.size === s3Metadata.size)
          return true;
        return false;
      }
      try {
        const actualSha = await this.computeFileSha256(destPath);
        return actualSha === entry;
      } catch {
        return false;
      }
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
