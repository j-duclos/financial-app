import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  buildAccountQuickActions,
  buildAccountManagementActions,
  accountRoleForQuickActions,
  type QuickActionsContext,
} from "./accountQuickActions";

function baseAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: { id: 10, name: "Home" },
    name: "Main Checking",
    display_name: "Main Checking",
    account_type: "CHECKING",
    role: "spending",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Account;
}

const ctx = (overrides: Partial<QuickActionsContext> = {}): QuickActionsContext => ({
  plaidLinkedAccountIds: new Set<number>(),
  allAccounts: [],
  forecastDays: 30,
  ...overrides,
});

function primaryLabels(account: Account, role: Account["role"] = account.role!) {
  const { primary } = buildAccountQuickActions(account, role!, ctx({ allAccounts: [account] }));
  return primary.map((a) => a.label);
}

function secondaryIds(account: Account, role: Account["role"] = account.role!) {
  const { secondary } = buildAccountQuickActions(account, role!, ctx({ allAccounts: [account] }));
  return secondary.map((a) => a.id);
}

describe("buildAccountQuickActions", () => {
  it("shows Open Ledger and Transfer Money for checking/spending", () => {
    const account = baseAccount();
    const labels = primaryLabels(account, "spending");
    expect(labels).toEqual(["Open Ledger", "Transfer Money"]);
    expect(labels).not.toContain("Add expense");
    expect(labels).not.toContain("Schedule");
  });

  it("does not show Add Expense or Schedule as primary actions", () => {
    const account = baseAccount();
    const { primary } = buildAccountQuickActions(account, "spending", ctx({ allAccounts: [account] }));
    const ids = primary.map((a) => a.id);
    expect(ids).not.toContain("add_expense");
    expect(ids).not.toContain("schedule");
  });

  it("does not show Add Transaction or Schedule Payment in overflow", () => {
    const account = baseAccount();
    const ids = secondaryIds(account, "spending");
    expect(ids).not.toContain("add_transaction");
    expect(ids).not.toContain("schedule");
    expect(ids).not.toContain("add_income");
    expect(ids).not.toContain("move_to_savings");
    expect(ids).toContain("reconcile");
  });

  it("does not add relationship shortcuts to checking overflow", () => {
    const checking = baseAccount({ id: 1, name: "Checking" });
    const savor = baseAccount({
      id: 2,
      name: "Savor",
      account_type: "CREDIT",
      role: "credit_card",
    });
    const savings = baseAccount({
      id: 3,
      name: "Savings",
      account_type: "SAVINGS",
      role: "savings",
    });
    const { secondary } = buildAccountQuickActions(
      checking,
      "spending",
      ctx({ allAccounts: [checking, savor, savings] })
    );
    expect(secondary.some((a) => a.id === "relationship_transfer")).toBe(false);
    expect(secondary.some((a) => a.id === "pay_card" && a.label.includes("Savor"))).toBe(false);
  });

  it("shows Payment Planner instead of Transfer Money for credit cards", () => {
    const card = baseAccount({
      id: 2,
      name: "Venture",
      account_type: "CREDIT",
      role: "credit_card",
      balance_owed: "500.00",
      statement_balance: "400.00",
      minimum_payment_amount: "35.00",
    });
    const labels = primaryLabels(card, "credit_card");
    expect(labels).toContain("Payment Planner");
    expect(labels).not.toContain("Transfer Money");
    expect(labels).toEqual(["Open Ledger", "Payment Planner"]);
  });

  it("keeps credit card overflow minimal without purchase, payment, or statement shortcuts", () => {
    const card = baseAccount({
      id: 2,
      account_type: "CREDIT",
      role: "credit_card",
      statement_balance: "400.00",
      minimum_payment_amount: "35.00",
      balance_owed: "500.00",
      utilization_percent: "72.5",
    });
    const ids = secondaryIds(card, "credit_card");
    expect(ids).toContain("reconcile");
    expect(ids).not.toContain("add_purchase");
    expect(ids).not.toContain("schedule_payment");
    expect(ids).not.toContain("view_statement");
    expect(ids).not.toContain("pay_statement");
    expect(ids).not.toContain("pay_minimum");
    expect(ids).not.toContain("pay_current");
    expect(ids).not.toContain("payment_planner");
    expect(ids).not.toContain("link_payment");
    expect(ids).not.toContain("view_utilization");
    expect(ids).not.toContain("import_txns");
    expect(ids).not.toContain("add_transaction");
    expect(ids).not.toContain("schedule");
  });

  it("shows savings monitoring primaries without expense actions", () => {
    const savings = baseAccount({
      id: 3,
      account_type: "SAVINGS",
      role: "savings",
      name: "Emergency",
    });
    const checking = baseAccount({ id: 4, name: "Checking" });
    const labels = primaryLabels(savings, "savings");
    expect(labels).toEqual(["Open Ledger", "Transfer Money"]);
    const ids = buildAccountQuickActions(savings, "savings", ctx({ allAccounts: [savings, checking] }))
      .secondary.map((a) => a.id);
    expect(ids).toContain("reconcile");
    expect(ids).not.toContain("schedule_savings");
    expect(ids).not.toContain("add_transaction");
    expect(ids).not.toContain("add_expense");
  });

  it("shows loan primaries with Payment Planner", () => {
    const loan = baseAccount({
      id: 5,
      account_type: "LOAN",
      role: "loan",
      minimum_payment_amount: "250.00",
    });
    const labels = primaryLabels(loan, "loan");
    expect(labels).toEqual(["Open Ledger", "Payment Planner"]);
  });

  it("shows investment primaries without Transfer Money", () => {
    const inv = baseAccount({
      id: 6,
      account_type: "INVESTMENT",
      role: "investment",
    });
    const labels = primaryLabels(inv, "investment");
    expect(labels).toEqual(["Open Ledger"]);
    const ids = secondaryIds(inv, "investment");
    expect(ids).toContain("reconcile");
    expect(ids).not.toContain("add_contribution");
    expect(ids).not.toContain("schedule_contribution");
    expect(ids).not.toContain("add_transaction");
    expect(ids).not.toContain("schedule");
  });

  it("shows reconcile for all accounts, with plaid unmatched hint when linked", () => {
    const account = baseAccount({
      health_details: { unmatched_import_count: 3 },
    });
    const { secondary } = buildAccountQuickActions(
      account,
      "spending",
      ctx({ plaidLinkedAccountIds: new Set([1]), allAccounts: [account] })
    );
    const reconcile = secondary.find((a) => a.id === "reconcile");
    expect(reconcile?.badge).toBeUndefined();
    expect(reconcile?.tooltip).toBe("3 unmatched import(s)");
    expect(secondary.some((a) => a.id === "import_txns")).toBe(false);
  });

  it("shows reconcile for manual accounts without plaid link", () => {
    const card = baseAccount({
      id: 2,
      account_type: "CREDIT",
      role: "credit_card",
    });
    const { secondary } = buildAccountQuickActions(card, "credit_card", ctx({ allAccounts: [card] }));
    const reconcile = secondary.find((a) => a.id === "reconcile");
    expect(reconcile?.label).toBe("Reconcile");
    expect(reconcile?.tooltip).toBe("Compare your ledger to your statement balance");
  });

  it("Transfer Money primary has no preset accounts", () => {
    const account = baseAccount({ id: 7 });
    const { primary } = buildAccountQuickActions(account, "spending", ctx({ allAccounts: [account] }));
    const transfer = primary.find((a) => a.id === "transfer");
    expect(transfer?.label).toBe("Transfer Money");
    expect(transfer?.payload).toBeUndefined();
  });

  it("move before risk defaults to account as destination", () => {
    const account = baseAccount({
      id: 7,
      lowest_projected_balance_30_days: "-37.06",
      available_to_spend: "-37.06",
      health_risk_date: "2026-06-17",
    });
    const { primary, secondary } = buildAccountQuickActions(
      account,
      "spending",
      ctx({ allAccounts: [account] })
    );
    const transfer = primary.find((a) => a.id === "transfer");
    expect(transfer?.label).toBe("Transfer Money");
    expect(transfer?.payload).toBeUndefined();
    const beforeRisk = secondary.find((a) => a.id === "move_before_risk");
    expect(beforeRisk?.payload?.transferToAccountId).toBe(7);
    expect(beforeRisk?.payload?.amount).toBe("37.06");
    expect(beforeRisk?.payload?.transferFromAccountId).toBeUndefined();
  });
});

describe("buildAccountManagementActions", () => {
  it("includes destructive actions in danger zone", () => {
    const { secondary, danger } = buildAccountManagementActions({
      isDefault: false,
      lifecycle: "active",
    });
    expect(secondary.some((a) => a.id === "mgmt_edit")).toBe(true);
    expect(secondary.some((a) => a.id === "mgmt_archive")).toBe(false);
    expect(secondary.some((a) => a.id === "mgmt_close")).toBe(false);
    const closeAction = danger.find((a) => a.id === "mgmt_close");
    expect(closeAction?.label).toBe("Close Account");
    expect(danger.map((a) => a.id)).toEqual(["mgmt_close", "mgmt_delete"]);
    expect(danger.every((a) => a.danger)).toBe(true);
  });
});

describe("accountRoleForQuickActions", () => {
  it("infers role from type when missing", () => {
    const acc = baseAccount({ role: undefined, account_type: "CREDIT" });
    expect(accountRoleForQuickActions(acc)).toBe("credit_card");
  });
});
