import {
  ExtractionRecord,
  ExtractionStatus,
} from "../entities/extraction-record.entity.js";
import { IAppConfigStore } from "./app-config-store.repository.js";
import { IFileRegistry, UnextractedFile } from "./file-registry.repository.js";
import { IRunStore } from "./run-store.repository.js";
export { EmailLogEntry } from "./email-log-store.repository.js";
import { IEmailLogStore, EmailLogEntry } from "./email-log-store.repository.js";
import { IExtractionLogStore } from "./extraction-log-store.repository.js";

/**
 * Composite repository interface for extraction record operations.
 * Composed from focused ISP interfaces — consumers can depend on only
 * the sub-interface they need instead of this full composite.
 */
export interface IExtractionRecordRepository
  extends
    IAppConfigStore,
    IFileRegistry,
    IRunStore,
    IExtractionLogStore,
    IEmailLogStore {
  // Lifecycle
  open(path: string): Promise<void>;
  close(): Promise<void>;
  initialize(): Promise<void>;

  // Extraction record write
  upsertRecord(record: ExtractionRecord): Promise<void>;
  upsertRecords(records: ExtractionRecord[]): Promise<void>;

  // Extraction record read
  getRecordsForRun(runId: string): Promise<ExtractionRecord[]>;
  getAllRecords(limit?: number, offset?: number): Promise<ExtractionRecord[]>;
  getCompletedPaths(runId?: string): Promise<Set<string>>;
  /** Paths already processed (done, skipped, or error) in this run or globally. */
  getProcessedPaths(runId?: string): Promise<Set<string>>;
  getGlobalSkipCount(): Promise<number>;
  getErrorPaths(runId: string): Promise<Set<string>>;
  /** Files that have status 'error' in any run (for retry failed). */
  getFailedFiles(filter?: {
    brand?: string;
    purchaser?: string;
    pairs?: { brand: string; purchaser: string }[];
  }): Promise<UnextractedFile[]>;

  // Schedule audit log (DB-backed replacement for flat-file schedule.log)
  appendScheduleLog(entry: Record<string, unknown>): void;
  getScheduleLogs(limit?: number): ScheduleLogEntry[];
}

export interface ScheduleLogEntry {
  timestamp: string;
  scheduleId?: string;
  outcome?: "executed" | "skipped";
  level?: "info" | "warn" | "error";
  message?: string;
  [key: string]: unknown;
}
