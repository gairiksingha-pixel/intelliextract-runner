import { Schedule } from "../entities/Schedule.js";

export interface IScheduleRepository {
  getSchedules(): Promise<Schedule[]>;
  saveSchedules(schedules: Schedule[]): Promise<void>;
  addSchedule(schedule: Schedule): Promise<void>;
  updateSchedule(schedule: Schedule): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
}
