import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UTILIZATION_PREFERENCE_QUERY_PREFIXES, FINANCIAL_QUERY_PREFIXES } from "./financialQueryRefresh";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "financialQueryRefresh.ts"),
  "utf8"
);
const accountsSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Accounts.tsx"),
  "utf8"
);

describe("financialQueryRefresh utilization preference", () => {
  it("invalidates recommendations, dashboard, debt plan, and account payoff when the target changes", () => {
    const keys = UTILIZATION_PREFERENCE_QUERY_PREFIXES.map((k) => k[0]);
    expect(keys).toContain("recommendations");
    expect(keys).toContain("dashboard-summary");
    expect(keys).toContain("debt-plan");
    expect(keys).toContain("account-payoff");
    expect(source).toMatch(/invalidateUtilizationPreferenceQueries/);
    expect(accountsSource).toMatch(/invalidateUtilizationPreferenceQueries\(queryClient\)/);
  });

  it("includes dti and debt-plan so minimum-payment changes refetch DTI and Payment Planner", () => {
    const keys = FINANCIAL_QUERY_PREFIXES.map((k) => k[0]);
    expect(keys).toContain("dti");
    expect(keys).toContain("debt-plan");
    expect(keys).toContain("accounts");
    expect(keys).toContain("onboarding");
    expect(accountsSource).toMatch(/queryKey: \["dti"\]/);
    expect(accountsSource).toMatch(/queryKey: \["debt-plan"\]/);
    expect(accountsSource).toMatch(/Refresh card minimums/);
    expect(accountsSource).toMatch(/syncHouseholdLiabilities/);
    expect(accountsSource).toMatch(/PlaidLiabilitiesUpdateButton/);
    expect(accountsSource).toMatch(/requestId !== liabilityRequestSeq\.current/);
  });

  it("includes account-payoff in financial mutation prefixes", () => {
    expect(source).toMatch(/\["account-payoff"\]/);
  });

  it("refetches active financial queries once via invalidation after a mutation", () => {
    const fnBody = source.slice(source.indexOf("export function refreshAfterTransactionEdit"));
    const end = fnBody.indexOf("export function flushFinancialRefresh");
    const body = end >= 0 ? fnBody.slice(0, end) : fnBody;
    expect(body).toMatch(/cancelQueries\(\{ queryKey: \["timeline"\] \}\)/);
    expect(body).toMatch(/invalidateFinancialQueries\(queryClient\)/);
    expect(body).not.toMatch(/refetchQueries/);
    expect(source).not.toMatch(/\["transactions", "future-posted"\]/);
  });
});
