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
  relationships: [],
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
  it("shows Open Ledger, Forecast, Move Money for checking/spending", () => {
    const account = baseAccount();
    const labels = primaryLabels(account, "spending");
    expect(labels).toEqual(["Open Ledger", "Forecast", "Move Money"]);
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

  it("puts Add Transaction and Schedule in overflow for checking", () => {
    const account = baseAccount();
    const ids = secondaryIds(account, "spending");
    expect(ids).toContain("add_transaction");
    expect(ids).toContain("schedule");
  });

  it("shows Make Payment instead of Move Money for credit cards", () => {
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
    expect(labels).toContain("Make Payment");
    expect(labels).not.toContain("Move Money");
    expect(labels).toEqual(["Open Ledger", "Forecast", "Make Payment"]);
  });

  it("puts purchase and schedule payment in overflow for credit cards", () => {
    const card = baseAccount({
      id: 2,
      account_type: "CREDIT",
      role: "credit_card",
      statement_balance: "400.00",
    });
    const ids = secondaryIds(card, "credit_card");
    expect(ids).toContain("add_purchase");
    expect(ids).toContain("schedule_payment");
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
    expect(labels).toEqual(["Open Ledger", "Forecast", "Move Money"]);
    const ids = buildAccountQuickActions(savings, "savings", ctx({ allAccounts: [savings, checking] }))
      .secondary.map((a) => a.id);
    expect(ids).toContain("schedule_savings");
    expect(ids).not.toContain("add_expense");
  });

  it("shows loan primaries with Make Payment", () => {
    const loan = baseAccount({
      id: 5,
      account_type: "LOAN",
      role: "loan",
      minimum_payment_amount: "250.00",
    });
    const labels = primaryLabels(loan, "loan");
    expect(labels).toEqual(["Open Ledger", "Forecast", "Make Payment"]);
  });

  it("shows investment primaries without Move Money", () => {
    const inv = baseAccount({
      id: 6,
      account_type: "INVESTMENT",
      role: "investment",
    });
    const labels = primaryLabels(inv, "investment");
    expect(labels).toEqual(["Open Ledger", "Forecast"]);
    const ids = secondaryIds(inv, "investment");
    expect(ids).toContain("add_contribution");
    expect(ids).toContain("schedule_contribution");
  });

  it("shows reconcile/import with badge when plaid-linked and unmatched imports", () => {
    const account = baseAccount({
      health_details: { unmatched_import_count: 3 },
    });
    const { secondary } = buildAccountQuickActions(
      account,
      "spending",
      ctx({ plaidLinkedAccountIds: new Set([1]), allAccounts: [account] })
    );
    const reconcile = secondary.find((a) => a.id === "reconcile");
    expect(reconcile?.badge).toBe(3);
    expect(secondary.some((a) => a.id === "import_txns")).toBe(true);
  });

  it("prefills relationship transfer from outgoing link", () => {
    const checking = baseAccount({ id: 1 });
    const savings = baseAccount({ id: 2, account_type: "SAVINGS", role: "savings", name: "Save" });
    const { secondary } = buildAccountQuickActions(
      checking,
      "spending",
      ctx({
        allAccounts: [checking, savings],
        relationships: [
          {
            id: 99,
            source_account: 1,
            source_account_name: "Checking",
            destination_account: 2,
            destination_account_name: "Save",
            relationship_type: "savings_funding",
            relationship_type_display: "Savings",
            frequency: "monthly",
            is_active: true,
            default_amount: "200.00",
          },
        ],
      })
    );
    const relAction = secondary.find((a) => a.payload?.relationshipId === 99);
    expect(relAction?.payload?.transferToAccountId).toBe(2);
    expect(relAction?.payload?.amount).toBe("200.00");
  });

  it("preselects source account on Move Money primary action", () => {
    const account = baseAccount({ id: 7 });
    const { primary } = buildAccountQuickActions(account, "spending", ctx({ allAccounts: [account] }));
    const move = primary.find((a) => a.id === "transfer");
    expect(move?.label).toBe("Move Money");
    expect(move?.payload?.transferFromAccountId).toBe(7);
  });
});

describe("buildAccountManagementActions", () => {
  it("includes destructive actions in danger zone", () => {
    const { secondary, danger } = buildAccountManagementActions({
      isDefault: false,
      lifecycle: "active",
    });
    expect(secondary.some((a) => a.id === "mgmt_edit")).toBe(true);
    expect(secondary.some((a) => a.id === "mgmt_archive")).toBe(true);
    expect(danger.map((a) => a.id)).toEqual(["mgmt_clear_ledger", "mgmt_delete"]);
    expect(danger.every((a) => a.danger)).toBe(true);
  });
});

describe("accountRoleForQuickActions", () => {
  it("infers role from type when missing", () => {
    const acc = baseAccount({ role: undefined, account_type: "CREDIT" });
    expect(accountRoleForQuickActions(acc)).toBe("credit_card");
  });
});
