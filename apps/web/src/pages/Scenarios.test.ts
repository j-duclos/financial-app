import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scenarioInputStamp, whatIfWebQueryKeys } from "../lib/whatIfQueryKeys";
import { SCENARIO_TEMPLATES } from "../lib/scenarioTemplates";

const scenariosSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Scenarios.tsx"),
  "utf8"
);
const queryKeysSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/whatIfQueryKeys.ts"),
  "utf8"
);
const displaySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/scenarioComparisonDisplay.ts"),
  "utf8"
);

describe("What-If context from Planning", () => {
  it("reads optional goal and debt query params without persisting on open", () => {
    expect(scenariosSource).toMatch(/parsePositiveIntParam\(searchParams.get\("goal"\)\)/);
    expect(scenariosSource).toMatch(/parsePositiveIntParam\(searchParams.get\("debt"\)\)/);
    expect(scenariosSource).toMatch(/initialDebtAccountId=\{contextDebtId\}/);
    expect(scenariosSource).toMatch(/Opened from Goals\. Changes here are hypothetical until you apply them\./);
    expect(scenariosSource).toMatch(/Model payoff change/);
  });

  it("keeps Edit and Remove on compact change rows without a primary red Remove", () => {
    expect(scenariosSource).toMatch(/planItemDisplayTitle\(item\)/);
    expect(scenariosSource).toMatch(/planItemDisplayDetail\(item\)/);
    expect(scenariosSource).toMatch(/>\s*Edit\s*</);
    expect(scenariosSource).toMatch(/>\s*Remove\s*</);
    expect(scenariosSource).not.toMatch(/bg-red-600[^"]*">Remove/);
  });

  it("makes detailed impact an expandable control", () => {
    expect(scenariosSource).toMatch(/aria-expanded=\{visible\}/);
    expect(scenariosSource).toMatch(/Hide detailed impact/);
    expect(scenariosSource).toMatch(/Show detailed impact/);
  });

  it("refreshes comparison via input stamp after changes settle (no duplicate compare invalidate)", () => {
    expect(scenariosSource).toMatch(/scenarioInputStamp|buildScenarioInputStamp/);
    expect(scenariosSource).toMatch(/financial_revision/);
    expect(scenariosSource).toMatch(/forecastPeriod/);
    expect(scenariosSource).toMatch(/getScenarioChanges/);
    expect(scenariosSource).toMatch(/whatIfWebQueryKeys\.scenarioChanges/);
    expect(scenariosSource).toMatch(/Comparison refreshes via inputStamp/);
    expect(scenariosSource).not.toMatch(
      /invalidateQueries\(\{ queryKey: \["scenario-compare", selectedScenarioId\] \}\)/
    );
  });

  it("does not apply a plan just because the result is SAFE", () => {
    expect(scenariosSource).not.toMatch(/applyScenario/);
    expect(scenariosSource).not.toMatch(/Apply this plan/);
  });

  it("does not invalidate real financial caches on scenario edits", () => {
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["dashboard/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["transactions/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["calendar/);
    expect(scenariosSource).not.toMatch(/invalidateQueries\(\{ queryKey: \["goals/);
    expect(queryKeysSource).toMatch(/must never be invalidated by scenario mutations/);
  });

  it("lazy-loads accounts only when a change form needs them", () => {
    expect(scenariosSource).toMatch(/modalNeedsAccounts/);
    expect(scenariosSource).toMatch(/enabled: modalNeedsAccounts/);
    expect(scenariosSource).toMatch(/modalNeedsAccountBalances/);
  });

  it("marks mismatched scenario comparison while switching plans", () => {
    expect(scenariosSource).toMatch(/comparisonBelongsToSelection/);
    expect(scenariosSource).toMatch(/Calculating this plan/);
    expect(scenariosSource).toMatch(/Updating scenario/);
    expect(scenariosSource).toMatch(/No hypothetical changes yet/);
  });

  it("compare query key includes scenario, horizon, and financial revision", () => {
    const key = whatIfWebQueryKeys.compare(1, "12m", 2, 9, "stamp");
    expect(key).toEqual(["scenario-compare", 1, "12m", 2, 9, "stamp"]);
  });

  it("input stamp is deterministic for identical change sets", () => {
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

  it("scenario templates contain no invented production financial amounts", () => {
    const templates = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../lib/scenarioTemplates.ts"),
      "utf8"
    );
    expect(templates).not.toMatch(/\$\d/);
    for (const t of SCENARIO_TEMPLATES) {
      expect(t.suggestedOverrideHints.join(" ")).not.toMatch(/\d{3,}/);
    }
  });

  it("does not compute monthly recurring cost with client 52/12 math", () => {
    expect(displaySource).not.toMatch(/\* 52\) \/ 12/);
    expect(displaySource).not.toMatch(/\* 26\) \/ 12/);
    expect(displaySource).toMatch(/delta_monthly/);
  });

  it("gives scenario compare a long timeout so 12-month forecasts can finish", () => {
    const apiSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/api-client/src/api.ts"),
      "utf8"
    );
    expect(apiSource).toMatch(
      /export async function getScenarioComparison[\s\S]*timeoutMs:\s*300_000/m
    );
  });

  it("does not stamp override_active true on a monthly debt payment increase", () => {
    const payDownSource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../components/scenarios/PayDownDebtModal.tsx"
      ),
      "utf8"
    );
    expect(payDownSource).toMatch(/override_active:\s*null/);
    expect(payDownSource).not.toMatch(/override_active:\s*true as const/);
  });
});
