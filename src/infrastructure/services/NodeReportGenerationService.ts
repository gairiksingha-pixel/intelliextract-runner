import { spawn } from "node:child_process";
import { IReportGenerationService } from "../../core/domain/services/IReportGenerationService.js";

/**
 * Infrastructure implementation that delegates physical report generation
 * to the CLI entry point as a child process. Keeps spawn() out of the
 * domain/use-case layer.
 */
export class NodeReportGenerationService implements IReportGenerationService {
  constructor(private readonly cwd: string) {}

  async generate(runId: string): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(
        "node",
        ["dist/index.js", "report", "--run-id", runId],
        { cwd: this.cwd, shell: false, stdio: ["ignore", "ignore", "pipe"] },
      );
      child.stderr?.on("data", (d) => {
        const msg = d.toString().trim();
        if (msg) console.error("[NodeReportGenerationService]", msg);
      });
      child.on("close", () => resolve());
      child.on("error", (err) => {
        console.error(
          "[NodeReportGenerationService] spawn error:",
          err.message,
        );
        resolve(); // non-fatal — report failure should not block run completion
      });
    });
  }
}
