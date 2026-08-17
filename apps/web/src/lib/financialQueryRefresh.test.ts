import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UTILIZATION_PREFERENCE_QUERY_PREFIXES } from "./financialQueryRefresh";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "financialQueryRefresh.ts"),
  "utf8"
);
const accountsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Accounts.tsx"),
  "utf8"
);

describe("financialQueryRefresh utilization preference", () => {
  it("invalidates recommendations, dashboard, and debt plan when the target changes", () => {
    const keys = UTILIZATION_PREFERENCE_QUERY_PREFIXES.map((k) => k[0]);
    expect(keys).toContain("recommendations");
    expect(keys).toContain("dashboard-summary");
    expect(keys).toContain("debt-plan");
    expect(source).toMatch(/invalidateUtilizationPreferenceQueries/);
    expect(accountsSource).toMatch(/invalidateUtilizationPreferenceQueries\(queryClient\)/);
  });
});
