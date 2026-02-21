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
import { getEmailConfig, saveEmailConfig } from "./dist/mailer.js";

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

// Load logo for reports
let REPORT_LOGO_DATA_URI = "";
try {
  const logoPath = join(ROOT, "assets", "logo.png");
  if (existsSync(logoPath)) {
    const buffer = readFileSync(logoPath);
    REPORT_LOGO_DATA_URI = `data:image/png;base64,${buffer.toString("base64")}`;
  }
} catch (_) {}

// Load favicon for reports
let REPORT_FAVICON_DATA_URI = "";
try {
  const favPath = join(ROOT, "assets", "favicon.ico");
  if (existsSync(favPath)) {
    const buffer = readFileSync(favPath);
    REPORT_FAVICON_DATA_URI = `data:image/x-icon;base64,${buffer.toString("base64")}`;
  }
} catch (_) {}

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

function formatBrandDisplayName(brandId) {
  if (!brandId) return "N/A";
  var b = brandId.toLowerCase();
  if (b.includes("no-cow")) return "No Cow";
  if (b.includes("sundia")) return "Sundia";
  if (b.includes("tractor-beverage")) return "Tractor";
  if (b === "p3" || b === "pipe") return "PIPE";
  return brandId;
}

function formatPurchaserDisplayName(purchaserId) {
  if (!purchaserId) return "N/A";
  var p = purchaserId.toLowerCase();
  if (p.includes("8c03bc63-a173-49d2-9ef4-d3f4c540fae8")) return "Temp 1";
  if (p.includes("a451e439-c9d1-41c5-b107-868b65b596b8")) return "Temp 2";
  if (p.includes("dot_foods")) return "DOT Foods";
  if (p === "640" || p === "641" || p.includes("640") || p.includes("641"))
    return "DMC";
  if (p === "843") return "HPI";
  if (p === "895") return "HPD";
  if (p === "897") return "HPM";
  if (p === "991") return "HPT";
  if (p.includes("kehe")) return "KeHE";
  if (p.includes("unfi")) return "UNFI";
  return purchaserId;
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

function buildExtractionDataPageHtml() {
  const succDir = join(EXTRACTIONS_DIR, "succeeded");
  const failDir = join(EXTRACTIONS_DIR, "failed");

  const loadFiles = (dir, status) => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const path = join(dir, f);
        let content = {};
        let mtime = 0;
        try {
          content = JSON.parse(readFileSync(path, "utf-8"));
        } catch (_) {}
        try {
          mtime = statSync(path).mtimeMs;
        } catch (_) {}
        return { filename: f, status, content, mtime };
      });
  };

  const succFiles = loadFiles(succDir, "success");
  const failFiles = loadFiles(failDir, "failed");
  const allFiles = [...succFiles, ...failFiles].sort(
    (a, b) => b.mtime - a.mtime,
  );

  const totalSuccess = succFiles.length;
  const totalFailed = failFiles.length;
  const totalAll = allFiles.length;
  const successRate =
    totalAll > 0 ? Math.round((totalSuccess / totalAll) * 100) : 0;

  const d = new Date();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let suffix = "th";
  if (day % 10 === 1 && day !== 11) suffix = "st";
  else if (day % 10 === 2 && day !== 12) suffix = "nd";
  else if (day % 10 === 3 && day !== 13) suffix = "rd";
  const now = `${day}${suffix} ${month} ${year}`;

  // Pre-process files to accurately identify brand and purchaser
  const processedFiles = allFiles.map((f) => {
    const brand = f.filename.split("_")[0] || "";
    let purchaser = "";
    const rest = f.filename.slice(brand.length + 1);
    const possiblePurchasers = BRAND_PURCHASERS[brand] || [];
    for (const p of possiblePurchasers) {
      if (rest.startsWith(p + "_")) {
        purchaser = p;
        break;
      }
    }
    if (!purchaser) {
      purchaser = f.content?.pattern?.purchaser_key || "";
    }
    return { ...f, brand, purchaser };
  });

  const allBrands = Array.from(
    new Set(processedFiles.map((f) => f.brand).filter(Boolean)),
  );
  const allPurchasers = Array.from(
    new Set(processedFiles.map((f) => f.purchaser).filter(Boolean)),
  ).sort((a, b) => {
    const nameA = formatPurchaserDisplayName(a).toLowerCase();
    const nameB = formatPurchaserDisplayName(b).toLowerCase();
    const isTempA = nameA.includes("temp");
    const isTempB = nameB.includes("temp");
    if (isTempA && !isTempB) return 1;
    if (!isTempA && isTempB) return -1;
    return nameA.localeCompare(nameB);
  });

  const brandNamesMap = {};
  allBrands.forEach((id) => (brandNamesMap[id] = formatBrandDisplayName(id)));
  const purchaserNamesMap = {};
  allPurchasers.forEach(
    (id) => (purchaserNamesMap[id] = formatPurchaserDisplayName(id)),
  );

  const brandPurchaserMap = {};
  processedFiles.forEach((f) => {
    if (f.brand && f.purchaser) {
      if (!brandPurchaserMap[f.brand]) brandPurchaserMap[f.brand] = [];
      if (!brandPurchaserMap[f.brand].includes(f.purchaser))
        brandPurchaserMap[f.brand].push(f.purchaser);
    }
  });

  const escHtml = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rowsJson = JSON.stringify(
    processedFiles.map((f) => ({
      filename: f.filename,
      brand: f.brand,
      purchaser: f.purchaser,
      status: f.status,
      mtime: f.mtime,
      patternKey: f.content?.pattern?.pattern_key ?? null,
      purchaserKey: f.content?.pattern?.purchaser_key ?? null,
      success: f.content?.success ?? null,
      json: f.content,
    })),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Operation Data Explorer — IntelliExtract</title>
  ${REPORT_FAVICON_DATA_URI ? `<link rel="icon" href="${REPORT_FAVICON_DATA_URI}" type="image/x-icon">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #f5f7f9;
      --surface: #ffffff;
      --text: #2c2c2c;
      --text-secondary: #5a5a5a;
      --border: #b0bfc9;
      --border-light: #cbd5e1;
      --header-bg: #216c6d;
      --header-text: #ffffff;
      --primary: #2d9d5f;
      --accent-light: #e8f5ee;
      --pass: #248f54;
      --pass-bg: #e8f5ee;
      --fail: #c62828;
      --fail-bg: #ffebee;
      --muted: #6b7c85;
      --radius: 12px;
      --radius-sm: 8px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1rem;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
    }
    .report-header {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      padding: 1rem 2rem;
      border-radius: 0 0 16px 16px;
      margin-bottom: 1rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid rgba(176, 191, 201, 0.3);
      position: sticky;
      top: 0;
      z-index: 1000;
      min-height: 72px;
    }
    .btn-back-main {
      background: var(--header-bg) !important;
      color: white !important;
      border: none;
      border-radius: 8px;
      height: 36px;
      padding: 0 1.25rem;
      font-size: 0.85rem;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace !important;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(33, 108, 109, 0.2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .btn-back-main:hover {
      background: var(--primary) !important;
      transform: translateX(-4px);
      box-shadow: 0 6px 16px rgba(45, 157, 95, 0.3);
    }
    .btn-back-main svg { width: 16px; height: 16px; transition: transform 0.2s; }
    .btn-back-main:hover svg { transform: translateX(-2px); }
    .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
    .report-header .logo { height: 32px; width: auto; object-fit: contain; cursor: pointer; }
    .report-header-title {
      margin: 0;
      height: 34px;
      font-size: 0.82rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #ffffff;
      background: var(--header-bg);
      padding: 0 1.1rem;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      line-height: 1;
      font-family: inherit;
    }
    .meta { color: var(--text-secondary); font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta p { margin: 2px 0; }

    /* Filtering Styles */
    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-filter-row { display: flex; align-items: center; gap: 0.75rem; }
    .header-field-wrap { display: flex; flex-direction: column; align-items: center; }
    .filter-dropdown { position: relative; }
    .filter-chip { 
      display: flex; align-items: center; height: 34px; background: #fff; 
      border: 1px solid rgba(176,191,201,0.6); border-radius: 8px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .filter-chip .header-label {
      font-size: 0.7rem; color: var(--primary); font-weight: 800; background: var(--accent-light);
      padding: 0 0.75rem; height: 100%; display: flex; align-items: center;
      border-right: 1px solid rgba(45,157,95,0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .filter-dropdown-trigger {
      border: none; background: transparent; height: 100%; padding: 0 1.5rem 0 0.75rem;
      font-size: 0.85rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .brand-field-wrap .filter-dropdown-trigger { min-width: 162px; max-width: 162px; }
    .purchaser-field-wrap .filter-dropdown-trigger { min-width: 187px; max-width: 187px; }

    .filter-dropdown-panel {
      display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
      min-width: 220px; max-height: 400px; overflow-y: auto; background: white;
      border: 1px solid var(--border-light); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      z-index: 1100; padding: 0.5rem 0;
    }
    .filter-dropdown-panel.open { display: block; animation: slideDownPanel 0.2s ease-out; }
    .filter-dropdown-option {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      font-size: 0.85rem; cursor: pointer; transition: background 0.1s;
    }
    .filter-dropdown-option:hover { background: #f8fafc; }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }
    
    .header-btn-reset {
      height: 34px; 
      padding: 0 1.1rem; 
      background: var(--header-bg); 
      color: #fff;
      border: none; 
      border-radius: 6px; 
      font-size: 0.82rem; 
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer; 
      box-shadow: 0 2px 5px rgba(33,108,109,0.2); 
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      font-family: inherit;
    }
    .header-btn-reset:hover { filter: brightness(1.1); transform: translateY(-1px); }
    @keyframes slideDownPanel { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

    .page-body { padding: 0.75rem 0; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .stat-card .stat-label {
      font-size: 0.65rem;
      font-weight: 800;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
    }
    .stat-card .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--header-bg);
      line-height: 1;
    }
    .stat-card .stat-sub { font-size: 0.7rem; color: var(--muted); }
    .stat-card.success .stat-value { color: var(--pass); }
    .stat-card.failed .stat-value { color: var(--fail); }
    .stat-card.rate .stat-value { color: var(--primary); }

    .controls-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      margin-bottom: 1rem;
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius-sm);
      padding: 0.75rem 1.25rem;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .tab-group { display: flex; gap: 0.25rem; }
    .tab-btn {
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 0.45rem 1rem;
      font-size: 0.8rem;
      font-weight: 700;
      color: var(--muted);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    .tab-btn:hover { background: var(--bg); color: var(--text); }
    .tab-btn.active { background: var(--header-bg); color: white; border-color: var(--header-bg); }
    .tab-btn .count {
      display: inline-block;
      background: rgba(255,255,255,0.25);
      border-radius: 100px;
      padding: 0 0.4rem;
      font-size: 0.7rem;
      margin-left: 0.35rem;
    }
    .tab-btn:not(.active) .count { background: var(--bg); color: var(--muted); }

    .search-wrap { position: relative; flex: 1; max-width: 400px; }
    .search-wrap svg { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
    .search-input {
      width: 100%;
      height: 38px;
      padding: 0 1rem 0 2.5rem;
      border: 1px solid var(--border-light);
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.85rem;
      background: var(--bg);
      color: var(--text);
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus { border-color: var(--primary); background: white; }

    .results-info { font-size: 0.75rem; color: var(--muted); white-space: nowrap; }

    .data-table-wrap {
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.8rem;
    }
    .data-table thead th {
      background: #f8fafc;
      color: var(--muted);
      font-size: 0.65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border-light);
      text-align: left;
    }
    .data-table tbody tr {
      border-bottom: 1px solid rgba(203,213,225,0.4);
      transition: background 0.1s;
      cursor: pointer;
    }
    .data-table tbody tr:hover { background: #f8fafc; }
    .data-table tbody tr:last-child { border-bottom: none; }
    .data-table td {
      padding: 0.75rem 1rem;
      vertical-align: middle;
    }
    .data-table tr.expanded { background: #f0f9ff; }
    .data-table tr.expanded:hover { background: #e0f2fe; }

    .expand-row td {
      padding: 0;
      background: #0f172a;
      cursor: default;
    }
    .expand-row:hover td { background: #0f172a; }
    .json-viewer {
      padding: 1.25rem 1.5rem;
      overflow-x: auto;
      max-height: 500px;
      overflow-y: auto;
      animation: slideDown 0.28s cubic-bezier(0.25, 1, 0.5, 1);
    }
    @keyframes slideDown {
      from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
      to   { opacity: 1; max-height: 500px; }
    }
    @keyframes slideUp {
      from { opacity: 1; max-height: 500px; }
      to   { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
    }
    .json-viewer pre {
      margin: 0;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      line-height: 1.6;
      color: #e2e8f0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .json-key { color: #93c5fd; }
    .json-string { color: #86efac; }
    .json-number { color: #fbbf24; }
    .json-bool-true { color: #34d399; }
    .json-bool-false { color: #f87171; }
    .json-null { color: #94a3b8; }

    /* Expand loader spinner */
    .json-loader {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1.5rem 1.75rem;
      color: #94a3b8;
      font-size: 0.78rem;
      animation: slideDown 0.18s cubic-bezier(0.25, 1, 0.5, 1);
    }
    .json-spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(148,163,184,0.25);
      border-top-color: #93c5fd;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .badge {
      display: inline-block;
      font-size: 0.6rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-success { background: var(--pass-bg); color: var(--pass); }
    .badge-failed { background: var(--fail-bg); color: var(--fail); }

    .expand-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: var(--bg);
      border: 1px solid var(--border-light);
      color: var(--muted);
      transition: all 0.2s;
      flex-shrink: 0;
    }
    tr.expanded .expand-icon { background: var(--header-bg); color: white; border-color: var(--header-bg); transform: rotate(90deg); }

    .pagination-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 1.25rem;
      border-top: 1px solid var(--border-light);
    }
    .pg-btn {
      min-width: 34px;
      height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
      padding: 0 0.5rem;
    }
    .pg-btn:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); background: var(--pass-bg); }
    .pg-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pg-btn.active { background: var(--primary); color: white; border-color: var(--primary); }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--muted);
    }
    .empty-state .icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.4; }
    .empty-state p { margin: 0; font-size: 0.85rem; }

    .filename-cell { font-size: 0.72rem; word-break: break-all; color: var(--text); max-width: 280px; }
    .pattern-cell code {
      background: var(--bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.68rem;
      color: var(--header-bg);
    }
    .time-cell { font-size: 0.72rem; color: var(--text-secondary); white-space: nowrap; }
    .toggle-cell { width: 40px; text-align: center; }
    .action-cell { width: 100px; text-align: center; }
    .btn-download-row {
      background: var(--bg);
      border: 1px solid var(--border-light);
      border-radius: 4px;
      padding: 0.3rem 0.6rem;
      cursor: pointer;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.7rem;
      font-weight: 700;
      transition: all 0.15s;
    }
    .btn-download-row:hover {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }
    @media (max-width: 1080px) {
      .report-header { padding: 0.75rem 1rem; min-height: 64px; }
      .report-header-title { font-size: 0.75rem; padding: 0 0.75rem; }
      .header-filter-row { gap: 0.5rem; }
      .brand-field-wrap .filter-dropdown-trigger { min-width: 140px; max-width: 140px; }
      .purchaser-field-wrap .filter-dropdown-trigger { min-width: 160px; max-width: 160px; }
      .header-btn-reset { width: 140px; font-size: 0.75rem; padding: 0 0.8rem; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div style="display: flex; align-items: center; gap: 1.5rem; width: 100%;">
      <a href="javascript:void(0)" onclick="goToHome()" title="Go to Home" style="display: flex; align-items: center; height: 34px;">
        <img src="${REPORT_LOGO_DATA_URI}" alt="intellirevenue" class="logo">
      </a>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <button type="button" onclick="goToHome()" class="btn-back-main">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
              <span>Back</span>
            </button>
            <h1 class="report-header-title">Operation Data Explorer</h1>
          </div>
          <div class="report-header-right">
             <div class="header-filter-row">
                  <div class="header-field-wrap brand-field-wrap">
                    <div id="brand-dropdown" class="filter-dropdown">
                      <div class="filter-chip">
                        <label class="header-label" for="brand-dropdown-trigger">Brand</label>
                        <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">
                          Select brand
                        </button>
                      </div>
                      <div id="brand-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
                    </div>
                  </div>
                  <div class="header-field-wrap purchaser-field-wrap">
                    <div id="purchaser-dropdown" class="filter-dropdown">
                      <div class="filter-chip">
                        <label class="header-label" for="purchaser-dropdown-trigger">Purchaser</label>
                        <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">
                          Select purchaser
                        </button>
                      </div>
                      <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
                    </div>
                  </div>
                  <div class="header-field-wrap header-filter-reset-wrap">
                    <button type="button" id="filter-reset-btn" class="header-btn-reset" onclick="resetFilters()">
                      Reset Filter
                    </button>
                  </div>
                </div>
          </div>
        </div>
        <div class="meta" style="display: flex; gap: 1.25rem; opacity: 0.85;">
          <span>Generated: ${now}</span>
          <span id="operation-count-label">${totalAll} operation(s)</span>
        </div>
      </div>
    </div>
  </div>

  <div class="page-body">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Extractions</div>
        <div class="stat-value" id="tot-val">${totalAll}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Succeeded</div>
        <div class="stat-value" id="succ-val">${totalSuccess}</div>
        <div class="stat-sub">Extraction success</div>
      </div>
      <div class="stat-card failed">
        <div class="stat-label">Failed</div>
        <div class="stat-value" id="fail-val">${totalFailed}</div>
        <div class="stat-sub">Require attention</div>
      </div>
      <div class="stat-card rate">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value" id="rate-val">${successRate}%</div>
        <div class="stat-sub">Filter applied</div>
      </div>
    </div>

    <div class="controls-bar">
      <div class="tab-group">
        <button class="tab-btn active" data-filter="all">All <span class="count" id="c-all">${totalAll}</span></button>
        <button class="tab-btn" data-filter="success">Succeeded <span class="count" id="c-succ">${totalSuccess}</span></button>
        <button class="tab-btn" data-filter="failed">Failed <span class="count" id="c-fail">${totalFailed}</span></button>
      </div>
      <div class="search-wrap">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" class="search-input" id="search-input" placeholder="Search filename, pattern, purchaser…">
      </div>
      <div class="results-info" id="results-info"></div>
    </div>

    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th class="toggle-cell"></th>
            <th>Timestamp</th>
            <th>Filename</th>
            <th>Pattern Key</th>
            <th>Purchaser</th>
            <th>Status</th>
            <th class="action-cell">Action</th>
          </tr>
        </thead>
        <tbody id="table-body">
        </tbody>
      </table>
      <div class="pagination-bar" id="pagination-bar"></div>
    </div>
  </div>

  <script>
    var ALL_ROWS = ${rowsJson};
    var CONFIG = {
      brands: ${JSON.stringify(allBrands)},
      purchasers: ${JSON.stringify(allPurchasers)},
      brandPurchaserMap: ${JSON.stringify(brandPurchaserMap)},
      brandNames: ${JSON.stringify(brandNamesMap)},
      purchaserNames: ${JSON.stringify(purchaserNamesMap)}
    };

    var PAGE_SIZE = 20;
    var currentPage = 1;
    var currentFilter = 'all';
    var currentSearch = '';
    var expandedRows = new Set();
    var selectedBrands = [];
    var selectedPurchasers = [];

    function goToHome() { 
      try {
        if (window.parent && typeof window.parent.closeReportView === 'function') {
          window.parent.closeReportView();
          return;
        }
      } catch (e) {}
      window.location.href = "/"; 
    }

    // Push a history entry so pressing browser Back navigates home
    if (window.history && window.history.pushState) {
      history.pushState({ page: 'report' }, document.title, window.location.href);
    }
    window.addEventListener('popstate', function() {
      goToHome();
    });


    function escHtml(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function formatTime(ms) {
      if (!ms) return '—';
      return new Date(ms).toLocaleString();
    }

    function initFilters() {
      // Brand Dropdown
      const brandPanel = document.getElementById('brand-dropdown-panel');
      const bTrigger = document.getElementById('brand-dropdown-trigger');
      bTrigger.onclick = (e) => {
        e.stopPropagation();
        brandPanel.classList.toggle('open');
        document.getElementById('purchaser-dropdown-panel').classList.remove('open');
      };

      CONFIG.brands.forEach(b => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.brandNames[b] || b;
        div.innerHTML = '<input type="checkbox" value="' + b + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          e.stopPropagation();
          const cb = div.querySelector('input');
          if (e.target !== cb) cb.checked = !cb.checked;
          updateFilters();
        };
        brandPanel.appendChild(div);
      });

      // Purchaser Dropdown
      const purchaserPanel = document.getElementById('purchaser-dropdown-panel');
      const pTrigger = document.getElementById('purchaser-dropdown-trigger');
      pTrigger.onclick = (e) => {
        e.stopPropagation();
        purchaserPanel.classList.toggle('open');
        document.getElementById('brand-dropdown-panel').classList.remove('open');
      };

      CONFIG.purchasers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.purchaserNames[p] || p;
        div.innerHTML = '<input type="checkbox" value="' + p + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          e.stopPropagation();
          const cb = div.querySelector('input');
          if (e.target !== cb) cb.checked = !cb.checked;
          updateFilters();
        };
        purchaserPanel.appendChild(div);
      });

      window.onclick = () => {
        brandPanel.classList.remove('open');
        purchaserPanel.classList.remove('open');
      };
    }

    function updateFilters() {
      selectedBrands = Array.from(document.querySelectorAll('#brand-dropdown-panel input:checked')).map(i => i.value);
      selectedPurchasers = Array.from(document.querySelectorAll('#purchaser-dropdown-panel input:checked')).map(i => i.value);

      // Cascading: disable purchasers not belonging to selected brands
      const pOptions = document.querySelectorAll('#purchaser-dropdown-panel .filter-dropdown-option');
      pOptions.forEach(opt => {
        const val = opt.querySelector('input').value;
        let visible = selectedBrands.length === 0;
        if (!visible) {
           for (const b of selectedBrands) {
             if (CONFIG.brandPurchaserMap[b] && CONFIG.brandPurchaserMap[b].includes(val)) {
               visible = true;
               break;
             }
           }
        }
        opt.style.display = visible ? 'flex' : 'none';
        if (!visible) opt.querySelector('input').checked = false;
      });
      selectedPurchasers = Array.from(document.querySelectorAll('#purchaser-dropdown-panel input:checked')).map(i => i.value);

      // Header Text
      const bTrigger = document.getElementById('brand-dropdown-trigger');
      bTrigger.innerText = selectedBrands.length === 0 ? 'Select Brand' : 
                           (selectedBrands.length === 1 ? (CONFIG.brandNames[selectedBrands[0]] || selectedBrands[0]) : selectedBrands.length + ' Brands');
      
      const pTrigger = document.getElementById('purchaser-dropdown-trigger');
      pTrigger.innerText = selectedPurchasers.length === 0 ? 'Select Purchaser' : 
                               (selectedPurchasers.length === 1 ? (CONFIG.purchaserNames[selectedPurchasers[0]] || selectedPurchasers[0]) : selectedPurchasers.length + ' Purchasers');

      currentPage = 1;
      render();
    }

    function resetFilters() {
      document.querySelectorAll('.filter-dropdown-panel input').forEach(i => i.checked = false);
      selectedBrands = [];
      selectedPurchasers = [];
      updateFilters();
    }

    function syntaxHighlight(json) {
      var str = JSON.stringify(json, null, 2);
      if (str.length > 80000) return escHtml(str);
      return str.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)/g, function(match) {
        var cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) cls = 'json-key';
          else cls = 'json-string';
        } else if (/true/.test(match)) cls = 'json-bool-true';
        else if (/false/.test(match)) cls = 'json-bool-false';
        else if (/null/.test(match)) cls = 'json-null';
        return '<span class="' + cls + '">' + escHtml(match) + '</span>';
      });
    }

    function getFilteredRows() {
      return ALL_ROWS.filter(function(r) {
        if (currentFilter !== 'all' && r.status !== currentFilter) return false;
        if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand)) return false;
        if (selectedPurchasers.length > 0 && !selectedPurchasers.includes(r.purchaser)) return false;
        if (currentSearch) {
          var q = currentSearch.toLowerCase();
          var haystack = (r.filename + ' ' + (r.patternKey || '') + ' ' + (r.purchaserKey || '')).toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });
    }

    function downloadRow(idx) {
      const r = ALL_ROWS[idx];
      if (!r) return;
      const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function render() {
      var filtered = getFilteredRows();
      var total = filtered.length;
      
      // Update counts and stats based on current filters (excluding currentFilter itself for tab counts)
      const baseFilter = ALL_ROWS.filter(r => {
        if (selectedBrands.length > 0 && !selectedBrands.includes(r.brand)) return false;
        if (selectedPurchasers.length > 0 && !selectedPurchasers.includes(r.purchaser)) return false;
        if (currentSearch) {
          var q = currentSearch.toLowerCase();
          var haystack = (r.filename + ' ' + (r.patternKey || '') + ' ' + (r.purchaserKey || '')).toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

      const succCount = baseFilter.filter(r => r.status === 'success').length;
      const failCount = baseFilter.filter(r => r.status === 'failed').length;
      const allCount = baseFilter.length;
      const rate = allCount > 0 ? Math.round((succCount / allCount) * 100) : 0;

      document.getElementById('c-all').innerText = allCount;
      document.getElementById('c-succ').innerText = succCount;
      document.getElementById('c-fail').innerText = failCount;
      document.getElementById('tot-val').innerText = allCount;
      document.getElementById('succ-val').innerText = succCount;
      document.getElementById('fail-val').innerText = failCount;
      document.getElementById('rate-val').innerText = rate + '%';
      document.getElementById('operation-count-label').innerText = allCount + ' operation(s)';

      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;
      var start = (currentPage - 1) * PAGE_SIZE;
      var page = filtered.slice(start, start + PAGE_SIZE);

      document.getElementById('results-info').textContent = 'Showing ' + (total === 0 ? 0 : start + 1) + '–' + Math.min(start + PAGE_SIZE, total) + ' of ' + total + ' results';

      var tbody = document.getElementById('table-body');
      if (page.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📂</div><p>No extraction results match your filter.</p></div></td></tr>';
        document.getElementById('pagination-bar').innerHTML = '';
        return;
      }

      var html = '';
      page.forEach(function(r, idx) {
        var globalIdx = ALL_ROWS.indexOf(r);
        var badge = r.status === 'success' ? '<span class="badge badge-success">Success</span>' : '<span class="badge badge-failed">Failed</span>';
        var expandIcon = '<span class="expand-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>';
        html += '<tr data-idx="' + globalIdx + '">';
        html += '<td class="toggle-cell">' + expandIcon + '</td>';
        html += '<td class="time-cell">' + escHtml(formatTime(r.mtime)) + '</td>';
        html += '<td class="filename-cell">' + escHtml(r.filename) + '</td>';
        html += '<td class="pattern-cell"><code>' + escHtml(r.patternKey || '—') + '</code></td>';
        html += '<td style="font-size:0.72rem; color:var(--text-secondary);">' + escHtml(CONFIG.purchaserNames[r.purchaserKey] || r.purchaserKey || '—') + '</td>';
        html += '<td>' + badge + '</td>';
        html += '<td class="action-cell"><button class="btn-download-row" onclick="event.stopPropagation(); downloadRow(' + globalIdx + ')">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> JSON</button></td>';
        html += '</tr>';
      });
      tbody.innerHTML = html;

      tbody.querySelectorAll('tr[data-idx]').forEach(function(tr) {
        tr.onclick = function() {
          var idx = parseInt(this.getAttribute('data-idx'), 10);
          var existingExpand = tbody.querySelector('tr.expand-row[data-for="' + idx + '"]');
          if (existingExpand) {
            var viewer = existingExpand.querySelector('.json-viewer');
            if (viewer) {
              viewer.style.animation = 'slideUp 0.15s forwards';
              viewer.onanimationend = () => existingExpand.remove();
            } else existingExpand.remove();
            this.classList.remove('expanded');
            expandedRows.delete(idx);
          } else {
            var r = ALL_ROWS[idx];
            var expandTr = document.createElement('tr');
            expandTr.className = 'expand-row';
            expandTr.setAttribute('data-for', idx);
            expandTr.innerHTML = '<td colspan="7"><div class="json-loader"><div class="json-spinner"></div><span>Loading...</span></div></td>';
            this.parentNode.insertBefore(expandTr, this.nextSibling);
            this.classList.add('expanded');
            expandedRows.add(idx);
            setTimeout(() => {
              const highlighted = syntaxHighlight(r.json);
              expandTr.querySelector('td').innerHTML = '<div class="json-viewer"><pre>' + highlighted + '</pre></div>';
            }, 50);
          }
        };
      });
      renderPagination(total, totalPages);
    }

    function renderPagination(total, totalPages) {
      var bar = document.getElementById('pagination-bar');
      if (totalPages <= 1) { bar.innerHTML = ''; return; }
      var html = '<button class="pg-btn" ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage - 1) + ')">&#8592; Prev</button>';
      var s = Math.max(1, currentPage - 2), e = Math.min(totalPages, currentPage + 2);
      if (s > 1) html += '<button class="pg-btn" onclick="goPage(1)">1</button><span style="padding:0 5px">…</span>';
      for (var i = s; i <= e; i++) html += '<button class="pg-btn ' + (i === currentPage ? 'active' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
      if (e < totalPages) html += '<span style="padding:0 5px">…</span><button class="pg-btn" onclick="goPage(' + totalPages + ')">' + totalPages + '</button>';
      html += '<button class="pg-btn" ' + (currentPage === totalPages ? 'disabled' : '') + ' onclick="goPage(' + (currentPage + 1) + ')">Next &#8594;</button>';
      bar.innerHTML = html;
    }

    function goPage(p) { currentPage = p; expandedRows.clear(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.onclick = function() {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentFilter = this.getAttribute('data-filter');
        currentPage = 1;
        expandedRows.clear();
        render();
      };
    });

    var searchTimer;
    document.getElementById('search-input').oninput = function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        currentSearch = this.value;
        currentPage = 1;
        expandedRows.clear();
        render();
      }, 250);
    };

    initFilters();
    render();
  </script>
</body>
</html>`;
}

function buildSyncReportHtml() {
  const files = listStagingFiles(STAGING_DIR, STAGING_DIR, []);
  files.sort((a, b) => b.mtime - a.mtime);

  const filesData = files.map((f) => {
    const parts = f.path.split("/");
    const brand = parts[0] || "";
    const purchaser = parts[1] || "";
    return { path: f.path, size: f.size, mtime: f.mtime, brand, purchaser };
  });

  const allBrands = Array.from(
    new Set(filesData.map((f) => f.brand).filter(Boolean)),
  );
  const allPurchasers = Array.from(
    new Set(filesData.map((f) => f.purchaser).filter(Boolean)),
  ).sort((a, b) => {
    const nameA = formatPurchaserDisplayName(a).toLowerCase();
    const nameB = formatPurchaserDisplayName(b).toLowerCase();
    const isTempA = nameA.includes("temp");
    const isTempB = nameB.includes("temp");
    if (isTempA && !isTempB) return 1;
    if (!isTempA && isTempB) return -1;
    return nameA.localeCompare(nameB);
  });

  const brandNamesMap = {};
  allBrands.forEach((id) => (brandNamesMap[id] = formatBrandDisplayName(id)));
  const purchaserNamesMap = {};
  allPurchasers.forEach(
    (id) => (purchaserNamesMap[id] = formatPurchaserDisplayName(id)),
  );

  const brandPurchaserMap = {};
  filesData.forEach((f) => {
    if (f.brand && f.purchaser) {
      if (!brandPurchaserMap[f.brand]) brandPurchaserMap[f.brand] = [];
      if (!brandPurchaserMap[f.brand].includes(f.purchaser))
        brandPurchaserMap[f.brand].push(f.purchaser);
    }
  });

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

  const formatDateHuman = (d) => {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    let suffix = "th";
    if (day % 10 === 1 && day !== 11) suffix = "st";
    else if (day % 10 === 2 && day !== 12) suffix = "nd";
    else if (day % 10 === 3 && day !== 13) suffix = "rd";
    return `${day}${suffix} ${month} ${year}`;
  };

  const historyData = JSON.stringify(history);
  const filesJson = JSON.stringify(filesData);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Staging Inventory Report</title>
  ${REPORT_FAVICON_DATA_URI ? `<link rel="icon" href="${REPORT_FAVICON_DATA_URI}" type="image/x-icon">` : ""}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #f5f7f9;
      --surface: #ffffff;
      --text: #2c2c2c;
      --text-secondary: #5a5a5a;
      --border: #b0bfc9;
      --border-light: #cbd5e1;
      --header-bg: #216c6d;
      --header-text: #ffffff;
      --primary: #2d9d5f;
      --accent: #2d9d5f;
      --accent-light: #e8f5ee;
      --radius: 12px;
      --radius-sm: 8px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 1rem;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
    }
    
    .report-header {
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(10px);
      padding: 1rem 2rem;
      border-radius: 0 0 16px 16px;
      margin-bottom: 1rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      border: 1px solid rgba(176, 191, 201, 0.3);
      position: sticky;
      top: 0;
      z-index: 1000;
      min-height: 72px;
    }
    .btn-back-main {
      background: var(--header-bg) !important;
      color: white !important;
      border: none;
      border-radius: 8px;
      height: 36px;
      padding: 0 1.25rem;
      font-size: 0.85rem;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace !important;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(33, 108, 109, 0.2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .btn-back-main:hover {
      background: var(--primary) !important;
      transform: translateX(-4px);
      box-shadow: 0 6px 16px rgba(45, 157, 95, 0.3);
    }
    .btn-back-main svg { width: 16px; height: 16px; transition: transform 0.2s; }
    .btn-back-main:hover svg { transform: translateX(-2px); }
    .report-header-left { display: flex; align-items: center; gap: 1.25rem; }
    .report-header .logo { height: 32px; width: auto; object-fit: contain; }
    .report-header-title {
      margin: 0;
      height: 34px;
      font-size: 0.82rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #ffffff;
      background: var(--header-bg);
      padding: 0 1.1rem;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      line-height: 1;
      font-family: inherit;
    }
    
    .meta { color: var(--text-secondary); font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; text-align: right; }
    .meta p { margin: 2px 0; }
    
    .page-body { padding: 0.75rem 0; }
    .chart-card { 
      background: var(--surface);
      border: 1px solid var(--border-light);
      border-radius: 16px; 
      padding: 1.6rem; 
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      margin-bottom: 2rem;
    }
    .chart-card h4 { margin: 0 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--header-bg); border-bottom: 2px solid rgba(33, 108, 109, 0.1); padding-bottom: 0.6rem; font-weight: 800; }
    .chart-container { position: relative; height: 350px; width: 100%; }

    h3 { color: var(--header-bg); font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin: 2rem 0 1rem; border-bottom: 2px solid var(--border-light); padding-bottom: 0.4rem; }

    table { border-collapse: separate; border-spacing: 0; width: 100%; margin-top: 1rem; background: white; border-radius: var(--radius-sm); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border: 1px solid var(--border); }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); word-break: break-all; }
    th { background: var(--surface); color: var(--text-secondary); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
    th:last-child, td:last-child { border-right: none; }
    tr:last-child td { border-bottom: none; }
    td { font-size: 0.75rem; color: var(--text-secondary); }

    /* Pagination */
    .pagination {
      display: flex;
      gap: 0.4rem;
      justify-content: center;
      margin: 2rem 0;
      padding: 1rem;
    }
    .pg-btn {
      min-width: 38px;
      height: 38px;
      padding: 0 0.8rem;
      border: 1px solid var(--border-light);
      background: white;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--header-bg);
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .pg-btn:hover:not(:disabled) { 
      background: var(--accent-light);
      border-color: var(--primary);
      color: var(--primary);
      transform: translateY(-1px);
    }
    .pg-btn.active { 
      background: var(--header-bg); 
      color: white; 
      border-color: var(--header-bg);
      box-shadow: 0 4px 10px rgba(33, 108, 109, 0.2);
    }
    .pg-btn:disabled { 
      opacity: 0.4; 
      cursor: not-allowed; 
      background: #f8fafc;
    }

    /* Filtering Styles */
    .report-header-right { display: flex; align-items: center; justify-content: flex-end; }
    .header-filter-row { display: flex; align-items: center; gap: 0.75rem; }
    .header-field-wrap { display: flex; flex-direction: column; align-items: center; }
    .filter-dropdown { position: relative; }
    .filter-chip { 
      display: flex; align-items: center; height: 34px; background: #fff; 
      border: 1px solid rgba(176,191,201,0.6); border-radius: 8px; overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .filter-chip .header-label {
      font-size: 0.7rem; color: var(--primary); font-weight: 800; background: var(--accent-light);
      padding: 0 0.75rem; height: 100%; display: flex; align-items: center;
      border-right: 1px solid rgba(45,157,95,0.2); text-transform: uppercase; letter-spacing: 0.04em;
    }
    .filter-dropdown-trigger {
      border: none; background: transparent; height: 100%; padding: 0 1.5rem 0 0.75rem;
      font-size: 0.85rem; font-family: inherit; cursor: pointer; color: var(--text-secondary);
      min-width: 180px; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23505050' d='M2.5 4.5L6 8l3.5-3.5H2.5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 8px center;
    }
    .filter-dropdown-panel {
      display: none; position: absolute; top: 100%; left: 0; margin-top: 4px;
      min-width: 220px; max-height: 400px; overflow-y: auto; background: white;
      border: 1px solid var(--border-light); border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      z-index: 1100; padding: 0.5rem 0;
    }
    .filter-dropdown-panel.open { display: block; animation: slideDownPanel 0.2s ease-out; }
    .filter-dropdown-option {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem;
      font-size: 0.85rem; cursor: pointer; transition: background 0.1s;
    }
    .filter-dropdown-option:hover { background: #f8fafc; }
    .filter-dropdown-option input { margin: 0; cursor: pointer; }
    
    .header-btn-reset {
      height: 34px; 
      padding: 0 1.1rem; 
      background: var(--header-bg); 
      color: #fff;
      border: none; 
      border-radius: 6px; 
      font-size: 0.82rem; 
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      cursor: pointer; 
      box-shadow: 0 2px 5px rgba(33,108,109,0.2); 
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      font-family: inherit;
    }
    .header-btn-reset:hover { filter: brightness(1.1); transform: translateY(-1px); }
    @keyframes slideDownPanel { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
  </style>
</head>
<body>
  <div class="report-header">
    <div style="display: flex; align-items: center; gap: 1.5rem; width: 100%;">
      <a href="javascript:void(0)" onclick="goToHome()" title="Go to Home" style="display: flex; align-items: center; height: 34px;">
        <img src="${REPORT_LOGO_DATA_URI}" alt="intellirevenue" class="logo">
      </a>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <button type="button" onclick="goToHome()" class="btn-back-main">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
              <span>Back</span>
            </button>
            <h1 class="report-header-title">Staging Inventory Report</h1>
          </div>
          <div class="report-header-right">
             <div class="header-filter-row">
                  <div class="header-field-wrap brand-field-wrap">
                    <div id="brand-dropdown" class="filter-dropdown">
                      <div class="filter-chip">
                        <label class="header-label" for="brand-dropdown-trigger">Brand</label>
                        <button type="button" id="brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">
                          Select brand
                        </button>
                      </div>
                      <div id="brand-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
                    </div>
                  </div>
                  <div class="header-field-wrap purchaser-field-wrap">
                    <div id="purchaser-dropdown" class="filter-dropdown">
                      <div class="filter-chip">
                        <label class="header-label" for="purchaser-dropdown-trigger">Purchaser</label>
                        <button type="button" id="purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">
                          Select purchaser
                        </button>
                      </div>
                      <div id="purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div>
                    </div>
                  </div>
                  <div class="header-field-wrap header-filter-reset-wrap">
                    <button type="button" id="filter-reset-btn" class="header-btn-reset" onclick="resetFilters()">
                      Reset Filter
                    </button>
                  </div>
                </div>
          </div>
        </div>
        <div class="meta" style="display: flex; gap: 1.25rem; opacity: 0.85;">
          <span>Generated: ${formatDateHuman(new Date())}</span>
          <span id="operation-count-label">Manifest: ${manifestEntries} | Staging: ${files.length} file(s)</span>
        </div>
      </div>
    </div>
  </div>

  <div class="page-body">
    <div class="dashboard-grid">
      <div class="chart-card">
        <h4>Download History (Last 30 Runs)</h4>
        <div class="chart-container">
          <canvas id="historyChart"></canvas>
        </div>
      </div>
    </div>

    <h3 id="files-title">Current Staging Files</h3>
    <table id="files-table">
      <thead><tr><th>Path (staging)</th><th>Size (bytes)</th><th>Modified</th></tr></thead>
      <tbody id="files-body"></tbody>
    </table>
    <div id="pagination" class="pagination"></div>
  </div>

  <script>
    const historyData = ${historyData};
    const ALL_FILES = ${filesJson};
    const CONFIG = {
      brands: ${JSON.stringify(allBrands)},
      purchasers: ${JSON.stringify(allPurchasers)},
      brandPurchaserMap: ${JSON.stringify(brandPurchaserMap)},
      brandNames: ${JSON.stringify(brandNamesMap)},
      purchaserNames: ${JSON.stringify(purchaserNamesMap)}
    };

    let currentPage = 1;
    const pageSize = 100;
    let selectedBrands = [];
    let selectedPurchasers = [];
    let historyChartInstance = null;

    function goToHome() { 
      try {
        if (window.parent && typeof window.parent.closeReportView === 'function') {
          window.parent.closeReportView();
          return;
        }
      } catch (e) {}
      window.location.href = "/"; 
    }

    // Push a history entry so pressing browser Back navigates home
    if (window.history && window.history.pushState) {
      history.pushState({ page: 'report' }, document.title, window.location.href);
    }
    window.addEventListener('popstate', function() {
      goToHome();
    });

    function esc(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function initFilters() {
      const brandPanel = document.getElementById('brand-dropdown-panel');
      const bTrigger = document.getElementById('brand-dropdown-trigger');
      if (bTrigger) {
        bTrigger.onclick = (e) => {
          e.stopPropagation();
          brandPanel.classList.toggle('open');
          document.getElementById('purchaser-dropdown-panel').classList.remove('open');
        };
      }

      CONFIG.brands.forEach(b => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.brandNames[b] || b;
        div.innerHTML = '<input type="checkbox" value="' + b + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          e.stopPropagation();
          const cb = div.querySelector('input');
          if (e.target !== cb) cb.checked = !cb.checked;
          updateFilters();
        };
        brandPanel.appendChild(div);
      });

      const purchaserPanel = document.getElementById('purchaser-dropdown-panel');
      const pTrigger = document.getElementById('purchaser-dropdown-trigger');
      if (pTrigger) {
        pTrigger.onclick = (e) => {
          e.stopPropagation();
          purchaserPanel.classList.toggle('open');
          document.getElementById('brand-dropdown-panel').classList.remove('open');
        };
      }

      CONFIG.purchasers.forEach(p => {
        const div = document.createElement('div');
        div.className = 'filter-dropdown-option';
        const displayName = CONFIG.purchaserNames[p] || p;
        div.innerHTML = '<input type="checkbox" value="' + p + '"> <span>' + displayName + '</span>';
        div.onclick = (e) => {
          e.stopPropagation();
          const cb = div.querySelector('input');
          if (e.target !== cb) cb.checked = !cb.checked;
          updateFilters();
        };
        purchaserPanel.appendChild(div);
      });

      window.onclick = () => {
        if (brandPanel) brandPanel.classList.remove('open');
        if (purchaserPanel) purchaserPanel.classList.remove('open');
      };
    }

    function updateFilters() {
      selectedBrands = Array.from(document.querySelectorAll('#brand-dropdown-panel input:checked')).map(i => i.value);
      selectedPurchasers = Array.from(document.querySelectorAll('#purchaser-dropdown-panel input:checked')).map(i => i.value);

      const pOptions = document.querySelectorAll('#purchaser-dropdown-panel .filter-dropdown-option');
      pOptions.forEach(opt => {
        const val = opt.querySelector('input').value;
        let visible = selectedBrands.length === 0;
        if (!visible) {
           for (const b of selectedBrands) {
             if (CONFIG.brandPurchaserMap[b] && CONFIG.brandPurchaserMap[b].includes(val)) {
               visible = true;
               break;
             }
           }
        }
        opt.style.display = visible ? 'flex' : 'none';
        if (!visible) opt.querySelector('input').checked = false;
      });
      selectedPurchasers = Array.from(document.querySelectorAll('#purchaser-dropdown-panel input:checked')).map(i => i.value);

      const bTrigger = document.getElementById('brand-dropdown-trigger');
      if (bTrigger) {
        bTrigger.innerText = selectedBrands.length === 0 ? 'Select Brand' : 
                                 (selectedBrands.length === 1 ? (CONFIG.brandNames[selectedBrands[0]] || selectedBrands[0]) : selectedBrands.length + ' Brands');
      }
      
      const pTrigger = document.getElementById('purchaser-dropdown-trigger');
      if (pTrigger) {
        pTrigger.innerText = selectedPurchasers.length === 0 ? 'Select Purchaser' : 
                                 (selectedPurchasers.length === 1 ? (CONFIG.purchaserNames[selectedPurchasers[0]] || selectedPurchasers[0]) : selectedPurchasers.length + ' Purchasers');
      }

      currentPage = 1;
      renderTable();
      updateCharts();
    }

    function resetFilters() {
      document.querySelectorAll('.filter-dropdown-panel input').forEach(i => i.checked = false);
      selectedBrands = [];
      selectedPurchasers = [];
      updateFilters();
    }

    function getFilteredFiles() {
      return ALL_FILES.filter(f => {
        if (selectedBrands.length > 0 && !selectedBrands.includes(f.brand)) return false;
        if (selectedPurchasers.length > 0 && !selectedPurchasers.includes(f.purchaser)) return false;
        return true;
      });
    }

    function renderTable() {
      const tbody = document.getElementById('files-body');
      if (!tbody) return;
      
      const filtered = getFilteredFiles();
      const label = document.getElementById('operation-count-label');
      if (label) {
        label.innerText = 'Manifest: ${manifestEntries} | Staging: ' + filtered.length + ' file(s)';
      }

      const pContainer = document.getElementById('pagination');
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">No files found for selected filters.</td></tr>';
        if (pContainer) pContainer.innerHTML = '';
        return;
      }

      const start = (currentPage - 1) * pageSize;
      const end = Math.min(start + pageSize, filtered.length);
      const page = filtered.slice(start, end);

      tbody.innerHTML = page.map(f => \`
        <tr>
          <td>\${esc(f.path)}</td>
          <td>\${f.size.toLocaleString()}</td>
          <td>\${new Date(f.mtime).toISOString().replace('T', ' ').split('.')[0]}</td>
        </tr>
      \`).join('');
      
      renderPagination(filtered.length);
    }

    function renderPagination(totalCount) {
      const container = document.getElementById('pagination');
      if (!container) return;
      const totalPages = Math.ceil(totalCount / pageSize);
      if (totalPages <= 1) { container.innerHTML = ''; return; }
      
      let html = '';
      html += '<button class="pg-btn" ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="goPage(' + (currentPage - 1) + ')">Prev</button>';
      
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
          html += '<button class="pg-btn ' + (i === currentPage ? 'active' : '') + '" onclick="goPage(' + i + ')">' + i + '</button>';
        } else if (i === currentPage - 3 || i === currentPage + 3) {
          html += '<span style="padding:0.5rem; color:var(--text-secondary)">...</span>';
        }
      }
      
      html += '<button class="pg-btn" ' + (currentPage === totalPages ? 'disabled' : '') + ' onclick="goPage(' + (currentPage + 1) + ')">Next</button>';
      container.innerHTML = html;
    }

    function goPage(p) {
      currentPage = p;
      renderTable();
      const table = document.getElementById('files-title');
      if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function updateCharts() {
      const canvas = document.getElementById('historyChart');
      if (!canvas || historyData.length === 0) return;

      const filteredHistory = historyData.filter(h => {
        // No filter selected — show all entries
        if (selectedBrands.length === 0 && selectedPurchasers.length === 0) return true;

        // Each history entry has parallel brands[] and purchasers[] arrays.
        // An entry matches if ANY of its (brand, purchaser) pairs satisfies the filters.
        const brands = Array.isArray(h.brands) ? h.brands : [];
        const purchasers = Array.isArray(h.purchasers) ? h.purchasers : brands.map(() => '');

        for (let i = 0; i < brands.length; i++) {
          const b = brands[i] || '';
          const p = purchasers[i] || '';

          const brandMatch = selectedBrands.length === 0 || selectedBrands.includes(b);
          const purchaserMatch = selectedPurchasers.length === 0 || selectedPurchasers.includes(p);

          if (brandMatch && purchaserMatch) return true;
        }
        return false;
      });

      const labels = filteredHistory.map(d => {
        const date = new Date(d.timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      });

      if (historyChartInstance) {
        historyChartInstance.destroy();
        historyChartInstance = null;
      }

      if (filteredHistory.length === 0) {
        // Show an informative empty state instead of a blank canvas
        const card = canvas.closest('.chart-card');
        if (card) {
          let msg = card.querySelector('.chart-empty-msg');
          if (!msg) {
            msg = document.createElement('p');
            msg.className = 'chart-empty-msg';
            msg.style.cssText = 'text-align:center;color:#94a3b8;font-size:0.85rem;padding:1rem 0;margin:0';
            card.appendChild(msg);
          }
          msg.textContent = 'No download history for the selected filter.';
        }
        return;
      }

      // Remove empty-state message if present
      const card = canvas.closest ? canvas.closest('.chart-card') : null;
      if (card) {
        const msg = card.querySelector('.chart-empty-msg');
        if (msg) msg.remove();
      }

      const ctx = canvas.getContext('2d');
      historyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Downloaded (New)', data: filteredHistory.map(d => d.synced), backgroundColor: '#2d9d5f' },
            { label: 'Skipped (Unchanged)', data: filteredHistory.map(d => d.skipped), backgroundColor: '#94a3b8' },
            { label: 'Errors', data: filteredHistory.map(d => d.errors), backgroundColor: '#ef4444' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
          plugins: { legend: { position: 'bottom' } }
        }
      });
    }

    window.onload = () => {
      if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'JetBrains Mono', 'Consolas', monospace";
        Chart.defaults.font.size = 11;
        Chart.defaults.color = "#5a5a5a";
      }
      initFilters();
      renderTable();
      updateCharts();
      
      const canvas = document.getElementById('historyChart');
      if (!canvas || historyData.length === 0) {
        const card = document.querySelector('.chart-card');
        if (card) card.style.display = 'none';
        const msg = document.createElement('p');
        msg.textContent = 'No download history available yet.';
        msg.style.textAlign = 'center';
        const grid = document.querySelector('.dashboard-grid');
        if (grid) grid.appendChild(msg);
      }
    };
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
  if (req.method === "GET" && url === "/api/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "pong" }));
    return;
  }
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
      const parsed = JSON.parse(body || "{}");
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
        retryFailed,
      } = parsed;

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
      if (retryFailed === true) {
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
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const page = parseInt(q.get("page") || "1", 10);
      const limit = parseInt(q.get("limit") || "20", 10);
      const allEntries = readScheduleLogEntries();
      const total = allEntries.length;
      const startIndex = (page - 1) * limit;
      const entries = allEntries.slice(startIndex, startIndex + limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries, total, page, limit }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/staging-stats") {
    try {
      const files = listStagingFiles(STAGING_DIR, STAGING_DIR, []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: files.length }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/extraction-stats") {
    try {
      const stats = { success: 0, failed: 0, brands: {}, purchasers: {} };
      const succDir = join(EXTRACTIONS_DIR, "succeeded");
      const failDir = join(EXTRACTIONS_DIR, "failed");

      const countDir = (dir, isSuccess) => {
        if (!existsSync(dir)) return;
        const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
        if (isSuccess) stats.success += files.length;
        else stats.failed += files.length;

        files.forEach((f) => {
          const brand = f.split("_")[0];
          if (brand) stats.brands[brand] = (stats.brands[brand] || 0) + 1;
        });
      };

      countDir(succDir, true);
      countDir(failDir, false);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(stats));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/extraction-results") {
    try {
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const page = parseInt(q.get("page") || "1", 10);
      const limit = parseInt(q.get("limit") || "15", 10);
      const status = q.get("status") || "all"; // all, success, failed
      const search = (q.get("search") || "").toLowerCase();

      let allFiles = [];
      const succDir = join(EXTRACTIONS_DIR, "succeeded");
      const failDir = join(EXTRACTIONS_DIR, "failed");

      if (status === "all" || status === "success") {
        if (existsSync(succDir)) {
          allFiles = allFiles.concat(
            readdirSync(succDir)
              .filter((f) => f.endsWith(".json"))
              .map((f) => ({
                name: f,
                status: "success",
                path: join(succDir, f),
              })),
          );
        }
      }
      if (status === "all" || status === "failed") {
        if (existsSync(failDir)) {
          allFiles = allFiles.concat(
            readdirSync(failDir)
              .filter((f) => f.endsWith(".json"))
              .map((f) => ({
                name: f,
                status: "failed",
                path: join(failDir, f),
              })),
          );
        }
      }

      // Sort by modified time (latest first)
      allFiles.sort((a, b) => {
        try {
          return statSync(b.path).mtimeMs - statSync(a.path).mtimeMs;
        } catch (_) {
          return 0;
        }
      });

      if (search) {
        allFiles = allFiles.filter((f) =>
          f.name.toLowerCase().includes(search),
        );
      }

      const total = allFiles.length;
      const startIndex = (page - 1) * limit;
      const paginated = allFiles.slice(startIndex, startIndex + limit);

      // Load content for paginated results (minimal info)
      const results = paginated.map((f) => {
        let content = {};
        try {
          content = JSON.parse(readFileSync(f.path, "utf-8"));
        } catch (_) {}
        return {
          filename: f.name,
          status: f.status,
          success: content.success,
          patternKey: content.pattern?.pattern_key,
          purchaserKey: content.pattern?.purchaser_key,
          timestamp: statSync(f.path).mtime,
        };
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ results, total, page, limit }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "GET" && url === "/api/extraction-data-page") {
    try {
      const html = buildExtractionDataPageHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error generating page: " + e.message);
    }
    return;
  }
  if (req.method === "GET" && url === "/api/email-config") {
    try {
      const config = getEmailConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === "POST" && url === "/api/email-config") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const data = JSON.parse(body || "{}");
      if (data.recipientEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emails = data.recipientEmail.split(",").map((e) => e.trim());
        for (const email of emails) {
          if (!email || !emailRegex.test(email)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Invalid email address format: " + email,
              }),
            );
            return;
          }
        }
      }
      saveEmailConfig(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
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
    let filename = slash === -1 ? null : rest.slice(slash + 1);
    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch (_) {}
    }
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
        "Content-Length": stat.size,
      };
      if (format === "html") {
        // For HTML reports, we inject the favicon dynamically so old reports get it too
        let content = readFileSync(filePath, "utf-8");
        if (!content.includes('rel="icon"')) {
          const faviconHtml = REPORT_FAVICON_DATA_URI
            ? `<link rel="icon" href="${REPORT_FAVICON_DATA_URI}" type="image/x-icon">`
            : "";
          content = content.replace("<head>", "<head>\n  " + faviconHtml);
        }
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Length": Buffer.byteLength(content),
        });
        res.end(content);
      } else {
        const headers = {
          "Content-Type": contentType,
          "Content-Length": stat.size,
          "Content-Disposition":
            'attachment; filename="' + filename.replace(/"/g, '\\"') + '"',
        };
        res.writeHead(200, headers);
        const stream = createReadStream(filePath);
        stream.on("error", (e) => {
          if (!res.writableEnded) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(e.message) }));
          }
        });
        stream.pipe(res);
      }
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
