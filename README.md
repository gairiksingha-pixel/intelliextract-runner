# EntelliExtract Test Stub

TypeScript test automation for the EntelliExtract spreadsheet extraction API. Supports S3 sync from brand buckets, file-level checkpointing (resumable runs), configurable concurrency and rate limiting, full request/response logging, and executive summary reports (Markdown, HTML, JSON).

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

   - Copy `config/config.example.yaml` to `config/config.yaml`.
   - Set your S3 bucket names and paths, staging directory, concurrency, and report options.

3. **Environment (credentials)**

   - Copy `.env.example` to `.env`.
   - Set EntelliExtract API credentials:
     - `ENTELLIEXTRACT_BASE_URL` – API base URL
     - `ENTELLIEXTRACT_ACCESS_KEY`
     - `ENTELLIEXTRACT_SECRET_MESSAGE`
     - `ENTELLIEXTRACT_SIGNATURE`
   - For S3 sync, set AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) or use a configured AWS profile.

4. **Build**

   ```bash
   npm run build
   ```

## Commands

All commands use the config file at `config/config.yaml` unless you pass `-c path/to/config.yaml`.

- **Sync only** – copy files from production S3 buckets (Sundia, No Cow, Tractor) to the staging directory:

  ```bash
  npm start sync
  # or: node dist/index.js sync
  ```

- **Run extraction** – sync (optional) then run the extraction API against every file in staging. Uses checkpointing so you can resume after an interrupt:

  ```bash
  npm start run              # sync + run + write report
  npm start run -- --no-sync # run only (staging already present)
  npm start run -- --no-report  # run but do not write report
  ```

- **Report** – generate the executive summary from the last run (or a given run ID):

  ```bash
  npm start report
  npm start report -- --run-id run_1234567890_abc123
  ```

## Output Layout

- **Staging:** `output/staging/<BrandName>/<key>` – files synced from S3.
- **Sync manifest:** `output/checkpoints/sync-manifest.json` (or `s3.syncManifestPath`) – stores key → SHA-256 so already-downloaded unchanged files are skipped on the next sync.
- **Checkpoints:** `output/checkpoints/checkpoint.json` – resumable run state; `last-run-id.txt` in the same directory stores the latest run ID for `report`.
- **Logs:** `output/logs/request-response_<runId>.jsonl` – one JSON object per request/response for debugging.
- **Reports:** `output/reports/report_<runId>_<ts>.md|.html|.json` – executive summary.

Note: Checkpoints are stored as `checkpoint.json` (same path as `checkpointPath` with `.sqlite` replaced by `.json`).

### Sync limit and SHA-256 skip

In `config.yaml` under `s3`:

- **`syncLimit`** – Optional. Max number of files to **download** per sync (e.g. `10` to sync only 10 new files). Files that already exist and have the same SHA-256 as in the manifest are **skipped** and do not count toward this limit. Use `0` or omit for no limit.
- **`syncManifestPath`** – Optional. Path to a JSON file that stores `key → SHA-256` for each synced file. Default: `./output/checkpoints/sync-manifest.json`. On the next sync, any local file whose SHA-256 matches the manifest is skipped (no re-download).

Example: with 1000 objects in S3, set `syncLimit: 10` to download at most 10 files per run. If 5 of those 10 are already on disk and unchanged (same SHA-256), they are skipped and only 5 are downloaded; the next run will continue from the remaining list.

## Benchmark (one App Runner instance)

Use a single run with fixed concurrency to establish a baseline:

1. Set in `config.yaml`: `run.concurrency: 10`, `run.requestsPerSecond: 10` (or your desired cap).
2. Run: `npm start run -- --no-sync` (after staging is populated).
3. Open the generated report for **throughput (files/sec)**, **average latency**, **P95 latency**, and **error rate**.

## Example Run Output

After `npm start run` you should see something like:

```
Running with S3 sync...
[S3] Sundia: synced 42, skipped (unchanged) 5, errors 0
[S3] NoCow: synced 18, skipped (unchanged) 0, errors 0
[S3] Tractor: synced 31, skipped (unchanged) 2, errors 0
Run run_1739123456789_abc1234 finished. Success: 88, Failed: 0, Skipped: 3
Report(s) written: [ 'output/reports/report_run_1739123456789_abc1234_1739123500000.md', ... ]
```

See `output/reports/` for the full executive summary (total files, run time, success/failure, P95 latency, anomalies).

---

## How to Run & Test

### Build and run commands

| Action | Command |
|--------|--------|
| Build only | `npm run build` |
| Sync S3 → staging | `npm start sync` or `node dist/index.js sync` |
| Full run (sync + extract + report) | `npm start run` |
| Extract only (no sync) | `npm start run -- --no-sync` |
| Run without writing report | `npm start run -- --no-report` |
| Report from last run | `npm start report` |
| Report for specific run ID | `npm start report -- --run-id <runId>` |
| Use custom config | `npm start sync -c path/to/config.yaml` (any command) |

### Prerequisites for testing

