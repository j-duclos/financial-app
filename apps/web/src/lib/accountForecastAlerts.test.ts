import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  buildAccountForecastAlerts,
  buildPortfolioForecastAlert,
} from "./accountForecastAlerts";

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
          lowest_projected_balance_date_30_days: "2026-06-17",
          risk_date: "2026-06-10",
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

describe("buildPortfolioForecastAlert", () => {
  it("summarizes a single spending shortfall without duplicating account-row detail", () => {
    const alert = buildPortfolioForecastAlert(
      [
        mockAccount({
          id: 1,
          name: "Main",
          display_name: "Main",
          lowest_projected_balance_30_days: "-1691.36",
          lowest_projected_balance_date_30_days: "2026-09-10",
          first_negative_balance: "-996.62",
          first_negative_date: "2026-08-20",
          health_risk_date: "2026-08-20",
        }),
      ],
      30
    );
    expect(alert).not.toBeNull();
    expect(alert?.headline).toBe(
      "1 spending account is projected to run short within 30 days."
    );
    expect(alert?.earliestLine).toBe("Earliest: Main on Aug 20 · $996.62 needed");
    expect(alert?.earliestAccountId).toBe(1);
    expect(alert?.resolveSpendingRisk).toBe(true);
  });

  it("scales to multiple shortfalls and uses the earliest date", () => {
    const alert = buildPortfolioForecastAlert(
      [
        mockAccount({
          id: 1,
          name: "Main",
          display_name: "Main",
          role: "spending",
          first_negative_date: "2026-08-20",
          first_negative_balance: "-996.62",
          lowest_projected_balance_30_days: "-1691.36",
          health_risk_date: "2026-08-20",
        }),
        mockAccount({
          id: 2,
          name: "Bills",
          display_name: "Bills",
          role: "bills",
          first_negative_date: "2026-08-28",
          first_negative_balance: "-200.00",
          lowest_projected_balance_30_days: "-200.00",
          health_risk_date: "2026-08-28",
        }),
        mockAccount({
          id: 3,
          name: "Reserve",
          display_name: "Reserve",
          role: "cash_reserve",
          first_negative_date: "2026-09-02",
          first_negative_balance: "-50.00",
          lowest_projected_balance_30_days: "-50.00",
          health_risk_date: "2026-09-02",
        }),
      ],
      30
    );
    expect(alert?.headline).toBe("3 accounts are projected to run short within 30 days.");
    expect(alert?.earliestLine).toContain("Main");
    expect(alert?.earliestLine).toContain("Aug 20");
    expect(alert?.earliestAccountId).toBe(1);
  });

  it("hides the banner when nothing is projected to run short", () => {
    expect(
      buildPortfolioForecastAlert(
        [
          mockAccount({
            lowest_projected_balance_30_days: "500",
            available_to_spend: "200",
          }),
        ],
        30
      )
    ).toBeNull();
  });

  it("does not treat high utilization as a portfolio shortfall", () => {
    expect(
      buildPortfolioForecastAlert(
        [
          mockAccount({
            id: 2,
            account_type: "CREDIT",
            role: "credit_card",
            name: "Venture",
            credit_limit: "3000",
            current_balance: "2940",
            utilization_percent: "98",
            health_status: "risk",
          }),
        ],
        30
      )
    ).toBeNull();
  });

  it("summarizes over-limit cards when nothing is projected to run short", () => {
    const alert = buildPortfolioForecastAlert(
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
    expect(alert?.headline).toBe("1 credit card is over its limit.");
    expect(alert?.resolveSpendingRisk).toBe(false);
  });
});
