import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import { emptyGoalFundingForm } from "./goalFundingForm";
import {
  classifyGoalSaveImpact,
  invalidateAfterGoalSave,
  invalidateGoalFundingQueries,
  invalidateGoalLifecycleQueries,
  invalidateGoalMetadataQueries,
  type GoalSaveImpactInput,
} from "./goalQueryInvalidation";

function goal(overrides: Partial<FinancialGoal> = {}): FinancialGoal {
  return {
    id: 1,
    household: 1,
    name: "Emergency",
    goal_type: "emergency",
    target_amount: "10000",
    current_amount: "1000",
    target_date: "2027-01-01",
    linked_account: 5,
    linked_credit_account: null,
    monthly_contribution: "200",
    priority: 3,
    status: "active",
    notes: "",
    created_at: "",
    updated_at: "",
    completed_at: null,
    remaining_amount: "9000",
    progress_percent: "10",
    projected_completion_date: null,
    on_track_status: "on_track",
    recommended_monthly_contribution: "200",
    is_debt_goal: false,
    goal_health: "on_track",
    monthly_required: "200",
    current_contribution_rate: "200",
    forecast_gap: null,
    include_in_safe_to_spend: true,
    forecast_enabled: true,
    auto_fund_enabled: false,
    milestones: [],
    ...overrides,
  } as FinancialGoal;
}

function values(overrides: Partial<GoalSaveImpactInput> = {}): GoalSaveImpactInput {
  return {
    name: "Emergency",
    description: "",
    goal_type: "emergency",
    target_amount: "10000",
    target_date: "2027-01-01",
    linked_account: 5,
    linked_credit_account: "",
    monthly_contribution: "200",
    priority: 3,
    include_in_safe_to_spend: true,
    forecast_enabled: true,
    auto_fund_enabled: false,
    notes: "",
    funding: { ...emptyGoalFundingForm },
    ...overrides,
  };
}

function captureInvalidations(run: (qc: QueryClient) => void): string[][] {
  const qc = new QueryClient();
  const keys: string[][] = [];
  const original = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, "invalidateQueries").mockImplementation(((opts: { queryKey?: unknown[] }) => {
    if (opts?.queryKey) keys.push(opts.queryKey.map(String));
    return original(opts as never);
  }) as typeof qc.invalidateQueries);
  run(qc);
  return keys;
}

describe("classifyGoalSaveImpact", () => {
  it("treats name/notes/priority/target-date as metadata-only", () => {
    expect(
      classifyGoalSaveImpact(
        goal(),
        values({ name: "Renamed", notes: "hi", priority: 1, target_date: "2028-06-01" })
      )
    ).toBe("metadata");
  });

  it("treats monthly contribution / forecast / funding / linked account as funding", () => {
    expect(classifyGoalSaveImpact(goal(), values({ monthly_contribution: "300" }))).toBe("funding");
    expect(classifyGoalSaveImpact(goal(), values({ forecast_enabled: false }))).toBe("funding");
    expect(classifyGoalSaveImpact(goal(), values({ include_in_safe_to_spend: false }))).toBe(
      "funding"
    );
    expect(classifyGoalSaveImpact(goal(), values({ linked_account: 9 }))).toBe("funding");
    expect(
      classifyGoalSaveImpact(
        goal({ auto_fund_enabled: false }),
        values({
          auto_fund_enabled: true,
          funding: { ...emptyGoalFundingForm, enabled: true, incomeRuleId: 1, fixedAmount: "50" },
        }),
        emptyGoalFundingForm
      )
    ).toBe("funding");
  });

  it("classifies create as funding for savings and metadata for debt", () => {
    expect(classifyGoalSaveImpact(null, values())).toBe("funding");
    expect(classifyGoalSaveImpact(null, values({ goal_type: "debt_payoff" }))).toBe("metadata");
  });
});

describe("goal invalidation blast radius", () => {
  it("lifecycle does not invalidate ledger or rule allocations", () => {
    const keys = captureInvalidations((qc) => invalidateGoalLifecycleQueries(qc));
    const roots = keys.map((k) => k[0]);
    expect(roots).toContain("buckets");
    expect(roots).toContain("bucket-detail");
    expect(roots).toContain("dashboard-summary");
    expect(roots).not.toContain("transactions");
    expect(roots).not.toContain("rule-allocations");
    expect(roots).not.toContain("recurring-rules");
    expect(roots).not.toContain("account-options");
  });

  it("metadata does not invalidate ledger or rules", () => {
    const keys = captureInvalidations((qc) => invalidateGoalMetadataQueries(qc));
    const roots = keys.map((k) => k[0]);
    expect(roots).toContain("buckets");
    expect(roots).not.toContain("transactions");
    expect(roots).not.toContain("rule-allocations");
    expect(roots).not.toContain("recurring-rules");
  });

  it("funding invalidates forecast, ledger, and rule allocations", () => {
    const keys = captureInvalidations((qc) => invalidateGoalFundingQueries(qc));
    const roots = keys.map((k) => k[0]);
    expect(roots).toContain("buckets");
    expect(roots).toContain("transactions");
    expect(roots).toContain("rule-allocations");
    expect(roots).toContain("recurring-rules");
    expect(roots).toContain("dashboard-summary");
  });

  it("invalidateAfterGoalSave routes metadata vs funding", () => {
    const meta = captureInvalidations((qc) =>
      invalidateAfterGoalSave(qc, "metadata", { isDebt: false })
    );
    expect(meta.map((k) => k[0])).not.toContain("transactions");
    expect(meta.map((k) => k[0])).not.toContain("rule-allocations");

    const funding = captureInvalidations((qc) => invalidateAfterGoalSave(qc, "funding"));
    expect(funding.map((k) => k[0])).toContain("rule-allocations");
    expect(funding.map((k) => k[0])).toContain("transactions");
  });
});
