/**
 * EntelliExtract API client.
 * Authenticates using Access Key, Secret Message, and Signature.
 * Adapt sign() to match your API's auth scheme (e.g. custom header or HMAC).
 */

import type { Config } from './types.js';

const ACCESS_KEY = process.env.ENTELLIEXTRACT_ACCESS_KEY ?? '';
const SECRET_MESSAGE = process.env.ENTELLIEXTRACT_SECRET_MESSAGE ?? '';
const SIGNATURE = process.env.ENTELLIEXTRACT_SIGNATURE ?? '';

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

function buildAuthHeaders(): Record<string, string> {
  // Use the three credentials as required by your API (e.g. custom headers or signing).
  return {
    'X-Access-Key': ACCESS_KEY,
    'X-Secret-Message': SECRET_MESSAGE,
    'X-Signature': SIGNATURE,
  };
}

export async function extract(
  config: Config,
  request: ExtractRequest,
  abortSignal?: AbortSignal
): Promise<ExtractResult> {
  const url = `${config.api.baseUrl.replace(/\/$/, '')}/extract`;
  const start = Date.now();

  const body = JSON.stringify({
    filePath: request.filePath,
    fileContentBase64: request.fileContentBase64,
    fileUrl: request.fileUrl,
    brand: request.brand,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.api.timeoutMs);
  const signal = abortSignal ?? controller.signal;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
      },
      body,
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
