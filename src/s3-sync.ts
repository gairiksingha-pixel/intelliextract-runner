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
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { Config, S3BucketConfig } from "./types.js";

function getS3Client(region: string): S3Client {
  return new S3Client({ region });
}

async function listAllKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<{ key: string }[]> {
  const keys: { key: string }[] = [];
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
      if (obj.Key) keys.push({ key: obj.Key });
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

function loadSyncManifest(manifestPath: string): Record<string, string> {
  if (!existsSync(manifestPath)) return {};
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, string>;
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

function saveSyncManifest(
  manifestPath: string,
  data: Record<string, string>,
): void {
  const dir = dirname(manifestPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(data, null, 0), "utf-8");
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

/** Returns true if file exists and its SHA-256 matches the manifest (skip re-download). */
async function skipIfUnchanged(
  destPath: string,
  keyInManifest: string,
  manifest: Record<string, string>,
): Promise<boolean> {
  if (!existsSync(destPath)) return false;
  const expectedSha = manifest[keyInManifest];
  if (!expectedSha) return false;
  try {
    const actualSha = await computeFileSha256(destPath);
    return actualSha === expectedSha;
  } catch {
    return false;
  }
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
    manifest: Record<string, string>;
    manifestPath: string;
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
  },
): Promise<{
  brand: string;
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

  for (const { key } of keys) {
    if (options.limitRemaining.value <= 0) break;

    const keyAfterPrefix =
      prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
    const destPath = purchaser
      ? join(brandDir, purchaser, keyAfterPrefix)
      : join(brandDir, key);
    const mk = manifestKey(brand, key);

    const shouldSkip = await skipIfUnchanged(destPath, mk, options.manifest);
    if (shouldSkip) {
      skipped++;
      options.onSyncSkipProgress?.(skipped, skipped + synced);
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
      options.manifest[mk] = sha;
      saveSyncManifest(options.manifestPath, options.manifest);
      synced++;
      options.onSyncSkipProgress?.(skipped, skipped + synced);
      options.limitRemaining.value--;
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
  return { brand, stagingPath: stagingPathForResult, synced, skipped, errors };
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

  const manifestPath =
    config.s3.syncManifestPath ??
    join(dirname(config.run.checkpointPath), "sync-manifest.json");
  const manifest = loadSyncManifest(manifestPath);

  const buckets = overrides?.buckets ?? config.s3.buckets;
  const results: SyncResult[] = [];
  for (const bucket of buckets) {
    const result = await syncBucket(client, bucket, stagingDir, {
      manifest,
      manifestPath,
      limitRemaining,
      onProgress: overrides?.onProgress,
      initialLimit,
      onSyncSkipProgress: overrides?.onSyncSkipProgress,
      onFileSynced: overrides?.onFileSynced,
      onStartDownload: overrides?.onStartDownload,
    });
    results.push(result);
  }

  saveSyncManifest(manifestPath, manifest);
  return results;
}

export interface SyncResult {
  brand: string;
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
