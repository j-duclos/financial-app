import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const budgetData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useBudgetData.ts"),
  "utf8"
);

describe("Budget request orchestration", () => {
  it("does not fetch household list for default household discovery", () => {
    expect(budgetData).toMatch(/useDefaultHouseholdId/);
    expect(budgetData).not.toMatch(/listHouseholds/);
    expect(budgetData).not.toMatch(/householdsQuery/);
  });

  it("starts summary and targets when household id is available", () => {
    expect(budgetData).toMatch(/enabled: householdId != null/);
    expect(budgetData).toMatch(/getSpendingTargetsSummary/);
    expect(budgetData).toMatch(/listSpendingTargets/);
  });

  it("exposes awaitable refresh that joins summary and targets", () => {
    expect(budgetData).toMatch(/Promise\.all\(\[summaryQuery\.refetch\(\), targetsQuery\.refetch\(\)\]\)/);
  });
});
