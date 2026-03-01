import { ServerResponse } from "node:http";
import { DashboardController } from "./dashboard.controller.js";
import { loadHistoricalRunSummaries } from "../presenters/report.js";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";
import { PageLayout } from "../../infrastructure/views/page-layout.js";
import { RunSummaryView } from "../../infrastructure/views/run-summary.view.js";

export class ReportPageController {
  constructor(
    private dashboardController: DashboardController,
    private recordRepo: IExtractionRecordRepository,
    private appConfig: any,
    private staticAssets: { logo: string; smallLogo: string; favIcon: string },
    private brandPurchasers: Record<string, string[]>,
  ) {}

  async getReportHtml(runId: string, res: ServerResponse) {
    try {
      const allSummaries = await loadHistoricalRunSummaries(
        this.recordRepo,
        this.appConfig,
      );
      const summaries = allSummaries.filter((s) => s.runId === runId);

      if (summaries.length === 0) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Report for run ${runId} not found`);
        return;
      }

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
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Error generating report: " + (e.message || "Unknown error"));
    }
  }

  async getSummaryReport(res: ServerResponse) {
    try {
      const summaries = await loadHistoricalRunSummaries(
        this.recordRepo,
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
}
