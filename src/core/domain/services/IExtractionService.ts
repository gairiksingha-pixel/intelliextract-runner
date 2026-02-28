export class NetworkAbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkAbortError";
  }
}

export interface ExtractionResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  patternKey?: string;
  errorMessage?: string;
  fullResponse?: any;
}

export interface IExtractionService {
  extractFile(
    filePath: string,
    brand: string,
    purchaser?: string,
    runId?: string,
    relativePath?: string,
  ): Promise<ExtractionResult>;
}
