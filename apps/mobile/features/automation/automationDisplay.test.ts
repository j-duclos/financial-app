import { describe, expect, it } from "vitest";
import type { RecurringRule } from "@budget-app/shared";
import {
  buildAutomationRows,
  buildRuleSummary,
  cadenceSummary,
  estimatedMonthlyCashFlow,
  getRuleLifecycleStatus,
  getRuleSection,
  groupAutomationRows,
  triggerSummary,
} from "@/features/automation/automationDisplay";
import { getNextRuleRunDate } from "@/features/automation/ruleOccurrences";

function mockRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Netflix",
    account: {
      id: 1,
      name: "Checking",
      effective_display_name: "Checking",
      account_type: "CHECKING",
    } as RecurringRule["account"],
    direction: "EXPENSE",
    amount: "15.99",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: null,
    day_of_month: 15,
    nth_week: null,
    start_date: "2026-01-01",
    end_date: null,
    active: true,
    paused_at: null,
    notes: null,
    category: { id: 2, name: "Streaming", household: 1 } as RecurringRule["category"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("automationDisplay", () => {
  it("classifies subscription rules", () => {
    expect(getRuleSection(mockRule())).toBe("subscriptions");
  });

  it("builds human-readable trigger and summary", () => {
    const rule = mockRule();
    expect(triggerSummary(rule)).toContain("Schedule:");
    expect(buildRuleSummary(rule)).toContain("Streaming");
    expect(buildRuleSummary(rule)).toContain("15.99");
  });

  it("groups rows by section and filters search", () => {
    const rows = buildAutomationRows(
      [mockRule(), mockRule({ id: 2, name: "Paycheck", direction: "INCOME", category: null })],
      "2026-08-01"
    );
    const grouped = groupAutomationRows(rows, "netflix");
    expect(grouped.subscriptions).toHaveLength(1);
    expect(grouped.income).toHaveLength(0);
  });

  it("detects paused lifecycle", () => {
    expect(getRuleLifecycleStatus(mockRule({ active: false }), "2026-08-01")).toBe("paused");
  });

  it("computes monthly cash flow excluding credit card charges", () => {
    const rules = [
      mockRule({ amount: "100" }),
      mockRule({
        id: 3,
        name: "CC charge",
        account: { id: 9, name: "Visa", account_type: "CREDIT" } as RecurringRule["account"],
      }),
    ];
    const total = estimatedMonthlyCashFlow(rules, () => true);
    expect(total).toBeLessThan(0);
    expect(Math.abs(total)).toBeCloseTo(100, 0);
  });

  it("cadenceSummary formats monthly rules", () => {
    expect(cadenceSummary(mockRule())).toContain("Monthly");
  });
});

describe("ruleOccurrences", () => {
  it("returns next run for active monthly rule", () => {
    const next = getNextRuleRunDate(mockRule(), "2026-08-01");
    expect(next).toBe("2026-08-15");
  });

  it("returns null for paused rules", () => {
    expect(getNextRuleRunDate(mockRule({ active: false }), "2026-08-01")).toBeNull();
  });
});
