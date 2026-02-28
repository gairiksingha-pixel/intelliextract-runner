import {
  existsSync,
  readdirSync,
  statSync,
  createReadStream,
  readFileSync,
} from "node:fs";
import { join, extname, resolve, basename } from "node:path";
import { ServerResponse } from "node:http";
// @ts-ignore
import archiver from "archiver";
import { DashboardController } from "./DashboardController.js";
import {
  loadHistoricalRunSummaries,
  htmlReportFromHistory,
} from "../presenters/report.js";
import { ICheckpointRepository } from "../../core/domain/repositories/ICheckpointRepository.js";

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
      const allowedExt = new Set([".html", ".json"]);
      const list: {
        html: { name: string; mtime: number }[];
        json: { name: string; mtime: number }[];
      } = { html: [], json: [] };

      if (!existsSync(this.reportsDir)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list));
        return;
      }

      const files = readdirSync(this.reportsDir, {
        withFileTypes: true,
      }).filter(
        (e) => e.isFile() && allowedExt.has(extname(e.name).toLowerCase()),
      );

      for (const f of files) {
        const ext = extname(f.name).toLowerCase();
        const key = (ext === ".html" ? "html" : "json") as keyof typeof list;
        let mtime = 0;
        try {
          mtime = statSync(join(this.reportsDir, f.name)).mtimeMs;
        } catch (_) {}
        list[key].push({ name: f.name, mtime });
      }

      for (const key of Object.keys(list) as (keyof typeof list)[]) {
        list[key].sort((a, b) => b.mtime - a.mtime);
      }

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
    if (filename) {
      try {
        filename = decodeURIComponent(filename);
      } catch (_) {}
    }
    if (!filename || !["html", "json"].includes(format)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing caseId" }));
      return;
    }
    const filePath = resolve(this.reportsDir, filename);
    if (!filePath.startsWith(resolve(this.reportsDir))) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      const stat = statSync(filePath);
      const contentType = format === "html" ? "text/html" : "application/json";
      if (format === "html") {
        let content = readFileSync(filePath, "utf-8");
        if (!content.includes('rel="icon"')) {
          const faviconHtml = this.staticAssets.favIcon
            ? `<link rel="icon" href="${this.staticAssets.favIcon}" type="image/x-icon">`
            : "";
          content = content.replace("<head>", "<head>\n  " + faviconHtml);
        }
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Length": Buffer.byteLength(content),
        });
        res.end(content);
      } else {
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": stat.size,
          "Content-Disposition":
            'attachment; filename="' + filename.replace(/"/g, '\\"') + '"',
        });
        createReadStream(filePath).pipe(res);
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
      const html = htmlReportFromHistory(summaries, new Date().toISOString());
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

      const allFiles = new Set<string>();

      for (const runId of runIds) {
        const records = await this.checkpointRepo.getRecordsForRun(runId);
        for (const r of records) {
          const safe = (r.relativePath || "")
            .replaceAll("/", "_")
            .replaceAll(/[^a-zA-Z0-9._-]/g, "_");
          const base = r.brand + "_" + (safe || "file");
          const jsonName = base.endsWith(".json") ? base : base + ".json";

          const succPath = resolve(this.extractionsDir, "succeeded", jsonName);
          const failPath = resolve(this.extractionsDir, "failed", jsonName);

          if (existsSync(succPath)) allFiles.add(succPath);
          else if (existsSync(failPath)) allFiles.add(failPath);
        }
      }

      for (const absPath of allFiles) {
        archive.file(absPath, { name: basename(absPath) });
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
      if (!existsSync(this.extractionsDir)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Extractions folder not found." }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="extractions.zip"',
      });
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);
      const succeededDir = join(this.extractionsDir, "succeeded");
      const failedDir = join(this.extractionsDir, "failed");
      if (existsSync(succeededDir))
        archive.directory(succeededDir, "succeeded");
      if (existsSync(failedDir)) archive.directory(failedDir, "failed");
      archive.finalize();
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || "Unknown error") }));
    }
  }
}
