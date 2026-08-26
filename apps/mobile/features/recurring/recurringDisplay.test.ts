import { describe, expect, it } from "vitest";
import {
  buildRecurringRows,
  cadenceLabel,
  sortRecurringRows,
} from "@/features/recurring/recurringDisplay";
import type { RecurringRule } from "@budget-app/shared";

function mockRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Rent",
    account: { id: 1, name: "Checking", effective_display_name: "Checking" } as RecurringRule["account"],
    direction: "EXPENSE",
    amount: "-1200",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: null,
    day_of_month: 1,
    nth_week: null,
    start_date: "2026-01-01",
    end_date: null,
    active: true,
    paused_at: null,
    notes: null,
    category: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("recurringDisplay", () => {
  it("cadenceLabel formats monthly rules", () => {
    expect(cadenceLabel(mockRule())).toContain("Monthly");
  });

  it("buildRecurringRows uses backend checklist for next occurrence", () => {
    const rows = buildRecurringRows(
      [mockRule()],
      [
        {
          id: 10,
          name: "Rent",
          account: { id: 1, name: "Checking" },
          due_date: "2026-09-01",
          rule_id: 1,
        } as never,
      ],
      "2026-08-01"
    );
    expect(rows[0].nextOccurrence).toBe("2026-09-01");
  });

  it("sortRecurringRows puts inactive rules last", () => {
    const rows = buildRecurringRows(
      [mockRule({ id: 1, active: false }), mockRule({ id: 2, name: "Paycheck", direction: "INCOME" })],
      [],
      "2026-08-01"
    );
    const sorted = sortRecurringRows(rows, "name");
    expect(sorted[0].isActive).toBe(true);
    expect(sorted[1].isActive).toBe(false);
  });
});
