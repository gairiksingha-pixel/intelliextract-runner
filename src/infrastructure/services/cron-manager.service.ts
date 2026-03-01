import cron from "node-cron";
import { ProcessOrchestrator } from "./process-orchestrator.service.js";
import { IRunStatusStore } from "../../core/domain/services/run-status-store.service.js";
import { IScheduleRepository } from "../../core/domain/repositories/schedule.repository.js";
import { IExtractionRecordRepository } from "../../core/domain/repositories/extraction-record.repository.js";
import { IRunStateService } from "../../core/domain/services/run-state.service.js";
import { getPairsForSchedule } from "../utils/tenant.utils.js";
import { SCHEDULE_TIMEZONES } from "../views/constants.js";
import { ChildProcess } from "node:child_process";
import { hasOverlap } from "../utils/concurrency.utils.js";

export class CronManager {
  private activeCronJobs = new Map<string, any>();
  private childProcesses = new Map<string, ChildProcess>();

  constructor(
    private orchestrator: ProcessOrchestrator,
    private runStatusStore: IRunStatusStore,
    private scheduleRepo: IScheduleRepository,
    private runStateService: IRunStateService,
    private recordRepo: IExtractionRecordRepository,
    private brandPurchaserMap: Record<string, string[]>,
    private resumeCapableCases: Set<string>,
  ) {}

  async bootstrap() {
    const list = await this.scheduleRepo.getSchedules();
    list.forEach((s) => this.registerJob(s));
  }

  registerJob(schedule: any) {
    if (!schedule.cron || !cron.validate(schedule.cron)) {
      this.recordRepo.appendScheduleLog({
        outcome: "skipped",
        level: "error",
        message: "Invalid cron expression",
        scheduleId: schedule.id,
        cron: schedule.cron,
      });
      return;
    }

    if (!SCHEDULE_TIMEZONES.includes(schedule.timezone)) {
      this.recordRepo.appendScheduleLog({
        outcome: "skipped",
        level: "warn",
        message: "Invalid timezone for schedule; skipping",
        scheduleId: schedule.id,
        timezone: schedule.timezone,
      });
      return;
    }

    if (this.activeCronJobs.has(schedule.id)) {
      try {
        this.activeCronJobs.get(schedule.id).stop();
      } catch (_) {}
      this.activeCronJobs.delete(schedule.id);
    }

    const task = cron.schedule(
      schedule.cron,
      async () => {
        const start = new Date().toISOString();
        const caseId = "PIPE";
        const activeRuns = this.runStatusStore.getActiveRuns();

        // Calculate the scope for this scheduled job
        const jobPairs = getPairsForSchedule(
          schedule.brands || [],
          schedule.purchasers || [],
          this.brandPurchaserMap,
        );
        const jobScope = { pairs: jobPairs };

        // Check for any overlapping active run
        const overlappingRun = activeRuns.find((r) =>
          hasOverlap(jobScope, r.params || {}),
        );

        if (overlappingRun) {
          const runType =
            overlappingRun.origin === "manual" ? "manual" : "scheduled";
          this.recordRepo.appendScheduleLog({
            timestamp: start,
            outcome: "skipped",
            level: "warn",
            message: `Scheduled job skipped — a ${runType} process (${overlappingRun.caseId}) for overlapping brands/purchasers is already running`,
            scheduleId: schedule.id,
            overlappingRun: overlappingRun.caseId,
          });
          return;
        }

        let pausedCase: string | undefined;
        for (const cid of this.resumeCapableCases) {
          const state = await this.runStateService.getRunState(cid);
          if (state && state.status === "stopped") {
            pausedCase = cid;
            break;
          }
        }

        if (pausedCase) {
          this.recordRepo.appendScheduleLog({
            outcome: "skipped",
            level: "warn",
            message: `Scheduled job skipped — a process (${pausedCase}) is in paused (resume) mode`,
            scheduleId: schedule.id,
            skippedAt: start,
            pausedCase,
          });
          return;
        }

        const now = new Date().toISOString();
        this.recordRepo.appendScheduleLog({
          timestamp: now,
          outcome: "executed",
          level: "info",
          message: "Scheduled job started",
          scheduleId: schedule.id,
          start: now,
        });

        const pairs = getPairsForSchedule(
          schedule.brands || [],
          schedule.purchasers || [],
          this.brandPurchaserMap,
        );
        const params: any = {};
        if (pairs.length > 0) {
          params.pairs = pairs;
        }

        const activeRunKey = `${caseId}:scheduled`;
        const runInfo: any = {
          caseId,
          params,
          startTime: now,
          status: "running",
          scheduled: true,
          origin: "scheduled",
          scheduleId: schedule.id,
        };

        this.runStatusStore.registerRun(runInfo);

        try {
          const result = await this.orchestrator.runCase(
            caseId,
            params,
            {
              onChild: (child) => {
                this.childProcesses.set(activeRunKey, child);
              },
              onProgress: (percent, done, total) => {
                runInfo.status = "extracting"; // percent progress is used for extraction overall
                runInfo.progress = { percent, done, total };
              },
              onSyncProgress: (done, total) => {
                runInfo.status = "syncing";
                runInfo.syncProgress = { done, total };
              },
              onExtractionProgress: (done, total) => {
                runInfo.status = "extracting";
                runInfo.extractProgress = { done, total };
              },
            },
            null,
          );

          this.runStatusStore.unregisterRun(caseId);
          this.childProcesses.delete(activeRunKey);

          this.recordRepo.appendScheduleLog({
            timestamp: new Date().toISOString(),
            outcome: "executed",
            level: "info",
            message: "Scheduled job finished",
            scheduleId: schedule.id,
            exitCode: result.exitCode,
            start: now,
            finishedAt: new Date().toISOString(),
          });
        } catch (e: any) {
          this.runStatusStore.unregisterRun(caseId);
          this.childProcesses.delete(activeRunKey);

          this.recordRepo.appendScheduleLog({
            timestamp: new Date().toISOString(),
            outcome: "executed",
            level: "error",
            message: "Scheduled job failed",
            scheduleId: schedule.id,
            error: e && e.message ? e.message : String(e),
            start: now,
            finishedAt: new Date().toISOString(),
          });
        }
      },
      { timezone: schedule.timezone } as any,
    );

    this.activeCronJobs.set(schedule.id, task);
  }

  getActiveChildProcess(key: string): ChildProcess | undefined {
    return this.childProcesses.get(key);
  }

  stopJob(id: string) {
    if (this.activeCronJobs.has(id)) {
      try {
        this.activeCronJobs.get(id).stop();
      } catch (_) {}
      this.activeCronJobs.delete(id);
    }
  }
}
