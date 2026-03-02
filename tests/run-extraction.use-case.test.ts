import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunExtractionUseCase } from "../src/core/use-cases/run-extraction.use-case.js";

const makeFile = (name: string, brand = "brand-a") => ({
  filePath: `/staging/${brand}/${name}`,
  relativePath: `${brand}/${name}`,
  brand,
  purchaser: "buyer-1",
});

const mockExtractionService = {
  extractFile: vi.fn().mockResolvedValue({
    success: true,
    latencyMs: 120,
    statusCode: 200,
    errorMessage: null,
    patternKey: "default",
    fullResponse: {},
  }),
};

const mockRecordRepo = {
  getCompletedPaths: vi.fn().mockResolvedValue(new Set<string>()),
  upsertRecord: vi.fn().mockResolvedValue(undefined),
  upsertRecords: vi.fn().mockResolvedValue(undefined),
  getRecordsForRun: vi.fn().mockResolvedValue([]),
  getCumulativeStats: vi
    .fn()
    .mockResolvedValue({ success: 0, failed: 0, total: 0 }),
};

const mockLogger = {
  init: vi.fn(),
  log: vi.fn(),
  close: vi.fn(),
};

const mockEmailService = {
  sendConsolidatedFailureEmail: vi.fn().mockResolvedValue(undefined),
};

function makeUseCase() {
  return new RunExtractionUseCase(
    mockExtractionService as any,
    mockRecordRepo as any,
    mockLogger as any,
    mockEmailService as any,
  );
}

describe("RunExtractionUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should call extractFile for each file and mark them done", async () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });

    expect(mockExtractionService.extractFile).toHaveBeenCalledTimes(2);
    // Should upsert once as 'running' and once as 'done' per file
    expect(mockRecordRepo.upsertRecord).toHaveBeenCalledTimes(4);
    const doneCalls = mockRecordRepo.upsertRecord.mock.calls.filter(
      (c: any[]) => c[0].status === "done",
    );
    expect(doneCalls).toHaveLength(2);
  });

  it("should skip already-completed files", async () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    mockRecordRepo.getCompletedPaths.mockResolvedValueOnce(
      new Set(["/staging/brand-a/a.pdf"]),
    );
    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });

    // Only b.pdf should be extracted
    expect(mockExtractionService.extractFile).toHaveBeenCalledTimes(1);
    expect(mockExtractionService.extractFile.mock.calls[0][0]).toContain(
      "b.pdf",
    );
  });

  it("should mark file as error and track failure when extraction fails", async () => {
    const files = [makeFile("a.pdf")];
    mockExtractionService.extractFile.mockResolvedValueOnce({
      success: false,
      latencyMs: 500,
      statusCode: 422,
      errorMessage: "Extraction failed",
      patternKey: null,
      fullResponse: {},
    });
    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });

    const errorCall = mockRecordRepo.upsertRecord.mock.calls.find(
      (c: any[]) => c[0].status === "error",
    );
    expect(errorCall).toBeDefined();
  });

  it("should NOT send email when there are no failures", async () => {
    const files = [makeFile("a.pdf")];
    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });
    expect(
      mockEmailService.sendConsolidatedFailureEmail,
    ).not.toHaveBeenCalled();
  });

  it("should send failure email when at least one file fails", async () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf")];
    mockExtractionService.extractFile
      .mockResolvedValueOnce({
        success: true,
        latencyMs: 100,
        statusCode: 200,
        errorMessage: null,
        patternKey: null,
        fullResponse: {},
      })
      .mockResolvedValueOnce({
        success: false,
        latencyMs: 500,
        statusCode: 500,
        errorMessage: "Server error",
        patternKey: null,
        fullResponse: {},
      });

    // Return a basic record for metrics
    mockRecordRepo.getRecordsForRun.mockResolvedValueOnce([
      {
        filePath: "/staging/brand-a/b.pdf",
        relativePath: "brand-a/b.pdf",
        brand: "brand-a",
        status: "error",
        latencyMs: 500,
        runId: "RUN-001",
      },
    ]);

    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });
    expect(
      mockEmailService.sendConsolidatedFailureEmail,
    ).toHaveBeenCalledOnce();
  });

  it("should report progress after each file", async () => {
    const files = [makeFile("a.pdf"), makeFile("b.pdf"), makeFile("c.pdf")];
    const progressUpdates: Array<[number, number]> = [];
    const uc = makeUseCase();
    await uc.execute({
      files,
      runId: "RUN-001",
      onProgress: (done, total) => progressUpdates.push([done, total]),
    });
    expect(progressUpdates).toHaveLength(3);
    expect(progressUpdates[2]).toEqual([3, 3]);
  });

  it("should return early without calling extract when all files are already completed", async () => {
    const files = [makeFile("a.pdf")];
    mockRecordRepo.getCompletedPaths.mockResolvedValueOnce(
      new Set(["/staging/brand-a/a.pdf"]),
    );
    const uc = makeUseCase();
    await uc.execute({ files, runId: "RUN-001" });
    expect(mockExtractionService.extractFile).not.toHaveBeenCalled();
    expect(mockLogger.close).toHaveBeenCalled();
  });
});
