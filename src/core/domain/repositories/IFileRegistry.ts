import { CheckpointStatus } from "../entities/Checkpoint.js";

/**
 * Segregated interface: master registry of all discovered/synced files.
 */
export interface RegisterFileInput {
  id: string;
  fullPath: string;
  brand: string;
  purchaser?: string;
  size?: number;
  etag?: string;
  sha256?: string;
}

export interface UnextractedFile {
  filePath: string;
  relativePath: string;
  brand: string;
  purchaser?: string;
}

export interface FileStatusMetrics {
  latencyMs?: number;
  statusCode?: number;
  errorMessage?: string;
  patternKey?: string;
  runId?: string;
}

export interface IFileRegistry {
  registerFiles(files: RegisterFileInput[]): Promise<void>;
  getUnextractedFiles(filter?: {
    brand?: string;
    purchaser?: string;
  }): Promise<UnextractedFile[]>;
  updateFileStatus(
    id: string,
    status: CheckpointStatus,
    metrics?: FileStatusMetrics,
  ): Promise<void>;
}
