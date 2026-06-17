import { describe, expect, it } from "vitest";
import { forecastRowSeverityClasses, unmatchedScheduleRowClasses } from "./forecastRowSeverity";

describe("forecastRowSeverityClasses", () => {
  it("uses white background for normal bank rows", () => {
    const c = forecastRowSeverityClasses({
      balance: 500,
      rowDate: "2026-06-01",
      minimumBuffer: 100,
      riskDate: null,
      isCredit: false,
    });
    expect(c.backgroundClass).toBe("bg-white");
    expect(c.borderClass).toBe("border-b border-gray-100");
  });

  it("uses yellow background when below buffer", () => {
    const c = forecastRowSeverityClasses({
      balance: 50,
      rowDate: "2026-06-01",
      minimumBuffer: 100,
      riskDate: null,
      isCredit: false,
    });
    expect(c.backgroundClass).toBe("bg-amber-50/30");
  });

  it("uses red background when negative", () => {
    const c = forecastRowSeverityClasses({
      balance: -10,
      rowDate: "2026-06-01",
      minimumBuffer: 100,
      riskDate: null,
      isCredit: false,
    });
    expect(c.backgroundClass).toBe("bg-red-50/40");
  });

  it("uses orange border on risk date", () => {
    const c = forecastRowSeverityClasses({
      balance: 500,
      rowDate: "2026-06-17",
      minimumBuffer: 100,
      riskDate: "2026-06-17",
      isCredit: false,
    });
    expect(c.borderClass).toBe("border-y-2 border-amber-400");
  });

  it("skips buffer coloring for credit accounts", () => {
    const c = forecastRowSeverityClasses({
      balance: 50,
      rowDate: "2026-06-01",
      minimumBuffer: 100,
      riskDate: null,
      isCredit: true,
    });
    expect(c.backgroundClass).toBe("bg-white");
  });

  it("uses violet tint for unmatched scheduled rows", () => {
    const c = unmatchedScheduleRowClasses();
    expect(c.backgroundClass).toContain("violet");
    expect(c.borderClass).toContain("border-violet");
  });

  it("keeps buffer severity background when merging schedule highlight", () => {
    const base = forecastRowSeverityClasses({
      balance: -10,
      rowDate: "2026-06-01",
      minimumBuffer: 100,
      riskDate: null,
      isCredit: false,
    });
    const merged = unmatchedScheduleRowClasses(base);
    expect(merged.backgroundClass).toBe(base.backgroundClass);
    expect(merged.borderClass).toContain("border-violet");
  });
});
