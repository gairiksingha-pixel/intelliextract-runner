import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExecuteWorkflowUseCase } from "../src/core/use-cases/execute-workflow.use-case.js";

// --- Mocks ---

const mockSyncBrand = {
  execute: vi
    .fn()
    .mockResolvedValue([
      {
        files: ["/staging/brand-a/file1.pdf"],
        synced: 1,
        skipped: 0,
        errors: 0,
        brand: "brand-a",
        purchaser: "buyer-1",
      },
    ]),
};

const mockRunExtraction = {
  execute: vi.fn().mockResolvedValue(undefined),
};

const mockReporting = {
  execute: vi.fn().mockResolvedValue({ totalFiles: 1, success: 1, failed: 0 }),
};

const mockDiscoverFiles = {
  execute: vi
    .fn()
    .mockReturnValue([
      {
        filePath: "/staging/brand-a/file1.pdf",
        relativePath: "brand-a/file1.pdf",
        brand: "brand-a",
        purchaser: "buyer-1",
      },
    ]),
};

const mockRunStatusStore = {
  registerRun: vi.fn(),
  unregisterRun: vi.fn(),
  isActive: vi.fn().mockReturnValue(false),
  getActiveRuns: vi.fn().mockReturnValue([]),
};

const mockReportGenerationService = {
  generate: vi.fn().mockResolvedValue(undefined),
};

const mockRecordRepo = {
  saveRunSummary: vi.fn().mockResolvedValue(undefined),
};

const STAGING_DIR = "/tmp/staging";

function makeUseCase() {
  return new ExecuteWorkflowUseCase(
    mockSyncBrand as any,
    mockRunExtraction as any,
    mockReporting as any,
    mockDiscoverFiles as any,
    mockRunStatusStore as any,
    STAGING_DIR,
    mockReportGenerationService as any,
    mockRecordRepo as any,
  );
}

describe("ExecuteWorkflowUseCase", () => {
  let updates: any[];

  beforeEach(() => {
    vi.clearAllMocks();
    updates = [];
  });

  const onUpdate = (u: any) => updates.push(u);

  it("should emit run_id on start", async () => {
    const uc = makeUseCase();
    await uc.execute({ caseId: "P2" }, onUpdate);
    const runIdEvent = updates.find((u) => u.type === "run_id");
    expect(runIdEvent).toBeDefined();
    expect(runIdEvent.runId).toMatch(/^RUN-\d+/);
  });

  it("should register and unregister the run in the status store", async () => {
    const uc = makeUseCase();
    await uc.execute({ caseId: "P2" }, onUpdate);
    expect(mockRunStatusStore.registerRun).toHaveBeenCalledOnce();
    expect(mockRunStatusStore.unregisterRun).toHaveBeenCalledWith("P2");
  });

  it("SYNC-only (P1): should call syncBrand but NOT runExtraction", async () => {
    const uc = makeUseCase();
    await uc.execute(
      { caseId: "P1", pairs: [{ tenant: "brand-a", purchaser: "buyer-1" }] },
      onUpdate,
    );
    expect(mockSyncBrand.execute).toHaveBeenCalledOnce();
    expect(mockRunExtraction.execute).not.toHaveBeenCalled();
  });

  it("EXTRACT-only (P2): should call discoverFiles and runExtraction but NOT syncBrand", async () => {
    const uc = makeUseCase();
    await uc.execute({ caseId: "P2" }, onUpdate);
    expect(mockSyncBrand.execute).not.toHaveBeenCalled();
    expect(mockDiscoverFiles.execute).toHaveBeenCalledOnce();
    expect(mockRunExtraction.execute).toHaveBeenCalledOnce();
  });

  it("PIPE: should call syncBrand then runExtraction in order", async () => {
    const uc = makeUseCase();
    const callOrder: string[] = [];
    mockSyncBrand.execute.mockImplementationOnce(async () => {
      callOrder.push("sync");
      return [
        {
          files: ["/staging/brand-a/file1.pdf"],
          synced: 1,
          skipped: 0,
          errors: 0,
          brand: "brand-a",
          purchaser: "buyer-1",
        },
      ];
    });
    mockRunExtraction.execute.mockImplementationOnce(async () => {
      callOrder.push("extract");
    });

    await uc.execute(
      { caseId: "PIPE", pairs: [{ tenant: "brand-a", purchaser: "buyer-1" }] },
      onUpdate,
    );
    expect(callOrder).toEqual(["sync", "extract"]);
  });

  it("should emit a report event on success", async () => {
    const uc = makeUseCase();
    await uc.execute({ caseId: "P2" }, onUpdate);
    const reportEvent = updates.find((u) => u.type === "report");
    expect(reportEvent).toBeDefined();
  });

  it("should emit error event and rethrow when runExtraction fails", async () => {
    mockRunExtraction.execute.mockRejectedValueOnce(new Error("API timeout"));
    const uc = makeUseCase();
    await expect(uc.execute({ caseId: "P2" }, onUpdate)).rejects.toThrow(
      "API timeout",
    );
    const errorEvent = updates.find((u) => u.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toBe("API timeout");
    // Must always unregister, even on failure
    expect(mockRunStatusStore.unregisterRun).toHaveBeenCalledWith("P2");
  });

  it("should use custom bucketName when provided", async () => {
    const uc = makeUseCase();
    await uc.execute(
      {
        caseId: "P1",
        pairs: [{ tenant: "brand-a", purchaser: "buyer-1" }],
        bucketName: "custom-bucket",
      },
      onUpdate,
    );
    const syncCall = mockSyncBrand.execute.mock.calls[0][0];
    expect(syncCall.buckets[0].bucket).toBe("custom-bucket");
  });

  it("should default bucket to intelliextract-staging when not provided", async () => {
    const uc = makeUseCase();
    await uc.execute(
      { caseId: "P1", pairs: [{ tenant: "brand-a", purchaser: "buyer-1" }] },
      onUpdate,
    );
    const syncCall = mockSyncBrand.execute.mock.calls[0][0];
    expect(syncCall.buckets[0].bucket).toBe("intelliextract-staging");
  });

  it("should log 'No files found' warning when P2 finds no files", async () => {
    mockDiscoverFiles.execute.mockReturnValueOnce([]);
    const uc = makeUseCase();
    await uc.execute({ caseId: "P2" }, onUpdate);
    const warnLog = updates.find((u) => u.type === "log" && u.level === "warn");
    expect(warnLog).toBeDefined();
    expect(warnLog.message).toContain("No files found");
  });
});
