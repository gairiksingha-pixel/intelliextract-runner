# EntelliExtract Test Stub

TypeScript test automation for the EntelliExtract spreadsheet extraction API. Supports S3 sync from a single bucket with tenant/purchaser folders, file-level checkpointing (resumable runs), configurable concurrency and rate limiting, full request/response logging, and executive summary reports (Markdown, HTML, JSON).

## Features & capabilities

- **S3 sync to staging**: Syncs from a single S3 bucket with tenant/purchaser folders into a local `output/staging/...` tree, with optional sync limits and SHA-256 based skip-on-checksum.
- **File-level checkpointing**: Stores status per file (`done`, `error`, `skipped`) in `checkpoint.json` so runs can be resumed without reprocessing completed files.
- **Configurable load (RPS + concurrency)**: `run.concurrency` and `run.requestsPerSecond` let you simulate different load profiles against the EntelliExtract API.
- **Full request/response logging**: Writes JSONL logs per run with request, response, headers, and timing for every API call.
- **Extraction result classification**: For every file, the full extract API JSON response is stored and classified using the response body’s `success` flag (`"success": true` → successful response, `"success": false` → failed response). Upload/read failures are counted as **failed file uploads**.
- **Executive summary reporting**: Generates Markdown, HTML, and JSON executive summaries with throughput, latency percentiles, error rate, anomaly detection, and per-file extraction results (linked to the stored JSON).
- **Sync-extract pipeline mode**: Optional `sync-extract` command that syncs and extracts files in a single streaming pipeline (sync one → extract one), useful for incremental runs.
- **HTML test runner UI**: Browser-based runner that drives the CLI test cases and shows stdout/stderr per scenario.

## Requirements

- **Node.js** 20+
- **npm** or **yarn**

## Setup

1. **Clone and install**

   ```bash
   cd entelliextract-test-stub
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
   - Edit `.env` with your EntelliExtract API credentials:
     - `ENTELLIEXTRACT_BASE_URL` – API base URL
     - `ENTELLIEXTRACT_ACCESS_KEY`
     - `ENTELLIEXTRACT_SECRET_MESSAGE`
     - `ENTELLIEXTRACT_SIGNATURE`
   - For S3 sync, set AWS credentials and `S3_BUCKET`, `S3_TENANT_PURCHASERS` (JSON map of tenant folder → purchaser folders). See `.env.example` for the full list.
   - **Encrypted secrets (optional):** To avoid storing plain secrets in `.env`, you can use [Fernet](https://github.com/fernet/spec)-encrypted values. Set `FERNET_KEY` (base64url key) and `*_ENCRYPTED` vars (e.g. `ENTELLIEXTRACT_ACCESS_KEY_ENCRYPTED`, `AWS_ACCESS_KEY_ID_ENCRYPTED`). The app decrypts them at runtime. Encrypt with Python: `Fernet(key).encrypt(b"secret").decode()` or with Node: `new Fernet(key).encrypt("secret")`. See `.env.example` for the list of supported `_ENCRYPTED` vars.

4. **Build**

   ```bash
   npm run build
   ```

## Quick start (HTML UI – recommended)

Use the browser-based test runner first to explore commands and verify your setup.

1. **Build** the project (ensures `dist/index.js` exists):

   ```bash
   npm run build
   ```

2. **Start the test runner server** from the project root:

   ```bash
   npm run test-runner
   ```

3. **Open the HTML UI** in your browser:

   - Visit `http://localhost:8765/`.
   - Click **Run** next to any test case to execute it; the command, exit code, stdout, and stderr are shown inline.

4. **Review reports and logs**:

   - Open the generated HTML report under `output/reports/` to see throughput, error rate, and per-run details.
   - Inspect `output/logs/request-response_<runId>.jsonl` for full API request/response traces.

## Commands

All commands use the config file at `config/config.yaml` unless you pass `-c path/to/config.yaml`. If you just cloned the repo, create it with `cp config/config.example.yaml config/config.yaml` (see Setup).

You can run commands in three equivalent ways (after `npm install`):

