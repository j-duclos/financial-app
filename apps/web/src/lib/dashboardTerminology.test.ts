import { describe, expect, it } from "vitest";
import {
  DASHBOARD_FUTURE_METRICS,
  DASHBOARD_SECTION,
  DEPRECATED_DASHBOARD_LABELS,
  FINANCIAL_HEALTH,
  RESOURCE_BREAKDOWN,
} from "./dashboardTerminology";

describe("dashboardTerminology", () => {
  it("defines financial health and resource breakdown sections", () => {
    expect(DASHBOARD_SECTION.financialHealth).toBe("Financial Health");
    expect(DASHBOARD_SECTION.resourceBreakdown).toBe("Resource Breakdown");
  });

  it("uses human-first financial health labels", () => {
    expect(FINANCIAL_HEALTH.lowestProjectedCash.label).toBe("Lowest Projected Cash");
    expect(FINANCIAL_HEALTH.availableCash.label).toBe("Available Cash");
    expect(FINANCIAL_HEALTH.availableCredit.label).toBe("Available Credit");
    expect(FINANCIAL_HEALTH.cashAfterDebt.label).toBe("Cash After Debt");
    expect(FINANCIAL_HEALTH.cashAfterDebt.subtitle).toBe(
      "Available cash minus total debt"
    );
    expect(FINANCIAL_HEALTH.lowestProjectedCash.help).toMatch(
      /lowest actual projected balance among your active cash accounts/i
    );
    expect(FINANCIAL_HEALTH.availableCash.help).toMatch(/checking, savings, and cash accounts/i);
    expect(FINANCIAL_HEALTH.availableCash.help).toMatch(/excludes bills pools/i);
    expect(FINANCIAL_HEALTH.cashAfterDebt.help).toMatch(
      /current liquid cash minus current total debt/i
    );
    expect(FINANCIAL_HEALTH.cashAfterDebt.help).toMatch(/not a forecasted balance/i);
  });

  it("uses resource breakdown labels without net position", () => {
    expect(RESOURCE_BREAKDOWN.spendingAccounts.label).toBe("Spending Accounts");
    expect(RESOURCE_BREAKDOWN.debtOwed.label).toBe("Debt Owed");
    expect(RESOURCE_BREAKDOWN.savingsInvestments.label).toBe("Savings & Investments");
  });

  it("deprecates accounting jargon for linting in UI tests", () => {
    expect(DEPRECATED_DASHBOARD_LABELS).toContain("Net Position");
    expect(DEPRECATED_DASHBOARD_LABELS).toContain("Liquid Cash");
    expect(DEPRECATED_DASHBOARD_LABELS).toContain("Financial Snapshot");
  });

  it("reserves net worth for future asset tracking", () => {
    expect(DASHBOARD_FUTURE_METRICS.netWorth).toBe("Net Worth");
  });
});
