import { IncomingMessage, ServerResponse } from "node:http";
import { ExtractionController } from "./controllers/extraction.controller.js";
import { ScheduleController } from "./controllers/schedule.controller.js";
import { ReportPageController } from "./controllers/report-page.controller.js";
import { ReportDataController } from "./controllers/report-data.controller.js";
import { ExportController } from "./controllers/export.controller.js";
import { ProjectController } from "./controllers/project.controller.js";

const MAX_BODY_BYTES = 512 * 1024; // 512 KB — guard against request flooding

export class Router {
  constructor(
    private extractionController: ExtractionController,
    private scheduleController: ScheduleController,
    private reportPageController: ReportPageController,
    private reportDataController: ReportDataController,
    private projectController: ProjectController,
    private exportController: ExportController,
  ) {}

  // ──────────────────────────────────────────────
  // Body reading helper — enforces size limit
  // ──────────────────────────────────────────────
  private async readBody(req: IncomingMessage): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let body = "";
      let bytes = 0;
      req.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error("Request body exceeds 512 KB limit"));
          return;
        }
        body += chunk.toString();
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  // ──────────────────────────────────────────────
  // Access logger
  // ──────────────────────────────────────────────
  private logAccess(
    method: string,
    url: string,
    status: number,
    durationMs: number,
  ) {
    // 1. Skip static assets & root to avoid noise
    if (!url.startsWith("/api/") && url !== "/run") return;

    // 2. Skip high-frequency heartbeat/polling routes (best practice for clean terminal)
    if (url === "/api/active-runs" || url.startsWith("/api/run-status")) return;

    const ts = new Date().toISOString();
    console.log(`[HTTP] ${ts} ${method} ${url} → ${status} (${durationMs}ms)`);
  }

  // ──────────────────────────────────────────────
  // Request handler
  // ──────────────────────────────────────────────
  async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url?.split("?")[0] || "/";
    const method = req.method || "GET";
    const start = Date.now();

    // Intercept writeHead to capture status for access log
    const origWriteHead = res.writeHead.bind(res);
    let capturedStatus = 200;
    (res as any).writeHead = (status: number, ...args: any[]) => {
      capturedStatus = status;
      return origWriteHead(status, ...args);
    };

    res.on("finish", () => {
      this.logAccess(method, url, capturedStatus, Date.now() - start);
    });

    try {
      await this.route(method, url, req, res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
    }
  }

  private async route(
    method: string,
    url: string,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    // 1. Static Assets & Ping
    if (method === "GET" && url === "/api/ping") {
      return this.projectController.ping(res);
    }
    if (method === "GET" && url.startsWith("/assets/")) {
      return this.projectController.getAssets(url, res);
    }

    // 2. Home Page
    if (method === "GET" && (url === "/" || url === "/index.html")) {
      return this.projectController.getHomePage(res);
    }

    // 3. Extraction/Execution
    if (method === "POST" && url === "/run") {
      const body = await this.readBody(req).catch(() => null);
      if (body === null) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request body too large" }));
        return;
      }
      try {
        const parsed = JSON.parse(body || "{}");
        return this.extractionController.handleRunRequest(parsed, res);
      } catch (e: unknown) {
        if (!res.writableEnded) {
          const msg = e instanceof Error ? e.message : String(e);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + msg }));
        }
        return;
      }
    }
    if (method === "POST" && url === "/api/stop-run") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      return this.projectController.stopRun(body, res);
    }

    // 4. Status & Run State
    if (method === "GET" && url === "/api/active-runs") {
      return this.projectController.getActiveRuns(res);
    }
    if (method === "GET" && url.startsWith("/api/run-status")) {
      return this.projectController.getRunStatus(req.url || url, res);
    }
    if (method === "POST" && url === "/api/run-state/clear") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      return this.projectController.clearRunState(body, res);
    }
    if (method === "GET" && url === "/api/staging-stats") {
      return this.projectController.getStagingStats(res);
    }

    // 5. Schedules
    if (method === "GET" && url === "/api/schedules") {
      return this.scheduleController.getSchedules(res);
    }
    if (method === "POST" && url === "/api/schedules") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      return this.scheduleController.addSchedule(body, res);
    }
    if (method === "PUT" && url.startsWith("/api/schedules/")) {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      const id = decodeURIComponent(url.slice("/api/schedules/".length));
      return this.scheduleController.updateSchedule(id, body, res);
    }
    if (method === "DELETE" && url.startsWith("/api/schedules/")) {
      const id = decodeURIComponent(url.slice("/api/schedules/".length));
      return this.scheduleController.deleteSchedule(id, res);
    }
    if (method === "GET" && url === "/api/schedule-log") {
      return this.scheduleController.getLogEntries(req.url || url, res);
    }

    // 6. Reports & Files
    const summaryRegex = /^\/?(reports\/)?summary\/?$/;
    const explorerRegex = /^\/?(reports\/)?explorer\/?$/;
    const inventoryRegex = /^\/?(reports\/)?inventory\/?$/;

    if (method === "GET" && summaryRegex.test(url)) {
      return this.reportPageController.getSummaryReport(res);
    }
    if (method === "GET" && explorerRegex.test(url)) {
      return this.reportPageController.getExplorerPage(res);
    }
    if (
      method === "GET" &&
      (inventoryRegex.test(url) || url === "/api/sync-report")
    ) {
      return this.reportPageController.getInventoryPage(res);
    }

    if (method === "GET" && url === "/api/reports/list") {
      return this.reportDataController.listReports(res);
    }
    if (method === "GET" && url.startsWith("/api/reports/")) {
      const parts = url.slice("/api/reports/".length).split("/");
      const format = parts[0];
      const filename = parts[1];
      if (!filename) {
        res.writeHead(400);
        res.end("Missing filename");
        return;
      }
      const runId = filename
        .replace(/^report_/, "")
        .replace(/\.(html|json)$/, "");
      if (format === "html") {
        return this.reportPageController.getReportHtml(runId, res);
      } else {
        return this.reportDataController.getReportJson(runId, res);
      }
    }
    // (Legacy inventory route handled above)

    // 7. Exports
    if (
      (method === "GET" || method === "HEAD") &&
      url.startsWith("/api/download-file")
    ) {
      return this.exportController.downloadFile(req.url || url, res, method);
    }
    if (method === "POST" && url === "/api/export-zip") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      const parsed = JSON.parse(body);
      return this.exportController.exportZip(parsed, res);
    }
    if (method === "POST" && url === "/api/export-results-by-runs") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      const parsed = JSON.parse(body);
      return this.exportController.exportResultsByRuns(parsed, res);
    }
    if (url === "/api/export-all-extractions") {
      return this.exportController.exportAllExtractions(res);
    }

    // 8. Configuration
    if (method === "GET" && url === "/api/config") {
      return this.projectController.getConfig(res);
    }
    if (method === "GET" && url === "/api/email-config") {
      return this.projectController.getEmailConfig(res);
    }
    if (method === "POST" && url === "/api/email-config") {
      const body = (await this.readBody(req).catch(() => "{}")) ?? "{}";
      return this.projectController.saveEmailConfig(body, res);
    }

    // 404 Fallback
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }
}
