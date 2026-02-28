import { ServerResponse } from "node:http";
import { IScheduleRepository } from "../../core/domain/repositories/schedule.repository.js";
import { ICheckpointRepository } from "../../core/domain/repositories/checkpoint.repository.js";
import { CronManager } from "../../infrastructure/services/cron-manager.service.js";
import { SCHEDULE_TIMEZONES } from "../../infrastructure/views/constants.js";
import { scheduleId } from "../../infrastructure/utils/id.utils.js";
import cron from "node-cron";

export class ScheduleController {
  constructor(
    private scheduleRepo: IScheduleRepository,
    private cronManager: CronManager,
    private checkpointRepo: ICheckpointRepository,
  ) {}

  async getSchedules(res: ServerResponse) {
    try {
      const list = await this.scheduleRepo.getSchedules();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ schedules: list, timezones: SCHEDULE_TIMEZONES }),
      );
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async addSchedule(body: string, res: ServerResponse) {
    try {
      const {
        brands,
        purchasers,
        cron: cronExpr,
        timezone,
      } = JSON.parse(body || "{}");
      const brandList = Array.isArray(brands)
        ? brands.filter(
            (b): b is string => typeof b === "string" && b.trim() !== "",
          )
        : [];
      const purchaserList = Array.isArray(purchasers)
        ? purchasers.filter(
            (p): p is string => typeof p === "string" && p.trim() !== "",
          )
        : [];

      if (brandList.length === 0 && purchaserList.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Please select at least one brand or purchaser.",
          }),
        );
        return;
      }
      if (
        !cronExpr ||
        typeof cronExpr !== "string" ||
        !cron.validate(cronExpr)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid cron expression." }));
        return;
      }
      const list = await this.scheduleRepo.getSchedules();
      if (list.some((s) => s.cron === cronExpr && s.timezone === timezone)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "A schedule for this time already exists." }),
        );
        return;
      }
      const sched = {
        id: scheduleId(),
        createdAt: new Date().toISOString(),
        brands: brandList,
        purchasers: purchaserList,
        cron: cronExpr,
        timezone: timezone || "UTC",
      };
      await this.scheduleRepo.addSchedule(sched);
      this.cronManager.registerJob(sched);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(sched));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async updateSchedule(id: string, body: string, res: ServerResponse) {
    try {
      const {
        brands,
        purchasers,
        cron: cronExpr,
        timezone,
      } = JSON.parse(body || "{}");
      const brandList = Array.isArray(brands)
        ? brands.filter(
            (b): b is string => typeof b === "string" && b.trim() !== "",
          )
        : [];
      const purchaserList = Array.isArray(purchasers)
        ? purchasers.filter(
            (p): p is string => typeof p === "string" && p.trim() !== "",
          )
        : [];

      if (brandList.length === 0 && purchaserList.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Please select at least one brand or purchaser.",
          }),
        );
        return;
      }
      if (
        !cronExpr ||
        typeof cronExpr !== "string" ||
        !cron.validate(cronExpr)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              "Invalid cron expression. Use standard 5-field syntax like '0 * * * *'.",
          }),
        );
        return;
      }
      if (
        !timezone ||
        typeof timezone !== "string" ||
        !SCHEDULE_TIMEZONES.includes(timezone)
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Invalid timezone. Please choose a value from the dropdown.",
          }),
        );
        return;
      }

      const list = await this.scheduleRepo.getSchedules();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Schedule not found" }));
        return;
      }
      if (
        list.some(
          (s, i) => i !== idx && s.cron === cronExpr && s.timezone === timezone,
        )
      ) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "A schedule for this time and timezone already exists.",
          }),
        );
        return;
      }
      const updated = {
        ...list[idx],
        brands: brandList,
        purchasers: purchaserList,
        cron: cronExpr,
        timezone: timezone || "UTC",
      };
      await this.scheduleRepo.updateSchedule(updated);
      this.cronManager.registerJob(updated);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(updated));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  async deleteSchedule(id: string, res: ServerResponse) {
    try {
      this.cronManager.stopJob(id);
      await this.scheduleRepo.deleteSchedule(id);
      res.writeHead(204);
      res.end();
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }

  getLogEntries(url: string, res: ServerResponse) {
    try {
      const urlObj = new URL(url, "http://localhost");
      const page = parseInt(urlObj.searchParams.get("page") || "1", 10);
      const limit = parseInt(urlObj.searchParams.get("limit") || "20", 10);
      const allEntries = this.checkpointRepo.getScheduleLogs(500);
      const total = allEntries.length;
      const startIndex = (page - 1) * limit;
      const entries = allEntries.slice(startIndex, startIndex + limit);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries, total, page, limit }));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
  }
}
