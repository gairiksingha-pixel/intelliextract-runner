import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join, normalize, extname } from "node:path";
import { ServerResponse } from "node:http";
import { DashboardController } from "./dashboard.controller.js";
import { IRunStatusStore } from "../../core/domain/services/run-status-store.service.js";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";
import { IRunStateService } from "../../core/domain/services/run-state.service.js";
import { INotificationService } from "../../core/domain/services/notification.service.js";
import { ProcessOrchestrator } from "../../infrastructure/services/process-orchestrator.service.js";
import { listStagingFiles } from "../../infrastructure/utils/storage.utils.js";

export class ProjectController {
  private MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".js": "application/javascript",
    ".css": "text/css",
    ".html": "text/html",
  };

  constructor(
    private dashboardController: DashboardController,
    private runStatusStore: IRunStatusStore,
    private recordRepo: IExtractionRecordRepository,
    private runStateService: IRunStateService,
    private notificationService: INotificationService,
    private orchestrator: ProcessOrchestrator,
    private rootDir: string,
    private stagingDir: string,
    private brandPurchasers: Record<string, string[]>,
    private resumeCapableCases: Set<string>,
    private staticAssets: { logo: string; smallLogo: string; favIcon: string },
  ) {}

  async getHomePage(res: ServerResponse) {
    try {
      const html = await this.dashboardController.getHomePage({
        ...this.staticAssets,
        brandPurchasers: this.brandPurchasers,
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error generating home page: " + (e.message || "Unknown error"));
    }
  }

  ping(res: ServerResponse) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "pong" }));
  }

  async getAssets(url: string, res: ServerResponse) {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(url.slice(1));
    } catch (_) {
      decodedPath = url.slice(1);
    }
    const assetsDir = resolve(this.rootDir, "assets");
    let filePath = resolve(this.rootDir, normalize(decodedPath));
    if (!filePath.startsWith(assetsDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (!existsSync(filePath)) {
        if (url === "/assets/logo.png" || url.startsWith("/assets/logo")) {
          if (existsSync(assetsDir)) {
            const files = readdirSync(assetsDir);
            const png = files.find((f) => f.toLowerCase().endsWith(".png"));
            if (png) filePath = join(assetsDir, png);
          }
        }
      }
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const data = readFileSync(filePath);
      const mime = this.MIME[extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
  }

  async getConfig(res: ServerResponse) {
    try {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ brandPurchasers: this.brandPurchasers }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async getEmailConfig(res: ServerResponse) {
    try {
      const config = await this.recordRepo.getEmailConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async saveEmailConfig(body: string, res: ServerResponse) {
    try {
      const data = JSON.parse(body || "{}");
      if (data.recipientEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emails = data.recipientEmail
          .split(",")
          .map((e: string) => e.trim());
        for (const email of emails) {
          if (!email || !emailRegex.test(email)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Invalid email address format: " + email,
              }),
            );
            return;
          }
        }
      }
      await this.recordRepo.saveEmailConfig(data);
      this.notificationService.updateConfig(data);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async getActiveRuns(res: ServerResponse) {
    try {
      const runs = this.runStatusStore.getActiveRuns();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ activeRuns: runs }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async getRunStatus(url: string, res: ServerResponse) {
    try {
      const urlObj = new URL(url, "http://localhost");
      const queryCaseId = urlObj.searchParams.get("caseId");

      if (queryCaseId) {
        const state = await this.runStateService.getRunState(queryCaseId);
        const isRegistered = this.runStatusStore.isActive(queryCaseId);
        const hasProcess =
          !!this.orchestrator.getActiveChildProcess(queryCaseId);
        const isActive = isRegistered && hasProcess;

        // Resumable if we have a state and it's not currently active (either stopped normally or interrupted)
        const canResume =
          state &&
          (state.status === "stopped" || state.status === "running") &&
          !isActive &&
          this.resumeCapableCases.has(queryCaseId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            caseId: queryCaseId,
            isRunning: isActive,
            canResume,
            state: state || {},
          }),
        );
      } else {
        const pipelineStatus = await this.recordRepo.getRunStatus();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pipelineStatus));
      }
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async stopRun(body: string, res: ServerResponse) {
    try {
      const { caseId, origin } = JSON.parse(body || "{}");
      if (!caseId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing caseId" }));
        return;
      }

      const runKey = origin === "scheduled" ? `${caseId}:scheduled` : caseId;
      const success = this.orchestrator.stopProcess(runKey);

      if (success) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, message: "Stop signal sent" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Process not found", runKey }));
      }
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async clearRunState(body: string, res: ServerResponse) {
    try {
      const { caseId } = JSON.parse(body || "{}");
      if (caseId && typeof caseId === "string") {
        this.runStateService.clearRunState(caseId);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async getStagingStats(res: ServerResponse) {
    try {
      const files = listStagingFiles(this.stagingDir, this.stagingDir, []);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ count: files.length }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }
}
