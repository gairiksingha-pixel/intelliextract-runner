import { createWriteStream, mkdirSync, existsSync, WriteStream } from "node:fs";
import { join } from "node:path";
import { ILogger, LogEntry } from "../../core/domain/services/ILogger.js";

export class JsonLogger implements ILogger {
  private logStream: WriteStream | null = null;

  constructor(
    private logDir: string,
    private logNameTemplate: string,
  ) {}

  init(runId: string): void {
    if (!existsSync(this.logDir)) mkdirSync(this.logDir, { recursive: true });
    const filename =
      this.logNameTemplate.replace(/\.[^.]+$/, "") + `_${runId}.jsonl`;
    const path = join(this.logDir, filename);
    this.logStream = createWriteStream(path, { flags: "a" });
  }

  log(entry: LogEntry): void {
    if (this.logStream?.writable) {
      const full = { ...entry, timestamp: new Date().toISOString() };
      this.logStream.write(JSON.stringify(full) + "\n");
    }
  }

  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}
