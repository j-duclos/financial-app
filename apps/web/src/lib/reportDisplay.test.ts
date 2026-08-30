import { describe, expect, it } from "vitest";
import {
  formatDeltaVsPrevious,
  formatExpenseSharePercent,
  formatSignedAmount,
  parseOptionalAmount,
  parseReportViewParam,
} from "./reportDisplay";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const reportDisplaySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "reportDisplay.ts"),
  "utf8"
);

describe("reportDisplay", () => {
  it("formats signed amounts with an explicit plus or minus", () => {
    expect(formatSignedAmount("17164")).toMatch(/^\+/);
    expect(formatSignedAmount("-812")).toMatch(/^-/);
    expect(formatSignedAmount("0")).not.toMatch(/^[+-]/);
  });

  it("describes month-over-month deltas", () => {
    expect(formatDeltaVsPrevious("1220", "2026-07")).toContain("vs Jul");
    expect(formatDeltaVsPrevious("0", "2026-07")).toContain("No change");
  });

  it("does not contain production dollar/percentage significance thresholds", () => {
    expect(reportDisplaySrc).not.toMatch(/absDelta < 0\.005/);
    expect(reportDisplaySrc).not.toMatch(/shouldShowCategoryDelta/);
    expect(reportDisplaySrc).not.toMatch(/absDelta < 25/);
  });

  it("formats backend expense share without recomputing", () => {
    expect(formatExpenseSharePercent("42.0")).toBe("42%");
    expect(formatExpenseSharePercent(null)).toBeNull();
    expect(formatExpenseSharePercent("NaN")).toBeNull();
  });

  it("does not silently treat malformed amounts as zero", () => {
    expect(parseOptionalAmount("NaN")).toBeNull();
    expect(parseOptionalAmount("Infinity")).toBeNull();
    expect(formatSignedAmount("bad")).toBe("—");
  });

  it("parses report view query params", () => {
    expect(parseReportViewParam("spending")).toBe("spending");
    expect(parseReportViewParam("cash-flow")).toBe("cash-flow");
    expect(parseReportViewParam("cash_flow")).toBe("cash-flow");
    expect(parseReportViewParam("unknown")).toBeNull();
  });
});
