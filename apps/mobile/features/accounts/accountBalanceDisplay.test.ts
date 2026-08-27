import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  resolveAccountBalanceDisplay,
  resolveListPrimaryBalance,
  resolvePostedCurrentBalance,
  shouldShowAccountHealthBadge,
} from "./accountBalanceDisplay";

function cashAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: 1,
    name: "360 Checking",
    account_type: "CHECKING",
    role: "spending",
    currency: "USD",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    balance: "400.00",
    available_balance: "400.00",
    ...overrides,
  } as Account;
}

describe("account balance semantics", () => {
  it("labels list cash primary as Current from ledger balance, never forecast/STS", () => {
    const primary = resolveListPrimaryBalance(
      cashAccount({
        available_balance: "415.85",
        available_to_spend: "200.00",
        projected_balance_30_days: "100.00",
      })
    );
    expect(primary).toEqual({ label: "Current", amount: "415.85" });
  });

  it("uses forecast_summary.current_balance as posted Current when enrichment is present", () => {
    const account = cashAccount({
      available_balance: "350.00",
      balance: "350.00",
      forecast_summary: { current_balance: "400.00" },
      available_to_spend: "250.00",
    });
    expect(resolvePostedCurrentBalance(account)).toBe("400.00");
    const display = resolveAccountBalanceDisplay(account);
    expect(display.kind).toBe("cash");
    if (display.kind === "cash") {
      expect(display.primary).toBe("400.00");
      expect(display.primaryLabel).toBe("Current balance");
      expect(display.afterPending).toBe("350.00");
      expect(display.safeToSpend).toBe("250.00");
    }
  });

  it("does not show After pending when it matches Current", () => {
    const display = resolveAccountBalanceDisplay(
      cashAccount({
        available_balance: "400.00",
        forecast_summary: { current_balance: "400.00" },
      })
    );
    expect(display.kind).toBe("cash");
    if (display.kind === "cash") {
      expect(display.afterPending).toBeNull();
    }
  });

  it("uses credit semantics for credit accounts", () => {
    const display = resolveAccountBalanceDisplay(
      cashAccount({
        account_type: "CREDIT",
        balance_owed: "926.24",
        available_credit: "3873.76",
        credit_limit: "4800.00",
        utilization_percent: "19.30",
        available_balance: "3873.76",
      })
    );
    expect(display.kind).toBe("credit");
    if (display.kind === "credit") {
      expect(display.owed).toBe("926.24");
      expect(display.availableCredit).toBe("3873.76");
      expect(display.creditLimit).toBe("4800.00");
    }
  });

  it("hides healthy list badges and keeps watch/risk/critical", () => {
    expect(shouldShowAccountHealthBadge("healthy")).toBe(false);
    expect(shouldShowAccountHealthBadge(null)).toBe(false);
    expect(shouldShowAccountHealthBadge("watch")).toBe(true);
    expect(shouldShowAccountHealthBadge("critical")).toBe(true);
  });
});
