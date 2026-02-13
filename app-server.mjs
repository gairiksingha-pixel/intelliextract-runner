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
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Sync Report</title>
<style>body{font-family:system-ui,sans-serif;margin:1rem 2rem;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ddd;padding:0.5rem;text-align:left;} th{background:#f5f5f5;} .meta{margin-bottom:1rem;}</style>
</head>
<body>
<h1>Sync Report</h1>
<div class="meta"><p>Generated: ${new Date().toISOString()}</p>
<p>Manifest entries (tracked keys): ${manifestEntries}</p>
<p>Files in staging: ${files.length}</p></div>
<table>
<thead><tr><th>Path (staging)</th><th>Size (bytes)</th><th>Modified</th></tr></thead>
<tbody>${rows || '<tr><td colspan="3">No synced files.</td></tr>'}</tbody>
</table>
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
function syncArgs(p) {
  const base = ["dist/index.js", "sync"];
  if (p?.syncLimit > 0) base.push("--limit", String(p.syncLimit));
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}
function runArgs(p, extra = []) {
  const base = ["dist/index.js", "run", ...extra];
  if (p?.syncLimit > 0) base.push("--sync-limit", String(p.syncLimit));
  if (p?.extractLimit > 0) base.push("--extract-limit", String(p.extractLimit));
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}
function pipelineArgs(p, opts = {}) {
  const base = ["dist/index.js", "sync-extract"];
  if (opts.resume) base.push("--resume");
  const limit =
    p?.syncLimit !== undefined && Number(p.syncLimit) >= 0
      ? Number(p.syncLimit)
      : 0;
  base.push("--limit", String(limit));
  addPairArgs(base, p);
  return ["node", base, { cwd: ROOT }];
}

const CASE_COMMANDS = {
  P1: (p) => syncArgs(p),
  P2: (p) => runArgs(p, ["--no-sync"]),
  PIPE: (p, opts) => pipelineArgs(p, opts || {}),
  P3: () => ["node", ["dist/index.js", "report"], { cwd: ROOT }],
  P4: (p) => {
    const base = ["dist/index.js", "sync", "-c", "config/config.yaml"];
    if (p?.syncLimit > 0) base.push("--limit", String(p.syncLimit));
    return ["node", base, { cwd: ROOT }];
  },
  P5: (p) => runArgs(p, []),
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
  N3: (p) => syncArgs(p),
  E1: (p) => runArgs(p, ["--no-sync"]),
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
  E3: (p) => syncArgs(p),
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
          },
          onProgress: (percent, done, total) => {
            writeLine({ type: "progress", percent, done, total });
          },
          onSyncProgress: (done, total) => {
            writeLine({ type: "sync_progress", done, total });
          },
          onExtractionProgress: (done, total) => {
            writeLine({ type: "extraction_progress", done, total });
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
      if (interrupted) {
        const runId = getCurrentRunIdFromCheckpoint();
        if (runId) spawnReportForRunId(runId).catch(() => {});
      } else if (result.exitCode === 0) {
        const runId = getCurrentRunIdFromCheckpoint();
        if (runId) markRunCompleted(runId);
      }
      if (!res.destroyed) {
        try {
          writeLine({ type: "result", ...result });
          res.end();
        } catch (_) {}
      }
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
});
