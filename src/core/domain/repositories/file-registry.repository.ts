import { ExtractionStatus } from "../entities/extraction-record.entity.js";

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
  /** The run that produced this status update */
  runId?: string;
}

export interface IFileRegistry {
  registerFiles(files: RegisterFileInput[]): Promise<void>;
  getUnextractedFiles(filter?: {
    brand?: string;
    purchaser?: string;
    pairs?: { brand: string; purchaser: string }[];
  }): Promise<UnextractedFile[]>;
  updateFileStatus(
    id: string,
    status: ExtractionStatus,
    metrics?: FileStatusMetrics,
  ): Promise<void>;
}
