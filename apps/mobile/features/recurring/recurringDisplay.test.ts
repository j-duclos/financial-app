import { describe, expect, it } from "vitest";
import {
  amountDisplayForRule,
  buildRecurringRows,
  cadenceLabel,
  resolveNextOccurrence,
  ruleLifecycleStatus,
  sortRecurringRows,
} from "@/features/recurring/recurringDisplay";
import type { RecurringRule } from "@budget-app/shared";

function mockRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Rent",
    account: { id: 1, name: "Main", effective_display_name: "Main" } as RecurringRule["account"],
    direction: "EXPENSE",
    amount: "3100.00",
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
    category: { id: 2, name: "Rent / Mortgage" } as RecurringRule["category"],
    next_occurrence_date: "2026-09-01",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("recurringDisplay", () => {
  it("cadenceLabel formats monthly day as ordinal", () => {
    expect(cadenceLabel(mockRule())).toBe("Monthly · 1st");
  });

  it("buildRecurringRows uses backend next_occurrence_date", () => {
    const rows = buildRecurringRows([mockRule()], "2026-08-01");
    expect(rows[0].nextOccurrence).toBe("2026-09-01");
    expect(rows[0].accountLine).toContain("Main");
    expect(rows[0].accountLine).toContain("Rent / Mortgage");
    expect(rows[0].metaLine).toContain("Next");
  });

  it("resolveNextOccurrence is null for paused/ended rules", () => {
    expect(
      resolveNextOccurrence(mockRule({ active: false, paused_at: "2026-08-01" }), "2026-08-15")
    ).toBeNull();
    expect(
      resolveNextOccurrence(mockRule({ end_date: "2026-07-01" }), "2026-08-15")
    ).toBeNull();
  });

  it("amountDisplayForRule signs by direction", () => {
    expect(amountDisplayForRule(mockRule({ direction: "EXPENSE" })).signed).toBe(-3100);
    expect(amountDisplayForRule(mockRule({ direction: "INCOME", amount: "500" })).showSign).toBe(
      true
    );
    expect(amountDisplayForRule(mockRule({ direction: "TRANSFER", amount: "680" })).tone).toBe(
      "neutral"
    );
  });

  it("sortRecurringRows puts inactive rules last and defaults to next", () => {
    const rows = buildRecurringRows(
      [
        mockRule({ id: 1, active: false, paused_at: "2026-07-01", next_occurrence_date: null }),
        mockRule({
          id: 2,
          name: "Paycheck",
          direction: "INCOME",
          next_occurrence_date: "2026-08-15",
        }),
        mockRule({ id: 3, name: "Later", next_occurrence_date: "2026-10-01" }),
      ],
      "2026-08-01"
    );
    const sorted = sortRecurringRows(rows, "next");
    expect(sorted[0].rule.name).toBe("Paycheck");
    expect(sorted[1].rule.name).toBe("Later");
    expect(sorted[2].isActive).toBe(false);
  });

  it("ruleLifecycleStatus distinguishes paused ended inactive", () => {
    expect(ruleLifecycleStatus(mockRule(), "2026-08-01")).toBe("active");
    expect(
      ruleLifecycleStatus(mockRule({ active: false, paused_at: "2026-08-01" }), "2026-08-15")
    ).toBe("paused");
    expect(ruleLifecycleStatus(mockRule({ end_date: "2026-07-01" }), "2026-08-15")).toBe("ended");
    expect(ruleLifecycleStatus(mockRule({ active: false, paused_at: null }), "2026-08-15")).toBe(
      "inactive"
    );
  });

  it("transfer account line shows direction", () => {
    const rows = buildRecurringRows(
      [
        mockRule({
          direction: "TRANSFER",
          category: null,
          transfer_to_account: {
            id: 9,
            name: "Savings",
            effective_display_name: "Savings",
          } as RecurringRule["transfer_to_account"],
        }),
      ],
      "2026-08-01"
    );
    expect(rows[0].accountLine).toBe("Main → Savings");
  });
});
