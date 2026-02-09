/**
 * Runner: orchestrates sync (optional) and extraction run, then returns result for reporting.
 */

import { loadConfig } from './config.js';
import { syncAllBuckets } from './s3-sync.js';
import { runExtraction } from './load-engine.js';
import { computeMetrics } from './metrics.js';
import type { Config, RunMetrics } from './types.js';
import type { LoadEngineResult } from './load-engine.js';

export interface RunOptions {
  configPath?: string;
  skipSync?: boolean;
  /** Override max files to sync (e.g. from CLI --sync-limit). */
  syncLimit?: number;
  /** Override max files to extract (e.g. from CLI --extract-limit). */
  extractLimit?: number;
}

export interface FullRunResult {
  config: Config;
  syncResults?: { brand: string; synced: number; skipped: number; errors: number }[];
  run: LoadEngineResult;
  metrics: RunMetrics;
}

/**
 * Sync S3, run extraction with checkpointing, and compute metrics.
 */
export async function runFull(options: RunOptions = {}): Promise<FullRunResult> {
  const config = loadConfig(options.configPath);

  let syncResults: { brand: string; synced: number; skipped: number; errors: number }[] | undefined;
  if (!options.skipSync) {
    syncResults = await syncAllBuckets(config, {
      syncLimit: options.syncLimit,
    });
  }

  const runResult = await runExtraction(config, {
    extractLimit: options.extractLimit,
  });
  const metrics = computeMetrics(
    runResult.runId,
    runResult.records,
    runResult.startedAt,
    runResult.finishedAt
  );

  return {
    config,
    syncResults,
    run: runResult,
    metrics,
  };
}

/**
 * Run extraction only (no sync). Use when staging is already populated.
 */
export async function runExtractionOnly(options: RunOptions = {}): Promise<FullRunResult> {
  return runFull({ ...options, skipSync: true });
}
