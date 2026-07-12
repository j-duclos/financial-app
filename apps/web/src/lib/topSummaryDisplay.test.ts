import { describe, expect, it } from "vitest";
import type { DashboardLowestProjectedCash } from "@budget-app/shared";
import {
  availableCreditSubtitle,
  lowestProjectedCashAmountClass,
  lowestProjectedCashDisplayValue,
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
    expect(lowestProjectedCashDisplayValue("-298.74")).toBe("-$298.74");
    expect(lowestProjectedCashDisplayValue("-298.74")).not.toMatch(/short by/i);
  });

  it("lowestProjectedCashSubtitle shows account and date only", () => {
    expect(lowestProjectedCashSubtitle(lpc())).toBe("Main · 07-22-26");
    expect(lowestProjectedCashSubtitle(lpc({ amount: "-298.74", date: "2026-07-08" }))).toBe(
      "Main · 07-08-26"
    );
    expect(lowestProjectedCashSubtitle(lpc({ amount: "-298.74", date: "2026-07-08" }))).not.toMatch(
      /buffer|reserved|short by/i
    );
  });

  it("lowestProjectedCashAmountClass highlights negative balances only", () => {
    expect(lowestProjectedCashAmountClass(lpc({ amount: "-298.74", is_negative: true }))).toBe(
      "text-red-700"
    );
    expect(lowestProjectedCashAmountClass(lpc({ amount: "421.18", is_negative: false }))).toBe(
      "text-emerald-800"
    );
  });

  it("availableCreditSubtitle includes total limit and utilization when present", () => {
    expect(availableCreditSubtitle("41", "8800")).toMatch(/Of \$8,800\.00 total limit/);
    expect(availableCreditSubtitle("41", "8800")).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, "8800")).toBe("Of $8,800.00 total limit");
    expect(availableCreditSubtitle("41", null)).toMatch(/41% of limit in use/);
    expect(availableCreditSubtitle(null, null)).toBe("Across active credit accounts");
  });
});
