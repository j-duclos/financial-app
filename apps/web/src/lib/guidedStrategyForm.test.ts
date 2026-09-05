import { describe, expect, it } from "vitest";
import type { Account, RecurringRule, ScenarioGuidedStrategy } from "@budget-app/shared";
import {
  applyUnambiguousGuidedDefaults,
  buildGuidedStrategyPayload,
  emptyGuidedStrategyForm,
  formFromGuidedStrategy,
  localTodayIso,
  moveCustomDebtOrderId,
  syncCustomDebtOrder,
  validateGuidedStrategyForm,
} from "./guidedStrategyForm";

function mockAccount(overrides: Partial<Account> & { id: number }): Account {
  const { id, ...rest } = overrides;
  return {
    id,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CHECKING",
    role: "spending",
    name: `Account ${id}`,
    institution: "Bank",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...rest,
  } as Account;
}

function mockRule(
  overrides: Partial<RecurringRule> & { id: number; account_id: number; transfer_to_account_id: number }
): RecurringRule {
  const { id, account_id, transfer_to_account_id, ...rest } = overrides;
  return {
    id,
    household: 1,
    name: `Rule ${id}`,
    account: mockAccount({ id: account_id }),
    account_id,
    transfer_to_account_id,
    category: null,
    direction: "TRANSFER",
    amount: "150.00",
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
    created_at: "",
    updated_at: "",
    ...rest,
  } as RecurringRule;
}

const existing: ScenarioGuidedStrategy = {
  id: 9,
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
  included_debt_accounts: [
    { id: 33, name: "Card A", effective_display_name: "Card A", account_type: "CREDIT" },
    { id: 44, name: "Card B", effective_display_name: "Card B", account_type: "CREDIT" },
  ],
  savings_transfer_rules: [{ id: 80, name: "To reserve", account_id: 11, transfer_to_account_id: 22 }],
  start_date: "2026-09-01",
  minimum_cash_buffer: "250.00",
  allocation_percent: "80.00",
  payoff_strategy: "custom",
  custom_debt_order: [
    { id: 44, name: "Card B", effective_display_name: "Card B", account_type: "CREDIT" },
    { id: 33, name: "Card A", effective_display_name: "Card A", account_type: "CREDIT" },
  ],
  resume_savings_after_payoff: false,
  created_at: "2026-09-04T00:00:00Z",
  updated_at: "2026-09-04T01:00:00Z",
};

describe("guidedStrategyForm", () => {
  it("uses the user's current local date and 100% allocation for a new strategy", () => {
    const now = new Date(2026, 8, 4);
    const form = emptyGuidedStrategyForm(now);
    expect(form.startDate).toBe(localTodayIso(now));
    expect(form.startDate).toBe("2026-09-04");
    expect(form.allocationPercent).toBe("100");
    expect(form.minimumCashBuffer).toBe("0.00");
    expect(form.resumeSavingsAfterPayoff).toBe(true);
    expect(form.sourceAccountId).toBeNull();
  });

  it("hydrates an existing strategy without inventing IDs", () => {
    const form = formFromGuidedStrategy(existing);
    expect(form.sourceAccountId).toBe(existing.source_account.id);
    expect(form.savingsAccountId).toBe(existing.savings_account.id);
    expect(form.savingsTransferRuleIds).toEqual([80]);
    expect(form.includedDebtAccountIds).toEqual([33, 44]);
    expect(form.customDebtOrderIds).toEqual([44, 33]);
    expect(form.minimumCashBuffer).toBe("250.00");
    expect(form.allocationPercent).toBe("80");
    expect(form.resumeSavingsAfterPayoff).toBe(false);
  });

  it("infers defaults only when each choice is unambiguous", () => {
    const uniqueSource = mockAccount({ id: 11, account_type: "CHECKING", role: "spending" });
    const uniqueSavings = mockAccount({
      id: 22,
      account_type: "OTHER",
      role: "emergency_fund",
      name: "Reserve bucket",
    });
    const extraSource = mockAccount({ id: 12, account_type: "CASH", role: "spending" });
    const uniqueRule = mockRule({ id: 80, account_id: 11, transfer_to_account_id: 22 });
    const uniqueDebt = mockAccount({ id: 33, account_type: "CREDIT", role: "credit_card" });

    const unambiguous = applyUnambiguousGuidedDefaults(
      emptyGuidedStrategyForm(new Date(2026, 8, 4)),
      [uniqueSource, uniqueSavings, uniqueDebt],
      [uniqueRule]
    );
    expect(unambiguous.sourceAccountId).toBe(11);
    expect(unambiguous.savingsAccountId).toBe(22);
    expect(unambiguous.savingsTransferRuleIds).toEqual([80]);
    expect(unambiguous.includedDebtAccountIds).toEqual([33]);

    const ambiguous = applyUnambiguousGuidedDefaults(
      emptyGuidedStrategyForm(new Date(2026, 8, 4)),
      [uniqueSource, extraSource, uniqueSavings, uniqueDebt],
      [uniqueRule]
    );
    expect(ambiguous.sourceAccountId).toBeNull();
    expect(ambiguous.savingsAccountId).toBeNull();
    expect(ambiguous.savingsTransferRuleIds).toEqual([]);
  });

  it("builds a write payload from selected IDs without hardcoded account data", () => {
    const form = formFromGuidedStrategy(existing);
    const payload = buildGuidedStrategyPayload(form);
    expect(payload.source_account_id).toBe(form.sourceAccountId);
    expect(payload.savings_account_id).toBe(form.savingsAccountId);
    expect(payload.included_debt_account_ids).toEqual(form.includedDebtAccountIds);
    expect(payload.savings_transfer_rule_ids).toEqual(form.savingsTransferRuleIds);
    expect(payload.custom_debt_order_ids).toEqual([44, 33]);
    expect(payload.custom_debt_order_ids).toEqual(
      expect.arrayContaining(payload.included_debt_account_ids)
    );
    expect(new Set(payload.custom_debt_order_ids).size).toBe(
      payload.included_debt_account_ids.length
    );
    expect(payload.strategy_type).toBe("debt_first_vs_save_first");
  });

  it("keeps custom order as every selected debt exactly once", () => {
    expect(syncCustomDebtOrder([33, 44, 55], [44, 33])).toEqual([44, 33, 55]);
    expect(syncCustomDebtOrder([33], [44, 33, 55])).toEqual([33]);
    expect(moveCustomDebtOrderId([33, 44, 55], 44, "up")).toEqual([44, 33, 55]);
    expect(moveCustomDebtOrderId([33, 44, 55], 44, "down")).toEqual([33, 55, 44]);
  });

  it("requires a transfer rule and a credit card before save", () => {
    const form = emptyGuidedStrategyForm(new Date(2026, 8, 4));
    form.sourceAccountId = 11;
    form.savingsAccountId = 22;
    expect(validateGuidedStrategyForm(form, 2).savings_transfer_rule_ids).toBeTruthy();
    expect(validateGuidedStrategyForm(form, 3).included_debt_account_ids).toBeTruthy();
    form.savingsTransferRuleIds = [80];
    form.includedDebtAccountIds = [33];
    form.customDebtOrderIds = [33];
    expect(validateGuidedStrategyForm(form)).toEqual({});
  });
});
