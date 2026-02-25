/**
 * Sync files from brand-specific S3 buckets to a local staging directory.
 * Structure: staging/<brand>/<purchaser>/<key after prefix> (purchaser-wise subfolders per brand).
 * Supports syncLimit (max files to download) and SHA-256 skip for already-downloaded unchanged files.
 */

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
import type { Config, S3BucketConfig, ManifestEntry } from "./types.js";
import {
  openCheckpointDb,
  getSyncManifest,
  upsertSyncManifestEntry,
  closeCheckpointDb,
} from "./checkpoint.js";

function getS3Client(region: string): S3Client {
  return new S3Client({ region });
}

async function listAllKeys(
  client: S3Client,
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
    const out = await client.send(cmd);
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

function manifestKey(brand: string, key: string): string {
  return `${brand}/${key}`;
}

/**
 * Top-level staging folder for a bucket (brand). Inside it we use purchaser-wise subfolders.
 * Structure: stagingDir/<brand>/<purchaser>/<key after prefix>.
 */
export function getStagingSubdir(bucket: S3BucketConfig): string {
  return bucket.name;
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const rs = createReadStream(filePath);
    rs.on("data", (chunk: Buffer | string) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", reject);
  });
}

/** Returns true if file exists and headers/manifest match (skip re-download). */
async function skipIfUnchanged(
  destPath: string,
  keyInManifest: string,
  manifest: Record<string, ManifestEntry | string>,
  s3Metadata: { etag: string; size: number },
): Promise<boolean> {
  if (!existsSync(destPath)) return false;

  const entry = manifest[keyInManifest];
  if (entry) {
    // Modern entry: compare ETag and Size (instant skip)
    if (typeof entry === "object") {
      if (entry.etag === s3Metadata.etag && entry.size === s3Metadata.size) {
        return true;
      }
      return false;
    }

    // Legacy entry (string SHA-256): falls back to disk I/O
    try {
      const actualSha = await computeFileSha256(destPath);
      return actualSha === entry;
    } catch {
      return false;
    }
  }

  // Recovery: file exists on disk but not in manifest.
  // We compute the hash once and assume it belongs to this S3 version if size matches.
  try {
    const stats = statSync(destPath);
    if (stats.size === s3Metadata.size) {
      const sha = await computeFileSha256(destPath);
      manifest[keyInManifest] = {
        sha256: sha,
        etag: s3Metadata.etag,
        size: s3Metadata.size,
      };
      return true;
    }
  } catch {
    // ignore errors, let it re-download
  }

  return false;
}

