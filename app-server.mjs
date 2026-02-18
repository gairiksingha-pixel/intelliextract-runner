#!/usr/bin/env node
/**
 * IntelliExtract app server. Serves the browser UI (index.html) and runs sync/extract/report via POST /run.
 * Start from project root: npm run app  (or: node app-server.mjs)
 * Open: http://localhost:8765/
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  statSync,
  createReadStream,
  mkdirSync,
} from "node:fs";
import {
  join,
  dirname,
  extname,
  normalize,
  resolve,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";

const require = createRequire(import.meta.url);
const archiver = require("archiver");
const dotenv = require("dotenv");

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const ROOT = join(__dirname);

// Build brand-purchaser map from S3_TENANT_PURCHASERS env variable
function loadBrandPurchasers() {
  const raw = process.env.S3_TENANT_PURCHASERS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch (_) {}
  return {};
}
const BRAND_PURCHASERS = loadBrandPurchasers();
const REPORTS_DIR = join(ROOT, "output", "reports");
const EXTRACTIONS_DIR = join(ROOT, "output", "extractions");
const STAGING_DIR = join(ROOT, "output", "staging");
const SYNC_MANIFEST_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "sync-manifest.json",
);
const CHECKPOINT_PATH = join(ROOT, "output", "checkpoints", "checkpoint.db");
const CHECKPOINT_JSON_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "checkpoint.json",
);
const LAST_PIPE_PARAMS_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "last-pipe-params.json",
);
const LAST_RUN_COMPLETED_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "last-run-completed.txt",
);
const ALLOWED_EXT = new Set([".html", ".json"]);

const SCHEDULES_PATH = join(ROOT, "output", "checkpoints", "schedules.json");
const LAST_RUN_STATE_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "last-run-state.json",
);

// Active process tracking
const ACTIVE_RUNS = new Map();

// Define which cases support resume functionality
const RESUME_CAPABLE_CASES = new Set(["P1", "P2", "PIPE", "P5", "P6"]);

function loadSchedules() {
  if (!existsSync(SCHEDULES_PATH)) return [];
  try {
    const raw = readFileSync(SCHEDULES_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function saveSchedules(list) {
  try {
    const dir = dirname(SCHEDULES_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SCHEDULES_PATH, JSON.stringify(list, null, 2), "utf-8");
  } catch (_) {}
}

function scheduleId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const base =
    now.getFullYear() +
    "-" +
    pad(now.getMonth() + 1) +
    "-" +
    pad(now.getDate()) +
    "T" +
    pad(now.getHours()) +
    ":" +
    pad(now.getMinutes()) +
    ":" +
    pad(now.getSeconds());
  const rand = Math.random().toString(36).slice(2, 6);
  return "sched_" + base + "_" + rand;
}

function getPairsForSchedule(brands, purchasers) {
  let brandList = Array.isArray(brands) ? brands.filter(Boolean) : [];
  let purchaserList = Array.isArray(purchasers)
    ? purchasers.filter(Boolean)
    : [];

  if (brandList.length === 0 && purchaserList.length === 0) return [];
  if (brandList.length === 0) brandList = Object.keys(BRAND_PURCHASERS || {});
  if (purchaserList.length === 0) {
    const set = new Set();
    brandList.forEach((b) => {
      (BRAND_PURCHASERS[b] || []).forEach((p) => set.add(p));
    });
    purchaserList = Array.from(set);
  }

  const pairs = [];
  brandList.forEach((tenant) => {
    const allowed = BRAND_PURCHASERS[tenant];
    if (!allowed) return;
    purchaserList.forEach((purchaser) => {
      if (allowed.indexOf(purchaser) !== -1) {
        pairs.push({ tenant, purchaser });
      }
    });
  });
  return pairs;
}

const SCHEDULE_TIMEZONES = [
  "UTC",
  // US time zones (includes PST/PDT via America/Los_Angeles)
  "America/Los_Angeles",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  // India Standard Time
  "Asia/Kolkata",
];

const SCHEDULE_LOG_PATH = join(ROOT, "output", "logs", "schedule.log");

function appendScheduleLog(entry) {
  try {
    const dir = dirname(SCHEDULE_LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    writeFileSync(SCHEDULE_LOG_PATH, line + "\n", {
      encoding: "utf-8",
      flag: "a",
    });
  } catch (_) {}
}

const SCHEDULE_LOG_MAX_ENTRIES = 500;

function readScheduleLogEntries() {
  if (!existsSync(SCHEDULE_LOG_PATH)) return [];
  try {
    const raw = readFileSync(SCHEDULE_LOG_PATH, "utf-8");
    const lines = raw.split("\n").filter((s) => s.trim());
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry && (entry.scheduleId || entry.message)) {
          if (entry.outcome === undefined) {
            entry.outcome =
              entry.message &&
              String(entry.message).toLowerCase().includes("skipped")
                ? "skipped"
                : "executed";
          }
          entries.push(entry);
        }
      } catch (_) {}
    }
    return entries.slice(-SCHEDULE_LOG_MAX_ENTRIES).reverse();
  } catch (_) {
    return [];
  }
}

function getCurrentRunIdFromCheckpoint() {
  const path = existsSync(CHECKPOINT_JSON_PATH)
    ? CHECKPOINT_JSON_PATH
    : CHECKPOINT_PATH;
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    return data?.run_meta?.current_run_id ?? null;
  } catch (_) {
    return null;
  }
}

function getLastCompletedRunId() {
  if (!existsSync(LAST_RUN_COMPLETED_PATH)) return null;
  try {
    return readFileSync(LAST_RUN_COMPLETED_PATH, "utf-8").trim() || null;
  } catch (_) {
    return null;
  }
}

function markRunCompleted(runId) {
  if (!runId) return;
  try {
    const dir = dirname(LAST_RUN_COMPLETED_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LAST_RUN_COMPLETED_PATH, runId, "utf-8");
  } catch (_) {}
}

function getRunStatusFromCheckpoint() {
  const runId = getCurrentRunIdFromCheckpoint();
  if (!runId)
    return {
      canResume: false,
      runId: null,
      done: 0,
      failed: 0,
      total: 0,
      syncLimit: 0,
    };
  const lastCompleted = getLastCompletedRunId();
  const path = existsSync(CHECKPOINT_JSON_PATH)
    ? CHECKPOINT_JSON_PATH
    : CHECKPOINT_PATH;
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw);
    const checkpoints = Array.isArray(data?.checkpoints)
      ? data.checkpoints
      : [];
    const forRun = checkpoints.filter((c) => c.run_id === runId);
    const done = forRun.filter((c) => c.status === "done").length;
    const failed = forRun.filter((c) => c.status === "error").length;
    const canResume = forRun.length > 0 && runId !== lastCompleted;
    let syncLimit = 0;
    if (existsSync(LAST_PIPE_PARAMS_PATH)) {
      try {
        const pipeParams = JSON.parse(
          readFileSync(LAST_PIPE_PARAMS_PATH, "utf-8"),
        );
        syncLimit = Math.max(0, Number(pipeParams.syncLimit) || 0);
      } catch (_) {}
    }
    return { canResume, runId, done, failed, total: forRun.length, syncLimit };
  } catch (_) {
    return {
      canResume: false,
      runId: null,
      done: 0,
      failed: 0,
      total: 0,
      syncLimit: 0,
    };
  }
}

function spawnReportForRunId(runId) {
  if (!runId) return;
  return new Promise((resolve) => {
    const child = spawn(
      "node",
      ["dist/index.js", "report", "--run-id", runId],
      { cwd: ROOT, shell: false, stdio: "ignore" },
    );
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(1));
  });
}

// State management functions
function loadRunStates() {
  if (!existsSync(LAST_RUN_STATE_PATH)) return {};
  try {
    const raw = readFileSync(LAST_RUN_STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveRunStates(states) {
  try {
    const dir = dirname(LAST_RUN_STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      LAST_RUN_STATE_PATH,
      JSON.stringify(states, null, 2),
      "utf-8",
    );
  } catch (_) {}
}

function updateRunState(caseId, stateUpdate) {
  const states = loadRunStates();
  states[caseId] = { ...states[caseId], ...stateUpdate };
  saveRunStates(states);
}

function clearRunState(caseId) {
  const states = loadRunStates();
  delete states[caseId];
  saveRunStates(states);
}

function getRunState(caseId) {
  const states = loadRunStates();
  return states[caseId] || null;
}

function listStagingFiles(dir, baseDir, list) {
  if (!existsSync(dir)) return list;
  const entries = readdirSync(dir, { withFileTypes: true });
  const base = baseDir || dir;
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(base, full).replace(/\\/g, "/");
    if (e.isDirectory()) {
      listStagingFiles(full, base, list);
    } else {
      let size = 0;
      let mtime = 0;
      try {
        const st = statSync(full);
        size = st.size;
        mtime = st.mtimeMs;
      } catch (_) {}
      list.push({ path: rel, size, mtime });
    }
  }
  return list;
}

const SYNC_HISTORY_PATH = join(
  ROOT,
  "output",
  "checkpoints",
  "sync-history.json",
);

function buildSyncReportHtml() {
  const files = listStagingFiles(STAGING_DIR, STAGING_DIR, []);
  files.sort((a, b) => b.mtime - a.mtime);
  let manifestEntries = 0;
  if (existsSync(SYNC_MANIFEST_PATH)) {
    try {
      const raw = readFileSync(SYNC_MANIFEST_PATH, "utf-8");
      const data = JSON.parse(raw);
      manifestEntries =
        typeof data === "object" && data !== null
          ? Object.keys(data).length
          : 0;
    } catch (_) {}
  }

  let history = [];
  if (existsSync(SYNC_HISTORY_PATH)) {
    try {
      history = JSON.parse(readFileSync(SYNC_HISTORY_PATH, "utf-8"));
      // Limit to last 30 entries
      if (history.length > 30) history = history.slice(-30);
    } catch (_) {}
  }

  const formatDate = (ms) => {
    if (!ms) return "—";
    const d = new Date(ms);
    return d.toISOString();
  };
  const rows = files
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.path)}</td><td>${f.size}</td><td>${formatDate(f.mtime)}</td></tr>`,
    )
    .join("");

  const historyData = JSON.stringify(history);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Staging Inventory Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --primary: #2d9d5f;
      --header-bg: #216c6d;
      --bg: #ffffff;
      --surface: #f8fafc;
      --border: #abb9c8;
      --text: #1e293b;
      --text-secondary: #475569;
      --pass-bg: #dcf2e6;
      --fail-bg: #fee2e2;
      --fail-text: #b91c1c;
    }
    body { font-family: 'Ubuntu', sans-serif; max-width: 1250px; margin: 2rem auto; padding: 0 1rem; color: var(--text); background: #f1f5f9; }
    h1 { color: var(--header-bg); font-size: 1.75rem; margin-bottom: 0.5rem; text-align: center; }
    .meta { color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 2rem; text-align: center; }
    
    .dashboard-grid { margin-bottom: 2rem; }
    .chart-card { 
      background: linear-gradient(145deg, #ffffff, #f1f5f9); 
      border: 1px solid rgba(171, 185, 200, 0.3); 
      border-radius: 16px; 
      padding: 1.6rem; 
      box-shadow: 8px 8px 16px #e2e8f0, -4px -4px 12px #ffffff;
      margin-bottom: 2rem;
    }
    .chart-card h4 { margin: 0 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--header-bg); border-bottom: 2px solid rgba(33, 108, 109, 0.1); padding-bottom: 0.6rem; font-weight: 800; }
    .chart-container { position: relative; height: 350px; width: 100%; }

    table { border-collapse: separate; border-spacing: 0; width: 100%; margin-top: 1rem; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid var(--border); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); }
    th { background: var(--surface); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
  </style>
</head>
<body>
  <h1>Staging Inventory Report</h1>
  <div class="meta">
    <p>Generated: ${new Date().toISOString()}</p>
    <p>Manifest entries: ${manifestEntries} | Files in staging: ${files.length}</p>
  </div>

  <div class="dashboard-grid">
    <div class="chart-card">
      <h4>Download History (Last 30 Batches)</h4>
      <div class="chart-container">
        <canvas id="historyChart"></canvas>
      </div>
    </div>
  </div>

  <h3>Current Staging Files</h3>
  <table>
    <thead><tr><th>Path (staging)</th><th>Size (bytes)</th><th>Modified</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3">No synced files.</td></tr>'}</tbody>
  </table>

  <script>
    const historyData = ${historyData};
    if (historyData.length > 0) {
      const ctx = document.getElementById('historyChart').getContext('2d');
      const labels = historyData.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      });
      
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Downloaded (New)',
              data: historyData.map(d => d.synced),
              backgroundColor: '#2d9d5f',
            },
            {
              label: 'Skipped (Unchanged)',
              data: historyData.map(d => d.skipped),
              backgroundColor: '#94a3b8',
            },
            {
              label: 'Errors',
              data: historyData.map(d => d.errors),
              backgroundColor: '#ef4444',
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { stacked: true },
            y: { stacked: true, beginAtZero: true }
          },
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    } else {
      document.querySelector('.chart-card').style.display = 'none';
      const msg = document.createElement('p');
      msg.textContent = 'No download history available yet.';
      msg.style.textAlign = 'center';
      document.querySelector('.dashboard-grid').appendChild(msg);
    }
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLastRunId() {
  const path = join(ROOT, "output", "checkpoints", "last-run-id.txt");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

function addPairArgs(base, p) {
  if (p?.pairs && Array.isArray(p.pairs) && p.pairs.length > 0) {
    base.push("--pairs", JSON.stringify(p.pairs));
  } else if (p?.tenant && p?.purchaser) {
    base.push("--tenant", p.tenant, "--purchaser", p.purchaser);
  }
}
function syncArgs(p, runOpts) {
  const base = ["dist/index.js", "sync"];
  let limit = p?.syncLimit;

  // If resuming, subtract the files already synced in the previous run
  if (
    runOpts &&
    runOpts.resume &&
    limit > 0 &&
    runOpts.lastSyncDone !== undefined &&
    runOpts.lastSyncDone > 0
  ) {
    limit = Math.max(0, limit - runOpts.lastSyncDone);
  }

  if (limit > 0) base.push("--limit", String(limit));
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}
function runArgs(p, extra = [], runOpts = null) {
  const base = ["dist/index.js", "run", ...extra];
  if (runOpts && runOpts.runId) base.push("--run-id", runOpts.runId);
  if (p?.syncLimit > 0) base.push("--sync-limit", String(p.syncLimit));
  if (p?.extractLimit > 0) base.push("--extract-limit", String(p.extractLimit));
  if (p?.retryFailed) base.push("--retry-failed");
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}
function pipelineArgs(p, opts = {}) {
  const base = ["dist/index.js", "sync-extract"];
  if (opts.resume) base.push("--resume");
  if (opts.runId) base.push("--run-id", opts.runId);
  const limit =
    p?.syncLimit !== undefined && Number(p.syncLimit) >= 0
      ? Number(p.syncLimit)
      : 0;
  base.push("--limit", String(limit));
  if (p?.retryFailed) base.push("--retry-failed");
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}

const CASE_COMMANDS = {
  P1: (p, runOpts) => syncArgs(p, runOpts),
  P2: (p, runOpts) => runArgs(p, ["--no-sync"], runOpts),
  PIPE: (p, opts) => pipelineArgs(p, opts || {}),
  P3: () => ["node", ["dist/index.js", "report"], { cwd: ROOT }],
  P4: (p, runOpts) => {
    const base = ["dist/index.js", "sync", "-c", "config/config.yaml"];
    let limit = p?.syncLimit;
    if (
      runOpts &&
      runOpts.resume &&
      limit > 0 &&
      runOpts.lastSyncDone !== undefined &&
      runOpts.lastSyncDone > 0
    ) {
      limit = Math.max(0, limit - runOpts.lastSyncDone);
    }
    if (limit > 0) base.push("--limit", String(limit));
    return ["node", base, { cwd: ROOT }];
  },
  P5: (p, runOpts) => runArgs(p, [], runOpts),
  P6: (p) => runArgs(p, ["--no-sync", "--no-report"]),
  P7: () => [
    "node",
    [
      "-e",
      "const fs=require('fs');const p=require('path');const dir=p.join(process.cwd(),'output','logs');if(!fs.existsSync(dir))process.exit(1);const f=fs.readdirSync(dir).find(n=>n.endsWith('.jsonl'));if(!f)process.exit(1);const lines=fs.readFileSync(p.join(dir,f),'utf8').trim().split(/\\n/).filter(Boolean);const ok=lines.length>0&&lines.every(l=>{try{const j=JSON.parse(l);return j.runId&&j.filePath&&j.request&&j.response!==undefined;}catch(e){return false;}});process.exit(ok?0:1);",
    ],
    { cwd: ROOT },
  ],
  N1: () => [
    "node",
    ["dist/index.js", "sync", "-c", "config/nonexistent.yaml"],
    { cwd: ROOT },
  ],
  N2: () => [
    "node",
    ["dist/index.js", "report", "--run-id", "run_0000000000_fake"],
    { cwd: ROOT },
  ],
  N3: (p, runOpts) => syncArgs(p, runOpts),
  E1: (p, runOpts) => runArgs(p, ["--no-sync"], runOpts),
  E2: (p) => {
    const cp = join(ROOT, "output", "checkpoints", "checkpoint.json");
    if (existsSync(cp)) {
      try {
        copyFileSync(cp, cp + ".bak");
      } catch (_) {}
      writeFileSync(cp, "{}", "utf-8");
    }
    return runArgs(p, ["--no-sync"]);
  },
  E3: (p, runOpts) => syncArgs(p, runOpts),
  E4: () => {
    const runId = getLastRunId() || "run_0000000000_fake";
    return [
      "node",
      ["dist/index.js", "report", "--run-id", runId],
      { cwd: ROOT },
    ];
  },
  E5: (p) => runArgs(p, ["--no-sync"]),
};

const PROGRESS_REGEX = /(\d+)%\s*\((\d+)\/(\d+)\)/g;
const SYNC_PROGRESS_PREFIX = "SYNC_PROGRESS\t";
const EXTRACTION_PROGRESS_PREFIX = "EXTRACTION_PROGRESS\t";
const RESUME_SKIP_PREFIX = "RESUME_SKIP\t";
const RESUME_SKIP_SYNC_PREFIX = "RESUME_SKIP_SYNC\t";
const RUN_ID_PREFIX = "RUN_ID\t";
const LOG_PREFIX = "LOG\t";

function runCase(caseId, params = {}, callbacks = null, runOpts = null) {
  const def = CASE_COMMANDS[caseId];
  if (!def) return Promise.reject(new Error(`Unknown case: ${caseId}`));
  const resolved = typeof def === "function" ? def(params, runOpts) : def();
  const [cmd, args, opts] = resolved;
  const displayCmd = args ? [cmd, ...args].join(" ") : cmd;
  const onProgress =
    callbacks?.onProgress ??
    (typeof callbacks === "function" ? callbacks : null);
  const onSyncProgress = callbacks?.onSyncProgress ?? null;
  const onExtractionProgress = callbacks?.onExtractionProgress ?? null;
  const onResumeSkip = callbacks?.onResumeSkip ?? null;
  const onResumeSkipSync = callbacks?.onResumeSkipSync ?? null;
  const onChild = callbacks?.onChild ?? null;
  return new Promise((resolve) => {
    const child = spawn(cmd, args || [], {
      ...opts,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (onChild) onChild(child);
    let fullStdout = "";
    let lineBuffer = "";
    let stderr = "";
    let lastPercent = -1;
    child.stdout?.on("data", (d) => {
      const chunk = d.toString();
      fullStdout += chunk;
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (onSyncProgress && line.startsWith(SYNC_PROGRESS_PREFIX)) {
          const parts = line.slice(SYNC_PROGRESS_PREFIX.length).split("\t");
          if (parts.length >= 2) {
            const done = Number(parts[0]);
            const total = Number(parts[1]);
            if (!Number.isNaN(done))
              onSyncProgress(done, Number.isNaN(total) ? 0 : total);
          }
        }
        if (
          onExtractionProgress &&
          line.startsWith(EXTRACTION_PROGRESS_PREFIX)
        ) {
          const parts = line
            .slice(EXTRACTION_PROGRESS_PREFIX.length)
            .split("\t");
          if (parts.length >= 2) {
            const done = Number(parts[0]);
            const total = Number(parts[1]);
            if (!Number.isNaN(done))
              onExtractionProgress(done, Number.isNaN(total) ? 0 : total);
          }
        }
        if (onResumeSkip && line.startsWith(RESUME_SKIP_PREFIX)) {
          const parts = line.slice(RESUME_SKIP_PREFIX.length).split("\t");
          if (parts.length >= 2) {
            const skipped = Number(parts[0]);
            const total = Number(parts[1]);
            if (!Number.isNaN(skipped))
              onResumeSkip(skipped, Number.isNaN(total) ? 0 : total);
          }
        }
        if (onResumeSkipSync && line.startsWith(RESUME_SKIP_SYNC_PREFIX)) {
          const parts = line.slice(RESUME_SKIP_SYNC_PREFIX.length).split("\t");
          if (parts.length >= 2) {
            const skipped = Number(parts[0]);
            const total = Number(parts[1]);
            if (!Number.isNaN(skipped))
              onResumeSkipSync(skipped, Number.isNaN(total) ? 0 : total);
          }
        }
        if (line.startsWith(RUN_ID_PREFIX)) {
          const parts = line.slice(RUN_ID_PREFIX.length).split("\t");
          if (parts.length >= 1) {
            const runId = parts[0].trim();
            if (child.stdout && !child.stdout.destroyed) {
              child.stdout.emit(
                "data",
                JSON.stringify({ type: "run_id", runId }) + "\n",
              );
            }
          }
        }
        if (line.startsWith(LOG_PREFIX)) {
          const message = line.slice(LOG_PREFIX.length).trim();
          if (child.stdout && !child.stdout.destroyed) {
            child.stdout.emit(
              "data",
              JSON.stringify({ type: "log", message }) + "\n",
            );
          }
        }
      }
      const bufToScan = lineBuffer || fullStdout;
      if (onProgress && bufToScan) {
        let m;
        let last = null;
        PROGRESS_REGEX.lastIndex = 0;
        while ((m = PROGRESS_REGEX.exec(bufToScan)) !== null) last = m;
        if (last) {
          const [, pct, done, total] = last;
          const num = Number(pct);
          if (num !== lastPercent) {
            lastPercent = num;
            onProgress(num, Number(done), Number(total));
          }
        }
      }
    });
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code, signal) => {
      resolve({
        caseId,
        exitCode: code ?? (signal ? 1 : 0),
        stdout: fullStdout.trim(),
        stderr: stderr.trim(),
        command: displayCmd,
      });
    });
    child.on("error", (err) => {
      resolve({
        caseId,
        exitCode: 1,
        stdout: "",
        stderr: err.message,
        command: displayCmd,
      });
    });
  });
}

const HTML_PATH = join(__dirname, "index.html");

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ACTIVE_CRON_JOBS = new Map();
// Track running child processes to allow stopping them
const CHILD_PROCESSES = new Map(); // Key: runKey (caseId or caseId:scheduled), Value: ChildProcess

function registerScheduleJob(schedule) {
  if (!schedule || !schedule.id || !schedule.cron || !schedule.timezone) {
    return;
  }
  if (!cron.validate(schedule.cron)) {
    appendScheduleLog({
      outcome: "skipped",
      level: "warn",
      message: "Invalid cron expression for schedule; skipping",
      scheduleId: schedule.id,
      cron: schedule.cron,
    });
    return;
  }
  if (!SCHEDULE_TIMEZONES.includes(schedule.timezone)) {
    appendScheduleLog({
      outcome: "skipped",
      level: "warn",
      message: "Invalid timezone for schedule; skipping",
      scheduleId: schedule.id,
      timezone: schedule.timezone,
    });
    return;
  }
  if (ACTIVE_CRON_JOBS.has(schedule.id)) {
    try {
      ACTIVE_CRON_JOBS.get(schedule.id).stop();
    } catch (_) {}
    ACTIVE_CRON_JOBS.delete(schedule.id);
  }

  const task = cron.schedule(
    schedule.cron,
    async () => {
      const caseId = "PIPE"; // Cron jobs always run PIPE
      const start = new Date().toISOString();

      // Skip if any manual (non-scheduled) run is currently active
      const manualRunning = Array.from(ACTIVE_RUNS.entries()).find(
        ([key]) => !key.endsWith(":scheduled"),
      );
      if (manualRunning) {
        appendScheduleLog({
          outcome: "skipped",
          level: "warn",
          message:
            "Scheduled job skipped — a manual process (" +
            manualRunning[1].caseId +
            ") is currently running",
          scheduleId: schedule.id,
          skippedAt: start,
          activeManualCase: manualRunning[1].caseId,
        });
        return;
      }

      // Skip if any process is in paused (resumable) mode
      const pausedCase = Array.from(RESUME_CAPABLE_CASES).find((cid) => {
        const state = getRunState(cid);
        return state && state.status === "stopped";
      });
      if (pausedCase) {
        appendScheduleLog({
          outcome: "skipped",
          level: "warn",
          message:
            "Scheduled job skipped — a process (" +
            pausedCase +
            ") is in paused (resume) mode",
          scheduleId: schedule.id,
          skippedAt: start,
          pausedCase,
        });
        return;
      }

      appendScheduleLog({
        outcome: "executed",
        level: "info",
        message: "Scheduled job started",
        scheduleId: schedule.id,
        start,
      });

      const pairs = getPairsForSchedule(
        schedule.brands || [],
        schedule.purchasers || [],
      );
      const params = {};
      if (pairs.length > 0) {
        params.pairs = pairs;
      }

      // Track state like /run endpoint does
      // Track state like /run endpoint does
      const runInfo = {
        caseId,
        params,
        startTime: start,
        status: "running",
        scheduled: true, // Mark as cron job
        origin: "scheduled", // Explicitly mark as scheduled run
        scheduleId: schedule.id,
      };
      // Use distinct key to allow manual run to coexist
      const activeRunKey = `${caseId}:scheduled`;
      ACTIVE_RUNS.set(activeRunKey, runInfo);

      // NOTE: We do NOT call updateRunState here because we don't want
      // scheduled jobs to be resumable via the UI "Resume" button.

      try {
        const result = await runCase(
          caseId,
          params,
          {
            onChild: (child) => {
              CHILD_PROCESSES.set(activeRunKey, child);
            },
            onProgress: (percent, done, total) => {
              runInfo.progress = { percent, done, total };
            },
            onSyncProgress: (done, total) => {
              runInfo.syncProgress = { done, total };
            },
            onExtractionProgress: (done, total) => {
              runInfo.extractProgress = { done, total };
            },
          },
          null,
        );

        // Clean up active run tracking
        ACTIVE_RUNS.delete(activeRunKey);
        CHILD_PROCESSES.delete(activeRunKey);

        appendScheduleLog({
          outcome: "executed",
          level: "info",
          message: "Scheduled job finished",
          scheduleId: schedule.id,
          exitCode: result.exitCode,
        });
      } catch (e) {
        // Clean up on error
        ACTIVE_RUNS.delete(activeRunKey);
        CHILD_PROCESSES.delete(activeRunKey);

        appendScheduleLog({
          outcome: "executed",
          level: "error",
          message: "Scheduled job failed",
          scheduleId: schedule.id,
          error: e && e.message ? e.message : String(e),
        });
      }
    },
    {
      scheduled: true,
      timezone: schedule.timezone,
    },
  );
  ACTIVE_CRON_JOBS.set(schedule.id, task);
}

function bootstrapSchedules() {
  const list = loadSchedules();
  list.forEach((s) => registerScheduleJob(s));
}
createServer(async (req, res) => {
  const url = req.url?.split("?")[0] || "/";
  if (req.method === "GET" && url.startsWith("/assets/")) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.slice(1));
    } catch (_) {
      decodedPath = url.slice(1);
    }
    const assetsDir = resolve(ROOT, "assets");
    let filePath = resolve(ROOT, normalize(decodedPath));
    if (!filePath.startsWith(assetsDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!existsSync(filePath)) {
        if (url === "/assets/logo.png" || url.startsWith("/assets/logo")) {
          if (existsSync(assetsDir)) {
            const files = readdirSync(assetsDir);
            const png = files.find((f) => f.toLowerCase().endsWith(".png"));
            if (png) filePath = join(assetsDir, png);
          }
        }
      }
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const data = readFileSync(filePath);
      const mime = MIME[extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
    return;
  }
  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    try {
      const html = readFileSync(HTML_PATH, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("index.html not found");
    }
    return;
  }
  if (req.method === "POST" && url === "/run") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const {
        caseId,
        syncLimit,
        extractLimit,
        tenant,
        purchaser,
        pairs,
        resume,
        lastSyncDone,
        lastExtractDone,
      } = JSON.parse(body || "{}");
      if (!caseId || !CASE_COMMANDS[caseId]) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing caseId" }));
        return;
      }
      const params = {};
      if (syncLimit !== undefined && Number(syncLimit) >= 0)
        params.syncLimit = Number(syncLimit);
      if (extractLimit !== undefined && Number(extractLimit) >= 0)
        params.extractLimit = Number(extractLimit);
      if (pairs && Array.isArray(pairs) && pairs.length > 0) {
        params.pairs = pairs.filter(
          (x) =>
            x &&
            typeof x.tenant === "string" &&
            typeof x.purchaser === "string",
        );
        if (params.pairs.length === 0) params.pairs = undefined;
      }
      if (!params.pairs) {
        if (tenant && typeof tenant === "string") params.tenant = tenant.trim();
        if (purchaser && typeof purchaser === "string")
          params.purchaser = purchaser.trim();
      }
      if (body.retryFailed === true) {
        params.retryFailed = true;
      }
      const runOpts =
        resume === true
          ? { resume: true, lastSyncDone, lastExtractDone }
          : null;

      if (caseId === "PIPE") {
        try {
          const dir = dirname(LAST_PIPE_PARAMS_PATH);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(
            LAST_PIPE_PARAMS_PATH,
            JSON.stringify({ syncLimit: params.syncLimit ?? 0 }),
            "utf-8",
          );
        } catch (_) {}
      }

      // Track active run
      const runInfo = {
        caseId,
        params,
        startTime: new Date().toISOString(),
        status: "running",
        origin: "manual", // Explicitly mark as manual run
      };
      ACTIVE_RUNS.set(caseId, runInfo);

      // Clear ALL other case states — only the latest run should be resumable.
      // This prevents the UI deadlock where multiple cases show Resume buttons
      // after page reload (e.g. P1 was paused, then PIPE was killed by reload).
      const allStates = loadRunStates();
      for (const key of Object.keys(allStates)) {
        if (key !== caseId) delete allStates[key];
      }
      saveRunStates(allStates);

      updateRunState(caseId, runInfo);

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Transfer-Encoding": "chunked",
      });
      const writeLine = (obj) => res.write(JSON.stringify(obj) + "\n");

      let currentChild = null;
      res.on("close", () => {
        if (currentChild) {
          currentChild.kill("SIGTERM");
          currentChild = null;
        }
      });

      const result = await runCase(
        caseId,
        params,
        {
          onChild: (child) => {
            currentChild = child;
            CHILD_PROCESSES.set(caseId, child);
          },
          onProgress: (percent, done, total) => {
            writeLine({ type: "progress", percent, done, total });
            // Update progress in active run tracking
            const activeRun = ACTIVE_RUNS.get(caseId);
            if (activeRun) {
              activeRun.progress = { percent, done, total };
              ACTIVE_RUNS.set(caseId, activeRun);
            }
          },
          onSyncProgress: (done, total) => {
            writeLine({ type: "sync_progress", done, total });
            const activeRun = ACTIVE_RUNS.get(caseId);
            if (activeRun) {
              activeRun.syncProgress = { done, total };
              ACTIVE_RUNS.set(caseId, activeRun);
            }
          },
          onExtractionProgress: (done, total) => {
            writeLine({ type: "extraction_progress", done, total });
            const activeRun = ACTIVE_RUNS.get(caseId);
            if (activeRun) {
              activeRun.extractProgress = { done, total };
              ACTIVE_RUNS.set(caseId, activeRun);
            }
          },
          onResumeSkip: (skipped, total) => {
            writeLine({ type: "resume_skip", skipped, total });
          },
          onResumeSkipSync: (skipped, total) => {
            writeLine({ type: "resume_skip_sync", skipped, total });
          },
        },
        runOpts,
      );
      currentChild = null;
      const interrupted =
        res.destroyed ||
        result.exitCode === 143 ||
        result.exitCode === 130 ||
        result.signal === "SIGTERM";

      // Clean up active run tracking
      CHILD_PROCESSES.delete(caseId);
      ACTIVE_RUNS.delete(caseId);

      if (interrupted) {
        // Process was stopped/interrupted - update state for resume
        const runId = getCurrentRunIdFromCheckpoint();
        if (runId) spawnReportForRunId(runId).catch(() => {});

        // Only save resume state for cases that support it
        if (RESUME_CAPABLE_CASES.has(caseId)) {
          const stateUpdate = {
            status: "stopped",
            stoppedTime: new Date().toISOString(),
            params,
          };
          // Add progress info if available
          const activeRun = ACTIVE_RUNS.get(caseId);
          if (activeRun) {
            if (activeRun.syncProgress)
              stateUpdate.syncProgress = activeRun.syncProgress;
            if (activeRun.extractProgress)
              stateUpdate.extractProgress = activeRun.extractProgress;
          }
          updateRunState(caseId, stateUpdate);
        } else {
          // For cases that don't support resume, clear the state
          clearRunState(caseId);
        }
      } else if (result.exitCode === 0) {
        // Process completed successfully
        const runId = getCurrentRunIdFromCheckpoint();
        if (runId) markRunCompleted(runId);
        // Clear run state on successful completion
        clearRunState(caseId);
      } else {
        // Process failed - clear state
        clearRunState(caseId);
      }

      if (!res.destroyed) {
        try {
          writeLine({ type: "result", ...result });
          res.end();
        } catch (_) {}
      }
    } catch (e) {
      // Best effort cleanup
      try {
        const cid = JSON.parse(body || "{}").caseId;
        if (cid) {
          CHILD_PROCESSES.delete(cid);
          ACTIVE_RUNS.delete(cid);
        }
      } catch (_) {}

      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "POST" && url === "/api/stop-run") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { caseId, origin } = JSON.parse(body || "{}");
      if (!caseId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing caseId" }));
        return;
      }

      const runKey = origin === "scheduled" ? `${caseId}:scheduled` : caseId;
      const child = CHILD_PROCESSES.get(runKey);

      if (child) {
        child.kill("SIGTERM");
        // Cleanup happens in close handler of child process spawned in runCase

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Stop signal sent" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Process not found", runKey }));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/active-runs") {
    try {
      const runs = Array.from(ACTIVE_RUNS.values());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ activeRuns: runs }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url.startsWith("/api/run-status")) {
    try {
      // Parse query parameter for case ID if provided
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const queryCaseId = urlObj.searchParams.get("caseId");

      if (queryCaseId) {
        // Return status for specific case
        const state = getRunState(queryCaseId);
        const isActive = ACTIVE_RUNS.has(queryCaseId);
        const canResume =
          state &&
          state.status === "stopped" &&
          RESUME_CAPABLE_CASES.has(queryCaseId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            caseId: queryCaseId,
            isRunning: isActive,
            canResume,
            state: state || {},
          }),
        );
      } else {
        // Return PIPE status for backward compatibility
        const pipelineStatus = getRunStatusFromCheckpoint();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pipelineStatus));
      }
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "POST" && url === "/api/run-state/clear") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { caseId } = JSON.parse(body || "{}");
      if (caseId && typeof caseId === "string") {
        clearRunState(caseId);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/schedule-log") {
    try {
      const entries = readScheduleLogEntries();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/schedules") {
    try {
      const list = loadSchedules();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ schedules: list, timezones: SCHEDULE_TIMEZONES }),
      );
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "POST" && url === "/api/schedules") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const {
        brands,
        purchasers,
        cron: cronExpr,
        timezone,
      } = JSON.parse(body || "{}");
      const brandList = Array.isArray(brands)
        ? brands.filter((b) => typeof b === "string" && b.trim() !== "")
        : [];
      const purchaserList = Array.isArray(purchasers)
        ? purchasers.filter((p) => typeof p === "string" && p.trim() !== "")
        : [];
      if (brandList.length === 0 && purchaserList.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Please select at least one brand or purchaser.",
          }),
        );
        return;
      }
      if (
        !cronExpr ||
        typeof cronExpr !== "string" ||
        !cron.validate(cronExpr)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "Invalid cron expression. Use standard 5-field syntax like '0 * * * *'.",
          }),
        );
        return;
      }
      if (
        !timezone ||
        typeof timezone !== "string" ||
        !SCHEDULE_TIMEZONES.includes(timezone)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Invalid timezone. Please choose a value from the dropdown.",
          }),
        );
        return;
      }
      const list = loadSchedules();
      // Check for duplicates
      if (list.some((s) => s.cron === cronExpr && s.timezone === timezone)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "A schedule for this time and timezone already exists.",
          }),
        );
        return;
      }
      const sched = {
        id: scheduleId(),
        createdAt: new Date().toISOString(),
        brands: brandList,
        purchasers: purchaserList,
        cron: cronExpr,
        timezone,
      };
      list.push(sched);
      saveSchedules(list);
      registerScheduleJob(sched);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sched));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "PUT" && url.startsWith("/api/schedules/")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const id = decodeURIComponent(url.slice("/api/schedules/".length));
      const {
        brands,
        purchasers,
        cron: cronExpr,
        timezone,
      } = JSON.parse(body || "{}");
      const brandList = Array.isArray(brands)
        ? brands.filter((b) => typeof b === "string" && b.trim() !== "")
        : [];
      const purchaserList = Array.isArray(purchasers)
        ? purchasers.filter((p) => typeof p === "string" && p.trim() !== "")
        : [];
      if (brandList.length === 0 && purchaserList.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Please select at least one brand or purchaser.",
          }),
        );
        return;
      }
      if (
        !cronExpr ||
        typeof cronExpr !== "string" ||
        !cron.validate(cronExpr)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "Invalid cron expression. Use standard 5-field syntax like '0 * * * *'.",
          }),
        );
        return;
      }
      if (
        !timezone ||
        typeof timezone !== "string" ||
        !SCHEDULE_TIMEZONES.includes(timezone)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Invalid timezone. Please choose a value from the dropdown.",
          }),
        );
        return;
      }
      const list = loadSchedules();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Schedule not found" }));
        return;
      }
      // Check for duplicates (excluding self)
      if (
        list.some(
          (s, i) => i !== idx && s.cron === cronExpr && s.timezone === timezone,
        )
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "A schedule for this time and timezone already exists.",
          }),
        );
        return;
      }
      const updated = {
        ...list[idx],
        brands: brandList,
        purchasers: purchaserList,
        cron: cronExpr,
        timezone,
      };
      list[idx] = updated;
      saveSchedules(list);
      registerScheduleJob(updated);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(updated));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "DELETE" && url.startsWith("/api/schedules/")) {
    try {
      const id = decodeURIComponent(url.slice("/api/schedules/".length));
      const list = loadSchedules();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Schedule not found" }));
        return;
      }
      list.splice(idx, 1);
      saveSchedules(list);
      const job = ACTIVE_CRON_JOBS.get(id);
      if (job) {
        try {
          job.stop();
        } catch (_) {}
        ACTIVE_CRON_JOBS.delete(id);
      }
      res.writeHead(204);
      res.end();
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/config") {
    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ brandPurchasers: BRAND_PURCHASERS }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/run-status") {
    try {
      const status = getRunStatusFromCheckpoint();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/reports") {
    try {
      const list = { html: [], json: [] };
      if (!existsSync(REPORTS_DIR)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list));
        return;
      }
      const files = readdirSync(REPORTS_DIR, { withFileTypes: true }).filter(
        (e) => e.isFile() && ALLOWED_EXT.has(extname(e.name).toLowerCase()),
      );
      for (const f of files) {
        const ext = extname(f.name).toLowerCase();
        const key = ext === ".html" ? "html" : "json";
        let mtime = 0;
        try {
          mtime = statSync(join(REPORTS_DIR, f.name)).mtimeMs;
        } catch (_) {}
        list[key].push({ name: f.name, mtime });
      }
      for (const key of Object.keys(list)) {
        list[key].sort((a, b) => b.mtime - a.mtime);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url.startsWith("/api/reports/")) {
    const rest = url.slice("/api/reports/".length);
    const slash = rest.indexOf("/");
    const format = slash === -1 ? rest : rest.slice(0, slash);
    const filename = slash === -1 ? null : rest.slice(slash + 1);
    if (!filename || !["html", "json"].includes(format)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing caseId" }));
      return;
    }
    const ext = format === "html" ? ".html" : ".json";
    if (
      !filename.endsWith(ext) ||
      filename.includes("..") ||
      /[\\/]/.test(filename)
    ) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid filename" }));
      return;
    }
    const filePath = resolve(REPORTS_DIR, filename);
    if (!filePath.startsWith(resolve(REPORTS_DIR))) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      const stat = statSync(filePath);
      const contentType = format === "html" ? "text/html" : "application/json";
      const headers = {
        "Content-Type": contentType,
        "Content-Disposition":
          'attachment; filename="' + filename.replace(/"/g, '\\"') + '"',
        "Content-Length": stat.size,
      };
      res.writeHead(200, headers);
      req.setTimeout(0);
      res.setTimeout(0);
      const stream = createReadStream(filePath);
      stream.on("error", (e) => {
        if (!res.writableEnded) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(e.message) }));
        }
      });
      stream.pipe(res);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/sync-report") {
    try {
      const html = buildSyncReportHtml();
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Disposition": 'attachment; filename="sync-report.html"',
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/extractions-zip") {
    try {
      if (!existsSync(EXTRACTIONS_DIR)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Extractions folder not found. Run extraction first.",
          }),
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="extractions.zip"',
      });
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => {
        try {
          res.end();
        } catch (_) {}
      });
      archive.pipe(res);
      const succeededDir = join(EXTRACTIONS_DIR, "succeeded");
      const failedDir = join(EXTRACTIONS_DIR, "failed");
      if (existsSync(succeededDir))
        archive.directory(succeededDir, "succeeded");
      if (existsSync(failedDir)) archive.directory(failedDir, "failed");
      archive.finalize();
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => {
  console.log(`IntelliExtract app: http://localhost:${PORT}/`);
  console.log("Open in browser, select Brand/Purchaser, then click Run.");
  bootstrapSchedules();
});