- **Config:** `config/config.yaml` (copy from `config/config.example.yaml`).
- **Env:** `.env` with `ENTELLIEXTRACT_BASE_URL`, `ENTELLIEXTRACT_ACCESS_KEY`, `ENTELLIEXTRACT_SECRET_MESSAGE`, `ENTELLIEXTRACT_SIGNATURE` (for extract). AWS env vars for S3 sync.
- **Build:** `npm run build` before running `npm start ...` (or use `npm run sync` / `npm run extract` / `npm run report`, which build then run).

---

## Test Cases

Manual test cases covering **positive**, **negative**, and **edge** scenarios aligned to the core requirements. Run the **Command** and assert the **Expected result**.

### Requirements coverage (core objectives → test cases)

| # | Core requirement | Test case IDs | What is verified |
|---|------------------|---------------|------------------|
| 1 | **Historical dataset coverage** – Sync from brand S3 buckets (e.g. Sundia, No Cow, Tractor) to staging and run extraction against all files | P1, P7, E4, E5 | Sync all brands to staging; full pipeline (sync + run) processes all files; empty bucket; partial S3 failures. |
| 2 | **Full logging & traceability** – Record all requests and responses in a structured format for debugging and output comparison | P2, P8 | Request-response log updated per run; log file exists and has structured JSONL (one entry per request/response). |
| 3 | **Resumable execution** – File-level checkpointing; resume without reprocessing completed files | E3, E7 | Resume after interrupt skips done files; corrupt/empty checkpoint handled (new run, no crash). |
| 4 | **Load testing & benchmarking** – Configurable concurrency and rate; benchmark throughput, avg latency, error rates | P2, P9, E8 | Run produces report; report contains throughput, avg latency, P95, error rate (P9); run with custom concurrency/rate from config (E8). |
| 5 | **Executive summary report** – Markdown, HTML, JSON (PDF optional) with total files, run time, success/failure, P95, anomalies | P3, P4, P10, E6 | Report from last run and by run ID; report content (totals, duration, breakdown, P95, anomalies); multiple formats; report when all failures. |

*Bonus (AI agent, intelligent retries): not implemented; no test cases.*

**Deliverables:** Working code = repo; Setup = README (Requirements, Setup, Commands); Example run output = "Example Run Output" section and `output/reports/` + `output/logs/` after a run.

### Positive test cases

| ID  | Scenario              | Command                              | Expected        |
|-----|-----------------------|--------------------------------------|-----------------|
| P1  | Sync (valid config)   | `npm start sync`                     | Exit 0, files in staging |
| P2  | Run extraction        | `npm start run -- --no-sync`         | Exit 0, Success/Failed/Skipped, report + log |
| P3  | Report (last run)     | `npm start report`                   | Exit 0, report files in output/reports |
| P4  | Report (by run ID)    | `npm start report -- --run-id <id>` | Exit 0, report for that run |
| P5  | Custom config         | `npm start sync -c config/my.yaml`   | Exit 0, uses my.yaml |
| P6  | Run, no report        | `npm start run -- --no-sync --no-report` | Exit 0, no new reports |
| P7  | **Req 1** Full pipeline | `npm start run`                    | Exit 0, sync all brands then run all files |
| P8  | **Req 2** Log structure | Inspect `output/logs/request-response_<runId>.jsonl` | JSONL: runId, filePath, request, response, success |
| P9  | **Req 4** Benchmark in report | Open report .md/.json          | Throughput, avg/P95 latency, error rate |
| P10 | **Req 5** Report formats | `npm start report`                | Exit 0, .md + .html + .json with totals, P95, anomalies |

**Details (positive)**

- **P1** — *Given:* Valid `config.yaml`, real S3 buckets, AWS creds. *Expect:* "Syncing S3 buckets...", `[S3] <brand>: synced N, errors 0`, files under `output/staging/<BrandName>/`.
- **P2** — *Given:* Staging has ≥1 file, API creds set. *Expect:* "Run run_... finished. Success: N, Failed: M, Skipped: K"; report in `output/reports/`; checkpoint and request-response log updated.
- **P3** — *Given:* At least one completed run (last-run-id.txt exists). *Expect:* "Report(s) written: [ ... ]"; markdown/HTML/JSON with metrics and run ID.
- **P4** — *Given:* Valid run ID from a previous run. *Expect:* Report generated for that run ID.
- **P5** — *Given:* Valid config at `config/my.yaml`. *Expect:* Sync uses buckets/staging from that file.
- **P6** — *Given:* Staging populated. *Expect:* Run completes; no new files in `output/reports/`.
- **P7** — *Given:* Multiple brands in config; AWS and API creds. *Expect:* Per-brand sync then extraction over all files; console shows sync counts and Success/Failed/Skipped.
- **P8** — *Given:* A run with ≥1 request. *Expect:* Log file exists; each line valid JSON with runId, filePath, request (method, url, bodyLength), response (statusCode, latencyMs, bodyPreview), success; one line per file.
- **P9** — *Given:* A run with some success/failure. *Expect:* Report has total files, run time, success/failure/skipped counts, throughput (files/sec), average latency, P95 latency, error rate.
- **P10** — *Given:* `report.formats`: markdown, html, json. *Expect:* One file per format in `output/reports/`; content has total files, run duration, success/failure breakdown, P95, anomalies.

