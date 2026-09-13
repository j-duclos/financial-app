import { describe, expect, it } from "vitest";
import { addDaysToIsoDate, addMonthsToIsoDate, todayStr } from "./dates";
import {
  DEFAULT_TIME_FILTER,
  RECENT_RANGE_OPTIONS,
  TIME_FILTER_LABELS,
  flattenLedgerHistoryPages,
  isUnboundedHistoryFilter,
  pastTransactionsRange,
  recentRangeLabel,
  usesNewestFirstHistoryPagination,
} from "./transactionsLedger";

describe("mobile history range", () => {
  it("offers 7 days, 14 days, 30 days, 90 days, 1 year, and All history without Premium labels", () => {
    expect(DEFAULT_TIME_FILTER).toBe("7d");
    expect(RECENT_RANGE_OPTIONS).toEqual(["7d", "14d", "30d", "90d", "12m", "all"]);
    expect(RECENT_RANGE_OPTIONS.map((opt) => recentRangeLabel(opt))).toEqual([
      "Last 7 days",
      "Last 14 days",
      "Last 30 days",
      "Last 90 days",
      "Last 1 year",
      "All history",
    ]);
    for (const opt of RECENT_RANGE_OPTIONS) {
      expect(TIME_FILTER_LABELS[opt].toLowerCase()).not.toContain("premium");
    }
  });

  it("does not cap historical lookback at 90 days", () => {
    const today = todayStr();
    expect(pastTransactionsRange("7d")).toEqual({
      start: addDaysToIsoDate(today, -7),
      end: today,
    });
    expect(pastTransactionsRange("14d")).toEqual({
      start: addDaysToIsoDate(today, -14),
      end: today,
    });
    expect(pastTransactionsRange("30d")).toEqual({
      start: addDaysToIsoDate(today, -30),
      end: today,
    });
    expect(pastTransactionsRange("90d")).toEqual({
      start: addDaysToIsoDate(today, -90),
      end: today,
    });
    expect(pastTransactionsRange("12m")).toEqual({
      start: addMonthsToIsoDate(today, -12),
      end: today,
    });
    expect(pastTransactionsRange("all")).toEqual({ start: "", end: today });
    expect(isUnboundedHistoryFilter("all")).toBe(true);
    expect(isUnboundedHistoryFilter("90d")).toBe(false);
  });

  it("paginates 1 year and all-history newest-first", () => {
    expect(usesNewestFirstHistoryPagination("7d")).toBe(false);
    expect(usesNewestFirstHistoryPagination("14d")).toBe(false);
    expect(usesNewestFirstHistoryPagination("30d")).toBe(false);
    expect(usesNewestFirstHistoryPagination("90d")).toBe(false);
    expect(usesNewestFirstHistoryPagination("12m")).toBe(true);
    expect(usesNewestFirstHistoryPagination("all")).toBe(true);
  });

  it("labels unbounded history without a Last prefix", () => {
    expect(recentRangeLabel("7d")).toBe("Last 7 days");
    expect(recentRangeLabel("14d")).toBe("Last 14 days");
    expect(recentRangeLabel("30d")).toBe("Last 30 days");
    expect(recentRangeLabel("all")).toBe("All history");
  });
});

describe("flattenLedgerHistoryPages", () => {
  it("keeps ascending pages as-is", () => {
    const pages = [{ results: [1, 2] }, { results: [3] }];
    expect(flattenLedgerHistoryPages(pages, false)).toEqual([1, 2, 3]);
  });

  it("reverses newest-first pages into ledger order without concatenating more than returned pages", () => {
    const pages = [
      { results: ["today", "yesterday"] },
      { results: ["last-year"] },
    ];
    expect(flattenLedgerHistoryPages(pages, true)).toEqual(["last-year", "yesterday", "today"]);
    expect(flattenLedgerHistoryPages(undefined, true)).toEqual([]);
  });
});
