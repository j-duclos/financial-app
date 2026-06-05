import { describe, expect, it } from "vitest";
import type { RecurringRule } from "@budget-app/shared";
import { getNextRuleRunDate } from "./ruleOccurrences";

function baseRule(overrides: Partial<RecurringRule>): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Test",
    account: { id: 1, name: "Main" } as RecurringRule["account"],
    category: null,
    direction: "EXPENSE",
    amount: "100.00",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: null,
    day_of_month: 15,
    nth_week: null,
    start_date: "2025-01-15",
    end_date: null,
    active: true,
    paused_at: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("getNextRuleRunDate", () => {
  it("returns next monthly occurrence on or after today", () => {
    const rule = baseRule({ day_of_month: 15, start_date: "2025-01-15" });
    expect(getNextRuleRunDate(rule, "2026-05-10")).toBe("2026-05-15");
    expect(getNextRuleRunDate(rule, "2026-05-15")).toBe("2026-05-15");
    expect(getNextRuleRunDate(rule, "2026-05-20")).toBe("2026-06-15");
  });

  it("returns null when rule is inactive", () => {
    const rule = baseRule({ active: false, paused_at: "2026-05-01" });
    expect(getNextRuleRunDate(rule, "2026-05-10")).toBeNull();
  });
});
