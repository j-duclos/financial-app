import { describe, expect, it } from "vitest";
import { CALENDAR_SUMMARY } from "./timelineTerminology";

describe("timelineTerminology", () => {
  it("defines calendar summary labels and help copy", () => {
    expect(CALENDAR_SUMMARY.lowestProjectedBalance.label).toBe("Lowest projected");
    expect(CALENDAR_SUMMARY.nextRiskDate.label).toBe("Next risk date");
    expect(CALENDAR_SUMMARY.highestProjectedBalance.label).toBe("Highest projected balance");
    expect(CALENDAR_SUMMARY.upcomingIncomeExpenses.label).toBe("Upcoming income");
    expect(CALENDAR_SUMMARY.safeUntilNextIncome.label).toBe("Safe until next income");
    expect(CALENDAR_SUMMARY.lowestProjectedBalance.help).toMatch(/tightest/i);
    expect(CALENDAR_SUMMARY.safeUntilNextIncome.help).toMatch(/next income/i);
  });
});
