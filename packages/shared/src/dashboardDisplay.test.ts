import { describe, expect, it } from "vitest";
import type { DashboardLowestProjectedCash, ExtendedCashRisk } from "../types";
import {
  availableCreditSubtitle,
  creditUtilizationSummary,
  isLookingAheadVisible,
  lookingAheadMessage,
  lowestProjectedCashDisplayValue,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
} from "./dashboardDisplay";
import {
  DASHBOARD_SECTION,
  FINANCIAL_HEALTH,
  LOOKING_AHEAD,
  lowestForecastBalanceLabel,
} from "./dashboardTerminology";
import { EXTENDED_CASH_RISK_QUERY_KEY, EXTENDED_CASH_RISK_STALE_MS } from "./extendedCashRiskQuery";

describe("shared dashboardDisplay", () => {
  it("builds identical top-summary and credit/LPC subtitles for Web and Mobile", () => {
    const top = topSummaryFromDashboard({
      top_summary: undefined,
      snapshot: {
        cash: "100",
        savings: "50",
        credit_debt: "0",
        utilization: "12",
        net_position: "150",
        cash_change_pct: null,
        savings_change_pct: null,
        net_position_change_pct: null,
      },
    });
    expect(top.liquid_cash).toBe("150");
    expect(top.credit_utilization).toBe("12");

    const metric: DashboardLowestProjectedCash = {
      amount: "421.18",
      account_id: 1,
      account_name: "Main",
      date: "2026-07-22",
      is_negative: false,
    };
    expect(lowestProjectedCashSubtitle(metric)).toBe("Main · Jul 22");
    expect(lowestProjectedCashDisplayValue("-298.74")).toBe("-$298.74");
    expect(creditUtilizationSummary("41")).toBe("41% of limit in use");
    expect(availableCreditSubtitle("41", "8800")).toMatch(/Of \$8,800\.00 total limit/);
  });

  it("formats looking-ahead visibility and copy", () => {
    const risk: ExtendedCashRisk = {
      account_id: 1,
      account_name: "Main",
      first_negative_date: "2026-09-23",
      projected_balance: "-12.50",
      days_from_as_of: 38,
      additional_accounts: [],
    };
    expect(isLookingAheadVisible({ as_of: "2026-08-16", horizon_days: 180, risk }, 30)).toBe(true);
    expect(isLookingAheadVisible({ as_of: "2026-08-16", horizon_days: 180, risk }, 60)).toBe(false);
    expect(lookingAheadMessage(risk)).toBe(
      "Main is projected to fall below $0 on Sep 23, 38 days from now."
    );
  });
});

describe("shared dashboardTerminology", () => {
  it("keeps canonical financial health labels", () => {
    expect(DASHBOARD_SECTION.financialHealth).toBe("Financial Health");
    expect(FINANCIAL_HEALTH.lowestProjectedCash.label).toBe("Lowest Forecast Balance");
    expect(FINANCIAL_HEALTH.availableCash.label).toBe("Available Cash");
    expect(FINANCIAL_HEALTH.availableCredit.label).toBe("Available Credit");
    expect(FINANCIAL_HEALTH.cashAfterDebt.label).toBe("Liquid Net Position");
    expect(LOOKING_AHEAD.label).toBe("Looking ahead");
    expect(lowestForecastBalanceLabel(30)).toBe("Lowest Forecast Balance (30 Days)");
    expect(lowestForecastBalanceLabel(180)).toBe("Lowest Forecast Balance (6 Months)");
  });
});

describe("shared extendedCashRiskQuery", () => {
  it("centralizes query key and staleTime", () => {
    expect(EXTENDED_CASH_RISK_QUERY_KEY).toEqual(["extended-cash-risk"]);
    expect(EXTENDED_CASH_RISK_STALE_MS).toBe(60_000);
  });
});