- **Recommended (auto-build)** – scripts that *always* compile TypeScript before running:

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
  node dist/index.js sync-extract --limit 50
  node dist/index.js sync-extract --limit 50 --tenant <tenant> --purchaser <purchaser>
  node dist/index.js sync-extract --limit 50 --resume   # resume from a previous pipeline run
  ```

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
- **Reports:** `output/reports/report_<runId>_<ts>.md|.html|.json` – executive summary. Set `report.retainCount` in config to keep only the last N report sets and avoid unbounded disk use.

Note: Checkpoints are stored as `checkpoint.json` (same path as `checkpointPath` with `.sqlite` replaced by `.json`).

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

| Action | Command |
|--------|--------|
| Build only | `npm run build` |
| Sync S3 → staging | `npm run sync` or `node dist/index.js sync` |
| Full run (sync + extract + report) | `npm run extract` or `npm start run` |
| Extract only (no sync) | `npm start run -- --no-sync` |
| Run without writing report | `npm start run -- --no-report` |
| Report from last run | `npm run report` or `npm start report` |
| Report for specific run ID | `npm start report -- --run-id <runId>` |
| Sync/run for one tenant+purchaser | `npm run sync -- --tenant <tenant> --purchaser <purchaser>` (same for `run`) |
| Use custom config | `npm run sync -c path/to/config.yaml` (any command) |
| Sync-extract pipeline | `node dist/index.js sync-extract --limit <n>` |

### Prerequisites for testing

- **Config:** `config/config.yaml`.
- **Env:** `.env` with EntelliExtract API vars, `S3_BUCKET`, `S3_TENANT_PURCHASERS`, and AWS credentials for S3 sync.
- **Build:** `npm run build` before running `npm start ...` (or use `npm run sync` / `npm run extract` / `npm run report`, which build then run).

---

## Test Cases

Manual test cases covering **positive**, **negative**, and **edge** scenarios aligned to the core requirements. **Commands** for each case are listed in the tables below (Positive / Negative / Edge); run the command and assert the **Expected** result. The browser test runner (see [Test runner (HTML UI)](#test-runner-html-ui)) uses these same cases without showing the command column; refer to this README for the exact command per case.

### Requirements coverage (core objectives → test cases)

| # | Core requirement | Test case IDs | What is verified |
|---|------------------|---------------|------------------|
| 1 | **Historical dataset coverage** – Sync from brand S3 buckets (e.g. Sundia, No Cow, Tractor) to staging and run extraction against all files | P1, P5, E3 | Sync all brands to staging; full pipeline (sync + run) processes all files; S3 edge (empty or partial failures). |
| 2 | **Full logging & traceability** – Record all requests and responses in a structured format for debugging and output comparison | P2, P7 | Request-response log updated per run; log file has structured JSONL (runId, filePath, request, response). |
| 3 | **Resumable execution** – File-level checkpointing; resume without reprocessing completed files | E2 | Resume after interrupt or corrupt checkpoint (new run ID, no crash). |
| 4 | **Load testing & benchmarking** – Configurable concurrency and rate; benchmark throughput, avg latency, error rates | P2, P7, E5 | Run produces report; report has throughput, P95, error rate; run under concurrency/rate cap (E5). |
| 5 | **Executive summary report** – Markdown, HTML, JSON (PDF optional) with total files, run time, success/failure, P95, anomalies | P3, P7, E4 | Report from last run or by run ID; formats .md/.html/.json; report when all failures (E4). |

*Bonus (AI agent, intelligent retries): not implemented; no test cases.*

**Deliverables:** Working code = repo; Setup = README (Requirements, Setup, Commands); Example run output = "Example Run Output" section and `output/reports/` + `output/logs/` after a run.

### Positive test cases

| ID  | Scenario              | Command                              | Expected        |
|-----|-----------------------|--------------------------------------|-----------------|
| P1  | Sync (valid config)   | `npm start sync`                     | Exit 0, files in staging |
| P2  | Run extraction        | `npm start run -- --no-sync`         | Exit 0, Success/Failed/Skipped, report + log |
| P3  | Report (last run or by run-id) | `npm start report [--run-id <id>]` | Exit 0, report files (.md + .html + .json) |
| P4  | Custom config         | `npm start sync -c config/config.yaml` | Exit 0, uses given config |
| P5  | **Req 1** Full pipeline | `npm start run`                    | Exit 0, sync then run all files |
| P6  | Run, no report        | `npm start run -- --no-sync --no-report` | Exit 0, no new reports |
| P7  | **Req 2/4/5** Output structure | After run: inspect `output/logs/*.jsonl` + report | JSONL: runId, filePath, request, response; report: throughput, P95, .md/.html/.json |

**Details (positive)**

- **P1** — *Given:* Valid `config.yaml`, real S3 buckets, AWS creds. *Expect:* Structured "Sync Summary" with download/skipped/errors and per-brand staging paths; files under `output/staging/<brand>/<purchaser>/`.
- **P2** — *Given:* Staging has ≥1 file, API creds set. *Expect:* "Run run_... finished. Success: N, Failed: M, Skipped: K"; report in `output/reports/`; checkpoint and request-response log updated.
- **P3** — *Given:* At least one completed run (last-run-id.txt exists) or valid run ID. *Expect:* "Report(s) written: [ ... ]"; markdown/HTML/JSON with metrics and run ID.
- **P4** — *Given:* Valid config path. *Expect:* Sync uses buckets/staging from that file.
- **P5** — *Given:* Multiple brands in config; AWS and API creds. *Expect:* Per-brand sync then extraction over all files; console shows sync counts and Success/Failed/Skipped.
- **P6** — *Given:* Staging populated. *Expect:* Run completes; no new files in `output/reports/`.
- **P7** — *Given:* A run with ≥1 request. *Expect:* Log file has JSONL with runId, filePath, request, response; report has throughput, P95, error rate and .md/.html/.json formats.

### Negative test cases

Negative coverage is by **value combination**: change config path or run context to get missing config, invalid YAML, invalid schema, or no valid run. If config is missing or invalid, the process exits before running; one consolidated check is enough.

| ID  | Scenario           | Command / value combo                         | Expected   |
|-----|--------------------|------------------------------------------------|------------|
| N1  | Invalid config     | `sync -c config/nonexistent.yaml` (missing file) | Exit 1, Failed to load config |
| N2  | Report without valid run | `report` with no last-run-id, or `report --run-id run_000...fake` | Exit 1, No last run found / No records found |
| N3  | Sync fails (AWS)   | `sync` with wrong creds or bucket              | Exit 1, Sync failed |

**Details (negative)**

- **N1** — *Given:* Missing config file (e.g. `config/nonexistent.yaml`). *Expect:* Exit 1; process does not run; message indicates config load failure.
- **N2** — *Value combos:* No `last-run-id.txt`, or fake run ID. *Expect:* Exit 1; "No last run found" or "No records found for run ...".
- **N3** — *Given:* Wrong AWS credentials or invalid bucket. *Expect:* Exit 1; "Sync failed: ..." with underlying error.

### Edge test cases

| ID  | Scenario            | Command / value combo                | Expected   |
|-----|---------------------|--------------------------------------|------------|
| E1  | Empty staging or all API fail | `npm start run -- --no-sync` (empty staging or bad API) | Exit 0, Success: 0 or Failed: N, no crash |
| E2  | Resume / corrupt checkpoint | Run twice (Ctrl+C then run again) or set checkpoint.json to `{}` then run | 2nd run skips done files; or new run ID, no crash |
| E3  | S3 edge (empty or partial failures) | `npm start sync` (empty bucket or some keys fail) | Exit 0, synced 0 or errors M>0 |
| E4  | Report (all failed run) | `npm start report -- --run-id <id>` for run with 0 success | Exit 0, failed count, anomalies |
| E5  | **Req 4** Concurrency/rate | `npm start run -- --no-sync` (config: concurrency, rps) | Exit 0, run under cap |

**Details (edge)**

- **E1** — *Value combos:* Empty staging, or staging with files but API failing. *Expect:* Exit 0; "Success: 0, Failed: 0" or "Failed: N"; no crash.
- **E2** — *Value combos:* Resume after Ctrl+C (second run skips done files), or corrupt/empty checkpoint. *Expect:* Exit 0; new run ID when checkpoint invalid; no crash.
- **E3** — *Value combos:* Empty bucket, or bucket with some keys that fail. *Expect:* Exit 0; Sync Summary with Downloaded: 0 or errors M>0.
- **E4** — *Given:* Run ID for a run where all extractions failed. *Expect:* Exit 0; report has failed count, 0 success, anomalies.
- **E5** — *Given:* config has run.concurrency and run.requestsPerSecond; staging has files. *Expect:* Exit 0; run completes; throughput/latency under cap.

### Test runner (HTML UI)

Run all test cases from a browser with one click per case:

1. **Build** the project (so `dist/index.js` exists):
   ```bash
   npm run build
   ```
2. **Start the test runner server** (from project root):
   ```bash
   npm run test-runner
   ```
   Or: `node test-runner-server.mjs`
3. **Open in browser:** [http://localhost:8765/](http://localhost:8765/)
4. Click **Run** next to any test case; the command runs in the background and the result (exit code, stdout, stderr) appears below the row.

**Logo:** The test runner page uses the intellirevenue logo if present. Place your logo at `assets/logo.png`, or any `.png` file in the `assets/` folder.

Negative cases (N1–N3): N1 uses a missing config path (`config/nonexistent.yaml`); N2 uses a fake run ID; N3 uses live sync (wrong creds/bucket for failure).

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
