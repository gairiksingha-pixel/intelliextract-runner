/**
 * Domain interface for physical report generation.
 * Fixes the DIP violation in ExecuteWorkflowUseCase where spawn()
 * was called directly (infrastructure concern inside the domain).
 */
export interface IReportGenerationService {
  generate(runId: string): Promise<void>;
}
