import cron from "node-cron";
import { ProcessOrchestrator } from "./ProcessOrchestrator.js";
import { IRunStatusStore } from "../../core/domain/services/IRunStatusStore.js";
import { IScheduleRepository } from "../../core/domain/repositories/IScheduleRepository.js";
import { RunStateService } from "./RunStateService.js";
import { getPairsForSchedule } from "../utils/TenantUtils.js";
import { appendScheduleLog } from "../utils/LogUtils.js";
import { SCHEDULE_TIMEZONES } from "../views/Constants.js";
import { ChildProcess } from "node:child_process";

export class CronManager {
  private activeCronJobs = new Map<string, any>();
  private childProcesses = new Map<string, ChildProcess>();

  constructor(
    private orchestrator: ProcessOrchestrator,
    private runStatusStore: IRunStatusStore,
    private scheduleRepo: IScheduleRepository,
    private runStateService: RunStateService,
    private logPath: string,
    private brandPurchaserMap: Record<string, string[]>,
    private resumeCapableCases: Set<string>,
  ) {}

  async bootstrap() {
    const list = await this.scheduleRepo.getSchedules();
    list.forEach((s) => this.registerJob(s));
  }

  registerJob(schedule: any) {
    if (!schedule.cron || !cron.validate(schedule.cron)) {
      appendScheduleLog(this.logPath, {
        outcome: "skipped",
        level: "error",
        message: "Invalid cron expression",
        scheduleId: schedule.id,
        cron: schedule.cron,
      });
      return;
    }

    if (!SCHEDULE_TIMEZONES.includes(schedule.timezone)) {
      appendScheduleLog(this.logPath, {
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
        const caseId = "PIPE";
        const start = new Date().toISOString();

        const activeRuns = this.runStatusStore.getActiveRuns();
        const manualRunning = activeRuns.find(
          (r: any) => !r.scheduled && r.origin !== "scheduled",
        );

        if (manualRunning) {
          appendScheduleLog(this.logPath, {
            outcome: "skipped",
            level: "warn",
            message: `Scheduled job skipped — a manual process (${manualRunning.caseId}) is currently running`,
            scheduleId: schedule.id,
            skippedAt: start,
            activeManualCase: manualRunning.caseId,
          });
          return;
        }

        const pausedCase = Array.from(this.resumeCapableCases).find((cid) => {
          const state = this.runStateService.getRunState(cid);
          return state && state.status === "stopped";
        });

        if (pausedCase) {
          appendScheduleLog(this.logPath, {
            outcome: "skipped",
            level: "warn",
            message: `Scheduled job skipped — a process (${pausedCase}) is in paused (resume) mode`,
            scheduleId: schedule.id,
            skippedAt: start,
            pausedCase,
          });
          return;
        }

        appendScheduleLog(this.logPath, {
          outcome: "executed",
          level: "info",
          message: "Scheduled job started",
          scheduleId: schedule.id,
          start,
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
          startTime: start,
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
                runInfo.progress = { percent, done, total };
              },
              onSyncProgress: (done, total) => {
                runInfo.syncProgress = { done, total };
              },
              onExtractionProgress: (done, total) => {
                runInfo.extractProgress = { done, total };
              },
            },
            null,
          );

          this.runStatusStore.unregisterRun(caseId); // Note: key in store is caseId check IRunStatusStore
          this.childProcesses.delete(activeRunKey);

          appendScheduleLog(this.logPath, {
            outcome: "executed",
            level: "info",
            message: "Scheduled job finished",
            scheduleId: schedule.id,
            exitCode: result.exitCode,
          });
        } catch (e: any) {
          this.runStatusStore.unregisterRun(caseId);
          this.childProcesses.delete(activeRunKey);

          appendScheduleLog(this.logPath, {
            outcome: "executed",
            level: "error",
            message: "Scheduled job failed",
            scheduleId: schedule.id,
            error: e && e.message ? e.message : String(e),
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
