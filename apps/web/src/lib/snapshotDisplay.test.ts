import { describe, expect, it } from "vitest";
import type { DashboardSnapshot } from "@budget-app/shared";
import {
  SNAPSHOT_LINKS,
  SNAPSHOT_UNAVAILABLE,
  cashSnapshotFooter,
  debtDisplayAmount,
  formatTrendPct,
  netPositionFooter,
  savingsGoalFooter,
  savingsSnapshotFooter,
  utilizationLabel,
} from "./snapshotDisplay";

function snap(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    cash: "31703.00",
    cash_change_pct: "2.1",
    credit_debt: "3368.00",
    utilization: "48",
    savings: "68615.00",
    savings_change_pct: "1.8",
    savings_goal_progress_pct: "3",
    net_position: "28335.00",
    net_position_change_pct: "3.2",
    net_position_mtd_positive: true,
    ...overrides,
  };
}

describe("snapshotDisplay", () => {
  it("links to accounts and reports", () => {
    expect(SNAPSHOT_LINKS.cash).toContain("/accounts");
    expect(SNAPSHOT_LINKS.debt).toContain("debtOnly");
    expect(SNAPSHOT_LINKS.savings).toContain("savingsOnly");
    expect(SNAPSHOT_LINKS.net).toBe("/reports");
  });

  it("formats compact trend footers", () => {
    expect(formatTrendPct("2.1")).toBe("↑ 2.1%");
    expect(formatTrendPct("-4.5")).toBe("↓ 4.5%");
  });

  it("shows utilization footer", () => {
    expect(utilizationLabel("48")).toBe("Utilization 48%");
  });

  it("shows goal progress when available", () => {
    expect(savingsGoalFooter(snap())).toBe("Goal progress +3%");
    expect(savingsSnapshotFooter(snap({ savings_goal_progress_pct: undefined }))).toBe("↑ 1.8%");
    expect(savingsGoalFooter(snap({ savings_goal_progress_pct: null }))).toBeNull();
  });

  it("prefers goal footer over savings trend", () => {
    expect(savingsSnapshotFooter(snap())).toBe("Goal progress +3%");
  });

  it("formats debt as negative amount string", () => {
    expect(debtDisplayAmount("3368")).toBe("-3368");
  });

  it("net position footer uses month-over-month trend", () => {
    expect(netPositionFooter(snap())).toBe("↑ 3.2%");
    expect(netPositionFooter(snap({ net_position_change_pct: null }))).toBe("Not available");
  });

  it("cash footer uses compact trend", () => {
    expect(cashSnapshotFooter(snap())).toBe("↑ 2.1%");
  });

  it("exports unavailable label", () => {
    expect(SNAPSHOT_UNAVAILABLE).toBe("Not available");
  });
});
