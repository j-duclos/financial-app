import { describe, expect, it } from "vitest";
import type { TimelineCalendarDay } from "@budget-app/shared";
import {
  calendarCellTone,
  calendarCellToneClass,
  computeSafeUntilNextIncome,
  dayHasActivity,
  DEFAULT_TIMELINE_VIEW,
  filterTimelineFromDate,
  formatShortMoney,
  groupTimelineDayGroupsByMonth,
  groupTimelineRowsByDate,
  groupTransactionsByKind,
  hasProjectedActivity,
  isIsoDateString,
  pickHorizonForFocusDate,
  resolveListDayMetrics,
  showRiskIcon,
  timelineDayForDate,
  timelineRowBalanceAfter,
} from "./timelineCalendarUtils";

function day(overrides: Partial<TimelineCalendarDay> = {}): TimelineCalendarDay {
  return {
    date: "2025-06-01",
    income_total: "0",
    expense_total: "0",
    transfer_total: "0",
    net_total: "0",
    ending_balance: "1000",
    lowest_balance: "1000",
    risk_level: "none",
    risk_reason: null,
    has_risk: false,
    transactions: [],
    ...overrides,
  };
}

describe("timelineCalendarUtils", () => {
  it("defaults to calendar view mode", () => {
    expect(DEFAULT_TIMELINE_VIEW).toBe("calendar");
  });

  it("maps risk levels to heatmap tones", () => {
    expect(calendarCellTone(day())).toBe("empty");
    expect(
      calendarCellTone(
        day({
          heat_level: "healthy",
          income_total: "10",
          transactions: [
            {
              id: 1,
              description: "x",
              account_name: "A",
              amount: "10",
              category: null,
              kind: "income",
              source: "rule",
              balance_after: "10",
              is_transfer: false,
            },
          ],
        })
      )
    ).toBe("healthy");
    expect(calendarCellTone(day({ income_total: "10", risk_level: "watch", transactions: [{ id: 1, description: "x", account_name: "A", amount: "10", category: null, kind: "income", source: "rule", balance_after: "10", is_transfer: false }] }))).toBe("watch");
    expect(calendarCellTone(day({ income_total: "10", risk_level: "critical", transactions: [{ id: 1, description: "x", account_name: "A", amount: "10", category: null, kind: "income", source: "rule", balance_after: "-1", is_transfer: false }] }))).toBe("critical");
    expect(calendarCellToneClass("critical")).toContain("red");
    expect(calendarCellToneClass("watch")).toContain("amber");
    expect(calendarCellToneClass("healthy")).toContain("emerald");
  });

  it("shows risk icon when below buffer or zero", () => {
    expect(showRiskIcon(day())).toBe(false);
    expect(showRiskIcon(day({ has_risk: true, risk_level: "watch" }))).toBe(true);
    expect(showRiskIcon(day({ risk_level: "critical" }))).toBe(true);
  });

  it("excludes transfers from income/expense grouping", () => {
    const groups = groupTransactionsByKind([
      { id: 1, description: "Pay", account_name: "C", amount: "100", category: null, kind: "income", source: "rule", balance_after: null, is_transfer: false },
      { id: 2, description: "Xfer", account_name: "C", amount: "-50", category: "Bank Transfer", kind: "transfer", source: "rule", balance_after: null, is_transfer: true },
      { id: 3, description: "Rent", account_name: "C", amount: "-200", category: "Rent", kind: "bill", source: "rule", balance_after: null, is_transfer: false },
    ]);
    expect(groups.income).toHaveLength(1);
    expect(groups.expenses).toHaveLength(1);
    expect(groups.transfers).toHaveLength(1);
  });

  it("formats short money with sign", () => {
    expect(formatShortMoney(2200, true)).toBe("+$2,200");
    expect(formatShortMoney(-1800, true)).toBe("-$1,800");
  });

  it("groups timeline list rows by date", () => {
    const groups = groupTimelineRowsByDate([
      { date: "2025-06-02", description: "b", account_id: 1, account_name: "A", category_id: null, category_name: null, amount: "-1", type: "OUTFLOW", status: "PLANNED", source: "rule", rule_id: 1, transaction_id: null, running_balance: "0" },
      { date: "2025-06-01", description: "a", account_id: 1, account_name: "A", category_id: null, category_name: null, amount: "1", type: "INFLOW", status: "PLANNED", source: "rule", rule_id: 2, transaction_id: null, running_balance: "1" },
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2025-06-01", "2025-06-02"]);
  });

  it("groups timeline day groups by month for sticky headers", () => {
    const dayGroups = groupTimelineRowsByDate([
      { date: "2026-07-01", description: "b", account_id: 1, account_name: "A", category_id: null, category_name: null, amount: "-1", type: "OUTFLOW", status: "PLANNED", source: "rule", rule_id: 1, transaction_id: null, running_balance: "0" },
      { date: "2026-06-01", description: "a", account_id: 1, account_name: "A", category_id: null, category_name: null, amount: "1", type: "INFLOW", status: "PLANNED", source: "rule", rule_id: 2, transaction_id: null, running_balance: "1" },
    ]);
    const months = groupTimelineDayGroupsByMonth(dayGroups);
    expect(months.map((m) => m.monthLabel)).toEqual(["JUNE 2026", "JULY 2026"]);
  });

  it("detects projected activity across horizon", () => {
    expect(hasProjectedActivity([day(), day({ expense_total: "5" })])).toBe(true);
    expect(hasProjectedActivity([day(), day()])).toBe(false);
    expect(dayHasActivity(day({ transfer_total: "0", transactions: [] }))).toBe(false);
  });

  it("validates ISO focus dates", () => {
    expect(isIsoDateString("2025-06-01")).toBe(true);
    expect(isIsoDateString("Jun 1")).toBe(false);
    expect(isIsoDateString(null)).toBe(false);
  });

  it("picks smallest horizon that includes the focus date", () => {
    expect(pickHorizonForFocusDate("2025-06-10", "2025-06-01")).toBe("14d");
    expect(pickHorizonForFocusDate("2025-08-01", "2025-06-01")).toBe("3m");
    expect(pickHorizonForFocusDate("2026-06-01", "2025-06-01")).toBe("12m");
  });

  it("filters timeline rows before horizon start", () => {
    const rows = [
      {
        date: "2025-12-29",
        description: "Old",
        account_id: 1,
        account_name: "Main",
        category_id: null,
        category_name: null,
        amount: "-10",
        type: "OUTFLOW",
        status: "ACTUAL",
        source: "actual" as const,
        rule_id: null,
        transaction_id: 1,
        running_balance: "100",
      },
      {
        date: "2026-05-28",
        description: "Future",
        account_id: 1,
        account_name: "Main",
        category_id: null,
        category_name: null,
        amount: "-20",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule" as const,
        rule_id: 2,
        transaction_id: null,
        running_balance: "80",
      },
    ];
    const filtered = filterTimelineFromDate(rows, "2026-05-01");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].date).toBe("2026-05-28");
  });

  it("builds a placeholder day when calendar data has no row", () => {
    const stub = timelineDayForDate([], "2025-06-15");
    expect(stub.date).toBe("2025-06-15");
    expect(stub.transactions).toEqual([]);
  });

  it("resolves list day metrics from calendar when available", () => {
    const day = {
      date: "2025-06-15",
      income_total: "100",
      expense_total: "40",
      transfer_total: "0",
      net_total: "60",
      ending_balance: "1060",
      lowest_balance: "1060",
      risk_level: "none" as const,
      risk_reason: null,
      has_risk: false,
      transactions: [],
    };
    const metrics = resolveListDayMetrics("2025-06-15", [], [day]);
    expect(metrics.netTotal).toBe("60");
    expect(metrics.endingBalance).toBe("1060");
  });

  it("falls back to timeline rows when calendar day is missing", () => {
    const rows = [
      {
        date: "2025-06-15",
        description: "Paycheck",
        account_id: 1,
        account_name: "Main",
        category_id: null,
        category_name: null,
        amount: "100.00",
        type: "INFLOW",
        status: "PLANNED",
        source: "rule" as const,
        rule_id: 1,
        transaction_id: null,
        running_balance: "1100.00",
      },
      {
        date: "2025-06-15",
        description: "Rent",
        account_id: 1,
        account_name: "Main",
        category_id: null,
        category_name: null,
        amount: "-900.00",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule" as const,
        rule_id: 2,
        transaction_id: null,
        running_balance: "200.00",
      },
    ];
    const metrics = resolveListDayMetrics("2025-06-15", rows, []);
    expect(metrics.netTotal).toBe("-800.00");
    expect(metrics.endingBalance).toBe("200.00");
  });

  it("prefers calendar balance_after over timeline running_balance", () => {
    const day: TimelineCalendarDay = {
      date: "2026-06-01",
      income_total: "0",
      expense_total: "3750",
      transfer_total: "0",
      net_total: "-3750",
      ending_balance: "20",
      lowest_balance: "-19.62",
      risk_level: "critical",
      risk_reason: null,
      has_risk: true,
      transactions: [
        {
          id: 10,
          account_id: 1,
          description: "Rent",
          account_name: "Main",
          amount: "-3100.00",
          category: "Rent / Mortgage",
          kind: "bill",
          source: "actual",
          balance_after: "630.38",
          is_transfer: false,
        },
        {
          id: 11,
          account_id: 1,
          description: "Credit Card Pmt",
          account_name: "Main",
          amount: "-650.00",
          category: "Credit Card Payment",
          kind: "bill",
          source: "actual",
          balance_after: "-19.62",
          is_transfer: false,
        },
      ],
    };
    const row = {
      date: "2026-06-01",
      description: "Credit Card Pmt",
      account_id: 1,
      account_name: "Main",
      category_id: null,
      category_name: "Credit Card Payment",
      amount: "-650.00",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual" as const,
      rule_id: null,
      transaction_id: 11,
      running_balance: "-119.62",
    };
    expect(timelineRowBalanceAfter(row, day)).toBe("-19.62");
  });

  it("computeSafeUntilNextIncome anchors on today when history is included", () => {
    const days: TimelineCalendarDay[] = [
      day({ date: "2025-05-01", ending_balance: "1000", net_total: "0" }),
      day({ date: "2025-05-28", ending_balance: "5000", net_total: "-100" }),
      day({ date: "2025-05-29", ending_balance: "5100", net_total: "100", expense_total: "50" }),
      day({ date: "2025-06-05", ending_balance: "5200", net_total: "200", income_total: "200" }),
    ];

    const summary = computeSafeUntilNextIncome(days, "2025-05-29");
    expect(summary?.currentBalance).toBe(5000);
    expect(summary?.nextIncomeDate).toBe("2025-06-05");
  });
});
