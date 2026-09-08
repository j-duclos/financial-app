import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  invalidateAfterTestPlanChange,
  PLAN_TEST_OVERRIDE_QUERY_PREFIXES,
} from "./planTestOverride";

const dir = dirname(fileURLToPath(import.meta.url));

describe("web plan test override refresh", () => {
  it("invalidates billing, profile, forecast, reports, planner, and usage queries", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterTestPlanChange(queryClient);
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["billing-status"],
        ["profile"],
        ["dashboard-summary"],
        ["transactions"],
        ["accounts"],
        ["rules"],
        ["buckets"],
        ["monthly-reports"],
        ["debt-plan"],
        ["recommendations"],
      ])
    );
    expect(PLAN_TEST_OVERRIDE_QUERY_PREFIXES.length).toBeGreaterThan(8);
    spy.mockRestore();
  });

  it("does not render developer controls from production Profile/Layout source without the capability gate", () => {
    const profile = readFileSync(join(dir, "../pages/Profile.tsx"), "utf8");
    const layout = readFileSync(join(dir, "../components/Layout.tsx"), "utf8");
    const section = readFileSync(
      join(dir, "../components/billing/DeveloperTestingSection.tsx"),
      "utf8"
    );
    const banner = readFileSync(join(dir, "../components/billing/TestPlanBanner.tsx"), "utf8");
    expect(profile).toMatch(/DeveloperTestingSection/);
    expect(layout).toMatch(/TestPlanBanner/);
    expect(section).toMatch(/canShowPlanTestControls/);
    expect(section).toMatch(/isWebDevBuild/);
    expect(banner).toMatch(/testPlanIndicatorLabel/);
    expect(banner).toMatch(/isWebDevBuild/);
    expect(section).toMatch(/invalidateAfterTestPlanChange/);
    expect(section).not.toMatch(/logout/);
  });
});
