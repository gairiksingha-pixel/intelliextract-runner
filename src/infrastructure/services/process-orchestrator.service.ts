import { spawn, ChildProcess } from "node:child_process";

export interface ProcessOrchestratorCallbacks {
  onProgress?: (percent: number, done: number, total: number) => void;
  onSyncProgress?: (done: number, total: number) => void;
  onExtractionProgress?: (done: number, total: number) => void;
  onResumeSkip?: (skipped: number, total: number) => void;
  onResumeSkipSync?: (skipped: number, total: number) => void;
  onRunId?: (runId: string) => void;
  onChild?: (child: ChildProcess) => void;
}

export interface RunCaseResult {
  caseId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
}

const PROGRESS_REGEX = /(\d+)%\s*\((\d+)\/(\d+)\)/g;
const SYNC_PROGRESS_PREFIX = "SYNC_PROGRESS\t";
const EXTRACTION_PROGRESS_PREFIX = "EXTRACTION_PROGRESS\t";
const RESUME_SKIP_PREFIX = "RESUME_SKIP\t";
const RESUME_SKIP_SYNC_PREFIX = "RESUME_SKIP_SYNC\t";
const RUN_ID_PREFIX = "RUN_ID\t";
const LOG_PREFIX = "LOG\t";

export class ProcessOrchestrator {
  private activeProcesses = new Map<string, ChildProcess>();

  constructor(
    private caseCommands: Record<
      string,
      (
        p?: any,
        runOpts?: any,
      ) => Promise<[string, string[], any]> | [string, string[], any]
    >,
  ) {}

  async runCase(
    caseId: string,
    params: any = {},
    callbacks: ProcessOrchestratorCallbacks = {},
    runOpts: any = null,
  ): Promise<RunCaseResult> {
    const def = this.caseCommands[caseId];
    if (!def) {
      throw new Error(`Unknown case: ${caseId}`);
    }

    const resolved =
      typeof def === "function"
        ? await (def as Function)(params, runOpts)
        : def;
    const [cmd, args, opts] = resolved;
    const displayCmd = args ? [cmd, ...args].join(" ") : cmd;

    return new Promise<RunCaseResult>((resolve) => {
      const child = spawn(cmd, args || [], {
        ...opts,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (runOpts?.runKey) {
        this.activeProcesses.set(runOpts.runKey, child);
      }

      if (callbacks.onChild) {
        callbacks.onChild(child);
      }

      let fullStdout = "";
      let lineBuffer = "";
      let stderr = "";
      let lastPercent = -1;

      child.stdout?.on("data", (d) => {
        const chunk = d.toString();
        fullStdout += chunk;
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (
            callbacks.onSyncProgress &&
            line.startsWith(SYNC_PROGRESS_PREFIX)
          ) {
            const parts = line.slice(SYNC_PROGRESS_PREFIX.length).split("\t");
            if (parts.length >= 2) {
              const done = Number(parts[0]);
              const total = Number(parts[1]);
              if (!Number.isNaN(done)) {
                callbacks.onSyncProgress(done, Number.isNaN(total) ? 0 : total);
              }
            }
          }
          if (
            callbacks.onExtractionProgress &&
            line.startsWith(EXTRACTION_PROGRESS_PREFIX)
          ) {
            const parts = line
              .slice(EXTRACTION_PROGRESS_PREFIX.length)
              .split("\t");
            if (parts.length >= 2) {
              const done = Number(parts[0]);
              const total = Number(parts[1]);
              if (!Number.isNaN(done)) {
                callbacks.onExtractionProgress(
                  done,
                  Number.isNaN(total) ? 0 : total,
                );
              }
            }
          }
          if (callbacks.onResumeSkip && line.startsWith(RESUME_SKIP_PREFIX)) {
            const parts = line.slice(RESUME_SKIP_PREFIX.length).split("\t");
            if (parts.length >= 2) {
              const skipped = Number(parts[0]);
              const total = Number(parts[1]);
              if (!Number.isNaN(skipped)) {
                callbacks.onResumeSkip(
                  skipped,
                  Number.isNaN(total) ? 0 : total,
                );
              }
            }
          }
          if (
            callbacks.onResumeSkipSync &&
            line.startsWith(RESUME_SKIP_SYNC_PREFIX)
          ) {
            const parts = line
              .slice(RESUME_SKIP_SYNC_PREFIX.length)
              .split("\t");
            if (parts.length >= 2) {
              const skipped = Number(parts[0]);
              const total = Number(parts[1]);
              if (!Number.isNaN(skipped)) {
                callbacks.onResumeSkipSync(
                  skipped,
                  Number.isNaN(total) ? 0 : total,
                );
              }
            }
          }
          if (line.startsWith(RUN_ID_PREFIX)) {
            const parts = line.slice(RUN_ID_PREFIX.length).split("\t");
            if (parts.length >= 1) {
              const runId = parts[0].trim();
              if (callbacks.onRunId) callbacks.onRunId(runId);
            }
          }
          if (line.startsWith(LOG_PREFIX)) {
            const message = line.slice(LOG_PREFIX.length).trim();
            // Optional: could add onLog callback here too
          }
        }

        const bufToScan = lineBuffer || fullStdout;
        if (callbacks.onProgress && bufToScan) {
          let m;
          let last = null;
          PROGRESS_REGEX.lastIndex = 0;
          while ((m = PROGRESS_REGEX.exec(bufToScan)) !== null) {
            last = m;
          }
          if (last) {
            const [, pct, done, total] = last;
            const num = Number(pct);
            if (num !== lastPercent) {
              lastPercent = num;
              callbacks.onProgress(num, Number(done), Number(total));
            }
          }
        }
      });

      child.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      child.on("close", (code, signal) => {
        if (runOpts?.runKey) {
          this.activeProcesses.delete(runOpts.runKey);
        }
        resolve({
          caseId,
          exitCode: code ?? (signal ? 1 : 0),
          stdout: fullStdout.trim(),
          stderr: stderr.trim(),
          command: displayCmd,
        });
      });

      child.on("error", (err) => {
        resolve({
          caseId,
          exitCode: 1,
          stdout: "",
          stderr: err.message,
          command: displayCmd,
        });
      });
    });
  }

  getActiveChildProcess(key: string): ChildProcess | undefined {
    return this.activeProcesses.get(key);
  }

  stopProcess(key: string): boolean {
    const child = this.activeProcesses.get(key);
    if (child) {
      child.kill("SIGTERM");
      return true;
    }
    return false;
  }
}
