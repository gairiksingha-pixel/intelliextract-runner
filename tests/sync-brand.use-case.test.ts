import { describe, it, expect, vi, beforeEach } from "vitest";
import { SyncBrandUseCase } from "../src/core/use-cases/sync-brand.use-case.js";

const mockSyncResult = {
  files: ["/staging/brand-a/file1.pdf"],
  synced: 1,
  skipped: 0,
  errors: 0,
  brand: "brand-a",
  purchaser: "buyer-1",
};

const mockS3Service = {
  syncBucket: vi.fn().mockResolvedValue(mockSyncResult),
};

const mockSyncRepo = {
  appendSyncHistory: vi.fn().mockResolvedValue(undefined),
};

function makeUseCase() {
  return new SyncBrandUseCase(mockS3Service as any, mockSyncRepo as any);
}

const STAGING_DIR = "/tmp/staging";

describe("SyncBrandUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should call syncBucket once per bucket provided", async () => {
    const uc = makeUseCase();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    expect(mockS3Service.syncBucket).toHaveBeenCalledOnce();
  });

  it("should call syncBucket for each bucket in parallel", async () => {
    const uc = makeUseCase();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
        {
          name: "brand-b",
          bucket: "test-bucket",
          purchaser: "buyer-2",
          prefix: "brand-b/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    expect(mockS3Service.syncBucket).toHaveBeenCalledTimes(2);
  });

  it("should append sync history when files were synced", async () => {
    const uc = makeUseCase();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    expect(mockSyncRepo.appendSyncHistory).toHaveBeenCalledOnce();
    const historyArg = mockSyncRepo.appendSyncHistory.mock.calls[0][0];
    expect(historyArg.synced).toBe(1);
    expect(historyArg.brands).toContain("brand-a");
  });

  it("should NOT append sync history when nothing was synced or skipped", async () => {
    mockS3Service.syncBucket.mockResolvedValueOnce({
      files: [],
      synced: 0,
      skipped: 0,
      errors: 0,
      brand: "brand-a",
      purchaser: "buyer-1",
    });
    const uc = makeUseCase();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    expect(mockSyncRepo.appendSyncHistory).not.toHaveBeenCalled();
  });

  it("should return all result objects from all buckets", async () => {
    mockS3Service.syncBucket
      .mockResolvedValueOnce({
        files: ["/a/1.pdf"],
        synced: 1,
        skipped: 0,
        errors: 0,
        brand: "brand-a",
        purchaser: "buyer-1",
      })
      .mockResolvedValueOnce({
        files: ["/b/2.pdf"],
        synced: 1,
        skipped: 1,
        errors: 0,
        brand: "brand-b",
        purchaser: "buyer-2",
      });

    const uc = makeUseCase();
    const results = await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
        {
          name: "brand-b",
          bucket: "test-bucket",
          purchaser: "buyer-2",
          prefix: "brand-b/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    expect(results).toHaveLength(2);
  });

  it("should pass the progress callback through to syncBucket", async () => {
    const uc = makeUseCase();
    const onProgress = vi.fn();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
      ],
      stagingDir: STAGING_DIR,
      onProgress,
    });
    const callArg = mockS3Service.syncBucket.mock.calls[0][2];
    expect(callArg.onProgress).toBeDefined();
  });

  it("should correctly sum totals from multiple buckets in sync history", async () => {
    mockS3Service.syncBucket
      .mockResolvedValueOnce({
        files: [],
        synced: 3,
        skipped: 1,
        errors: 0,
        brand: "brand-a",
        purchaser: "buyer-1",
      })
      .mockResolvedValueOnce({
        files: [],
        synced: 2,
        skipped: 4,
        errors: 1,
        brand: "brand-b",
        purchaser: "buyer-2",
      });

    const uc = makeUseCase();
    await uc.execute({
      buckets: [
        {
          name: "brand-a",
          bucket: "test-bucket",
          purchaser: "buyer-1",
          prefix: "brand-a/",
        },
        {
          name: "brand-b",
          bucket: "test-bucket",
          purchaser: "buyer-2",
          prefix: "brand-b/",
        },
      ],
      stagingDir: STAGING_DIR,
    });
    const historyArg = mockSyncRepo.appendSyncHistory.mock.calls[0][0];
    expect(historyArg.synced).toBe(5);
    expect(historyArg.skipped).toBe(5);
    expect(historyArg.errors).toBe(1);
  });
});
