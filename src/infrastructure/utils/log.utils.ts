// LogUtils.ts — schedule log helpers retired.
// Schedule audit logs are now stored in the `schedule_logs` SQLite table
// via SqliteExtractionRecordRepository.appendScheduleLog() / getScheduleLogs().

export const SCHEDULE_LOG_MAX_ENTRIES = 500;
