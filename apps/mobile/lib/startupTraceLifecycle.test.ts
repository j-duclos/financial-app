import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const lifecycle = readFileSync(join(dir, "startupTraceLifecycle.ts"), "utf8");
const layout = readFileSync(join(dir, "../app/_layout.tsx"), "utf8");
const auth = readFileSync(join(dir, "../features/auth/AuthContext.tsx"), "utf8");
const profile = readFileSync(join(dir, "profileQuery.ts"), "utf8");
const households = readFileSync(join(dir, "../hooks/useHouseholds.ts"), "utf8");
const householdId = readFileSync(join(dir, "../hooks/useDefaultHouseholdId.ts"), "utf8");
const accounts = readFileSync(join(dir, "../hooks/useAccountOptions.ts"), "utf8");
const prefetch = readFileSync(join(dir, "../features/transactions/defaultLedgerPrefetch.ts"), "utf8");
const homePrefetch = readFileSync(
  join(dir, "../features/dashboard/attentionPrefetch.ts"),
  "utf8"
);
const timeline = readFileSync(join(dir, "financialEngineShadow.ts"), "utf8");
const dashboardTiming = readFileSync(
  join(dir, "../features/dashboard/dashboardTiming.ts"),
  "utf8"
);
const api = readFileSync(join(dir, "../services/api.ts"), "utf8");
const refresh = readFileSync(join(dir, "financialQueryRefresh.ts"), "utf8");

describe("startup trace wiring", () => {
  it("starts cold launch and resume traces from app lifecycle", () => {
    expect(lifecycle).toMatch(/startStartupTrace\(\{ type: "cold_launch" \}\)/);
    expect(lifecycle).toMatch(/foreground_resume/);
    expect(lifecycle).toMatch(/timeSinceBackgroundMs/);
    expect(lifecycle).toMatch(/AppState/);
    expect(layout).toMatch(/useStartupTraceLifecycle/);
  });

  it("instruments auth, profile, household, and accounts at the query layer", () => {
    expect(auth).toMatch(/markStartupEvent\("auth_ready"\)/);
    expect(auth).toMatch(/timedStartupQueryFn\(\s*"profile"/);
    expect(profile).toMatch(/timedStartupQueryFn\(\s*"profile"/);
    expect(households).toMatch(/timedStartupQueryFn\(\s*"household"/);
    expect(householdId).toMatch(/markStartupQueryFinished\(\s*"household"/);
    expect(accounts).toMatch(/timedStartupQueryFn\(\s*"accounts"/);
  });

  it("instruments transactions prefetch and timeline without screen duplication", () => {
    expect(prefetch).toMatch(/timedStartupQueryFn\(\s*"transactions"/);
    expect(homePrefetch).toMatch(/transactions_prefetch_started/);
    expect(homePrefetch).toMatch(/transactions_prefetch_finished/);
    expect(timeline).toMatch(/timedStartupQueryFn\(\s*"timeline"/);
    expect(timeline).toMatch(/recordTimelineBackendMeta/);
    expect(dashboardTiming).toMatch(/home_primary_content_visible/);
    expect(dashboardTiming).toMatch(/first_screen_ready/);
    expect(dashboardTiming).toMatch(/home_data_ready/);
    expect(api).toMatch(/recordStartupRequest/);
    expect(api).toMatch(/onRequestStart/);
  });

  it("attaches a correlation id and can record Plaid refresh timing", () => {
    expect(api).toMatch(/X-FlowSight-Request-Id/);
    expect(api).toMatch(/getStartupCorrelationId/);
    expect(refresh).toMatch(/recordPlaidRefreshTiming/);
    expect(refresh).not.toMatch(/syncPlaidItem/);
  });
});
