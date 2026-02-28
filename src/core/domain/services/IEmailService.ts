export interface EmailConfig {
  recipientEmail?: string;
  senderEmail?: string;
  appPassword?: string;
}

export interface FailureDetail {
  filePath: string;
  brand: string;
  purchaser?: string;
  patternKey?: string;
  errorMessage?: string;
  statusCode?: number;
}

export interface IEmailService {
  getEmailConfig(): Promise<EmailConfig>;
  saveEmailConfig(config: EmailConfig): Promise<void>;
  sendConsolidatedFailureEmail(
    runId: string,
    failures: FailureDetail[],
    metrics?: any,
  ): Promise<void>;
  sendFailureEmail(params: FailureDetail & { runId: string }): Promise<void>;
}
