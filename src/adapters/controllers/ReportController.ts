import { existsSync, createReadStream, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import { ServerResponse } from "node:http";
// @ts-ignore
import archiver from "archiver";
import { DashboardController } from "./DashboardController.js";
import {
  loadHistoricalRunSummaries,
  htmlReportFromHistory,
} from "../presenters/report.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";
import { PageLayout } from "../../infrastructure/views/PageLayout.js";
import { RunSummaryView } from "../../infrastructure/views/RunSummaryView.js";

export class ReportController {
  constructor(
    private dashboardController: DashboardController,
    private reportsDir: string,
    private extractionsDir: string,
    private stagingDir: string,
    private rootDir: string,
    private checkpointRepo: ICheckpointRepository,
    private appConfig: any,
    private staticAssets: { logo: string; smallLogo: string; favIcon: string },
    private brandPurchasers: Record<string, string[]>,
  ) {}

  async listReports(res: ServerResponse) {
    try {
      const runIds = await this.checkpointRepo.getAllRunIdsOrdered();

      const list = {
        html: runIds.map((id) => ({ name: `report_${id}.html`, runId: id })),
        json: runIds.map((id) => ({ name: `report_${id}.json`, runId: id })),
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || "Unknown error") }));
    }
  }

  async getReportFile(url: string, res: ServerResponse) {
    const rest = url.slice("/api/reports/".length);
    const slash = rest.indexOf("/");
    const format = slash === -1 ? rest : rest.slice(0, slash);
    let filename = slash === -1 ? null : rest.slice(slash + 1);

    if (!filename || !["html", "json"].includes(format)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Invalid report format or missing runId" }),
      );
      return;
    }

    // Extract runId from filename like report_RUN_ID.html
    let runId = filename.replace(/^report_/, "").replace(/\.(html|json)$/, "");

    try {
      const allSummaries = await loadHistoricalRunSummaries(
        this.checkpointRepo,
        this.appConfig,
      );
      const summaries = allSummaries.filter((s) => s.runId === runId);

      if (summaries.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Report for run ${runId} not found` }));
        return;
      }

      if (format === "html") {
        const props = {
          totalAll: summaries.length,
          totalSuccess: summaries.filter((s) => s.metrics.failed === 0).length,
          totalFailed: summaries.filter((s) => s.metrics.failed > 0).length,
        };

        const content = RunSummaryView.render(props);
        const styles = RunSummaryView.getStyles();
        const scripts = `
          <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
          <script>window.SUMMARY_DATA = ${JSON.stringify(summaries).replace(/</g, "\\u003c")};</script>
          <script type="module" src="/assets/js/run-summary.js"></script>
        `;

        const html = PageLayout({
          title: `Report - ${runId}`,
          content,
          styles,
          scripts,
          ...this.staticAssets,
          showSidebar: false,
        });

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        const { buildReportJsonPayload } =
          await import("../presenters/report.js");
        const jsonPayload = buildReportJsonPayload(summaries);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="report_${runId}.json"`,
        });
        res.end(JSON.stringify(jsonPayload, null, 2));
      }
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || "Unknown error") }));
    }
  }

  async getSummaryReport(res: ServerResponse) {
    try {
      const summaries = await loadHistoricalRunSummaries(
        this.checkpointRepo,
        this.appConfig,
      );

      const props = {
        totalAll: summaries.length,
        totalSuccess: summaries.filter((s) => s.metrics.failed === 0).length,
        totalFailed: summaries.filter((s) => s.metrics.failed > 0).length,
      };

      const content = RunSummaryView.render(props);
      const styles = RunSummaryView.getStyles();
      const scripts = `
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
        <script>window.SUMMARY_DATA = ${JSON.stringify(summaries).replace(/</g, "\\u003c")};</script>
        <script type="module" src="/assets/js/run-summary.js"></script>
      `;

      const html = PageLayout({
        title: "Run Summary Report",
        content,
        styles,
        scripts,
        ...this.staticAssets,
        activeTab: "summary",
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(
        "Error generating summary report: " + (e.message || "Unknown error"),
      );
    }
  }

  async getExplorerPage(res: ServerResponse) {
    try {
      const html = await this.dashboardController.getExplorerPage({
        ...this.staticAssets,
        brandPurchasers: this.brandPurchasers,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(
        "Error generating explorer page: " + (e.message || "Unknown error"),
      );
    }
  }

  async getInventoryPage(res: ServerResponse) {
    try {
      const html = await this.dashboardController.getInventoryPage({
        ...this.staticAssets,
        brandPurchasers: this.brandPurchasers,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(
        "Error generating inventory report: " + (e.message || "Unknown error"),
      );
    }
  }

  async downloadFile(url: string, res: ServerResponse) {
    try {
      const q = new URL(url, "http://localhost").searchParams;
      const fileId = q.get("file");
      if (!fileId) throw new Error("File path is required");

      const fullPath = resolve(this.rootDir, fileId);
      if (
        !fullPath.startsWith(resolve(this.extractionsDir)) &&
        !fullPath.startsWith(resolve(this.stagingDir)) &&
        !fullPath.startsWith(resolve(this.reportsDir))
      ) {
        res.writeHead(403);
        res.end("Access denied");
        return;
      }

      if (!existsSync(fullPath)) {
        res.writeHead(404);
        res.end("File not found");
        return;
      }

      const filename = basename(fullPath);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      createReadStream(fullPath).pipe(res);
    } catch (e: any) {
      res.writeHead(500);
      res.end(e.message || "Unknown error");
    }
  }

  async exportZip(body: string, res: ServerResponse) {
    try {
      const { files, zipName } = JSON.parse(body);
      if (!Array.isArray(files) || files.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid 'files' array" }));
        return;
      }
      const finalZipName = (zipName || "export") + ".zip";

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${finalZipName.replace(/"/g, '\\"')}"`,
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: any) => {
        if (!res.writableEnded) res.end();
      });
      archive.pipe(res);

      const allowedResolve = [
        this.reportsDir,
        this.extractionsDir,
        this.stagingDir,
      ].map((d) => resolve(d));

      for (const f of files) {
        const absPath = resolve(this.rootDir, f);
        const isAllowed = allowedResolve.some((dir) => absPath.startsWith(dir));
        if (isAllowed && existsSync(absPath) && statSync(absPath).isFile()) {
          archive.file(absPath, { name: basename(absPath) });
        }
      }
      archive.finalize();
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: String(e.message || "Unknown error") }),
        );
      }
    }
  }

  async exportResultsByRuns(body: string, res: ServerResponse) {
    try {
      const { runIds } = JSON.parse(body);
      if (!Array.isArray(runIds) || runIds.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing or invalid 'runIds' array" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="run_results_${Date.now()}.zip"`,
      });

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err: any) => {
        if (!res.writableEnded) res.end();
      });
      archive.pipe(res);

      for (const runId of runIds) {
        const records = await this.checkpointRepo.getRecordsForRun(runId);
        for (const r of records) {
          if (!r.fullResponse) continue;

          const safe = (r.relativePath || "")
            .replaceAll("/", "_")
            .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
          const base = r.brand + "_" + (safe || "file");
          const jsonName = base.endsWith(".json") ? base : base + ".json";

          // Add as virtual file to zip
          archive.append(JSON.stringify(r.fullResponse, null, 2), {
            name: (r.status === "done" ? "succeeded/" : "failed/") + jsonName,
          });
        }
      }

      archive.finalize();
    } catch (e: any) {
      if (!res.writableEnded) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: String(e.message || "Unknown error") }),
        );
      }
    }
  }

  async exportAllExtractions(res: ServerResponse) {
    try {
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="extractions.zip"',
      });
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      const records = await this.checkpointRepo.getAllCheckpoints();
      for (const r of records) {
        if (!r.fullResponse) continue;

        const safe = (r.relativePath || "")
          .replaceAll("/", "_")
          .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
        const base = r.brand + "_" + (safe || "file");
        const jsonName = base.endsWith(".json") ? base : base + ".json";

        archive.append(JSON.stringify(r.fullResponse, null, 2), {
          name: (r.status === "done" ? "succeeded/" : "failed/") + jsonName,
        });
      }

      archive.finalize();
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || "Unknown error") }));
    }
  }
}
