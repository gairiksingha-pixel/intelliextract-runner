#!/usr/bin/env node
/**
 * Local test runner server. Serves test-cases.html and runs test case commands via POST /run.
 * Start from project root: node test-runner-server.mjs
 * Open: http://localhost:8765/
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const ROOT = join(__dirname);
const REPORTS_DIR = join(ROOT, 'output', 'reports');
const STAGING_DIR = join(ROOT, 'output', 'staging');
const SYNC_MANIFEST_PATH = join(ROOT, 'output', 'checkpoints', 'sync-manifest.json');
const ALLOWED_EXT = new Set(['.html', '.json']);

function listStagingFiles(dir, baseDir, list) {
  if (!existsSync(dir)) return list;
  const entries = readdirSync(dir, { withFileTypes: true });
  const base = baseDir || dir;
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(base, full).replace(/\\/g, '/');
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
      const raw = readFileSync(SYNC_MANIFEST_PATH, 'utf-8');
      const data = JSON.parse(raw);
      manifestEntries = typeof data === 'object' && data !== null ? Object.keys(data).length : 0;
    } catch (_) {}
  }
  const formatDate = (ms) => {
    if (!ms) return '—';
    const d = new Date(ms);
    return d.toISOString();
  };
  const rows = files.map(
    (f) =>
      `<tr><td>${escapeHtml(f.path)}</td><td>${f.size}</td><td>${formatDate(f.mtime)}</td></tr>`
  ).join('');
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
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getLastRunId() {
  const path = join(ROOT, 'output', 'checkpoints', 'last-run-id.txt');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8').trim();
}

function syncArgs(p) {
  const base = ['dist/index.js', 'sync'];
  if (p?.syncLimit > 0) base.push('--limit', String(p.syncLimit));
  if (p?.tenant) base.push('--tenant', p.tenant);
  if (p?.purchaser) base.push('--purchaser', p.purchaser);
  return ['node', base, { cwd: ROOT }];
}
function runArgs(p, extra = []) {
  const base = ['dist/index.js', 'run', ...extra];
  if (p?.syncLimit > 0) base.push('--sync-limit', String(p.syncLimit));
  if (p?.extractLimit > 0) base.push('--extract-limit', String(p.extractLimit));
  if (p?.tenant) base.push('--tenant', p.tenant);
  if (p?.purchaser) base.push('--purchaser', p.purchaser);
  return ['node', base, { cwd: ROOT }];
}
function pipelineArgs(p) {
  const base = ['dist/index.js', 'sync-extract'];
  const limit = p?.syncLimit !== undefined && Number(p.syncLimit) >= 0 ? Number(p.syncLimit) : 0;
  base.push('--limit', String(limit));
  if (p?.tenant) base.push('--tenant', p.tenant);
  if (p?.purchaser) base.push('--purchaser', p.purchaser);
  return ['node', base, { cwd: ROOT }];
}

const CASE_COMMANDS = {
  P1: (p) => syncArgs(p),
  P2: (p) => runArgs(p, ['--no-sync']),
  PIPE: (p) => pipelineArgs(p),
  P3: () => ['node', ['dist/index.js', 'report'], { cwd: ROOT }],
  P4: (p) => {
    const base = ['dist/index.js', 'sync', '-c', 'config/config.yaml'];
    if (p?.syncLimit > 0) base.push('--limit', String(p.syncLimit));
    return ['node', base, { cwd: ROOT }];
  },
  P5: (p) => runArgs(p, []),
  P6: (p) => runArgs(p, ['--no-sync', '--no-report']),
  P7: () => [
    'node',
    [
      '-e',
      "const fs=require('fs');const p=require('path');const dir=p.join(process.cwd(),'output','logs');if(!fs.existsSync(dir))process.exit(1);const f=fs.readdirSync(dir).find(n=>n.endsWith('.jsonl'));if(!f)process.exit(1);const lines=fs.readFileSync(p.join(dir,f),'utf8').trim().split(/\\n/).filter(Boolean);const ok=lines.length>0&&lines.every(l=>{try{const j=JSON.parse(l);return j.runId&&j.filePath&&j.request&&j.response!==undefined;}catch(e){return false;}});process.exit(ok?0:1);",
    ],
    { cwd: ROOT },
  ],
  N1: () => ['node', ['dist/index.js', 'sync', '-c', 'config/nonexistent.yaml'], { cwd: ROOT }],
  N2: () => ['node', ['dist/index.js', 'report', '--run-id', 'run_0000000000_fake'], { cwd: ROOT }],
  N3: (p) => syncArgs(p),
  E1: (p) => runArgs(p, ['--no-sync']),
  E2: (p) => {
    const cp = join(ROOT, 'output', 'checkpoints', 'checkpoint.json');
    if (existsSync(cp)) {
      try {
        copyFileSync(cp, cp + '.bak');
      } catch (_) {}
      writeFileSync(cp, '{}', 'utf-8');
    }
    return runArgs(p, ['--no-sync']);
  },
  E3: (p) => syncArgs(p),
  E4: () => {
    const runId = getLastRunId() || 'run_0000000000_fake';
    return ['node', ['dist/index.js', 'report', '--run-id', runId], { cwd: ROOT }];
  },
  E5: (p) => runArgs(p, ['--no-sync']),
};

const PROGRESS_REGEX = /(\d+)%\s*\((\d+)\/(\d+)\)/g;
const SYNC_PROGRESS_PREFIX = 'SYNC_PROGRESS\t';

function runCase(caseId, params = {}, callbacks = null) {
  const def = CASE_COMMANDS[caseId];
  if (!def) return Promise.reject(new Error(`Unknown case: ${caseId}`));
  const resolved = typeof def === 'function' ? def(params) : def();
  const [cmd, args, opts] = resolved;
  const displayCmd = args ? [cmd, ...args].join(' ') : cmd;
  const onProgress = callbacks?.onProgress ?? (typeof callbacks === 'function' ? callbacks : null);
  const onSyncProgress = callbacks?.onSyncProgress ?? null;
  const onChild = callbacks?.onChild ?? null;
  return new Promise((resolve) => {
    const child = spawn(cmd, args || [], {
      ...opts,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (onChild) onChild(child);
    let fullStdout = '';
    let lineBuffer = '';
    let stderr = '';
    let lastPercent = -1;
    child.stdout?.on('data', (d) => {
      const chunk = d.toString();
      fullStdout += chunk;
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (onSyncProgress && line.startsWith(SYNC_PROGRESS_PREFIX)) {
          const parts = line.slice(SYNC_PROGRESS_PREFIX.length).split('\t');
          if (parts.length >= 2) {
            const done = Number(parts[0]);
            const total = Number(parts[1]);
            if (!Number.isNaN(done)) onSyncProgress(done, Number.isNaN(total) ? 0 : total);
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
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code, signal) => {
      resolve({
        caseId,
        exitCode: code ?? (signal ? 1 : 0),
        stdout: fullStdout.trim(),
        stderr: stderr.trim(),
        command: displayCmd,
      });
    });
    child.on('error', (err) => {
      resolve({
        caseId,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        command: displayCmd,
      });
    });
  });
}

const HTML_PATH = join(__dirname, 'test-cases.html');

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  const url = req.url?.split('?')[0] || '/';
  if (req.method === 'GET' && url.startsWith('/assets/')) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.slice(1));
    } catch (_) {
      decodedPath = url.slice(1);
    }
    const assetsDir = resolve(ROOT, 'assets');
    let filePath = resolve(ROOT, normalize(decodedPath));
    if (!filePath.startsWith(assetsDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!existsSync(filePath)) {
        if (url === '/assets/logo.png' || url.startsWith('/assets/logo')) {
          if (existsSync(assetsDir)) {
            const files = readdirSync(assetsDir);
            const png = files.find((f) => f.toLowerCase().endsWith('.png'));
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
      const mime = MIME[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
    return;
  }
  if (req.method === 'GET' && (url === '/' || url === '/test-cases.html')) {
    try {
      const html = readFileSync(HTML_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('test-cases.html not found');
    }
    return;
  }
  if (req.method === 'POST' && url === '/run') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { caseId, syncLimit, extractLimit, tenant, purchaser } = JSON.parse(body || '{}');
      if (!caseId || !CASE_COMMANDS[caseId]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing caseId' }));
        return;
      }
      const params = {};
      if (syncLimit !== undefined && Number(syncLimit) >= 0) params.syncLimit = Number(syncLimit);
      if (extractLimit !== undefined && Number(extractLimit) >= 0) params.extractLimit = Number(extractLimit);
      if (tenant && typeof tenant === 'string') params.tenant = tenant.trim();
      if (purchaser && typeof purchaser === 'string') params.purchaser = purchaser.trim();

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      });
      const writeLine = (obj) => res.write(JSON.stringify(obj) + '\n');

      let currentChild = null;
      res.on('close', () => {
        if (currentChild) {
          currentChild.kill('SIGTERM');
          currentChild = null;
        }
      });

      const result = await runCase(caseId, params, {
        onChild: (child) => {
          currentChild = child;
        },
        onProgress: (percent, done, total) => {
          writeLine({ type: 'progress', percent, done, total });
        },
        onSyncProgress: (done, total) => {
          writeLine({ type: 'sync_progress', done, total });
        },
      });
      currentChild = null;
      writeLine({ type: 'result', ...result });
      res.end();
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/reports') {
    try {
      const list = { html: [], json: [] };
      if (!existsSync(REPORTS_DIR)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
        return;
      }
      const files = readdirSync(REPORTS_DIR, { withFileTypes: true })
        .filter((e) => e.isFile() && ALLOWED_EXT.has(extname(e.name).toLowerCase()));
      for (const f of files) {
        const ext = extname(f.name).toLowerCase();
        const key = ext === '.html' ? 'html' : 'json';
        let mtime = 0;
        try {
          mtime = statSync(join(REPORTS_DIR, f.name)).mtimeMs;
        } catch (_) {}
        list[key].push({ name: f.name, mtime });
      }
      for (const key of Object.keys(list)) {
        list[key].sort((a, b) => b.mtime - a.mtime);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === 'GET' && url.startsWith('/api/reports/')) {
    const rest = url.slice('/api/reports/'.length);
    const slash = rest.indexOf('/');
    const format = slash === -1 ? rest : rest.slice(0, slash);
    const filename = slash === -1 ? null : rest.slice(slash + 1);
    if (!filename || !['html', 'json'].includes(format)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid format or filename' }));
      return;
    }
    const ext = format === 'html' ? '.html' : '.json';
    if (!filename.endsWith(ext) || filename.includes('..') || /[\\/]/.test(filename)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid filename' }));
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
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const content = readFileSync(filePath, 'utf-8');
      const contentType = format === 'html' ? 'text/html' : 'application/json';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': 'attachment; filename="' + filename.replace(/"/g, '\\"') + '"',
      });
      res.end(content);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.method === 'GET' && url === '/api/sync-report') {
    try {
      const html = buildSyncReportHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Disposition': 'attachment; filename="sync-report.html"',
      });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => {
  console.log(`Test runner: http://localhost:${PORT}/`);
  console.log('Open in browser and click Run on any test case.');
});
