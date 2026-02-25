import Database from "better-sqlite3";
import { Schedule } from "../../core/domain/entities/Schedule.js";
import { IScheduleRepository } from "../../core/domain/repositories/IScheduleRepository.js";

export class SqliteScheduleRepository implements IScheduleRepository {
  constructor(private dbPath: string) {}

  private getDb() {
    return new Database(this.dbPath);
  }

  async getSchedules(): Promise<Schedule[]> {
    const db = this.getDb();
    try {
      const rows = db
        .prepare("SELECT * FROM schedules ORDER BY created_at DESC")
        .all();
      return rows.map((r: any) => ({
        id: r.id,
        createdAt: r.created_at,
        brands: JSON.parse(r.brands),
        purchasers: JSON.parse(r.purchasers),
        cron: r.cron,
        timezone: r.timezone,
      }));
    } finally {
      db.close();
    }
  }

  async saveSchedules(schedules: Schedule[]): Promise<void> {
    const db = this.getDb();
    try {
      db.transaction(() => {
        db.prepare("DELETE FROM schedules").run();
        const insert = db.prepare(`
          INSERT INTO schedules (id, created_at, brands, purchasers, cron, timezone)
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
    } finally {
      db.close();
    }
  }

  async addSchedule(schedule: Schedule): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `
        INSERT INTO schedules (id, created_at, brands, purchasers, cron, timezone)
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
    } finally {
      db.close();
    }
  }

  async updateSchedule(schedule: Schedule): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare(
        `
        UPDATE schedules 
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
    } finally {
      db.close();
    }
  }

  async deleteSchedule(id: string): Promise<void> {
    const db = this.getDb();
    try {
      db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
    } finally {
      db.close();
    }
  }
}
