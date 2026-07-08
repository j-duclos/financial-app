import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@budget-app/shared";
import {
  availableCreditSubtitle,
  safeToSpendDisplayValue,
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
  it("safeToSpendDisplayValue frames shortfalls as headroom, not balance", () => {
    expect(safeToSpendDisplayValue("250")).toBe("$250.00");
    expect(safeToSpendDisplayValue("-3678.44")).toBe("You are short by $3,678.44");
  });

  it("safeToSpendRiskSubtitle describes cushion timing without implying account balance", () => {
    expect(
      safeToSpendRiskSubtitle(
        sts({ amount: "-50", status: "critical", next_issue: { risk_date: "2026-06-17" } })
      )
    ).toBe("Short by 06-17-26 after bills, buffers, and reserved savings");
    expect(
      safeToSpendRiskSubtitle(
        sts({ amount: "10", status: "critical", next_issue: { risk_date: "2026-06-17" } })
      )
    ).toBe("Earliest issue: 06-17-26");
    expect(safeToSpendRiskSubtitle(sts({ status: "watch", next_issue: { risk_date: "2026-06-04" } }))).toBe(
      "Earliest issue: 06-04-26"
    );
  });

  it("safeToSpendHealthySubtitle describes spending cushion headroom", () => {
    expect(safeToSpendHealthySubtitle(30)).toMatch(/Headroom after bills, buffers, and reserved savings/);
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