### Negative test cases

| ID  | Scenario           | Command                                    | Expected   |
|-----|--------------------|--------------------------------------------|------------|
| N1  | Config missing     | `npm start sync -c config/nonexistent.yaml` | Exit 1, "Failed to load config..." |
| N2  | Invalid YAML       | `npm start sync` (bad YAML in config)      | Exit 1, "Invalid YAML in ..." |
| N3  | Invalid config     | `npm start sync` (missing api.baseUrl etc.) | Exit 1, "Missing or invalid: ..." |
| N4  | No prior run       | `npm start report` (no last-run-id.txt)   | Exit 1, "No last run found..." |
| N5  | Bad run ID         | `npm start report -- --run-id run_000...fake` | Exit 1, "No records found for run..." |
| N6  | Sync fails (AWS)   | `npm start sync` (wrong creds/bucket)      | Exit 1, "Sync failed: ..." |

**Details (negative)**

- **N1** — *Given:* No config at path (or wrong path). *Expect:* Exit 1; message "Failed to load config from ..." and/or "Missing or invalid".
- **N2** — *Given:* config.yaml with invalid YAML (e.g. stray `:`, bad indentation). *Expect:* Exit 1; "Invalid YAML in ..." with parse details.
- **N3** — *Given:* Config missing e.g. api.baseUrl or s3.buckets. *Expect:* Exit 1; "Invalid config ... Missing or invalid: api.baseUrl, ...".
- **N4** — *Given:* Fresh clone; no `output/checkpoints/last-run-id.txt`. *Expect:* Exit 1; "No last run found. Run \"run\" first or pass --run-id."
- **N5** — *Given:* Run ID that never existed in checkpoint. *Expect:* Exit 1; "No records found for run run_0000000000_fake."
- **N6** — *Given:* Wrong AWS credentials or invalid bucket name. *Expect:* Exit 1; "Sync failed: ..." with underlying error (e.g. access denied, bucket not found).

### Edge test cases

| ID  | Scenario            | Command                          | Expected   |
|-----|---------------------|----------------------------------|------------|
| E1  | Empty staging       | `npm start run -- --no-sync`     | Exit 0, Success: 0, Failed: 0, Skipped: 0 |
| E2  | All API fail        | `npm start run -- --no-sync`     | Exit 0, Failed: N, report has error rate + anomalies |
| E3  | Resume after stop   | Run twice: start, Ctrl+C, run again | 2nd run skips done files |
| E4  | Empty S3 bucket     | `npm start sync`                 | Exit 0, `[S3] <brand>: synced 0, errors 0` |
| E5  | S3 partial failures | `npm start sync`                 | Exit 0, synced N, errors M (M>0), errors logged |
| E6  | Report (all failed) | `npm start report -- --run-id <id>` | Exit 0, report: failed count, 0 success, anomalies |
| E7  | Corrupt checkpoint  | Replace checkpoint.json with `{}` then run | Exit 0, new run ID, no crash |
| E8  | **Req 4** Concurrency/rate | `npm start run -- --no-sync` (config: concurrency 3, rps 5) | Exit 0, run completes under cap |

**Details (edge)**

- **E1** — *Given:* Empty `output/staging/` or no brand dirs. *Expect:* Exit 0; "Success: 0, Failed: 0, Skipped: 0"; no crash; report may show zero throughput.
- **E2** — *Given:* Staging has files; API URL wrong or creds invalid. *Expect:* Exit 0; run completes with "Failed: N"; checkpoint status error; report shows error rate and anomalies.
- **E3** — *Given:* Start run, Ctrl+C after some files complete, same config. *Expect:* First run partial; second run skips completed files; final counts consistent.
- **E4** — *Given:* Real bucket with zero objects. *Expect:* Exit 0; `[S3] <brand>: synced 0, errors 0`; no files in staging for that brand.
- **E5** — *Given:* Bucket with some keys that fail (e.g. access denied). *Expect:* Exit 0; `[S3] <brand>: synced N, errors M` (M>0); successful files in staging; errors on console.
- **E6** — *Given:* Run where 0 success, all failed. *Expect:* Exit 0; report has failed count, 0 success, safe latency defaults, anomalies list errors.
- **E7** — *Given:* checkpoint.json is `{}` or invalid JSON. *Expect:* Exit 0; stub uses empty store, new run ID; no crash.
- **E8** — *Given:* config has run.concurrency: 3, run.requestsPerSecond: 5; staging has several files. *Expect:* Exit 0; run completes; throughput/latency consistent with cap.

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

Negative cases (N1–N6) use fixture configs where needed: `config/nonexistent.yaml`, `config/bad-yaml.yaml`, `config/bad-schema.yaml`.

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

## License

MIT
