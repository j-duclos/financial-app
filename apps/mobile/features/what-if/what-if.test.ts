import { describe, expect, it } from "vitest";
import { FINANCIAL_QUERY_PREFIXES } from "@/lib/financialQueryRefresh";
import { whatIfQueryKeys, scenarioInputStamp } from "./queryKeys";
import { buildPlanIncludes } from "./scenarioPlainLanguage";
import { derivePlanSummaryResult, scenarioHasCashShortfall, recurringCostFromGroup } from "./display";
import { SCENARIO_TEMPLATES } from "./scenarioTemplates";
import type { ScenarioComparisonResponse, ScenarioForecastChangeGroup } from "@budget-app/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("what-if query isolation", () => {
  it("uses what-if prefix keys separate from real financial queries", () => {
    expect(whatIfQueryKeys.scenarios[0]).toBe("what-if-scenarios");
    expect(whatIfQueryKeys.compare(1, "12m", 2, 3, "stamp")[0]).toBe("what-if-scenario-compare");
    expect(whatIfQueryKeys.scenarioChanges(5, 2)[0]).toBe("what-if-scenario-changes");

    for (const prefix of FINANCIAL_QUERY_PREFIXES) {
      expect(prefix[0]).not.toMatch(/^what-if-/);
    }

    expect(whatIfQueryKeys.scenarios).not.toEqual(["dashboard-summary-fast"]);
    expect(whatIfQueryKeys.scenarioChanges(5, 2)).not.toEqual(["rules"]);
  });

  it("includes scenario, horizon, household, and financial_revision in compare key", () => {
    const key = whatIfQueryKeys.compare(9, "6m", 4, 17, "stamp-a");
    expect(key).toEqual(["what-if-scenario-compare", 9, "6m", 4, 17, "stamp-a"]);
  });

  it("scopes scenario-changes by household to avoid collisions", () => {
    expect(whatIfQueryKeys.scenarioChanges(1, 10)).not.toEqual(
      whatIfQueryKeys.scenarioChanges(1, 20)
    );
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

  it("input stamp is order-stable for the same change set", () => {
    const a = scenarioInputStamp({
      overrides: [
        { id: 2, updated_at: "b" },
        { id: 1, updated_at: "a" },
      ],
    });
    const b = scenarioInputStamp({
      overrides: [
        { id: 1, updated_at: "a" },
        { id: 2, updated_at: "b" },
      ],
    });
    expect(a).toBe(b);
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

  it("uses backend delta_monthly instead of client 52/12 frequency math", () => {
    const group: ScenarioForecastChangeGroup = {
      event: "Rent",
      account_id: 1,
      account_name: "Checking",
      rule_id: 1,
      frequency: "weekly",
      occurrence_count: 52,
      delta_per_occurrence: "-100",
      delta_monthly: "-433.33",
      total_delta: "-5200",
      first_date: "2026-01-01",
      effect_kind: "expense",
      base_amount: "100",
      scenario_amount: "0",
    };
    const cost = recurringCostFromGroup(group);
    expect(cost?.monthly).toBeCloseTo(433.33, 2);
    const displaySrc = readFileSync(join(process.cwd(), "features/what-if/display.ts"), "utf8");
    expect(displaySrc).not.toMatch(/\* 52\) \/ 12/);
    expect(displaySrc).not.toMatch(/\* 26\) \/ 12/);
  });
});

