export interface ExtractionResult {
  success: boolean;
  statusCode: number;
  latencyMs: number;
  patternKey?: string;
  errorMessage?: string;
}

export interface IExtractionService {
  extractFile(
    filePath: string,
    brand: string,
    purchaser?: string,
  ): Promise<ExtractionResult>;
}
