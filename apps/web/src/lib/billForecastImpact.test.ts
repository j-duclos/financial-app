import { describe, expect, it } from "vitest";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { findBillRiskDay, formatBillForecastImpact } from "./billForecastImpact";

function txn(description: string): TimelineCalendarTransaction {
  return {
    id: "r-1-2025-06-17",
    description,
    account_name: "Main",
    amount: "-100.00",
    category: "Bills",
    kind: "bill",
    source: "rule",
    balance_after: "50.00",
    is_transfer: false,
  };
}

function day(
  date: string,
  overrides: Partial<TimelineCalendarDay> = {}
): TimelineCalendarDay {
  return {
    date,
    income_total: "0",
    expense_total: "100",
    transfer_total: "0",
    net_total: "-100",
    ending_balance: "50",
    lowest_balance: "-362.88",
    risk_level: "critical",
    risk_reason: null,
    has_risk: true,
    heat_level: "dangerous",
    transactions: [],
    ...overrides,
  };
}

describe("billForecastImpact", () => {
  it("finds the day where this payment triggers the lowest balance", () => {
    const geico = txn("GEICO");
    const days = [
      day("2025-06-17", {
        lowest_projected_balance: "-362.88",
        lowest_projected_balance_account_name: "Main",
        lowest_projected_balance_after_description: "GEICO",
      }),
      day("2025-07-24"),
    ];
    expect(findBillRiskDay(geico, days)?.date).toBe("2025-06-17");
  });

  it("reports healthy impact when no risk linkage exists", () => {
    const impact = formatBillForecastImpact(
      day("2025-07-24", { has_risk: true, heat_level: "dangerous" }),
      txn("Netflix"),
      []
    );
    expect(impact.tone).toBe("healthy");
    expect(impact.headline).toContain("does not create");
  });

  it("reports lowest-balance-after-payment messaging", () => {
    const geico = txn("GEICO");
    const impact = formatBillForecastImpact(
      day("2025-06-17", {
        lowest_projected_balance: "-362.88",
        lowest_projected_balance_account_name: "Main",
        lowest_projected_balance_after_description: "GEICO",
      }),
      geico,
      []
    );
    expect(impact.tone).toBe("risk");
    expect(impact.headline).toContain("Lowest projected balance");
  });
});
