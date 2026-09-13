import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { markDashboardTiming, resetDashboardTimingForTests } from "./dashboardTiming";
import {
  getStartupTraceSnapshot,
  resetStartupTraceForTests,
  startStartupTrace,
} from "@/lib/startupTrace";

describe("dashboardTiming home readiness", () => {
  beforeEach(() => {
    resetDashboardTimingForTests();
    resetStartupTraceForTests();
    startStartupTrace({ type: "cold_launch" });
  });

  afterEach(() => {
    resetDashboardTimingForTests();
    resetStartupTraceForTests();
  });

  it("does not mark first_screen_ready or primary content when the shell mounts", () => {
    markDashboardTiming("home-shell-rendered");
    const snap = getStartupTraceSnapshot();
    expect(snap?.events.home_shell_mounted).toBeDefined();
    expect(snap?.events.first_screen_ready).toBeUndefined();
    expect(snap?.events.home_primary_content_visible).toBeUndefined();
  });

  it("marks first_screen_ready only when meaningful Home data is visible", () => {
    markDashboardTiming("home-shell-rendered");
    markDashboardTiming("home-accounts-visible");
    markDashboardTiming("home-balances-visible");
    markDashboardTiming("home-primary-content-visible");
    const snap = getStartupTraceSnapshot();
    expect(snap?.events.home_primary_content_visible).toBeDefined();
    expect(snap?.events.first_screen_ready).toBeDefined();
    expect(snap?.events.home_accounts_visible).toBeDefined();
  });
});
