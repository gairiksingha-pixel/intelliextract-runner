import { ExtractionRecord, RunMetrics, EmailConfig } from "../types.js";

export interface INotificationService {
  sendFailureNotification(
    runId: string,
    failures: ExtractionRecord[],
    metrics?: RunMetrics,
  ): Promise<void>;
  updateConfig(config: EmailConfig): void;
}
