import { describe, expect, it } from "vitest";
import type { Account, RecurringRule } from "@budget-app/shared";
import {
  eligibleGuidedDebtAccounts,
  eligibleGuidedSavingsAccounts,
  eligibleGuidedSourceAccounts,
  eligibleSavingsTransferRules,
} from "./guidedStrategyEligibility";

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
    transfer_to_account: mockAccount({ id: transfer_to_account_id, account_type: "SAVINGS" }),
    transfer_to_account_id,
    category: null,
    direction: "TRANSFER",
    amount: "200.00",
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
    created_at: "",
    updated_at: "",
    ...rest,
  } as RecurringRule;
}

describe("guidedStrategyEligibility", () => {
  it("filters source, savings, and credit-card debt from live account types and roles", () => {
    const source = mockAccount({ id: 11, account_type: "CHECKING", role: "spending" });
    const savings = mockAccount({ id: 22, account_type: "SAVINGS", role: "savings" });
    const card = mockAccount({ id: 33, account_type: "CREDIT", role: "credit_card" });
    const investment = mockAccount({ id: 44, account_type: "INVESTMENT", role: "investment" });
    const loan = mockAccount({ id: 55, account_type: "OTHER", role: "loan" });
    const accounts = [source, savings, card, investment, loan];

    expect(eligibleGuidedSourceAccounts(accounts).map((a) => a.id)).toEqual([11, 22]);
    expect(eligibleGuidedSavingsAccounts(accounts, 11).map((a) => a.id)).toEqual([22]);
    expect(eligibleGuidedDebtAccounts(accounts).map((a) => a.id)).toEqual([33]);
  });

  it("excludes the chosen source from savings destinations", () => {
    const one = mockAccount({ id: 1, account_type: "CHECKING" });
    const two = mockAccount({ id: 2, account_type: "SAVINGS" });
    expect(eligibleGuidedSavingsAccounts([one, two], 1).map((a) => a.id)).toEqual([2]);
    expect(eligibleGuidedSavingsAccounts([one, two], 2).map((a) => a.id)).toEqual([1]);
  });

  it("filters transfer rules by selected source and destination IDs, not names", () => {
    const matching = mockRule({ id: 80, account_id: 11, transfer_to_account_id: 22, name: "Keep" });
    const wrongDest = mockRule({ id: 81, account_id: 11, transfer_to_account_id: 99, name: "Other dest" });
    const wrongSource = mockRule({ id: 82, account_id: 99, transfer_to_account_id: 22, name: "Other source" });
    const rules = [matching, wrongDest, wrongSource];

    expect(eligibleSavingsTransferRules(rules, 11, 22).map((r) => r.id)).toEqual([80]);
    expect(eligibleSavingsTransferRules(rules, null, 22)).toEqual([]);
  });
});
