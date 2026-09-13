import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyReactQueryCache,
  finishStartupTrace,
  getStartupCorrelationId,
  getStartupTraceSnapshot,
  markStartupEvent,
  maybeFinishStartupTrace,
  recordPlaidRefreshTiming,
  recordTimelineBackendMeta,
  resetStartupTraceForTests,
  runTimedStartupQuery,
  sanitizeStartupMetadata,
  setStartupTraceLogger,
  startStartupTrace,
  startupQueryCacheState,
  startupQueryDuration,
} from "./startupTrace";

describe("startupTrace", () => {
  const lines: string[] = [];

  beforeEach(() => {
    resetStartupTraceForTests();
    lines.length = 0;
    setStartupTraceLogger((line) => {
      lines.push(line);
    });
  });

  afterEach(() => {
    setStartupTraceLogger(null);
    resetStartupTraceForTests();
  });

  it("records a cold launch trace and completes once", () => {
    startStartupTrace({ type: "cold_launch" });
    markStartupEvent("app_started");
    markStartupEvent("app_became_active");
    markStartupEvent("auth_ready");
    markStartupEvent("first_screen_ready");
    markStartupEvent("home_data_ready");
    const first = finishStartupTrace();
    const second = finishStartupTrace();
    expect(first?.type).toBe("cold_launch");
    expect(first?.events.app_started).toBeDefined();
    expect(first?.summary).toContain("type=cold_launch");
    expect(first?.summary).toContain("correlation_id=");
    expect(second?.correlationId).toBe(first?.correlationId);
    expect(lines.filter((l) => l.startsWith("[startup-summary]")).length).toBe(1);
  });

  it("records a foreground resume with time since background", () => {
    startStartupTrace({ type: "foreground_resume", timeSinceBackgroundMs: 420_000 });
    markStartupEvent("app_became_active", { time_since_background_ms: 420000 });
    markStartupEvent("first_screen_ready");
    const snap = finishStartupTrace();
    expect(snap?.type).toBe("foreground_resume");
    expect(snap?.timeSinceBackgroundMs).toBe(420_000);
    expect(snap?.summary).toContain("type=foreground_resume");
    expect(snap?.summary).toContain("time_since_background_ms=420000");
  });

  it("records query phase durations and cache metadata", async () => {
    startStartupTrace({ type: "cold_launch" });
    await runTimedStartupQuery("profile", "network_fetch", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true };
    });
    await runTimedStartupQuery("timeline", "stale_refetch", async () => 1);
    markStartupEvent("first_screen_ready");
    const snap = finishStartupTrace();
    expect(startupQueryDuration("profile")).toBeGreaterThanOrEqual(1);
    expect(startupQueryCacheState("profile")).toBe("network_fetch");
    expect(startupQueryCacheState("timeline")).toBe("stale_refetch");
    expect(snap?.queries.profile?.status).toBe("ok");
    expect(lines.some((l) => l.includes("profile cache=network_fetch"))).toBe(true);
  });

  it("ignores duplicate marks so totals are not corrupted", async () => {
    startStartupTrace({ type: "cold_launch" });
    await runTimedStartupQuery("accounts", "cache_hit", async () => "a");
    const firstMs = startupQueryDuration("accounts");
    await runTimedStartupQuery("accounts", "network_fetch", async () => {
      await new Promise((r) => setTimeout(r, 20));
      return "b";
    });
    markStartupEvent("first_screen_ready");
    markStartupEvent("first_screen_ready");
    const snap = finishStartupTrace();
    expect(startupQueryDuration("accounts")).toBe(firstMs);
    expect(startupQueryCacheState("accounts")).toBe("cache_hit");
    expect(snap?.queries.accounts?.cache).toBe("cache_hit");
  });

  it("does not finish until first_screen_ready and in-flight queries settle", async () => {
    startStartupTrace({ type: "cold_launch" });
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runTimedStartupQuery("household", "network_fetch", () => pending);
    markStartupEvent("first_screen_ready");
    markStartupEvent("transactions_prefetch_finished");
    maybeFinishStartupTrace();
    expect(getStartupTraceSnapshot()?.finishedAt).toBeNull();
    release();
    await running;
    expect(getStartupTraceSnapshot()?.finishedAt).not.toBeNull();
  });

  it("attaches Plaid refresh timing without payload data", () => {
    startStartupTrace({ type: "foreground_resume", timeSinceBackgroundMs: 8_000 });
    recordPlaidRefreshTiming({ durationMs: 1630, changedData: true });
    markStartupEvent("first_screen_ready");
    const snap = finishStartupTrace();
    expect(snap?.plaid).toEqual({ durationMs: 1630, changedData: true });
    expect(snap?.summary).toContain("plaid_refresh_ms=1630");
    expect(snap?.summary).toContain("plaid_refresh_changed_data=true");
    expect(lines.join("\n")).not.toMatch(/account_id|payee|balance|token/i);
  });

  it("records timeline backend cache hit/miss metadata", () => {
    startStartupTrace({ type: "cold_launch" });
    recordTimelineBackendMeta({
      cache: "miss",
      serverDurationMs: 1150,
      balanceWalkMode: "client",
    });
    markStartupEvent("first_screen_ready");
    const snap = finishStartupTrace();
    expect(snap?.timelineBackend?.cache).toBe("miss");
    expect(snap?.summary).toContain("timeline_cache=miss");
    expect(snap?.summary).toContain("timeline_server_ms=1150");
    expect(snap?.summary).toContain("timeline_balance_walk=client");
    expect(getStartupCorrelationId()).toBe(snap?.correlationId);
  });

  it("strips sensitive payload keys from log metadata", () => {
    expect(
      sanitizeStartupMetadata({
        cache: "hit",
        duration_ms: 12,
        account_id: 9,
        payee: "Costco",
        balance: "12.00",
        token: "secret",
        description: "Groceries",
      })
    ).toEqual({ cache: "hit", duration_ms: 12 });
  });

  it("classifies React Query cache hit, stale refetch, and network fetch", () => {
    expect(
      classifyReactQueryCache({ hasData: false, staleTimeMs: 30_000 })
    ).toBe("network_fetch");
    expect(
      classifyReactQueryCache({
        hasData: true,
        dataUpdatedAt: Date.now() - 1_000,
        staleTimeMs: 30_000,
      })
    ).toBe("cache_hit");
    expect(
      classifyReactQueryCache({
        hasData: true,
        dataUpdatedAt: Date.now() - 60_000,
        staleTimeMs: 30_000,
      })
    ).toBe("stale_refetch");
    expect(
      classifyReactQueryCache({
        hasData: true,
        dataUpdatedAt: Date.now(),
        isInvalidated: true,
        staleTimeMs: 30_000,
      })
    ).toBe("stale_refetch");
  });
});
