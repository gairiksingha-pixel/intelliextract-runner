#!/usr/bin/env node
/**
 * Local test runner server. Serves test-cases.html and runs test case commands via POST /run.
 * Start from project root: node test-runner-server.mjs
 * Open: http://localhost:8765/
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8765;
const ROOT = join(__dirname);

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

const CASE_COMMANDS = {
  P1: (p) => syncArgs(p),
  P2: (p) => runArgs(p, ['--no-sync']),
  P3: () => ['node', ['dist/index.js', 'report'], { cwd: ROOT }],
  P4: () => {
    const runId = getLastRunId() || 'run_0000000000_fake';
    return ['node', ['dist/index.js', 'report', '--run-id', runId], { cwd: ROOT }];
  },
  P5: (p) => {
    const base = ['dist/index.js', 'sync', '-c', 'config/config.yaml'];
    if (p?.syncLimit > 0) base.push('--limit', String(p.syncLimit));
    return ['node', base, { cwd: ROOT }];
  },
  P6: (p) => runArgs(p, ['--no-sync', '--no-report']),
  P7: (p) => runArgs(p, []),
  P8: () => [
    'node',
    [
      '-e',
      "const fs=require('fs');const p=require('path');const dir=p.join(process.cwd(),'output','logs');if(!fs.existsSync(dir))process.exit(1);const f=fs.readdirSync(dir).find(n=>n.endsWith('.jsonl'));if(!f)process.exit(1);const lines=fs.readFileSync(p.join(dir,f),'utf8').trim().split(/\\n/).filter(Boolean);const ok=lines.length>0&&lines.every(l=>{try{const j=JSON.parse(l);return j.runId&&j.filePath&&j.request&&j.response!==undefined;}catch(e){return false;}});process.exit(ok?0:1);",
    ],
    { cwd: ROOT },
  ],
  P9: () => ['node', ['dist/index.js', 'report'], { cwd: ROOT }],
  P10: () => ['node', ['dist/index.js', 'report'], { cwd: ROOT }],
  N1: () => ['node', ['dist/index.js', 'sync', '-c', 'config/nonexistent.yaml'], { cwd: ROOT }],
  N2: () => ['node', ['dist/index.js', 'sync', '-c', 'config/bad-yaml.yaml'], { cwd: ROOT }],
  N3: () => ['node', ['dist/index.js', 'sync', '-c', 'config/bad-schema.yaml'], { cwd: ROOT }],
  N4: () => ['node', ['dist/index.js', 'report'], { cwd: ROOT }],
  N5: () => ['node', ['dist/index.js', 'report', '--run-id', 'run_0000000000_fake'], { cwd: ROOT }],
  N6: (p) => syncArgs(p),
  E1: (p) => runArgs(p, ['--no-sync']),
  E2: (p) => runArgs(p, ['--no-sync']),
  E3: (p) => runArgs(p, ['--no-sync']),
  E4: (p) => syncArgs(p),
  E5: (p) => syncArgs(p),
  E6: () => {
    const runId = getLastRunId() || 'run_0000000000_fake';
    return ['node', ['dist/index.js', 'report', '--run-id', runId], { cwd: ROOT }];
  },
  E7: (p) => {
    const cp = join(ROOT, 'output', 'checkpoints', 'checkpoint.json');
    if (existsSync(cp)) {
      try {
        copyFileSync(cp, cp + '.bak');
      } catch (_) {}
      writeFileSync(cp, '{}', 'utf-8');
    }
    return runArgs(p, ['--no-sync']);
  },
  E8: (p) => runArgs(p, ['--no-sync']),
};

function runCase(caseId, params = {}) {
  const def = CASE_COMMANDS[caseId];
  if (!def) return Promise.reject(new Error(`Unknown case: ${caseId}`));
  const resolved = typeof def === 'function' ? def(params) : def();
  const [cmd, args, opts] = resolved;
  const displayCmd = args ? [cmd, ...args].join(' ') : cmd;
  return new Promise((resolve) => {
    const child = spawn(cmd, args || [], {
      ...opts,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code, signal) => {
      resolve({
        caseId,
        exitCode: code ?? (signal ? 1 : 0),
        stdout: stdout.trim(),
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
      const result = await runCase(caseId, params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
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
