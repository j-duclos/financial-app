import { describe, expect, it } from "vitest";
import {
  groupItemsByMonth,
  monthAriaLabelFromKey,
  monthKeyFromIsoDate,
  monthLabelFromIsoDate,
  monthLabelFromKey,
} from "./monthGroupDisplay";
import { groupTimelineDayGroupsByMonth, groupTimelineRowsByDate } from "./timelineCalendarUtils";
import { groupUpcomingByMonth, upcomingMonthKey } from "./upcomingDisplay";
import type { DashboardUpcomingGroup } from "@budget-app/shared";

describe("monthGroupDisplay", () => {
  it("derives month key and label from ISO date", () => {
    expect(monthKeyFromIsoDate("2026-06-17")).toBe("2026-06");
    expect(monthLabelFromIsoDate("2026-06-17")).toBe("JUNE 2026");
    expect(monthLabelFromKey("2026-07")).toBe("JULY 2026");
    expect(monthAriaLabelFromKey("2026-06")).toBe("June 2026");
  });

  it("groups items by month preserving order within month", () => {
    const items = [
      { date: "2026-06-01" },
      { date: "2026-06-15" },
      { date: "2026-07-02" },
    ];
    const groups = groupItemsByMonth(items, (i) => i.date);
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-06", "2026-07"]);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.items).toHaveLength(1);
  });
});

describe("timeline month grouping", () => {
  it("groups day groups under correct months", () => {
    const dayGroups = groupTimelineRowsByDate([
      {
        date: "2026-07-01",
        description: "b",
        account_id: 1,
        account_name: "A",
        category_id: null,
        category_name: null,
        amount: "-1",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule",
        rule_id: 1,
        transaction_id: null,
        running_balance: "0",
      },
      {
        date: "2026-06-05",
        description: "a",
        account_id: 1,
        account_name: "A",
        category_id: null,
        category_name: null,
        amount: "1",
        type: "INFLOW",
        status: "PLANNED",
        source: "rule",
        rule_id: 2,
        transaction_id: null,
        running_balance: "1",
      },
    ]);
    const months = groupTimelineDayGroupsByMonth(dayGroups);
    expect(months.map((m) => m.monthLabel)).toEqual(["JUNE 2026", "JULY 2026"]);
    expect(months[0]!.items.map((d) => d.date)).toEqual(["2026-06-05"]);
    expect(months[1]!.items.map((d) => d.date)).toEqual(["2026-07-01"]);
  });
});

describe("upcoming month grouping", () => {
  function g(date: string): DashboardUpcomingGroup {
    return {
      date,
      label: date,
      day_of_week: "Mon",
      income_total: "0",
      expense_total: "0",
      net_total: "0",
      transfer_total: "0",
      transfers_excluded: false,
      has_risk: false,
      risk_reason: null,
      transactions: [],
      hidden_transaction_count: 0,
      total_transaction_count: 0,
    };
  }

  it("groups upcoming days by month", () => {
    const months = groupUpcomingByMonth([g("2026-06-28"), g("2026-06-30"), g("2026-07-01")]);
    expect(months).toHaveLength(2);
    expect(months[0]!.monthLabel).toBe("JUNE 2026");
    expect(months[1]!.monthLabel).toBe("JULY 2026");
    expect(months[0]!.items.map(upcomingMonthKey)).toEqual(["2026-06", "2026-06"]);
  });
});
