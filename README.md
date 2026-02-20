# IntelliExtract Runner

TypeScript runner and browser app for the IntelliExtract spreadsheet extraction API. Supports S3 sync from a single bucket with tenant/purchaser folders, file-level checkpointing (resumable runs), configurable concurrency and rate limiting, full request/response logging, and executive summary reports (Markdown, HTML, JSON).

## Features & capabilities

- **Unified Dashboard UI**: Standardized 33.333% row heights ensure all operations fit on one screen without scrolling, providing a clear "at-a-glance" overview.
- **Accessible Interactions**: Keyboard shortcuts added to the UI—press **Enter** to confirm and **Escape** to cancel or dismiss alerts.
- **Responsive Navigation**: Optimized for a wide range of devices, including standard **1024x768** desktop resolutions, with perfectly aligned and equally spaced header controls.
- **Automated Notifications**: Built-in support for **consolidated failure emails**. Receive a professional HTML summary via Gmail/SMTP whenever extraction failures occur in a batch run.
- **Scheduled runs**: Built-in cron-based scheduler to run sync+extract pipelines automatically. Configure recurring jobs (e.g., hourly/daily) directly from the browser UI.
- **S3 sync to staging**: Syncs from a single S3 bucket with tenant/purchaser folders into a local `output/staging/...` tree, with optional sync limits and SHA-256 based skip-on-checksum.
- **File-level checkpointing**: Stores status per file (`done`, `error`, `skipped`) in a local JSON-based store (`checkpoint.json`) so runs can be resumed without reprocessing completed files.
- **Process management**: View active runs, track progress, and stop/cancel running processes directly from the UI.
- **Configurable load (RPS + concurrency)**: `run.concurrency` and `run.requestsPerSecond` let you simulate different load profiles against the IntelliExtract API.
- **Full request/response logging**: Writes JSONL logs per run with request, response, headers, and timing for every API call.
- **Extraction result classification**: For every file, the full extract API JSON response is stored and classified using the response body’s `success` flag.
- **Consolidated Reporting**: Generates Markdown, HTML, and JSON executive summaries with throughput, latency percentiles, error rate, and per-file links to stored JSON responses.
- **Stream Pipeline Mode**: The `sync-extract` command streams files—syncing and extracting each file as soon as it is downloaded, ideal for continuous incremental runs.
- **Browser app**: Full-featured Web UI to manage schedules, view history, and execute runs with real-time progress indicators.

## Requirements

- **Node.js** 20+
- **npm** or **yarn**

## Setup

1. **Clone and install**

   ```bash
   cd intelliextract-runner
   npm install
   ```

2. **Configuration**
   - **Create** `config/config.yaml` from the example (the repo does not commit `config.yaml` so you keep your own copy):
     ```bash
     cp config/config.example.yaml config/config.yaml
     ```
   - Edit `config/config.yaml` (staging dir, concurrency, report options). S3 buckets are built from `.env` when `S3_BUCKET` and `S3_TENANT_PURCHASERS` are set.

