import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  computePortfolioSummary,
  isPortfolioSavingsAccount,
} from "./portfolioSummary";
import { isDebtAccount } from "./accountOrganization";

function account(overrides: Partial<Account> & Pick<Account, "id">): Account {
  return {
    id: overrides.id,
    household: 1,
    name: overrides.name ?? "Account",
    account_type: overrides.account_type ?? "CHECKING",
    role: overrides.role ?? "spending",
    currency: "USD",
    balance: overrides.balance ?? "0",
    available_balance: overrides.available_balance ?? overrides.balance ?? "0",
    is_active: true,
    status: "active",
    ...overrides,
  } as Account;
}

describe("portfolioSummary", () => {
  it("classifies savings and debt buckets like dashboard snapshot", () => {
    expect(isPortfolioSavingsAccount(account({ id: 1, role: "savings" }))).toBe(true);
    expect(isPortfolioSavingsAccount(account({ id: 2, role: "spending" }))).toBe(false);
    expect(isDebtAccount(account({ id: 3, account_type: "CREDIT", role: "credit_card" }))).toBe(
      true
    );
  });

  it("computes net position as cash + savings − debt", () => {
    const summary = computePortfolioSummary([
      account({ id: 1, role: "spending", available_balance: "1000" }),
      account({ id: 2, role: "savings", available_balance: "500" }),
      account({
        id: 3,
        account_type: "CREDIT",
        role: "credit_card",
        balance_owed: "300",
        current_balance: "300",
      }),
    ]);

    expect(summary.spending.displayTotal).toBe(1000);
    expect(summary.savings.displayTotal).toBe(500);
    expect(summary.debt.displayTotal).toBe(300);
    expect(summary.netPosition).toBe(1200);
  });
});
