import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Schedule } from "../../core/domain/entities/schedule.entity.js";
import { IScheduleRepository } from "../../core/domain/repositories/schedule.repository.js";

export class SqliteScheduleRepository implements IScheduleRepository {
  private _db: Database.Database | null = null;

  constructor(private dbPath: string) {}

  private getDb() {
    if (this._db) return this._db;
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this._db = new Database(this.dbPath);
    this._db.pragma("journal_mode = DELETE");
    this._db.pragma("synchronous = FULL");
    this._db.pragma("busy_timeout = 5000");
    return this._db;
  }

  async getSchedules(): Promise<Schedule[]> {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM tbl_cron_schedules ORDER BY created_at DESC")
      .all();
    return rows.map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      brands: JSON.parse(r.brands),
      purchasers: JSON.parse(r.purchasers),
      cron: r.cron,
      timezone: r.timezone,
    }));
  }

  async saveSchedules(schedules: Schedule[]): Promise<void> {
    const db = this.getDb();
    db.transaction(() => {
      db.prepare("DELETE FROM tbl_cron_schedules").run();
      const insert = db.prepare(`
        INSERT INTO tbl_cron_schedules (id, created_at, brands, purchasers, cron, timezone)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const s of schedules) {
        insert.run(
          s.id,
          s.createdAt,
          JSON.stringify(s.brands),
          JSON.stringify(s.purchasers),
          s.cron,
          s.timezone,
        );
      }
    })();
  }

  async addSchedule(schedule: Schedule): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `
      INSERT INTO tbl_cron_schedules (id, created_at, brands, purchasers, cron, timezone)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(
      schedule.id,
      schedule.createdAt,
      JSON.stringify(schedule.brands),
      JSON.stringify(schedule.purchasers),
      schedule.cron,
      schedule.timezone,
    );
  }

  async updateSchedule(schedule: Schedule): Promise<void> {
    const db = this.getDb();
    db.prepare(
      `
      UPDATE tbl_cron_schedules
      SET brands = ?, purchasers = ?, cron = ?, timezone = ?
      WHERE id = ?
    `,
    ).run(
      JSON.stringify(schedule.brands),
      JSON.stringify(schedule.purchasers),
      schedule.cron,
      schedule.timezone,
      schedule.id,
    );
  }

  async deleteSchedule(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM tbl_cron_schedules WHERE id = ?").run(id);
  }
}
