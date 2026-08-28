import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PROFILE_QUERY_KEY } from "@/lib/profileQueryKey";
import { referenceQueryKeys } from "@/lib/referenceQueryKeys";
import { whatIfQueryKeys } from "@/features/what-if/queryKeys";

const root = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("request-flow cache consolidation", () => {
  it("Transactions ledger does not fetch reconcile setup", () => {
    const data = read("../features/transactions/useTransactionsData.ts");
    expect(data).not.toMatch(/getReconcileSetup/);
    expect(data).not.toMatch(/reconcileSetup/);
  });

  it("What-If uses canonical profile and household caches", () => {
    const data = read("../features/what-if/useWhatIfData.ts");
    const screen = read("../features/what-if/WhatIfScreen.tsx");
    expect(data).toMatch(/useProfile/);
    expect(data).toMatch(/useHouseholds/);
    expect(data).not.toMatch(/what-if-profile/);
    expect(data).not.toMatch(/what-if-households/);
    expect(screen).toMatch(/useProfile\(\)/);
    expect(screen).toMatch(/useHouseholds\(\)/);
    expect(PROFILE_QUERY_KEY).toEqual(["profile"]);
    expect(read("../hooks/useHouseholds.ts")).toMatch(/\["households"\]/);
  });

  it("What-If rules share canonical rules cache with Automation", () => {
    const data = read("../features/what-if/useWhatIfData.ts");
    expect(data).toMatch(/useRules/);
    expect(data).not.toMatch(/what-if-rules/);
    expect(read("../hooks/useRules.ts")).toMatch(/\["rules"\]/);
  });

  it("Action Center reuses account-options for reference accounts", () => {
    const screen = read("../features/action-center/ActionCenterScreen.tsx");
    expect(screen).toMatch(/useAccountOptions/);
    expect(screen).not.toMatch(/action-center.*accounts/);
    expect(screen).not.toMatch(/listAccounts/);
  });

  it("Automation form reuses account-options", () => {
    const form = read("../features/automation/AutomationFormScreen.tsx");
    expect(form).toMatch(/useAccountOptions/);
    expect(form).not.toMatch(/automation-form/);
    expect(form).not.toMatch(/listAccounts/);
  });

  it("What-If loads scenario changes through one aggregate query", () => {
    const data = read("../features/what-if/useWhatIfData.ts");
    expect(data).toMatch(/getScenarioChanges/);
    expect(data).toMatch(/scenarioChanges/);
    expect(data).not.toMatch(/listScenarioOverrides/);
    expect(data).not.toMatch(/listScenarioOneTimeEvents/);
    expect(data).not.toMatch(/listScenarioCategoryShocks/);
    expect(data).not.toMatch(/listScenarioAddedRecurring/);
    expect(whatIfQueryKeys.scenarioChanges(3)).toEqual(["what-if-scenario-changes", 3]);
  });

  it("account-options key is household-scoped for cache sharing", () => {
    expect(referenceQueryKeys.accountOptions(7)).toEqual(["account-options", 7]);
    const tx = read("../features/transactions/TransactionsScreen.tsx");
    expect(tx).toMatch(/useAccountOptions/);
  });
});

describe("automation monthly summary decision", () => {
  it("sums backend-owned estimated_monthly_amount without client frequency conversion", () => {
    const display = read("../features/automation/automationDisplay.ts");
    expect(display).toMatch(/estimated_monthly_amount/);
    expect(display).not.toMatch(/52\s*\/\s*12/);
    expect(display).not.toMatch(/26\s*\/\s*12/);
    expect(display).toMatch(/estimatedMonthlyCashFlow/);
  });
});
