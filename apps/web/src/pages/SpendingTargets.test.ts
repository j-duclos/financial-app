import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, "SpendingTargets.tsx"), "utf8");
const budgetLegacy = readFileSync(join(dir, "Budget.tsx"), "utf8");
const formModal = readFileSync(
  join(dir, "../components/spendingTargets/SpendingTargetFormModal.tsx"),
  "utf8"
);

describe("Budget page", () => {
  it("uses canonical Spending Targets APIs, not legacy budgets or category-breakdown math", () => {
    expect(source).toMatch(/getSpendingTargetsSummary/);
    expect(source).toMatch(/listSpendingTargets/);
    expect(source).not.toMatch(/listBudgets/);
    expect(source).not.toMatch(/getCategoryBreakdown/);
    expect(source).not.toMatch(/createBudget/);
    expect(source).not.toMatch(/listTransactions/);
  });

  it("displays backend remaining_to_targets_total without client summary arithmetic", () => {
    expect(source).toMatch(/remaining_to_targets_total/);
    expect(source).not.toMatch(/spendingTargetsRemainingFromSummary/);
    expect(source).toMatch(/scheduled_in_period_total/);
    expect(source).toMatch(/spent_so_far_total/);
    expect(source).toMatch(/total_monthly_targets/);
  });

  it("uses profile default household, not households\\[0\\]", () => {
    expect(source).toMatch(/useProfileQuery/);
    expect(source).toMatch(/default_household/);
    expect(source).not.toMatch(/households\?\.\[0\]/);
  });

  it("invalidates spending-target dependents on mutation", () => {
    expect(source).toMatch(/invalidateSpendingTargetDependents/);
  });

  it("does not mislabel previous-period placeholder data as current", () => {
    expect(source).toMatch(/keepPreviousData/);
    expect(source).toMatch(/dataMatchesPeriod/);
    expect(source).toMatch(/Updating/);
  });

  it("does not add sorting or filtering controls", () => {
    expect(source).not.toMatch(/sortBy/);
    expect(source).not.toMatch(/filterCategory/);
  });

  it("uses a short subtitle, keeps progress copy, and labels the add CTA", () => {
    expect(source).toMatch(/Set and track monthly spending by category\./);
    expect(source).toMatch(/Progress uses posted spending plus known future scheduled transactions only\./);
    expect(source).toMatch(/Add spending limit/);
  });
});

describe("legacy Budget.tsx", () => {
  it("remains unrouted documentation of the old Budget model only", () => {
    expect(budgetLegacy).toMatch(/LEGACY/);
    expect(budgetLegacy).toMatch(/listBudgets/);
  });
});

describe("SpendingTargetFormModal threshold", () => {
  it("omits warning_threshold when blank and does not hard-code 80", () => {
    expect(formModal).not.toMatch(/setWarningThreshold\("80"\)/);
    expect(formModal).not.toMatch(/\|\| "80"/);
    expect(formModal).toMatch(/Leave blank for server default/);
    expect(formModal).toMatch(/if \(threshold\)/);
  });
});
