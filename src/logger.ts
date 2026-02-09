/**
 * Structured request/response logging for full traceability.
 * Writes JSON lines (one JSON object per line) for easy parsing and debugging.
 */

import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, RequestResponseLogEntry } from './types.js';

let logStream: ReturnType<typeof createWriteStream> | null = null;
let logPath: string | null = null;
let maxBodyLength = 50000;

export function initRequestResponseLogger(config: Config, runId: string): string {
  const dir = config.logging.dir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = config.logging.requestResponseLog.replace(/\.[^.]+$/, '') + `_${runId}.jsonl`;
  const path = join(dir, filename);
  maxBodyLength = config.logging.maxResponseBodyLength;
  logStream = createWriteStream(path, { flags: 'a' });
  logPath = path;
  return path;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '...[truncated]';
}

export function logRequestResponse(entry: Omit<RequestResponseLogEntry, 'timestamp'>): void {
  const full: RequestResponseLogEntry = { ...entry, timestamp: new Date().toISOString() };
  if (full.response.bodyPreview && full.response.bodyPreview.length > maxBodyLength) {
    full.response.bodyPreview = truncate(full.response.bodyPreview, maxBodyLength);
  }
  if (logStream?.writable) {
    logStream.write(JSON.stringify(full) + '\n');
  }
}

export function getRequestResponseLogPath(): string | null {
  return logPath;
}

export function closeRequestResponseLogger(): void {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
  logPath = null;
}
