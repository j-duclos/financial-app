import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  resolveAutomationNextRun,
  triggerSummary,
} from "@/features/automation/automationDisplay";

const dir = dirname(fileURLToPath(import.meta.url));
const displaySource = readFileSync(join(dir, "automationDisplay.ts"), "utf8");
const detailSource = readFileSync(join(dir, "AutomationDetailScreen.tsx"), "utf8");

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
    is_bill: false,
    category: { id: 2, name: "Streaming", household: 1 } as RecurringRule["category"],
    next_occurrence_date: "2026-08-15",
    estimated_monthly_amount: "-15.99",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("automationDisplay", () => {
  it("classifies non-bill expenses as subscriptions without category-name heuristics", () => {
    expect(getRuleSection(mockRule())).toBe("subscriptions");
    expect(getRuleSection(mockRule({ is_bill: true }))).toBe("bills");
    expect(displaySource).not.toMatch(/Streaming/);
    expect(displaySource).not.toMatch(/Credit Card Payment/);
    expect(displaySource).not.toMatch(/move to/);
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

  it("sums backend estimated_monthly_amount and excludes credit card charges", () => {
    const rules = [
      mockRule({ amount: "100", estimated_monthly_amount: "-100" }),
      mockRule({
        id: 3,
        name: "CC charge",
        estimated_monthly_amount: "-50",
        account: { id: 9, name: "Visa", account_type: "CREDIT" } as RecurringRule["account"],
      }),
    ];
    const total = estimatedMonthlyCashFlow(rules, () => true);
    expect(total).toBe(-100);
  });

  it("uses backend next_occurrence_date for next run", () => {
    expect(resolveAutomationNextRun(mockRule(), "2026-08-01")).toBe("2026-08-15");
    expect(resolveAutomationNextRun(mockRule({ active: false }), "2026-08-01")).toBeNull();
    expect(buildAutomationRows([mockRule()], "2026-08-01")[0].nextRun).toBe("2026-08-15");
  });

  it("does not generate recurrence schedules client-side", () => {
    expect(displaySource).not.toMatch(/generateRuleOccurrences/);
    expect(displaySource).not.toMatch(/getNextRuleRunDate/);
    expect(displaySource).not.toMatch(/52\s*\/\s*12/);
    expect(detailSource).not.toMatch(/ruleOccurrences/);
    expect(detailSource).toMatch(/resolveAutomationNextRun/);
  });

  it("cadenceSummary formats monthly rules", () => {
    expect(cadenceSummary(mockRule())).toContain("Monthly");
  });
});
