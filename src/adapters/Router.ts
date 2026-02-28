import { IncomingMessage, ServerResponse } from "node:http";
import { ExtractionController } from "./controllers/ExtractionController.js";
import { ScheduleController } from "./controllers/ScheduleController.js";
import { ReportController } from "./controllers/ReportController.js";
import { ProjectController } from "./controllers/ProjectController.js";

export class Router {
  constructor(
    private extractionController: ExtractionController,
    private scheduleController: ScheduleController,
    private reportController: ReportController,
    private projectController: ProjectController,
  ) {}

  async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url?.split("?")[0] || "/";
    const method = req.method;

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
      let body = "";
      for await (const chunk of req) body += chunk;
      try {
        const parsed = JSON.parse(body || "{}");
        return this.extractionController.handleRunRequest(parsed, res);
      } catch (e: any) {
        if (!res.writableEnded) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON: " + e.message }));
        }
        return;
      }
    }
    if (method === "POST" && url === "/api/stop-run") {
      let body = "";
      for await (const chunk of req) body += chunk;
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
      let body = "";
      for await (const chunk of req) body += chunk;
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
      let body = "";
      for await (const chunk of req) body += chunk;
      return this.scheduleController.addSchedule(body, res);
    }
    if (method === "PUT" && url.startsWith("/api/schedules/")) {
      let body = "";
      for await (const chunk of req) body += chunk;
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
    if (method === "GET" && url === "/api/reports") {
      return this.reportController.listReports(res);
    }
    if (method === "GET" && url.startsWith("/api/reports/")) {
      return this.reportController.getReportFile(url, res);
    }
    if (method === "GET" && url === "/reports/summary") {
      return this.reportController.getSummaryReport(res);
    }
    if (
      method === "GET" &&
      (url === "/reports/explorer" || url === "/api/extraction-data-page")
    ) {
      return this.reportController.getExplorerPage(res);
    }
    if (
      method === "GET" &&
      (url === "/reports/inventory" || url === "/api/sync-report")
    ) {
      return this.reportController.getInventoryPage(res);
    }
    if (
      (method === "GET" || method === "HEAD") &&
      url === "/api/download-file"
    ) {
      return this.reportController.downloadFile(req.url || url, res);
    }

    // 7. Exports
    if (method === "POST" && url === "/api/export-zip") {
      let body = "";
      for await (const chunk of req) body += chunk;
      return this.reportController.exportZip(body, res);
    }
    if (method === "POST" && url === "/api/export-results-by-runs") {
      let body = "";
      for await (const chunk of req) body += chunk;
      return this.reportController.exportResultsByRuns(body, res);
    }
    if (method === "GET" && url === "/api/extractions-zip") {
      return this.reportController.exportAllExtractions(res);
    }

    // 8. Configuration
    if (method === "GET" && url === "/api/config") {
      return this.projectController.getConfig(res);
    }
    if (method === "GET" && url === "/api/email-config") {
      return this.projectController.getEmailConfig(res);
    }
    if (method === "POST" && url === "/api/email-config") {
      let body = "";
      for await (const chunk of req) body += chunk;
      return this.projectController.saveEmailConfig(body, res);
    }

    // 404 Fallback
    res.writeHead(404);
    res.end();
  }
}
