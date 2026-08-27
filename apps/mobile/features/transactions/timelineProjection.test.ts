import { describe, expect, it } from "vitest";
import { needsTimelineProjection } from "./timelineProjection";
import { DEFAULT_TRANSACTION_FILTERS } from "./types";

describe("needsTimelineProjection", () => {
  const today = "2026-08-26";

  it("loads timeline for default all/posted+forecast view", () => {
    expect(needsTimelineProjection(DEFAULT_TRANSACTION_FILTERS, today)).toBe(true);
  });

  it("skips timeline for posted-only filter", () => {
    expect(
      needsTimelineProjection({ ...DEFAULT_TRANSACTION_FILTERS, forecast: "posted" }, today)
    ).toBe(false);
  });

  it("skips timeline for specific past date drill-down", () => {
    expect(
      needsTimelineProjection(
        { ...DEFAULT_TRANSACTION_FILTERS, specificDate: "2026-08-01" },
        today
      )
    ).toBe(false);
  });

  it("loads timeline for specific today or future date", () => {
    expect(
      needsTimelineProjection(
        { ...DEFAULT_TRANSACTION_FILTERS, specificDate: today },
        today
      )
    ).toBe(true);
  });

  it("skips timeline for budget drill-down range entirely in the past", () => {
    expect(
      needsTimelineProjection(
        {
          ...DEFAULT_TRANSACTION_FILTERS,
          dateFrom: "2026-07-01",
          dateTo: "2026-07-31",
        },
        today
      )
    ).toBe(false);
  });
});
