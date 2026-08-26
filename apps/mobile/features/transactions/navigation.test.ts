import { describe, expect, it } from "vitest";
import { filtersFromSearchParams } from "@/features/transactions/queryKeys";

describe("filtersFromSearchParams", () => {
  it("applies account filter from navigation params for View transactions deep link", () => {
    expect(filtersFromSearchParams({ account: "42" })).toEqual({ accountId: 42 });
  });

  it("applies date filter from calendar navigation", () => {
    expect(filtersFromSearchParams({ date: "2026-08-12" })).toEqual({ specificDate: "2026-08-12" });
  });

  it("applies budget period filters for category transactions", () => {
    expect(
      filtersFromSearchParams({
        category: "12",
        dateFrom: "2026-08-01",
        dateTo: "2026-08-31",
      })
    ).toEqual({
      categoryId: 12,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
    });
  });

  it("ignores invalid account ids", () => {
    expect(filtersFromSearchParams({ account: "abc" })).toEqual({});
  });
});