async function downloadToFile(
  client: S3Client,
  bucket: string,
  key: string,
  destPath: string,
): Promise<void> {
  const dir = dirname(destPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await client.send(cmd);
  const body = response.Body as Readable;
  if (!body) throw new Error(`No body for s3://${bucket}/${key}`);
  const ws = createWriteStream(destPath);
  await pipeline(body, ws);
}

/**
 * Sync one bucket to stagingDir/brandName/ with optional limit and SHA-256 skip.
 */
export async function syncBucket(
  client: S3Client,
  bucketConfig: S3BucketConfig,
  stagingDir: string,
  options: {
    manifest: Record<string, ManifestEntry | string>;
    limitRemaining: { value: number };
    /** When set, called after each file. done = new downloads so far; total = limit or 0 (unknown). */
    onProgress?: (done: number, total: number) => void;
    /** Used for progress: limit when set, 0 when no limit (unknown total). */
    initialLimit: number;
    /** When set, called when a file is skipped (already present) or after sync: (skipped, totalProcessed) so UI can show "Skipping synced files". */
    onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
    /** When set, called after each file is successfully synced (for pipeline: trigger extraction). */
    onFileSynced?: (job: {
      filePath: string;
      relativePath: string;
      brand: string;
    }) => void;
    /** When set, called before downloading a file (for resume: persist in-progress path so partial can be removed). */
    onStartDownload?: (destPath: string, manifestKey: string) => void;
    /** When set, paths in this set are treated as already extracted; skip file read/SHA check and count as skipped. */
    alreadyExtractedPaths?: Set<string>;
    /** Called when a manifest entry needs to be updated in the database. */
    onManifestUpdate?: (key: string, entry: ManifestEntry) => void;
  },
): Promise<{
  brand: string;
  purchaser: string;
  stagingPath: string;
  synced: number;
  skipped: number;
  errors: number;
}> {
  const prefix = bucketConfig.prefix ?? "";
  const keys = await listAllKeys(client, bucketConfig.bucket, prefix);
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  const brand = bucketConfig.name;
  const brandDir = join(stagingDir, brand);
  const purchaser =
    bucketConfig.purchaser ??
    (bucketConfig.name.includes("__") ? bucketConfig.name.split("__")[1] : "");
  if (!existsSync(brandDir)) mkdirSync(brandDir, { recursive: true });
  const stagingPathForResult = purchaser ? join(brandDir, purchaser) : brandDir;

  const reportProgress = () => {
    if (!options.onProgress) return;
    const total = options.initialLimit > 0 ? options.initialLimit : keys.length;
    const done =
      options.initialLimit > 0
        ? options.initialLimit - options.limitRemaining.value
        : synced + skipped + errors;
    options.onProgress(done, total);
  };
  reportProgress(); // Initial reporting of 0/Total (or 0/0)

  for (const { key, etag, size } of keys) {
    if (options.limitRemaining.value <= 0) break;

    const keyAfterPrefix =
      prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const destPath = purchaser
      ? join(brandDir, purchaser, keyAfterPrefix)
      : join(brandDir, key);
    const mk = manifestKey(brand, key);

    if (options.alreadyExtractedPaths?.has(destPath)) {
      skipped++;
      options.onSyncSkipProgress?.(skipped, skipped + synced);
      if (options.onFileSynced) {
        const relativePath = relative(brandDir, destPath).replace(/\\/g, "/");
        options.onFileSynced({ filePath: destPath, relativePath, brand });
      }
      reportProgress();
      continue;
    }

    const shouldSkip = await skipIfUnchanged(destPath, mk, options.manifest, {
      etag,
      size,
    });
    if (shouldSkip) {
      skipped++;
      options.onSyncSkipProgress?.(skipped, skipped + synced);
      // Ensure manifest has the latest info (may have been legacy or recovery)
      if (typeof options.manifest[mk] === "string" || !options.manifest[mk]) {
        // computeFileSha256 was already called in skipIfUnchanged in these cases
        // or we just reuse the old string if it was legacy.
        // skipIfUnchanged already updated its entry if it was recovery.
        // We only save if it's been updated.
        const entry = options.manifest[mk];
        if (typeof entry === "object") {
          options.onManifestUpdate?.(mk, entry);
        }
      }
      if (options.onFileSynced) {
        const relativePath = relative(brandDir, destPath).replace(/\\/g, "/");
        options.onFileSynced({ filePath: destPath, relativePath, brand });
      }
      reportProgress();
      continue;
    }

    try {
      options.onStartDownload?.(destPath, mk);
      await downloadToFile(client, bucketConfig.bucket, key, destPath);
      const sha = await computeFileSha256(destPath);
      const entry = { sha256: sha, etag, size };
      options.manifest[mk] = entry;
      options.onManifestUpdate?.(mk, entry);
      synced++;
      if (options.onFileSynced) {
        const relativePath = relative(brandDir, destPath).replace(/\\/g, "/");
        options.onFileSynced({ filePath: destPath, relativePath, brand });
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

  reportProgress();
  return {
    brand,
    purchaser: purchaser || "",
    stagingPath: stagingPathForResult,
    synced,
    skipped,
    errors,
  };
}

/**
 * Sync all configured buckets to staging. Respects syncLimit and uses SHA-256 manifest to skip unchanged files.
 * @param overrides.syncLimit - Override config (e.g. from CLI --limit).
 * @param overrides.buckets - Use these buckets instead of config.s3.buckets (e.g. for tenant/purchaser filter).
 * @param overrides.onProgress - Optional progress callback: (done, total). total is 0 when limit not set (unknown).
 */
export async function syncAllBuckets(
  config: Config,
  overrides?: {
    syncLimit?: number;
    buckets?: S3BucketConfig[];
    onProgress?: (done: number, total: number) => void;
    onSyncSkipProgress?: (skipped: number, totalProcessed: number) => void;
    onFileSynced?: (job: {
      filePath: string;
      relativePath: string;
      brand: string;
    }) => void;
    onStartDownload?: (destPath: string, manifestKey: string) => void;
    /** When set, paths in this set are already extracted; sync skips file read/SHA for them. */
    alreadyExtractedPaths?: Set<string>;
  },
): Promise<SyncResult[]> {
  const client = getS3Client(config.s3.region);
  const stagingDir = config.s3.stagingDir;
  if (!existsSync(stagingDir)) mkdirSync(stagingDir, { recursive: true });

  const limit = overrides?.syncLimit ?? config.s3.syncLimit;
  const limitRemaining = {
    value: limit !== undefined && limit > 0 ? limit : Number.MAX_SAFE_INTEGER,
  };
  const initialLimit = limit !== undefined && limit > 0 ? limit : 0;

  const db = openCheckpointDb(config.run.checkpointPath);
  const manifest = getSyncManifest(db);

  const buckets = overrides?.buckets ?? config.s3.buckets;
  const results: SyncResult[] = [];
  for (const bucket of buckets) {
    const result = await syncBucket(client, bucket, stagingDir, {
      manifest,
      limitRemaining,
      onProgress: overrides?.onProgress,
      initialLimit,
      onSyncSkipProgress: overrides?.onSyncSkipProgress,
      onFileSynced: overrides?.onFileSynced,
      onStartDownload: overrides?.onStartDownload,
      alreadyExtractedPaths: overrides?.alreadyExtractedPaths,
      onManifestUpdate: (key, entry) => upsertSyncManifestEntry(db, key, entry),
    });
    results.push(result);
  }

  closeCheckpointDb(db);

  // Record history
  try {
    const totalSynced = results.reduce((s, r) => s + r.synced, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors, 0);
    if (totalSynced > 0 || totalSkipped > 0 || totalErrors > 0) {
      const { appendSyncHistory } = await import("./sync-history.js");
      appendSyncHistory(dirname(config.run.checkpointPath), {
        timestamp: new Date().toISOString(),
        synced: totalSynced,
        skipped: totalSkipped,
        errors: totalErrors,
        brands: results.map((r) => r.brand),
        purchasers: results.map((r) => r.purchaser || ""),
      });
    }
  } catch (e) {
    // ignore history write errors
  }

  return results;
}

export interface SyncResult {
  brand: string;
  purchaser: string;
  stagingPath: string;
  synced: number;
  skipped: number;
  errors: number;
}

/**
 * Print structured sync summary. Clarifies: download limit applies only to new downloads;
 * skipped = already present and unchanged (do not count toward limit).
 */
export function printSyncResults(
  results: SyncResult[],
  syncLimit?: number,
): void {
  const totalSynced = results.reduce((s, r) => s + r.synced, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors, 0);
  const limitLabel =
    syncLimit !== undefined && syncLimit > 0
      ? `${syncLimit} new file(s)`
      : "no limit";

  const lines: string[] = [
    "Sync Summary",
    "------------",
    `Download limit: ${limitLabel}`,
    `Downloaded (new): ${totalSynced}`,
    `Skipped (already present, unchanged): ${totalSkipped}`,
    `Errors: ${totalErrors}`,
    "",
  ];

  if (results.length > 0) {
    lines.push("By brand (staging path → counts):");
    for (const r of results) {
      const [tenant, purchaser] = r.brand.includes("__")
        ? r.brand.split("__")
        : [r.brand, ""];
      const label = purchaser ? `${tenant} / ${purchaser}` : r.brand;
      lines.push(
        `  ${label}`,
        `    Staging path: ${r.stagingPath}`,
        `    Downloaded: ${r.synced}, Skipped: ${r.skipped}, Errors: ${r.errors}`,
      );
    }
  }

  console.log(lines.join("\n"));
}
