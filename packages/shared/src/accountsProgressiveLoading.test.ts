import { describe, expect, it } from "vitest";
import {
  accountsListEnrichmentEnabled,
  isQueryDataFresh,
} from "./accountsProgressiveLoading";

describe("accountsListEnrichmentEnabled", () => {
  const now = 1_000_000;
  const staleMs = 60_000;

  it("waits for main list when forecast is ready and enrich cache is empty", () => {
    expect(
      accountsListEnrichmentEnabled({
        forecastReady: true,
        mainListSuccess: false,
        enrichedListUpdatedAt: undefined,
        enrichedStaleTimeMs: staleMs,
        now,
      })
    ).toBe(false);
  });

  it("starts enrichment after main list succeeds", () => {
    expect(
      accountsListEnrichmentEnabled({
        forecastReady: true,
        mainListSuccess: true,
        enrichedListUpdatedAt: undefined,
        enrichedStaleTimeMs: staleMs,
        now,
      })
    ).toBe(true);
  });

  it("uses fresh enrich cache without waiting for a new main round trip", () => {
    expect(
      accountsListEnrichmentEnabled({
        forecastReady: true,
        mainListSuccess: false,
        enrichedListUpdatedAt: now - 10_000,
        enrichedStaleTimeMs: staleMs,
        now,
      })
    ).toBe(true);
  });

  it("does not use stale enrich cache from a prior session window", () => {
    expect(
      accountsListEnrichmentEnabled({
        forecastReady: true,
        mainListSuccess: false,
        enrichedListUpdatedAt: now - staleMs - 1,
        enrichedStaleTimeMs: staleMs,
        now,
      })
    ).toBe(false);
  });

  it("does not enrich before forecast window is ready", () => {
    expect(
      accountsListEnrichmentEnabled({
        forecastReady: false,
        mainListSuccess: true,
        enrichedListUpdatedAt: now,
        enrichedStaleTimeMs: staleMs,
        now,
      })
    ).toBe(false);
  });
});

describe("isQueryDataFresh", () => {
  it("treats missing updatedAt as stale", () => {
    expect(isQueryDataFresh(undefined, 30_000)).toBe(false);
  });
});
