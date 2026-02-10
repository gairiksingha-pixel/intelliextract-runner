/**
 * intelliExtract API client.
 * Uses POST /api/v1/spreadsheet/extract/upload (multipart/form-data file upload).
 * Auth headers (must match Swagger): X-Access-Key, X-Secret-Message, X-Signature.
 */

import { config as loadEnv } from 'dotenv';
import { basename } from 'node:path';
import type { Config } from './types.js';

loadEnv();

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

/** Auth headers exactly as Swagger: X-Access-Key, X-Signature, X-Secret-Message (raw message that was signed). */
function buildAuthHeaders(): Record<string, string> {
  const accessKey = process.env.ENTELLIEXTRACT_ACCESS_KEY ?? '';
  const secretMessage = process.env.ENTELLIEXTRACT_SECRET_MESSAGE ?? '';
  const signature = process.env.ENTELLIEXTRACT_SIGNATURE ?? '';
  return {
    'X-Access-Key': accessKey,
    'X-Secret-Message': secretMessage,
    'X-Signature': signature,
  };
}

export async function extract(
  config: Config,
  request: ExtractRequest,
  abortSignal?: AbortSignal
): Promise<ExtractResult> {
  const url = getExtractUploadUrl(config);
  const start = Date.now();

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
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.api.timeoutMs);
  const signal = abortSignal ?? controller.signal;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildAuthHeaders(),
      body: form,
      signal,
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
    return {
      success: false,
      statusCode: 0,
      latencyMs,
      body: message,
      headers: {},
    };
  }
}
