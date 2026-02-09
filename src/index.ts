#!/usr/bin/env node
/**
 * EntelliExtract Test Stub – CLI
 * Commands: sync | run | report
 */

import { program } from 'commander';
import { loadConfig, getConfigPath } from './config.js';
import { syncAllBuckets } from './s3-sync.js';
import { runFull, runExtractionOnly } from './runner.js';
import { buildSummary, writeReports } from './report.js';
import { openCheckpointDb, getRecordsForRun, closeCheckpointDb } from './checkpoint.js';
import { computeMetrics } from './metrics.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const LAST_RUN_FILE = 'last-run-id.txt';

function getLastRunIdPath(config: ReturnType<typeof loadConfig>): string {
  const checkpointDir = dirname(config.run.checkpointPath);
  return `${checkpointDir}/${LAST_RUN_FILE}`;
}

function saveLastRunId(config: ReturnType<typeof loadConfig>, runId: string): void {
  const path = getLastRunIdPath(config);
  writeFileSync(path, runId, 'utf-8');
}

program
  .name('entelliextract-test-stub')
  .description('Test automation for EntelliExtract API: S3 sync, extraction run with checkpointing, and executive report')
  .option('-c, --config <path>', 'Config file path', getConfigPath());

program
  .command('sync')
  .description('Sync production S3 buckets (Sundia, No Cow, Tractor) to staging')
  .option('--limit <n>', 'Max number of files to download (0 = no limit). Skipped (unchanged SHA-256) do not count.', Number.parseInt)
  .action(async (cmdOpts: { limit?: number }) => {
    try {
      const opts = program.opts() as { config?: string };
      const config = loadConfig(opts.config ?? getConfigPath());
      const syncLimit =
        cmdOpts.limit === undefined || Number.isNaN(cmdOpts.limit) ? undefined : cmdOpts.limit;
      console.log('Syncing S3 buckets to staging...');
      const results = await syncAllBuckets(config, syncLimit === undefined ? undefined : { syncLimit });
      console.log('Sync complete:', results);
    } catch (e) {
      console.error('Sync failed:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program
  .command('run')
  .description('Run extraction against all staging files (with optional S3 sync). Resumable via checkpoint.')
  .option('--no-sync', 'Skip S3 sync; use existing staging files')
  .option('--no-report', 'Do not write report after run')
  .option('--sync-limit <n>', 'Max files to download when syncing (0 = no limit).', Number.parseInt)
  .option('--extract-limit <n>', 'Max files to extract in this run (0 = no limit).', Number.parseInt)
  .action(async (opts: { sync: boolean; report: boolean; syncLimit?: number; extractLimit?: number }) => {
    try {
      const globalOpts = program.opts() as { config?: string };
      const config = loadConfig(globalOpts.config ?? getConfigPath());
      const doSync = opts.sync === true || opts.sync === undefined;
      const doReport = opts.report === true || opts.report === undefined;
      const syncLimit =
        opts.syncLimit === undefined || Number.isNaN(opts.syncLimit) ? undefined : opts.syncLimit;
      const extractLimit =
        opts.extractLimit === undefined || Number.isNaN(opts.extractLimit) ? undefined : opts.extractLimit;
      console.log(doSync ? 'Running with S3 sync...' : 'Running extraction only (no sync)...');
      const result = await (doSync
        ? runFull({ configPath: globalOpts.config, syncLimit, extractLimit })
        : runExtractionOnly({ configPath: globalOpts.config, extractLimit }));
      console.log(`Run ${result.run.runId} finished. Success: ${result.metrics.success}, Failed: ${result.metrics.failed}, Skipped: ${result.metrics.skipped}`);
      saveLastRunId(config, result.run.runId);
      if (doReport) {
        const summary = buildSummary(result.metrics);
        const paths = writeReports(config, summary);
        console.log('Report(s) written:', paths);
      }
    } catch (e) {
      console.error('Run failed:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program
  .command('report')
  .description('Generate executive summary report from last run (or specified run-id)')
  .option('-r, --run-id <id>', 'Run ID to report (default: last run)')
  .action(async (cmdOpts: { runId?: string }) => {
    try {
      const globalOpts = program.opts() as { config?: string };
      const config = loadConfig(globalOpts.config ?? getConfigPath());
      let runId = cmdOpts.runId;
      if (!runId) {
        const lastPath = getLastRunIdPath(config);
        if (!existsSync(lastPath)) {
          console.error('No last run found. Run "run" first or pass --run-id.');
          process.exit(1);
        }
        runId = readFileSync(lastPath, 'utf-8').trim();
      }
      if (runId === undefined) process.exit(1);
      const db = openCheckpointDb(config.run.checkpointPath);
      const records = getRecordsForRun(db, runId);
      closeCheckpointDb(db);
      if (records.length === 0) {
        console.error(`No records found for run ${runId}`);
        process.exit(1);
      }
      let startedAt = records.reduce((min, r) => {
        const t = r.startedAt ? new Date(r.startedAt).getTime() : Infinity;
        return Math.min(t, min);
      }, Infinity);
      let finishedAt = records.reduce((max, r) => {
        const t = r.finishedAt ? new Date(r.finishedAt).getTime() : 0;
        return Math.max(t, max);
      }, 0);
      if (!Number.isFinite(startedAt) || startedAt === Infinity) startedAt = 0;
      if (!Number.isFinite(finishedAt) || finishedAt < startedAt) finishedAt = startedAt || Date.now();
      const metrics = computeMetrics(runId, records, new Date(startedAt), new Date(finishedAt));
      const summary = buildSummary(metrics);
      const paths = writeReports(config, summary);
      console.log('Report(s) written:', paths);
    } catch (e) {
      console.error('Report failed:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  });

program.parse();