describe("what-if screen isolation contract", () => {
  const root = join(process.cwd(), "features/what-if");

  it("does not reference apply scenario or real-data invalidation", () => {
    const source = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    expect(source).not.toMatch(/applyScenario/);
    expect(source).not.toMatch(/invalidateFinancialQueries/);
    expect(source).toMatch(/invalidateScenarioQueries/);
    expect(source).toMatch(/Hypothetical only/);
  });

  it("uses explicit pullRefreshing, not passive isFetching", () => {
    const source = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    expect(source).toMatch(/pullRefreshing/);
    expect(source).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(source).toMatch(/refreshWhatIfScenario/);
    expect(source).not.toMatch(/refreshing=\{scenariosQuery\.isFetching/);
  });

  it("does not fetch form picker data when only Add Change menu opens", () => {
    const source = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    expect(source).not.toMatch(/formsEnabled \|\| addMenuOpen/);
    expect(source).toMatch(/accountsWithBalance: debtFormOpen/);
    expect(source).toMatch(/accountsLight:/);
  });

  it("marks mismatched scenario comparison as recalculating", () => {
    const source = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    const summary = readFileSync(join(root, "components/PlanSummaryCard.tsx"), "utf8");
    expect(source).toMatch(/comparisonBelongsToSelection/);
    expect(source).toMatch(/scenario_id === selectedScenarioId/);
    expect(summary).toMatch(/Updating scenario/);
  });

  it("distinguishes empty scenario from comparison failure", () => {
    const source = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    const summary = readFileSync(join(root, "components/PlanSummaryCard.tsx"), "utf8");
    expect(source).toMatch(/emptyScenario=\{isEmptyScenario\}/);
    expect(source).toMatch(/comparisonFailed=/);
    expect(summary).toMatch(/No hypothetical changes yet/);
    expect(summary).toMatch(/not a zero-impact result/);
  });

  it("uses plan overflow and tap-to-edit changes without Edit/Remove link clutter", () => {
    const screen = readFileSync(join(root, "WhatIfScreen.tsx"), "utf8");
    const changeRow = readFileSync(join(root, "components/ScenarioChangeRow.tsx"), "utf8");
    const newRecurring = readFileSync(join(root, "forms/NewRecurringSheet.tsx"), "utf8");
    const oneTime = readFileSync(join(root, "forms/OneTimeEventSheet.tsx"), "utf8");
    const create = readFileSync(join(root, "forms/CreateScenarioSheet.tsx"), "utf8");
    const addMenu = readFileSync(join(root, "forms/ChangeKindSheet.tsx"), "utf8");

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

    const summary = readFileSync(join(root, "components/PlanSummaryCard.tsx"), "utf8");
    expect(summary).toMatch(/Updating scenario/);
  });

  it("recalculates only after saved change via input stamp / compare query", () => {
    const data = readFileSync(join(root, "useWhatIfData.ts"), "utf8");
    const keys = readFileSync(join(root, "queryKeys.ts"), "utf8");
    expect(data).toMatch(/keepPreviousData/);
    expect(data).toMatch(/invalidateScenarioQueries/);
    expect(data).not.toMatch(/invalidateFinancialQueries/);
    expect(keys).toMatch(/what-if-scenario-compare/);
    expect(data).toMatch(/getScenarioChanges/);
    expect(data).toMatch(/scenarioChanges/);
    expect(data).toMatch(/useAccountOptions/);
    // Mutations invalidate changes only — stamp drives a single compare.
    expect(data).toMatch(/Comparison refreshes via inputStamp/);
  });

  it("scenario templates contain no invented production financial amounts", () => {
    const templates = readFileSync(join(root, "scenarioTemplates.ts"), "utf8");
    expect(templates).not.toMatch(/\$\d/);
    expect(templates).not.toMatch(/amount:\s*["']\d/);
    for (const t of SCENARIO_TEMPLATES) {
      expect(t.suggestedOverrideHints.join(" ")).not.toMatch(/\d{3,}/);
    }
  });

  it("debt helpers do not implement amortization schedules", () => {
    const debt = readFileSync(join(root, "scenarioDebtPayment.ts"), "utf8");
    expect(debt).not.toMatch(/interest_rate/);
    expect(debt).not.toMatch(/payoff_months/);
    expect(debt).not.toMatch(/minimum_payment\s*\*/);
    expect(debt).toMatch(/form preview only/);
  });

  it("one-time transfer form validates pairing without client balance projection", () => {
    const oneTime = readFileSync(join(root, "forms/OneTimeEventSheet.tsx"), "utf8");
    expect(oneTime).toMatch(/transfer/);
    expect(oneTime).not.toMatch(/ending_balance\s*[+\-]/);
    expect(oneTime).not.toMatch(/projectedBalance/);
  });
});
