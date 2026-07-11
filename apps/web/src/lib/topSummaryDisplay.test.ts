import { describe, expect, it } from "vitest";
import type { DashboardLowestProjectedCash } from "@budget-app/shared";
import {
  availableCreditSubtitle,
  lowestProjectedCashAmountClass,
  lowestProjectedCashDisplayValue,
  lowestProjectedCashLabel,
  lowestProjectedCashSubtitle,
} from "./topSummaryDisplay";

function lpc(overrides: Partial<DashboardLowestProjectedCash> = {}): DashboardLowestProjectedCash {
  return {
    amount: "421.18",
    account_id: 1,
    account_name: "Main",
    date: "2026-07-22",
    is_negative: false,
    ...overrides,
  };
}

describe("topSummaryDisplay", () => {
  it("lowestProjectedCashDisplayValue shows the actual projected balance", () => {
    expect(lowestProjectedCashDisplayValue("421.18")).toBe("$421.18");
    expect(lowestProjectedCashDisplayValue("-572.60")).toBe("-$572.60");
  });

  it("lowestProjectedCashLabel switches for negative balances", () => {
    expect(lowestProjectedCashLabel(false)).toBe("Lowest Projected Cash");
    expect(lowestProjectedCashLabel(true)).toBe("Projected Cash Shortfall");
  });

  it("lowestProjectedCashSubtitle shows account and date only", () => {
    expect(lowestProjectedCashSubtitle(lpc())).toMatch(/Main/);
    expect(lowestProjectedCashSubtitle(lpc())).toMatch(/07-22-26/);
    expect(lowestProjectedCashSubtitle(lpc({ is_negative: true, amount: "-572.60", date: "2026-07-08" }))).not.toMatch(
      /buffer/i
    );
  });

  it("lowestProjectedCashAmountClass highlights negative balances", () => {
    expect(lowestProjectedCashAmountClass(true)).toBe("text-red-700");
    expect(lowestProjectedCashAmountClass(false)).toBe("text-emerald-800");
  });

  it("availableCreditSubtitle includes total limit and utilization when present", () => {
    expect(availableCreditSubtitle("41", "8800")).toMatch(/Of \$8,800\.00 total limit/);
    expect(availableCreditSubtitle("41", "8800")).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, "8800")).toBe("Of $8,800.00 total limit");
    expect(availableCreditSubtitle("41", null)).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, null)).toBe("Across active credit accounts");
  });
});
