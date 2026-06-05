import { describe, expect, it } from "vitest";
import {
  billRowClass,
  billStatusBadgeClass,
  billStatusLabel,
  currentMonthKey,
  formatBillMonthTitle,
  shiftMonthKey,
} from "./billsDisplay";

describe("billsDisplay", () => {
  it("formats month title", () => {
    expect(formatBillMonthTitle("2026-06")).toBe("JUNE 2026");
  });

  it("renders status labels and badge classes", () => {
    expect(billStatusLabel("paid")).toBe("Paid");
    expect(billStatusLabel("late")).toBe("Late");
    expect(billStatusLabel("due_soon")).toBe("Due soon");
    expect(billStatusBadgeClass("late")).toContain("red");
    expect(billStatusLabel("projected")).toBe("Scheduled");
    expect(billStatusBadgeClass("projected")).toContain("blue");
    expect(billStatusBadgeClass("reconciled")).toContain("green");
  });

  it("row classes for late bills", () => {
    expect(billRowClass("late")).toContain("red");
    expect(billRowClass("paid")).toContain("emerald");
  });

  it("shifts month keys", () => {
    expect(shiftMonthKey("2026-06", 1)).toBe("2026-07");
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("currentMonthKey is YYYY-MM", () => {
    expect(currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });
});
