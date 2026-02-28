/**
 * Segregated interface: key-value app configuration store
 * (runtime state, email config, etc.)
 */
export interface IAppConfigStore {
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  getEmailConfig(): Promise<EmailStoredConfig>;
  saveEmailConfig(config: EmailStoredConfig): Promise<void>;
}

export interface EmailStoredConfig {
  recipientEmail?: string;
  senderEmail?: string;
  appPassword?: string;
}
