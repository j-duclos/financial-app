import { describe, expect, it } from "vitest";
import type {
  GuidedStrategyDebtAccountSummary,
  GuidedStrategyDebtPayment,
  GuidedStrategyResult,
  GuidedTransferOccurrenceStatus,
  ScenarioComparisonResponse,
} from "./types";

const STATUSES: GuidedTransferOccurrenceStatus[] = [
  "redirected",
  "split",
  "resumed_savings",
  "buffer_limited",
  "skipped",
];

const decimal = /^[+-]?\d+\.\d{2}$/;

describe("guided_strategy_result contract", () => {
  it("allows an omitted or null guided result on comparison responses", () => {
    const omitted: ScenarioComparisonResponse = {
      scenario_id: 1,
      scenario_name: "Base",
      horizon: "12m",
      start_date: "2026-09-04",
      end_date: "2027-09-04",
      metrics: {},
      summary: { overall: "neutral", messages: [] },
    };
    const explicitNull: ScenarioComparisonResponse = {
      ...omitted,
      guided_strategy_result: null,
    };
    expect(omitted.guided_strategy_result).toBeUndefined();
    expect(explicitNull.guided_strategy_result).toBeNull();
  });

  it("requires decimal strings, nullable dates, payments, statuses, and debt summaries", () => {
    const payment: GuidedStrategyDebtPayment = {
      date: "2026-09-08",
      source_account_id: 1,
      debt_account_id: 7,
      amount: "320.00",
      original_transfer_rule_id: 21,
      original_transfer_amount: "320.00",
      priority_at_payment: 1,
    };
    const debt: GuidedStrategyDebtAccountSummary = {
      account_id: 7,
      name: "Venture",
      opening_owed: "3141.42",
      ending_owed: "0.00",
      guided_payments: "3141.42",
      payoff_date: "2026-11-05",
    };
    const result: GuidedStrategyResult = {
      strategy_type: "debt_first_vs_save_first",
      start_date: "2026-09-05",
      end_date: "2027-09-05",
      source_account_id: 1,
      savings_account_id: 4,
      payoff_strategy: "avalanche",
      allocation_percent: "100.00",
      minimum_cash_buffer: "500.00",
      baseline: {
        savings_at_horizon: "13911.64",
        selected_debt_at_horizon: "6180.69",
      },
      debt_first: {
        savings_at_horizon: "9800.00",
        selected_debt_at_horizon: "0.00",
      },
      total_planned_for_savings: "12000.00",
      total_redirected_to_debt: "6180.69",
      total_sent_to_savings: "5819.31",
      total_left_in_source_due_to_buffer: "0.00",
      total_unallocated_after_payoff: "0.00",
      interest_avoided_within_horizon: "425.17",
      debt_free_date: "2027-01-15",
      savings_resumed_date: "2027-01-15",
      net_position_break_even_date: null,
      savings_balance_catch_up_date: null,
      break_even_date: null,
      lowest_source_balance: "501.13",
      lowest_source_balance_date: "2026-10-06",
      debt_payments: [payment],
      transfer_occurrences: [
        {
          date: "2026-09-08",
          rule_id: 21,
          original_amount: "320.00",
          affordable_amount: "320.00",
          redirected_to_debt: "320.00",
          sent_to_savings: "0.00",
          left_in_source: "0.00",
          source_balance_before: "821.13",
          source_balance_after: "501.13",
          status: "redirected",
        },
      ],
      debt_accounts: [debt],
    };

    expect(result.allocation_percent).toMatch(decimal);
    expect(result.minimum_cash_buffer).toMatch(decimal);
    expect(result.baseline.savings_at_horizon).toMatch(decimal);
    expect(result.debt_payments[0]?.amount).toMatch(decimal);
    expect(result.debt_free_date).toBe("2027-01-15");
    expect(result.break_even_date).toBeNull();
    expect(result.net_position_break_even_date).toBeNull();
    expect(result.savings_balance_catch_up_date).toBeNull();
    expect(debt.payoff_date).toBe("2026-11-05");
    expect(STATUSES).toContain(result.transfer_occurrences[0]?.status);
    const unpaid: GuidedStrategyDebtAccountSummary = { ...debt, payoff_date: null };
    expect(unpaid.payoff_date).toBeNull();
  });

  it("does not conflate savings catch-up with net-position break-even", () => {
    const result: Pick<
      GuidedStrategyResult,
      "savings_balance_catch_up_date" | "net_position_break_even_date" | "break_even_date"
    > = {
      savings_balance_catch_up_date: "2027-06-01",
      net_position_break_even_date: "2027-01-15",
      break_even_date: "2027-01-15",
    };
    expect(result.break_even_date).toBe(result.net_position_break_even_date);
    expect(result.savings_balance_catch_up_date).not.toBe(result.net_position_break_even_date);
  });
});
