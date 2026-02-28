export interface Schedule {
  id: string;
  createdAt: string;
  brands: string[];
  purchasers: string[];
  cron: string;
  timezone: string;
}
