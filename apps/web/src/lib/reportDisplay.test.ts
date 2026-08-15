import { describe, expect, it } from "vitest";
import {
  formatDeltaVsPrevious,
  formatSignedAmount,
  parseReportViewParam,
  shouldShowCategoryDelta,
} from "./reportDisplay";

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

  it("hides tiny category comparisons", () => {
    expect(shouldShowCategoryDelta("-5", "1", 5000)).toBe(false);
    expect(shouldShowCategoryDelta("-812", "-94", 5000)).toBe(true);
  });

  it("parses report view query params", () => {
    expect(parseReportViewParam("spending")).toBe("spending");
    expect(parseReportViewParam("cash-flow")).toBe("cash-flow");
    expect(parseReportViewParam("cash_flow")).toBe("cash-flow");
    expect(parseReportViewParam("unknown")).toBeNull();
  });
});
