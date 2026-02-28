import { ServerResponse } from "node:http";
import { ICheckpointRepository } from "../../core/domain/repositories/checkpoint.repository.js";
import { loadHistoricalRunSummaries } from "../presenters/report.js";

export class ReportDataController {
  constructor(
    private checkpointRepo: ICheckpointRepository,
    private appConfig: any,
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

  async getReportJson(runId: string, res: ServerResponse) {
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

      const { buildReportJsonPayload } =
        await import("../presenters/report.js");
      const jsonPayload = buildReportJsonPayload(summaries);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="report_${runId}.json"`,
      });
      res.end(JSON.stringify(jsonPayload, null, 2));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message || "Unknown error") }));
    }
  }
}
