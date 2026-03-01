export interface EmailLogEntry {
  id?: number;
  timestamp: string;
  runId: string;
  recipient: string;
  subject: string;
  status: "sent" | "failed";
  error?: string;
}

export interface IEmailLogStore {
  saveEmailLog(entry: EmailLogEntry): Promise<void>;
  getEmailLogs(limit?: number): Promise<EmailLogEntry[]>;
}
