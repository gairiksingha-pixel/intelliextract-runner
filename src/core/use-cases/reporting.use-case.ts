import { IExtractionRecordRepository } from "../domain/repositories/extraction-record.repository.js";
import { ExtractionRecord } from "../domain/entities/extraction-record.entity.js";

export interface ReportMetrics {
  runId: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  durationSeconds: number;
}

export class ReportingUseCase {
  constructor(private recordRepo: IExtractionRecordRepository) {}

  async execute(runId: string): Promise<ReportMetrics> {
    const records = await this.recordRepo.getRecordsForRun(runId);
    if (records.length === 0) {
      throw new Error(`No records found for run ${runId}`);
    }

    let startedAt = Infinity;
    let finishedAt = 0;

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const r of records) {
      if (r.startedAt)
        startedAt = Math.min(startedAt, new Date(r.startedAt).getTime());
      if (r.finishedAt)
        finishedAt = Math.max(finishedAt, new Date(r.finishedAt).getTime());

      if (r.status === "done") success++;
      else if (r.status === "error") failed++;
      else if (r.status === "skipped") skipped++;
    }

    if (startedAt === Infinity) startedAt = Date.now();
    if (finishedAt === 0) finishedAt = Date.now();

    const durationSeconds = (finishedAt - startedAt) / 1000;

    return {
      runId,
      total: records.length,
      success,
      failed,
      skipped,
      durationSeconds,
    };
  }

  async getHistoricalSummaries(): Promise<any[]> {
    // This would involve aggregating records across all runs
    // For now, let's keep it simple or delegate to the existing report.ts logic
    // but refactored to use the repo.
    return [];
  }
}
