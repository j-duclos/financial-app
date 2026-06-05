import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import { buildAccountForecastAlerts } from "./accountForecastAlerts";

function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CHECKING",
    role: "spending",
    name: "Main",
    institution: "Chase",
    currency: "USD",
    is_active: true,
    status: "active",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Account;
}

describe("buildAccountForecastAlerts", () => {
  it("flags bank accounts with negative lowest projected balance", () => {
    const alerts = buildAccountForecastAlerts(
      [
        mockAccount({
          id: 1,
          lowest_projected_balance_30_days: "-37.06",
          risk_date: "2026-06-17",
        }),
      ],
      30
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("negative_projected");
    expect(alerts[0].headline).toContain("Projected overdrawn");
    expect(alerts[0].detail).toContain("-$37.06");
  });

  it("flags credit cards over the limit", () => {
    const alerts = buildAccountForecastAlerts(
      [
        mockAccount({
          id: 2,
          account_type: "CREDIT",
          role: "credit_card",
          name: "Venture",
          credit_limit: "1000",
          current_balance: "1231.20",
          utilization_percent: "123.12",
        }),
      ],
      30
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("over_limit");
    expect(alerts[0].headline).toContain("Venture");
  });

  it("returns empty when all accounts are healthy", () => {
    const alerts = buildAccountForecastAlerts(
      [
        mockAccount({
          lowest_projected_balance_30_days: "500",
          available_to_spend: "200",
        }),
        mockAccount({
          id: 2,
          account_type: "CREDIT",
          role: "credit_card",
          credit_limit: "5000",
          current_balance: "100",
          utilization_percent: "2",
        }),
      ],
      30
    );
    expect(alerts).toEqual([]);
  });
});
