import { z } from "zod";

/**
 * Validation schemas for all API request bodies.
 * Provides central, reusable, and type-safe validation.
 */

export const RunRequestSchema = z.object({
  caseId: z.string().min(1, "caseId is required"),
  syncLimit: z.number().int().min(0).optional(),
  extractLimit: z.number().int().min(0).optional(),
  tenant: z.string().nullable().optional(),
  purchaser: z.string().nullable().optional(),
  pairs: z
    .array(
      z.object({
        tenant: z.string(),
        purchaser: z.string(),
      }),
    )
    .nullable()
    .optional(),
  retryFailed: z.boolean().optional(),
  skipCompleted: z.boolean().optional(),
  concurrency: z.number().int().min(1).optional(),
  requestsPerSecond: z.number().min(0.1).optional(),
});

export const EmailConfigSchema = z.object({
  recipientEmail: z
    .string()
    .refine((val) => {
      if (!val) return true;
      const emails = val.split(",").map((e) => e.trim());
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emails.every((email) => emailRegex.test(email));
    }, "Invalid email address format")
    .optional(),
  senderEmail: z.string().email().optional(),
  appPassword: z.string().optional(),
});

export const ScheduleSchema = z.object({
  id: z.string().optional(), // ID can be optional during creation
  brands: z
    .string()
    .min(1, "Brands are required (comma-separated string expected)"),
  purchasers: z.string().optional(),
  cron: z.string().min(1, "Cron expression is required"),
  timezone: z.string().optional(),
});

export const ExportByRunsSchema = z.object({
  runIds: z.array(z.string()).min(1, "Select at least one run ID"),
  format: z.enum(["csv", "json"]).optional(),
});

export const ExportZipSchema = z.object({
  runId: z.string().min(1, "runId is required"),
  withFullResponse: z.boolean().optional(),
});
