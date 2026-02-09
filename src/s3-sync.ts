/**
 * Sync files from brand-specific S3 buckets to a local staging directory.
 * Preserves brand folder structure: staging/<BrandName>/<key>
 * Supports syncLimit (max files to download) and SHA-256 skip for already-downloaded unchanged files.
 */

import { ListObjectsV2Command, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream, createReadStream, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Config, S3BucketConfig } from './types.js';

function getS3Client(region: string): S3Client {
  return new S3Client({ region });
}

async function listAllKeys(
  client: S3Client,
  bucket: string,
  prefix: string
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

function loadSyncManifest(manifestPath: string): Record<string, string> {
  if (!existsSync(manifestPath)) return {};
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, string>;
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

function saveSyncManifest(manifestPath: string, data: Record<string, string>): void {
  const dir = dirname(manifestPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(data, null, 0), 'utf-8');
}

async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const rs = createReadStream(filePath);
    rs.on('data', (chunk: Buffer | string) => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
    rs.on('error', reject);
  });
}

/** Returns true if file exists and its SHA-256 matches the manifest (skip re-download). */
async function skipIfUnchanged(
  destPath: string,
  keyInManifest: string,
  manifest: Record<string, string>
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
  destPath: string
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
  }
): Promise<{ brand: string; synced: number; skipped: number; errors: number }> {
  const prefix = bucketConfig.prefix ?? '';
  const keys = await listAllKeys(client, bucketConfig.bucket, prefix);
  let synced = 0;
  let skipped = 0;
  let errors = 0;
  const brandDir = join(stagingDir, bucketConfig.name);
  if (!existsSync(brandDir)) mkdirSync(brandDir, { recursive: true });
  const brand = bucketConfig.name;

  for (const { key } of keys) {
    if (options.limitRemaining.value <= 0) break;

    const destPath = join(brandDir, key);
    const mk = manifestKey(brand, key);

    const shouldSkip = await skipIfUnchanged(destPath, mk, options.manifest);
    if (shouldSkip) {
      skipped++;
      continue;
    }

    try {
      await downloadToFile(client, bucketConfig.bucket, key, destPath);
      const sha = await computeFileSha256(destPath);
      options.manifest[mk] = sha;
      synced++;
      options.limitRemaining.value--;
    } catch (e) {
      errors++;
      console.error(`Failed to download s3://${bucketConfig.bucket}/${key}:`, e);
    }
  }

  return { brand, synced, skipped, errors };
}

/**
 * Sync all configured buckets to staging. Respects syncLimit and uses SHA-256 manifest to skip unchanged files.
 * @param overrides.syncLimit - Override config (e.g. from CLI --limit).
 */
export async function syncAllBuckets(
  config: Config,
  overrides?: { syncLimit?: number }
): Promise<{ brand: string; synced: number; skipped: number; errors: number }[]> {
  const client = getS3Client(config.s3.region);
  const stagingDir = config.s3.stagingDir;
  if (!existsSync(stagingDir)) mkdirSync(stagingDir, { recursive: true });

  const limit = overrides?.syncLimit ?? config.s3.syncLimit;
  const limitRemaining = { value: limit !== undefined && limit > 0 ? limit : Number.MAX_SAFE_INTEGER };

  const manifestPath =
    config.s3.syncManifestPath ?? join(dirname(config.run.checkpointPath), 'sync-manifest.json');
  const manifest = loadSyncManifest(manifestPath);

  const results: { brand: string; synced: number; skipped: number; errors: number }[] = [];
  for (const bucket of config.s3.buckets) {
    const result = await syncBucket(client, bucket, stagingDir, {
      manifest,
      manifestPath,
      limitRemaining,
    });
    results.push(result);
    console.log(
      `[S3] ${result.brand}: synced ${result.synced}, skipped (unchanged) ${result.skipped}, errors ${result.errors}`
    );
  }

  saveSyncManifest(manifestPath, manifest);
  return results;
}
