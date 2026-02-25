export interface INotificationService {
  sendFailureNotification(
    runId: string,
    failures: any[],
    metrics?: any,
  ): Promise<void>;
  updateConfig(config: any): void;
}
