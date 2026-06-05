import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@budget-app/shared";
import {
  availableCreditSubtitle,
  safeToSpendHealthySubtitle,
  safeToSpendRiskSubtitle,
} from "./topSummaryDisplay";

function sts(
  overrides: Partial<DashboardSummary["safe_to_spend"]> = {}
): DashboardSummary["safe_to_spend"] {
  return {
    amount: "100",
    status: "healthy",
    window_days: 30,
    next_issue: null,
    ...overrides,
  };
}

describe("topSummaryDisplay", () => {
  it("safeToSpendRiskSubtitle uses plain forecast language", () => {
    expect(
      safeToSpendRiskSubtitle(
        sts({ amount: "-50", status: "critical", next_issue: { risk_date: "2026-06-17" } })
      )
    ).toBe("Negative by 06-17-26");
    expect(
      safeToSpendRiskSubtitle(
        sts({ amount: "10", status: "critical", next_issue: { risk_date: "2026-06-17" } })
      )
    ).toBe("Forecast risk by 06-17-26");
    expect(safeToSpendRiskSubtitle(sts({ status: "watch", next_issue: { risk_date: "2026-06-04" } }))).toBe(
      "Low point on 06-04-26"
    );
  });

  it("safeToSpendHealthySubtitle describes spendable headroom", () => {
    expect(safeToSpendHealthySubtitle(30)).toMatch(/Spendable before projected risk/);
    expect(safeToSpendHealthySubtitle(30)).toMatch(/30-day/);
  });

  it("availableCreditSubtitle includes total limit and utilization when present", () => {
    expect(availableCreditSubtitle("41", "8800")).toMatch(/Of \$8,800\.00 total limit/);
    expect(availableCreditSubtitle("41", "8800")).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, "8800")).toBe("Of $8,800.00 total limit");
    expect(availableCreditSubtitle("41", null)).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, null)).toBe("Across active credit accounts");
  });
});