3. **Environment (credentials)**
   - Create `.env` from the example (the repo does not commit `.env`):
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` with your IntelliExtract API credentials:
     - `INTELLIEXTRACT_BASE_URL` – API base URL
     - `INTELLIEXTRACT_ACCESS_KEY`
     - `INTELLIEXTRACT_SECRET_MESSAGE`
     - `INTELLIEXTRACT_SIGNATURE`
   - For S3 sync, set AWS credentials and `S3_BUCKET`, `S3_TENANT_PURCHASERS` (JSON map of tenant folder → purchaser folders). See `.env.example` for the full list.
   - **Encrypted secrets (optional):** To avoid storing plain secrets in `.env`, you can use [Fernet](https://github.com/fernet/spec)-encrypted values. Set `FERNET_KEY` (base64url key) and `*_ENCRYPTED` vars (e.g. `INTELLIEXTRACT_ACCESS_KEY_ENCRYPTED`, `AWS_ACCESS_KEY_ID_ENCRYPTED`). The app decrypts them at runtime. Encrypt with Python: `Fernet(key).encrypt(b"secret").decode()` or with Node: `new Fernet(key).encrypt("secret")`. See `.env.example` for the list of supported `_ENCRYPTED` vars.

4. **Build**

   ```bash
   npm run build
   ```

## Quick start (browser app – recommended)

Use the browser app to run sync, extract, and pipeline scenarios and verify your setup.

1. **Build** the project (ensures `dist/index.js` exists):

   ```bash
   npm run build
   ```

2. **Start the app server** from the project root:

   ```bash
   npm run app
   ```

3. **Open the app** in your browser:
   - Visit [http://localhost:8765/](http://localhost:8765/).
   - Select **Brand** and **Purchaser**, set limits if needed, then click **Run** to execute a scenario; output appears inline.

4. **Schedule runs**:
   - Go to the **Schedule** tab to configure automated cron jobs for sync/extract pipelines.
   - Set brands/purchasers, cron expression (e.g. `0 * * * *` for hourly), and timezone.

5. **Manage processes**:
   - The **History** modal shows past runs and their status.
   - The **Active Runs** indicator shows currently running processes.
   - You can **Stop** any running process from the UI if needed.

6. **Review reports and logs**:
   - Open the generated HTML report under `output/reports/` to see throughput, error rate, and per-run details.
   - Inspect `output/logs/request-response_<runId>.jsonl` for full API request/response traces.

## Commands

All commands use the config file at `config/config.yaml` unless you pass `-c path/to/config.yaml`. If you just cloned the repo, create it with `cp config/config.example.yaml config/config.yaml` (see Setup).

You can run commands in three equivalent ways (after `npm install`):

- **Recommended (auto-build)** – scripts that _always_ compile TypeScript before running:

  ```bash
  npm run sync      # build + sync
  npm run extract   # build + run extraction
  npm run report    # build + report
  ```

- **Direct CLI (after you have already built once)**:

  ```bash
  node dist/index.js sync
  node dist/index.js run
  node dist/index.js report
  ```

- **`npm start` passthrough (also assumes you already built)**:

  ```bash
  npm start sync
  npm start run
  npm start report
  ```

### Core CLI commands

- **Sync only** – copy files from the S3 bucket (tenant/purchaser folders) to staging. Optionally scope to one tenant and purchaser:

  ```bash
  npm run sync
  npm run sync -- --tenant no-cow-026090539970-prod --purchaser DOT_FOODS
  ```

- **Run extraction** – sync (optional) then run the extraction API against staging files. Optionally scope to one tenant/purchaser. Uses checkpointing so you can resume after an interrupt:

  ```bash
  npm run extract                  # build + run (sync + extract + report)
  npm start run                    # use existing build (sync + extract + report)
  npm start run -- --no-sync       # run only (staging already present)
  npm start run -- --tenant <tenant> --purchaser <purchaser>
  npm start run -- --no-report     # run but do not write report
  ```

- **Sync-extract pipeline** – stream pipeline: sync up to N files and extract each one as soon as it is downloaded:

  ```bash
  npm run build
  node dist/index.js sync-extract --limit 50 --tenant <tenant> --purchaser <purchaser>
  node dist/index.js sync-extract --limit 50 --resume   # resume from a previous pipeline run
  ```

  _Note: Options `--tenant`, `--purchaser`, and `--pairs` are supported across all core commands._

- **Report** – generate the executive summary from the last run (or a given run ID):

  ```bash
  npm run report
  npm start report
  npm start report -- --run-id run_1234567890_abc123
  ```

## Output Layout

- **Staging:** `output/staging/<brand>/<purchaser>/<key>` – files synced from S3; each brand has purchaser-wise subfolders (signed URLs or file paths for API extraction use these paths).
- **Sync manifest:** `output/checkpoints/sync-manifest.json` (or `s3.syncManifestPath`) – stores key → SHA-256 so already-downloaded unchanged files are skipped on the next sync.
- **Checkpoints:** `output/checkpoints/checkpoint.json` – resumable run state; `last-run-id.txt` in the same directory stores the latest run ID for `report`.
- **Logs:** `output/logs/request-response_<runId>.jsonl` – one JSON object per request/response for debugging.
- **Reports:** `output/reports/report_<runId>_<ts>.md|.html|.json` – executive summary.
- **Notifications:** `output/checkpoints/notification-config.json` – stores recipient email settings configured via the UI.

Note: Checkpoints are stored in `checkpoint.json`. Even if configured as `.db` or `.sqlite` in YAML, the runner uses a robust, lock-protected JSON store for cross-platform compatibility without native dependencies.

### Sync limit and SHA-256 skip

In `config.yaml` under `s3`:

- **`syncLimit`** – Optional. Max number of files to **download** per sync (e.g. `10` to sync only 10 new files). Files that already exist and have the same SHA-256 as in the manifest are **skipped** and do not count toward this limit. Use `0` or omit for no limit.
- **`syncManifestPath`** – Optional. Path to a JSON file that stores `key → SHA-256` for each synced file. Default: `./output/checkpoints/sync-manifest.json`. On the next sync, any local file whose SHA-256 matches the manifest is skipped (no re-download).

Example: with 1000 objects in S3, set `syncLimit: 10` to download at most 10 **new** files per run. Files already on disk with matching SHA-256 are **skipped** and do not count toward the limit (e.g. limit 1 with 3 already synced → "Downloaded: 1, Skipped: 3"). Sync logs are structured and show download limit, downloaded count, skipped count, and per-brand staging paths.

## How benchmarking works in this project

Benchmarking is done entirely through the **run metrics and reports** – there is no separate benchmark command.

1. Configure a fixed load profile in `config.yaml`:
   ```yaml
   run:
     concurrency: 10
     requestsPerSecond: 10
   ```
2. Populate staging (once) with S3 sync:
   ```bash
   npm run sync
   ```
3. Run extraction at that load without syncing again:
   ```bash
   npm start run -- --no-sync
   ```
4. Open the generated HTML report under `output/reports/`:
   - **Observed throughput**: `files/sec` and `files/min` (from `metrics.throughputPerSecond` / `throughputPerMinute`).
   - **Latency percentiles**: `avg`, `P50`, `P95`, `P99` (from `metrics.avgLatencyMs`, `p50LatencyMs`, `p95LatencyMs`, `p99LatencyMs`).
   - **Error rate**: percentage of failed responses (from `metrics.errorRate` plus the extraction result reclassification logic).

Example: if you see in the report:

- “Observed throughput: 80.0 files/min, 1.33 files/sec”
- “API response time (P50 / P95 / P99): 200 ms / 500 ms / 900 ms”
- “Error rate at this load: 2.50%”

then at `concurrency = 10` and `requestsPerSecond = 10`, your single test run is effectively a **benchmark** showing that **one instance** handled about **80 files per minute** with **P95 ≈ 500 ms** and **~2.5% errors** for that dataset and configuration.

## How to Run & Test

### Build and run commands

| Action                             | Command                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Build only                         | `npm run build`                                                              |
| Sync S3 → staging                  | `npm run sync` or `node dist/index.js sync`                                  |
| Full run (sync + extract + report) | `npm run extract` or `npm start run`                                         |
| Extract only (no sync)             | `npm start run -- --no-sync`                                                 |
| Run without writing report         | `npm start run -- --no-report`                                               |
| Report from last run               | `npm run report` or `npm start report`                                       |
| Report for specific run ID         | `npm start report -- --run-id <runId>`                                       |
| Sync/run for one tenant+purchaser  | `npm run sync -- --tenant <tenant> --purchaser <purchaser>` (same for `run`) |
| Use custom config                  | `npm run sync -c path/to/config.yaml` (any command)                          |
| Sync-extract pipeline              | `node dist/index.js sync-extract --limit <n>`                                |
| Start browser app                  | `npm run app` or `node app-server.mjs`                                       |

### Prerequisites for testing

- **Config:** `config/config.yaml`.
- **Env:** `.env` with IntelliExtract API vars, `S3_BUCKET`, `S3_TENANT_PURCHASERS`, and AWS credentials for S3 sync.
- **Build:** `npm run build` before running `npm start ...` (or use `npm run sync` / `npm run extract` / `npm run report`, which build then run).

---

## Browser app

Run sync, extract, and pipeline from a browser UI:

1. **Build** the project (so `dist/index.js` exists):
   ```bash
   npm run build
   ```
2. **Start the app** (from project root):
   ```bash
   npm run app
   ```
   Or: `node app-server.mjs`
3. **Open in browser:** [http://localhost:8765/](http://localhost:8765/)
4. Use the dropdowns to pick **Brand** and **Purchaser**, optionally set limits, then click **Run** to execute a scenario and see the output inline.

**Logo & Layout:** The app shows the intellirevenue logo across all dashboards and reports. Standardized header layouts ensure that the Back button, Title, and Filter controls are equally spaced and perfectly aligned, even on smaller viewports.

### Quick verification script (optional)

Run a minimal positive path without real S3/API (config must exist and be valid; sync/run may fail but should exit with a clear message):

```bash
npm run build
npm start sync          # expect 0 or 1 depending on AWS/config
npm start run -- --no-sync --no-report   # expect 0 or 1 depending on API/config
npm start report       # expect 0 if last run existed, else 1
```

---

## Resumable Execution

If a run is interrupted, start again with the same config. The stub loads the checkpoint and skips files already marked `done`, so only remaining (or failed) files are processed.
