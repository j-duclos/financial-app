import { describe, expect, it } from "vitest";
import { FINANCIAL_QUERY_PREFIXES } from "@/lib/financialQueryRefresh";
import { whatIfQueryKeys, scenarioInputStamp } from "./queryKeys";
import { buildPlanIncludes } from "./scenarioPlainLanguage";
import { derivePlanSummaryResult, scenarioHasCashShortfall } from "./display";
import type { ScenarioComparisonResponse } from "@budget-app/shared";

describe("what-if query isolation", () => {
  it("uses what-if prefix keys separate from real financial queries", () => {
    expect(whatIfQueryKeys.scenarios[0]).toBe("what-if-scenarios");
    expect(whatIfQueryKeys.compare(1, "12m", 2, 3, "stamp")[0]).toBe("what-if-scenario-compare");

    for (const prefix of FINANCIAL_QUERY_PREFIXES) {
      expect(prefix[0]).not.toMatch(/^what-if-/);
    }

    expect(whatIfQueryKeys.scenarios).not.toEqual(["dashboard-summary-fast"]);
    expect(whatIfQueryKeys.scenarioOverrides(5)).not.toEqual(["rules"]);
  });

  it("builds input stamp that changes when scenario changes update", () => {
    const a = scenarioInputStamp({
      scenarioUpdatedAt: "2026-01-01",
      overrides: [{ id: 1, updated_at: "t1" }],
      events: [],
      shocks: [],
      addedRecurring: [],
    });
    const b = scenarioInputStamp({
      scenarioUpdatedAt: "2026-01-01",
      overrides: [{ id: 1, updated_at: "t2" }],
      events: [],
      shocks: [],
      addedRecurring: [],
    });
    expect(a).not.toBe(b);
  });
});

describe("scenario plain language", () => {
  it("describes hypothetical overrides without implying real mutation", () => {
    const items = buildPlanIncludes(
      [
        {
          id: 1,
          scenario: 1,
          rule: {
            id: 10,
            name: "Rent",
            amount: "2500",
            currency: "USD",
            direction: "EXPENSE",
            frequency: "MONTHLY_DAY",
          } as never,
          override_amount: "3000",
          override_active: null,
          override_start_date: null,
          override_end_date: null,
          override_account: null,
          override_category: null,
          notes: "",
          created_at: "",
          updated_at: "",
        },
      ],
      [],
      [],
      []
    );
    expect(items[0].actionLabel).toMatch(/Rent/i);
    expect(items[0].detailLabel).toContain("→");
  });
});

describe("scenario comparison display", () => {
  const baseComparison: ScenarioComparisonResponse = {
    scenario_id: 1,
    scenario_name: "Test",
    horizon: "12m",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    metrics: {
      lowest_projected_balance: {
        base: "500",
        scenario: "200",
        delta: "-300",
      },
      risk_days: { base: "0", scenario: "2", delta: "2" },
      ending_cash: { base: "1000", scenario: "700", delta: "-300" },
    },
    summary: { overall: "worse", messages: [] },
    risk_explanation: {
      is_risky: true,
      first_problem_date: "2026-03-15",
      first_problem_account_id: 1,
      first_problem_account_name: "Checking",
      triggering_event: null,
      base_lowest_balance: "500",
      base_lowest_balance_date: "2026-06-01",
      scenario_lowest_balance: "200",
      scenario_lowest_balance_date: "2026-03-15",
      shortfall_amount: "100",
      amount_needed_to_stay_safe: "100",
      scenario_has_cash_shortfall: true,
    },
  };

  it("detects cash shortfall from backend metrics", () => {
    expect(scenarioHasCashShortfall(baseComparison)).toBe(true);
  });

  it("derives worse plan result when scenario risk increases", () => {
    expect(derivePlanSummaryResult(baseComparison)).toBe("WORSE");
  });
});

describe("what-if screen isolation contract", () => {
  it("does not reference apply scenario or real-data invalidation", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "features/what-if/WhatIfScreen.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/applyScenario/);
    expect(source).not.toMatch(/invalidateFinancialQueries/);
    expect(source).toMatch(/invalidateScenarioQueries/);
    expect(source).toMatch(/Hypothetical only/);
  });

  it("uses plan overflow and tap-to-edit changes without Edit/Remove link clutter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.join(process.cwd(), "features/what-if");
    const screen = fs.readFileSync(path.join(root, "WhatIfScreen.tsx"), "utf8");
    const changeRow = fs.readFileSync(path.join(root, "components/ScenarioChangeRow.tsx"), "utf8");
    const newRecurring = fs.readFileSync(path.join(root, "forms/NewRecurringSheet.tsx"), "utf8");
    const oneTime = fs.readFileSync(path.join(root, "forms/OneTimeEventSheet.tsx"), "utf8");
    const create = fs.readFileSync(path.join(root, "forms/CreateScenarioSheet.tsx"), "utf8");
    const addMenu = fs.readFileSync(path.join(root, "forms/ChangeKindSheet.tsx"), "utf8");

    expect(screen).toMatch(/PlanActionsSheet/);
    expect(screen).toMatch(/PlanPickerSheet/);
    expect(screen).not.toMatch(/Duplicate plan/);
    expect(screen).not.toMatch(/label="Delete plan"/);
    expect(changeRow).not.toMatch(/>Edit</);
    expect(changeRow).not.toMatch(/>Remove</);
    expect(changeRow).toMatch(/onPress=\{onEdit\}/);
    expect(changeRow).toMatch(/ellipsis-v/);

    expect(newRecurring).toMatch(/OptionsPickerSheet/);
    expect(newRecurring).toMatch(/DatePickerField/);
    expect(newRecurring).not.toMatch(/ChipRow/);
    expect(oneTime).toMatch(/OptionsPickerSheet/);
    expect(oneTime).not.toMatch(/ChipRow/);
    expect(create).toMatch(/Template/);
    expect(create).toMatch(/households\.length > 1/);
    expect(create).toMatch(/OptionsPickerSheet/);
    expect(addMenu).toMatch(/What do you want to change\?/);
    expect(oneTime).toMatch(/Save change/);
    expect(newRecurring).toMatch(/Save change/);

    const summary = fs.readFileSync(path.join(root, "components/PlanSummaryCard.tsx"), "utf8");
    expect(summary).toMatch(/Updating scenario/);
  });

  it("recalculates only after saved change via input stamp / compare query", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const data = fs.readFileSync(path.join(process.cwd(), "features/what-if/useWhatIfData.ts"), "utf8");
    expect(data).toMatch(/keepPreviousData/);
    expect(data).toMatch(/invalidateScenarioQueries/);
    expect(data).not.toMatch(/invalidateFinancialQueries/);
    expect(data).toMatch(/what-if-scenario-compare/);
  });
});
