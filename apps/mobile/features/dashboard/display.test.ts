import { describe, expect, it } from "vitest";
import type { DashboardLowestProjectedCash, ExtendedCashRisk } from "@budget-app/shared";
import {
  attentionItemsLimited,
  availableCreditSubtitle,
  isDashboardOnboarding,
  isLookingAheadVisible,
  lookingAheadMessage,
  lowestProjectedCashSubtitle,
  topSummaryFromDashboard,
} from "./display";

describe("dashboard display helpers", () => {
  it("builds lowest projected cash subtitle from account and date only", () => {
    const metric: DashboardLowestProjectedCash = {
      amount: "421.18",
      account_id: 1,
      account_name: "Main",
      date: "2026-07-22",
      is_negative: false,
    };
    expect(lowestProjectedCashSubtitle(metric)).toBe("Main · Jul 22");
  });

  it("formats available credit subtitle with limit and utilization", () => {
    expect(availableCreditSubtitle("41", "8800")).toMatch(/Of \$8,800\.00 total limit/);
    expect(availableCreditSubtitle("41", "8800")).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, null)).toBe("Across active credit accounts");
  });

  it("falls back top summary from snapshot when top_summary missing", () => {
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
  });

  it("shows looking-ahead only beyond the selected forecast window", () => {
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
    expect(lookingAheadMessage(risk)).toContain("Main is projected to fall below $0");
  });

  it("limits attention cards and detects onboarding emptiness", () => {
    expect(attentionItemsLimited([1, 2, 3, 4], 3)).toEqual([1, 2, 3]);
    expect(
      isDashboardOnboarding({
        attention: [],
        recommendations: [],
        top_summary: {
          liquid_cash: "0",
          available_credit: "0",
          total_credit_limit: null,
          credit_utilization: null,
          net_position: "0",
        },
      })
    ).toBe(true);
  });
});
