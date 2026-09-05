import { describe, expect, it } from "vitest";
import type { GuidedStrategyResult, ScenarioComparisonResponse, ScenarioGuidedStrategy } from "@budget-app/shared";
import {
  comparisonMatchesGuidedStrategy,
  debtFreeDateCopy,
  formatGuidedNullableDate,
  guidedComparisonViewState,
  guidedTradeoffExplanation,
  guidedTransferStatusLabel,
  netPositionBreakEvenCopy,
  planHasHypotheticalChanges,
  savingsBalanceCatchUpCopy,
} from "./guidedStrategyDisplay";

const strategy: ScenarioGuidedStrategy = {
  id: 1,
  scenario_id: 12,
  strategy_type: "debt_first_vs_save_first",
  source_account: {
    id: 11,
    name: "Everyday",
    effective_display_name: "Everyday",
    account_type: "CHECKING",
  },
  savings_account: {
    id: 22,
    name: "Reserve",
    effective_display_name: "Reserve",
    account_type: "SAVINGS",
  },
  included_debt_accounts: [],
  savings_transfer_rules: [],
  start_date: "2026-09-04",
  minimum_cash_buffer: "0.00",
  allocation_percent: "100.00",
  payoff_strategy: "avalanche",
  custom_debt_order: [],
  resume_savings_after_payoff: true,
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T00:00:00Z",
};

function result(overrides: Partial<GuidedStrategyResult> = {}): GuidedStrategyResult {
  return {
    strategy_type: "debt_first_vs_save_first",
    start_date: "2026-09-04",
    end_date: "2027-09-04",
    source_account_id: 11,
    savings_account_id: 22,
    payoff_strategy: "avalanche",
    allocation_percent: "100.00",
    minimum_cash_buffer: "0.00",
    baseline: { savings_at_horizon: "1200.00", selected_debt_at_horizon: "800.00" },
    debt_first: { savings_at_horizon: "200.00", selected_debt_at_horizon: "0.00" },
    total_planned_for_savings: "1200.00",
    total_redirected_to_debt: "1000.00",
    total_sent_to_savings: "0.00",
    total_left_in_source_due_to_buffer: "0.00",
    total_unallocated_after_payoff: "0.00",
    interest_avoided_within_horizon: "45.00",
    debt_free_date: "2027-01-15",
    savings_resumed_date: "2027-01-15",
    net_position_break_even_date: "2027-03-01",
    savings_balance_catch_up_date: null,
    break_even_date: "2027-03-01",
    lowest_source_balance: "80.00",
    lowest_source_balance_date: "2026-10-01",
    debt_payments: [],
    transfer_occurrences: [],
    debt_accounts: [],
    ...overrides,
  };
}

function comparison(
  overrides: Partial<ScenarioComparisonResponse> = {}
): ScenarioComparisonResponse {
  return {
    scenario_id: 12,
    scenario_name: "Plan",
    horizon: "12m",
    start_date: "2026-09-04",
    end_date: "2027-09-04",
    metrics: {},
    summary: { overall: "neutral", messages: [] },
    ...overrides,
  };
}

describe("guidedStrategyDisplay", () => {
  it("renders null dates as forecast wording instead of today, zero, or never", () => {
    expect(formatGuidedNullableDate(null, "Not within this forecast")).toBe(
      "Not within this forecast"
    );
    expect(formatGuidedNullableDate("", "Not within this forecast")).toBe(
      "Not within this forecast"
    );
    expect(formatGuidedNullableDate("2027-03-01", "Not within this forecast")).toBe("Mar 1, 2027");
    expect(debtFreeDateCopy(result({ debt_free_date: null }))).toBe(
      "Selected cards are not fully paid within this forecast"
    );
    expect(debtFreeDateCopy(result({ debt_free_date: undefined }))).toBe(
      "Selected cards are not fully paid within this forecast"
    );
  });

  it("does not label net-position break-even as savings catch-up", () => {
    const sample = result({
      net_position_break_even_date: "2027-03-01",
      savings_balance_catch_up_date: null,
    });
    const net = netPositionBreakEvenCopy(sample);
    const savings = savingsBalanceCatchUpCopy(sample);
    expect(net.label.toLowerCase()).toContain("savings minus selected debt");
    expect(net.label.toLowerCase()).not.toContain("savings balance itself");
    expect(savings.label.toLowerCase()).toContain("savings balance itself");
    expect(savings.value).toBe("Savings do not catch up within this forecast");
    expect(net.value).toBe("Mar 1, 2027");
  });

  it("uses friendly transfer status labels", () => {
    expect(guidedTransferStatusLabel("redirected")).toBe("Redirected to debt");
    expect(guidedTransferStatusLabel("split")).toBe("Split between debt and savings");
    expect(guidedTransferStatusLabel("resumed_savings")).toBe("Resumed savings");
    expect(guidedTransferStatusLabel("buffer_limited")).toBe("Limited by cash buffer");
    expect(guidedTransferStatusLabel("skipped")).toBe("Skipped");
  });

  it("explains the tradeoff from returned totals without hardcoded advice thresholds", () => {
    const copy = guidedTradeoffExplanation(
      result({ total_left_in_source_due_to_buffer: "40.00", savings_resumed_date: "2027-01-15" })
    );
    expect(copy).toMatch(/reduces selected card debt/i);
    expect(copy).toMatch(/cash buffer prevented/i);
    expect(copy).toMatch(/resume/i);
    expect(copy).not.toMatch(/you should/i);
    expect(copy).not.toMatch(/always better/i);
  });

  it("treats a configured guided strategy as a plan change", () => {
    expect(planHasHypotheticalChanges(0, null)).toBe(false);
    expect(planHasHypotheticalChanges(0, strategy)).toBe(true);
    expect(planHasHypotheticalChanges(2, null)).toBe(true);
  });

  it("does not treat a stale guided result as ready while recalculating", () => {
    const stale = comparison({
      guided_strategy_result: result({ allocation_percent: "50.00" }),
    });
    expect(comparisonMatchesGuidedStrategy(stale, strategy)).toBe(false);
    expect(
      guidedComparisonViewState({
        strategy,
        strategyLoading: false,
        comparison: stale,
        comparisonFetching: true,
        comparisonError: false,
        comparisonBelongsToScenario: true,
      })
    ).toBe("loading");
  });

  it("surfaces a saved strategy with no result after the comparison finishes", () => {
    expect(
      guidedComparisonViewState({
        strategy,
        strategyLoading: false,
        comparison: comparison({ guided_strategy_result: null }),
        comparisonFetching: false,
        comparisonError: false,
        comparisonBelongsToScenario: true,
      })
    ).toBe("missing_result");
  });
});
