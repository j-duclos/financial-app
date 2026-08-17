import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scenariosSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Scenarios.tsx"),
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

  it("invalidates scenario comparison when changes are edited or removed", () => {
    expect(scenariosSource).toMatch(/invalidateQueries\(\{ queryKey: \["scenario-compare", selectedScenarioId\] \}\)/);
    expect(scenariosSource).toMatch(/scenarioInputStamp/);
    expect(scenariosSource).toMatch(/financial_revision/);
    expect(scenariosSource).toMatch(/forecastPeriod/);
  });

  it("does not apply a plan just because the result is SAFE", () => {
    expect(scenariosSource).not.toMatch(/applyScenario/);
    expect(scenariosSource).not.toMatch(/Apply this plan/);
  });
});
