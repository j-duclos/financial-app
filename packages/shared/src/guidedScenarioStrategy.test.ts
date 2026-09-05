import { describe, expect, it } from "vitest";
import type {
  DebtPayoffStrategy,
  GuidedDebtPayoffStrategy,
  GuidedScenarioStrategyType,
  ScenarioGuidedStrategy,
  ScenarioGuidedStrategyWritePayload,
} from "./types";

const PAYOFF_STRATEGIES: GuidedDebtPayoffStrategy[] = [
  "avalanche",
  "snowball",
  "utilization_target",
  "custom",
];

describe("guided scenario strategy contract", () => {
  it("reuses Payment Planner payoff-strategy constants", () => {
    const planner: DebtPayoffStrategy[] = [
      "avalanche",
      "snowball",
      "utilization_target",
      "custom",
    ];
    expect(PAYOFF_STRATEGIES).toEqual(planner);
  });

  it("uses a stable lowercase guided strategy type", () => {
    const type: GuidedScenarioStrategyType = "debt_first_vs_save_first";
    expect(type).toBe("debt_first_vs_save_first");
  });

  it("accepts a write payload of IDs and decimal strings", () => {
    const payload: ScenarioGuidedStrategyWritePayload = {
      strategy_type: "debt_first_vs_save_first",
      source_account_id: 1,
      savings_account_id: 4,
      included_debt_account_ids: [7, 8],
      savings_transfer_rule_ids: [21],
      start_date: "2026-09-05",
      minimum_cash_buffer: "500.00",
      allocation_percent: "100.00",
      payoff_strategy: "avalanche",
      custom_debt_order_ids: [],
      resume_savings_after_payoff: true,
    };
    expect(payload.included_debt_account_ids).toHaveLength(2);
    expect(payload.minimum_cash_buffer).toBe("500.00");
  });

  it("describes a normalized read payload with nested account and rule refs", () => {
    const strategy: ScenarioGuidedStrategy = {
      id: 1,
      scenario_id: 12,
      strategy_type: "debt_first_vs_save_first",
      source_account: {
        id: 1,
        name: "Checking Source",
        effective_display_name: "Checking Source",
        account_type: "CHECKING",
      },
      savings_account: {
        id: 4,
        name: "Savings Dest",
        effective_display_name: "Savings Dest",
        account_type: "SAVINGS",
      },
      included_debt_accounts: [
        {
          id: 7,
          name: "Card A",
          effective_display_name: "Card A",
          account_type: "CREDIT",
        },
      ],
      savings_transfer_rules: [
        {
          id: 21,
          name: "Savings transfer",
          account_id: 1,
          transfer_to_account_id: 4,
        },
      ],
      start_date: "2026-09-05",
      minimum_cash_buffer: "500.00",
      allocation_percent: "100.00",
      payoff_strategy: "custom",
      custom_debt_order: [
        {
          id: 7,
          name: "Card A",
          effective_display_name: "Card A",
          account_type: "CREDIT",
          priority: 1,
        },
      ],
      resume_savings_after_payoff: true,
      created_at: "2026-09-04T00:00:00Z",
      updated_at: "2026-09-04T00:00:00Z",
    };
    expect(strategy.custom_debt_order[0]?.priority).toBe(1);
    expect(strategy.savings_transfer_rules[0]?.transfer_to_account_id).toBe(4);
  });
});
