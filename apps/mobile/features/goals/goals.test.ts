import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import {
  goalDetailForecastRows,
  goalListStatusDisplay,
  goalSuggestionLine,
  validateGoalForm,
} from "@budget-app/shared";
import { buildGoalBucketPayload, emptyGoalForm } from "./form";
import { goalDetailPath, goalRelatedTransactionsPath, goalsListPath } from "./navigation";
import { goalsQueryKeys } from "./queryKeys";

const goalsScreenSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalsScreen.tsx"),
  "utf8"
);
const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../dashboard/DashboardDetailsSections.tsx"),
  "utf8"
);
const placeholderPath = join(dirname(fileURLToPath(import.meta.url)), "../../app/(app)/goals.tsx");

function sampleGoal(overrides: Partial<FinancialGoal> = {}): FinancialGoal {
  return {
    id: 1,
    household: 1,
    name: "House Down Payment",
    goal_type: "house",
    target_amount: "30000",
    current_amount: "2048.64",
    target_date: "2026-12-01",
    linked_account: 5,
    linked_credit_account: null,
    monthly_contribution: "0",
    priority: 3,
    status: "active",
    notes: "",
    created_at: "",
    updated_at: "",
    completed_at: null,
    remaining_amount: "27951.36",
    progress_percent: "6.83",
    projected_completion_date: "2028-03-01",
    on_track_status: "behind",
    recommended_monthly_contribution: "6192.45",
    is_debt_goal: false,
    goal_health: "behind",
    monthly_required: "6192.45",
    current_contribution_rate: null,
    forecast_gap: "6192.45",
    milestones: [],
    pace_status: "behind",
    contribution_recommendation: "Need $6192.45/month to reach your target date",
    ...overrides,
  } as FinancialGoal;
}

describe("Goals routes and placeholder removal", () => {
  it("goals route no longer uses PlaceholderScreen", () => {
    const goalsRoute = readFileSync(placeholderPath, "utf8");
    expect(goalsRoute).not.toMatch(/PlaceholderScreen/);
    expect(goalsRoute).toMatch(/GoalsScreen/);
  });

  it("dashboard goal cards navigate to specific goal detail", () => {
    expect(dashboardSource).toMatch(/goalDetailPath\(goal\.id\)/);
    expect(dashboardSource).not.toMatch(/router\.push\("\/goals"\).*onPress/);
  });
});

describe("Goals list presentation", () => {
  it("shows explicit pace status labels", () => {
    expect(goalListStatusDisplay(sampleGoal())?.label).toBe("BEHIND");
    expect(goalListStatusDisplay(sampleGoal({ status: "paused", pace_status: undefined }))?.label).toBe(
      "PAUSED"
    );
    expect(goalListStatusDisplay(sampleGoal({ status: "completed", pace_status: "completed" }))?.label).toBe(
      "COMPLETED"
    );
  });

  it("uses API contribution recommendation with status context", () => {
    const line = goalSuggestionLine(sampleGoal());
    expect(line).toContain("Need $6192.45/month");
    expect(line).not.toContain("stay on pace");
  });

  it("overview query key is canonical", () => {
    expect(goalsQueryKeys.overview(42)).toEqual(["buckets", "overview", 42]);
  });
});

describe("Goal detail presentation", () => {
  it("distinguishes target date from projected completion", () => {
    const rows = goalDetailForecastRows(sampleGoal());
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Target date");
    expect(labels).toContain("Projected completion");
  });

  it("detail navigation paths", () => {
    expect(goalDetailPath(7)).toBe("/goal/7");
    expect(goalsListPath()).toBe("/goals");
    expect(goalRelatedTransactionsPath(5)).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: { account: "5" },
    });
  });
});

describe("Goal form validation", () => {
  it("requires name and target amount", () => {
    const errors = validateGoalForm({
      ...emptyGoalForm,
      linked_account: 1,
    });
    expect(errors.name).toBeTruthy();
    expect(errors.target_amount).toBeTruthy();
  });

  it("builds bucket payload for savings goals", () => {
    const payload = buildGoalBucketPayload(1, {
      ...emptyGoalForm,
      name: "Emergency",
      target_amount: "10000",
      linked_account: 2,
      goal_type: "emergency",
    });
    expect(payload.name).toBe("Emergency");
    expect(payload.type).toBe("emergency");
    expect(payload.linked_account).toBe(2);
  });

  it("goals list uses single overview request", () => {
    expect(goalsScreenSource).toMatch(/getBucketsOverview/);
    expect(goalsScreenSource).not.toMatch(/getBucketDetail/);
  });
});
