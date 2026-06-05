import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DashboardSnapshot } from "@budget-app/shared";
import { DEPRECATED_DASHBOARD_LABELS, RESOURCE_BREAKDOWN } from "../../lib/dashboardTerminology";

const dir = dirname(fileURLToPath(import.meta.url));

const SAMPLE: DashboardSnapshot = {
  cash: "31703.00",
  cash_change_pct: "2.1",
  credit_debt: "3368.00",
  utilization: "48",
  savings: "68615.00",
  savings_change_pct: "1.8",
  savings_goal_progress_pct: "43",
  net_position: "28335.00",
  net_position_change_pct: "3.2",
  net_position_mtd_positive: true,
};

describe("FinancialSnapshotCard", () => {
  it("snapshot sample has three resource metrics (no net position card)", () => {
    expect(SAMPLE.cash).toBeTruthy();
    expect(SAMPLE.credit_debt).toBeTruthy();
    expect(SAMPLE.savings).toBeTruthy();
  });

  it("uses resource breakdown labels and omits net position UI", () => {
    const source = readFileSync(join(dir, "FinancialSnapshotCard.tsx"), "utf8");
    expect(source).toContain("RESOURCE_BREAKDOWN.spendingAccounts.label");
    expect(source).toContain("RESOURCE_BREAKDOWN.debtOwed.label");
    expect(source).toContain("RESOURCE_BREAKDOWN.savingsInvestments.label");
    expect(source).toContain("RESOURCE_BREAKDOWN.spendingAccounts.help");
    expect(source).toContain("RESOURCE_BREAKDOWN.debtOwed.help");
    expect(source).toContain("RESOURCE_BREAKDOWN.savingsInvestments.help");
    expect(source).toContain("HoverTooltip");
    expect(source).toMatch(/sm:grid-cols-3/);
    for (const deprecated of DEPRECATED_DASHBOARD_LABELS) {
      expect(source).not.toContain(`"${deprecated}"`);
    }
    expect(source).not.toMatch(/label="Net Position"/);
  });
});
