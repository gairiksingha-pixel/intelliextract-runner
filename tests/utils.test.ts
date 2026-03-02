import { describe, it, expect } from "vitest";
import { normalizeRelativePath } from "../src/core/domain/utils.js";
import { parseSyncSummaryFromStdout } from "../src/infrastructure/utils/stdout-parser.utils.js";

describe("normalizeRelativePath", () => {
  it("should convert backslashes to forward slashes", () => {
    expect(normalizeRelativePath("brand\\file.pdf")).toBe("brand/file.pdf");
  });

  it("should strip leading slashes", () => {
    expect(normalizeRelativePath("/brand/file.pdf")).toBe("brand/file.pdf");
  });

  it("should strip trailing slashes", () => {
    expect(normalizeRelativePath("brand/file.pdf/")).toBe("brand/file.pdf");
  });

  it("should handle both backslashes and leading slash", () => {
    expect(normalizeRelativePath("\\brand\\file.pdf")).toBe("brand/file.pdf");
  });

  it("should return empty string for empty input", () => {
    expect(normalizeRelativePath("")).toBe("");
  });

  it("should handle already-normalized paths unchanged", () => {
    expect(normalizeRelativePath("brand/sub/file.pdf")).toBe(
      "brand/sub/file.pdf",
    );
  });
});

describe("parseSyncSummaryFromStdout", () => {
  it("should parse downloaded, skipped, and errors from stdout", () => {
    const stdout = `
      Sync complete.
      Downloaded (new): 5
      Skipped (already present): 10
      Errors: 1
    `;
    const result = parseSyncSummaryFromStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.downloaded).toBe(5);
    expect(result!.skipped).toBe(10);
    expect(result!.errors).toBe(1);
    expect(result!.totalInInventory).toBe(15);
  });

  it("should return null for empty string", () => {
    expect(parseSyncSummaryFromStdout("")).toBeNull();
  });

  it("should return null when no recognizable sync lines found", () => {
    expect(
      parseSyncSummaryFromStdout("Process started.\nCompleted."),
    ).toBeNull();
  });

  it("should parse even when some fields are missing", () => {
    const stdout = "Downloaded (new): 3";
    const result = parseSyncSummaryFromStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.downloaded).toBe(3);
    expect(result!.skipped).toBe(0);
    expect(result!.errors).toBe(0);
  });

  it("should handle case-insensitive matching", () => {
    const stdout = "DOWNLOADED (NEW): 7\nERRORS: 2";
    const result = parseSyncSummaryFromStdout(stdout);
    expect(result).not.toBeNull();
    expect(result!.downloaded).toBe(7);
    expect(result!.errors).toBe(2);
  });
});
