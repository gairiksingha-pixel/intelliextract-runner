/**
 * intelliExtract API client.
 * Uses POST /api/v1/spreadsheet/extract/upload (multipart/form-data file upload).
 * Auth headers (must match Swagger): X-Access-Key, X-Secret-Message, X-Signature.
 * Set ENTELLIEXTRACT_USE_MOCK=1 to return fixture JSON instead of calling the API (for offline/dev).
 * Uses undici with a custom connect timeout (config.api.timeoutMs); Node's default fetch has a 10s connect limit.
 */

import { config as loadEnv } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fetch, Agent, FormData } from 'undici';
import type { Config } from './types.js';

loadEnv();

const USE_MOCK = process.env.ENTELLIEXTRACT_USE_MOCK === '1' || process.env.ENTELLIEXTRACT_USE_MOCK === 'true';

function loadMockResponse(): string | null {
  const path = join(process.cwd(), 'fixtures', 'extract-response-success.json');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export interface ExtractRequest {
  filePath: string;
  fileContentBase64?: string;
  fileUrl?: string;
  brand?: string;
}

export interface ExtractResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  body: string;
  headers: Record<string, string>;
}

/** Base URL for the extract-upload endpoint (no trailing slash). */
export function getExtractUploadUrl(config: Config): string {
  const base = config.api.baseUrl.replace(/\/$/, '');
  return `${base}/api/v1/spreadsheet/extract/upload`;
}

/** Headers to match Swagger: auth + Accept. Do not set Content-Type; fetch sets multipart boundary. */
function buildHeaders(): Record<string, string> {
  const accessKey = process.env.ENTELLIEXTRACT_ACCESS_KEY ?? '';
  const secretMessage = process.env.ENTELLIEXTRACT_SECRET_MESSAGE ?? '';
  const signature = process.env.ENTELLIEXTRACT_SIGNATURE ?? '';
  return {
    'Accept': 'application/json',
    'X-Access-Key': accessKey,
    'X-Secret-Message': secretMessage,
    'X-Signature': signature,
  };
}

/** MIME type for spreadsheet file (Swagger uses this for the file part). */
function getSpreadsheetMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'application/octet-stream';
}

export async function extract(
  config: Config,
  request: ExtractRequest,
  abortSignal?: AbortSignal
): Promise<ExtractResult> {
  const start = Date.now();

  if (USE_MOCK) {
    const body = loadMockResponse();
    if (body) {
      await new Promise((r) => setTimeout(r, 100));
      return {
        success: true,
        statusCode: 200,
        latencyMs: Date.now() - start,
        body,
        headers: { 'content-type': 'application/json' },
      };
    }
  }

  const url = getExtractUploadUrl(config);

  if (!request.fileContentBase64) {
    return {
      success: false,
      statusCode: 0,
      latencyMs: Date.now() - start,
      body: 'Missing file content (fileContentBase64 required for upload)',
      headers: {},
    };
  }

  const fileBuffer = Buffer.from(request.fileContentBase64, 'base64');
  const filename = basename(request.filePath);
  const mimeType = getSpreadsheetMimeType(filename);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);
  form.append('pattern_key', '');
  form.append('request_metadata', '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.api.timeoutMs);
  const signal = abortSignal ?? controller.signal;
  const dispatcher = new Agent({
    connectTimeout: config.api.timeoutMs,
    bodyTimeout: config.api.timeoutMs,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: form,
      signal,
      dispatcher,
    });
    const latencyMs = Date.now() - start;
    clearTimeout(timeout);
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return {
      success: res.ok,
      statusCode: res.status,
      latencyMs,
      body: text,
      headers,
    };
  } catch (err) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? err.cause.message
        : err instanceof Error && err.cause
          ? String(err.cause)
          : '';
    const body = cause ? `${message} (${cause})` : message;
    return {
      success: false,
      statusCode: 0,
      latencyMs,
      body,
      headers: {},
    };
  }
}
