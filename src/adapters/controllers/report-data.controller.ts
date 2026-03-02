import { ServerResponse } from "node:http";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";
import { loadHistoricalRunSummaries } from "../presenters/report.js";
import { Config } from "../../core/domain/entities/config.entity.js";

export class ReportDataController {
  constructor(
    private recordRepo: IExtractionRecordRepository,
    private appConfig: Config,
  ) {}

  async listReports(res: ServerResponse) {
    try {
      const runIds = await this.recordRepo.getAllRunIdsOrdered();
      const list = {
        html: runIds.map((id) => ({ name: `report_${id}.html`, runId: id })),
        json: runIds.map((id) => ({ name: `report_${id}.json`, runId: id })),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(list));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg || "Unknown error" }));
    }
  }

  async getReportJson(runId: string, res: ServerResponse) {
    try {
      const allSummaries = await loadHistoricalRunSummaries(
        this.recordRepo,
        this.appConfig,
      );
      const summaries = allSummaries.filter(
        (s) =>
          s.runId === runId ||
          (s.sessions || []).some((sess) => sess.runId === runId),
      );

      if (summaries.length === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Report for run ${runId} not found` }));
        return;
      }

      const { buildReportJsonPayload } =
        await import("../presenters/report.js");
      const jsonPayload = buildReportJsonPayload(summaries);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="report_${runId}.json"`,
      });
      res.end(JSON.stringify(jsonPayload, null, 2));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg || "Unknown error" }));
    }
  }
}
