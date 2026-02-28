import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  extract,
  type ExtractResult,
  getExtractUploadUrl,
} from "./api-client.js";
import {
  IExtractionService,
  ExtractionResult,
  NetworkAbortError,
} from "../../core/domain/services/IExtractionService.js";
import { Config } from "../../core/domain/entities/Config.js";

export class IntelliExtractService implements IExtractionService {
  constructor(
    private appConfig: Config,
    private extractionsDir: string,
  ) {}

  async extractFile(
    filePath: string,
    brand: string,
    purchaser?: string,
    runId?: string,
    relativePath?: string,
  ): Promise<ExtractionResult> {
    let bodyBase64: string;
    try {
      bodyBase64 = readFileSync(filePath, { encoding: "base64" });
    } catch (e) {
      return {
        success: false,
        statusCode: 0,
        latencyMs: 0,
        errorMessage: `Read file: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const { result, attempts } = await this.extractWithRetries(
      filePath,
      brand,
      bodyBase64,
    );

    const isHttpSuccess = result.success;
    let isAppSuccess = isHttpSuccess;
    let appErrorMessage: string | undefined;
    let patternKey: string | undefined;

    if (result.body) {
      try {
        const parsed = JSON.parse(result.body);
        if (typeof parsed === "object" && parsed !== null) {
          if (parsed.success === false) {
            isAppSuccess = false;
            appErrorMessage = parsed.error || parsed.message;
          }
          patternKey = parsed.pattern?.pattern_key;
        }
      } catch (_) {}
    }

    // Write result to disk
    if (result.body) {
      this.writeResult(
        filePath,
        brand,
        purchaser,
        result.body,
        isAppSuccess,
        result.latencyMs,
        runId,
        relativePath,
      );
    }

    const finalSuccess = isAppSuccess;
    const baseErrorSnippet = finalSuccess
      ? undefined
      : result.body?.slice(0, 500) || "";
    const errorMessage =
      finalSuccess || (!baseErrorSnippet && !appErrorMessage)
        ? undefined
        : appErrorMessage ||
          (attempts > 1
            ? `${baseErrorSnippet} (after ${attempts} attempt${attempts === 1 ? "" : "s"})`
            : baseErrorSnippet);

    return {
      success: finalSuccess,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      patternKey,
      errorMessage,
    };
  }

  private async extractWithRetries(
    filePath: string,
    brand: string,
    bodyBase64: string,
  ): Promise<{ result: ExtractResult; attempts: number }> {
    const maxRetries = this.appConfig.run.maxRetries || 0;
    const backoffBaseMs = this.appConfig.run.retryBackoffMs || 500;

    let attempt = 0;
    let last: ExtractResult;

    const NETWORK_MAX_RETRIES = 5;
    const NETWORK_RETRY_DELAY_MS = 12000;

    const stdoutPiped = !process.stdout.isTTY;

    while (true) {
      attempt += 1;
      last = await extract(this.appConfig, {
        filePath,
        fileContentBase64: bodyBase64,
        brand,
      });

      // Check for Network Error (statusCode === 0)
      if (last.statusCode === 0) {
        if (attempt <= NETWORK_MAX_RETRIES) {
          if (stdoutPiped) {
            process.stdout.write(
              `LOG\tNetwork interruption detected. Retry ${attempt}/${NETWORK_MAX_RETRIES} in ${NETWORK_RETRY_DELAY_MS / 1000}s...\n`,
            );
          }
          await new Promise((resolve) =>
            setTimeout(resolve, NETWORK_RETRY_DELAY_MS),
          );
          continue;
        } else {
          throw new NetworkAbortError(
            "Network interruption detected (max retries exceeded). Aborting run.",
          );
        }
      }

      if (last.success) break;

      // Handle other retriable errors (5xx, 429)
      const code = last.statusCode;
      const isRetriable = code === 429 || (code >= 500 && code < 600);

      if (!isRetriable) break;
      if (attempt > maxRetries) break;

      if (backoffBaseMs > 0) {
        const delay = backoffBaseMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { result: last!, attempts: attempt };
  }

  private writeResult(
    filePath: string,
    brand: string,
    purchaser: string | undefined,
    responseBody: string,
    success: boolean,
    latencyMs: number,
    runId?: string,
    relativePath?: string,
  ) {
    const subdir = success ? "succeeded" : "failed";
    const outDir = join(this.extractionsDir, subdir);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    // Use relative path for safe filename to match old project logic
    const relativePathForName = relativePath || filePath;
    const safe = relativePathForName
      .replaceAll(/[\\/]/g, "_")
      .replaceAll(/[^a-zA-Z0-9._-]/g, "_");

    let filename = `${brand}_${safe}`;
    if (!filename.toLowerCase().endsWith(".json")) filename += ".json";

    const path = join(outDir, filename);

    try {
      const data = JSON.parse(responseBody);
      if (typeof data === "object" && data !== null) {
        const d = data as any;
        d._filePath = filePath;
        d._relativePath = relativePathForName;
        d._brand = brand;
        d._purchaser = purchaser;
        d._latencyMs = latencyMs;
        if (runId) d._runId = runId;
      }
      writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      writeFileSync(path, responseBody, "utf-8");
    }
  }
}
