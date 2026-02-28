import Database from "better-sqlite3";
import {
  IAppConfigStore,
  EmailStoredConfig,
} from "../../core/domain/repositories/app-config-store.repository.js";

export class SqliteAppConfigRepository implements IAppConfigStore {
  constructor(private db: Database.Database) {}

  async getMeta(key: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT value FROM tbl_app_config WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO tbl_app_config (key, value) VALUES (?, ?)",
      )
      .run(key, value);
  }

  async getEmailConfig(): Promise<EmailStoredConfig> {
    const val = await this.getMeta("email_config");
    return val ? (JSON.parse(val) as EmailStoredConfig) : {};
  }

  async saveEmailConfig(config: EmailStoredConfig): Promise<void> {
    await this.setMeta("email_config", JSON.stringify(config));
  }
}
