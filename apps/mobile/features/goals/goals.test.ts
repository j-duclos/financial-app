import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FinancialGoal } from "@budget-app/shared";
import {
  formatGoalProgressSummary,
  goalDetailAdvancedForecastRows,
  goalDetailForecastRows,
  goalDetailPrimaryPaceLines,
  goalListStatusDisplay,
  goalPrimaryRecommendation,
  goalSuggestionLine,
  validateGoalForm,
} from "@budget-app/shared";
import { buildGoalBucketPayload, emptyGoalForm } from "./form";
import {
  goalContributionHistoryPath,
  goalDetailPath,
  goalRelatedTransactionsPath,
  goalsListPath,
} from "./navigation";
import { GOAL_DETAIL_HISTORY_PREVIEW_LIMIT, goalsQueryKeys } from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const goalsScreenSource = readFileSync(join(dir, "GoalsScreen.tsx"), "utf8");
const goalCardSource = readFileSync(join(dir, "GoalCard.tsx"), "utf8");
const goalDetailSource = readFileSync(join(dir, "GoalDetailScreen.tsx"), "utf8");
const goalFormSource = readFileSync(join(dir, "GoalFormScreen.tsx"), "utf8");
const historySource = readFileSync(join(dir, "GoalContributionHistoryScreen.tsx"), "utf8");
const dashboardSource = readFileSync(join(dir, "../dashboard/DashboardDetailsSections.tsx"), "utf8");
const placeholderPath = join(dir, "../../app/(app)/goals.tsx");

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
    projected_completion_date: "2029-08-01",
    on_track_status: "behind",
    recommended_monthly_contribution: "6987.84",
    is_debt_goal: false,
    goal_health: "behind",
    monthly_required: "6987.84",
    current_contribution_rate: "795.39",
    forecast_gap: "6192.45",
    suggested_per_paycheck: "3225.16",
    milestones: [],
    pace_status: "behind",
    contribution_recommendation:
      "Need $6987.84/month to reach your target date · $3225.16/paycheck needed to reach target",
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
  it("shows canonical sentence-case status labels", () => {
    expect(goalListStatusDisplay(sampleGoal())?.label).toBe("Behind");
    expect(goalListStatusDisplay(sampleGoal({ status: "paused", pace_status: undefined }))?.label).toBe(
      "Paused"
    );
    expect(goalListStatusDisplay(sampleGoal({ status: "completed", pace_status: "completed" }))?.label).toBe(
      "Complete"
    );
  });

  it("list card uses compact progress and primary monthly recommendation", () => {
    const goal = sampleGoal();
    expect(formatGoalProgressSummary(goal)).toMatch(/\$2,048\.64 of \$30,000\.00 · 7%/);
    expect(goalPrimaryRecommendation(goal)).toBe("Need $6,987.84/month to reach target");
    expect(goalPrimaryRecommendation(goal)).not.toMatch(/paycheck/i);
  });

  it("goal card source omits per-paycheck and percent-complete clutter", () => {
    expect(goalCardSource).toMatch(/formatGoalProgressSummary/);
    expect(goalCardSource).toMatch(/goalPrimaryRecommendation/);
    expect(goalCardSource).not.toMatch(/paycheck/i);
    expect(goalCardSource).not.toMatch(/% complete/);
    expect(goalCardSource).not.toMatch(/goalSuggestionLine/);
  });

  it("list opens detail on card press and uses header create action", () => {
    expect(goalsScreenSource).toMatch(/goalDetailPath\(goal\.id\)/);
    expect(goalsScreenSource).toMatch(/accessibilityLabel="Create goal"/);
    expect(goalsScreenSource).toMatch(/name="plus"/);
    expect(goalsScreenSource).not.toMatch(/label="Create goal"/);
  });

  it("overview query key is canonical and list does not load detail", () => {
    expect(goalsQueryKeys.overview(42)).toEqual(["buckets", "overview", 42]);
    expect(goalsScreenSource).toMatch(/getBucketsOverview/);
    expect(goalsScreenSource).not.toMatch(/getBucketDetail/);
  });
});

describe("Goal detail presentation", () => {
  it("uses compact forecast rows without shortfall/paycheck by default", () => {
    const rows = goalDetailForecastRows(sampleGoal());
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual(["Target", "Projected", "Current pace", "Required pace"]);
    expect(labels).not.toContain("Shortfall");
    expect(labels).not.toContain("Per paycheck needed");
  });

  it("advanced forecast rows include shortfall and paycheck", () => {
    const advanced = goalDetailAdvancedForecastRows(sampleGoal());
    const labels = advanced.map((r) => r.label);
    expect(labels).toContain("Shortfall");
    expect(labels.some((l) => /paycheck/i.test(l))).toBe(true);
  });

  it("detail primary recommendation is monthly-only", () => {
    const lines = goalDetailPrimaryPaceLines(sampleGoal());
    expect(lines.needed).toBe("Need $6,987.84/month");
    expect(lines.pace).toBe("Current pace $795.39/month");
    expect(goalPrimaryRecommendation(sampleGoal())).not.toMatch(/paycheck/i);
  });

  it("detail keeps API suggestion available but screens prefer primary helper", () => {
    const line = goalSuggestionLine(sampleGoal());
    expect(line).toContain("Need $6987.84/month");
    expect(goalDetailSource).toMatch(/goalPrimaryRecommendation|goalDetailPrimaryPaceLines/);
    expect(goalDetailSource).not.toMatch(/goalSuggestionLine/);
    expect(goalDetailSource).not.toMatch(/goalPerPaycheckNeeded/);
  });

  it("detail navigation paths", () => {
    expect(goalDetailPath(7)).toBe("/goal/7");
    expect(goalsListPath()).toBe("/goals");
    expect(goalContributionHistoryPath(7)).toBe("/goal/7/contributions");
    expect(goalRelatedTransactionsPath(5)).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        account: "5",
        focus: "__none__",
        focusDate: "__none__",
        focusTransactionId: "__none__",
        focusRuleId: "__none__",
        focusEventId: "__none__",
        focusDescription: "__none__",
      },
    });
    // Nested layout so Expo resolves Stack.Screen name="goal/[id]" (without it, nav traps).
    const layoutPath = join(dir, "../../app/(app)/goal/[id]/_layout.tsx");
    expect(readFileSync(layoutPath, "utf8")).toMatch(/Stack\.Screen name="index"/);
    expect(goalDetailSource).toMatch(/showBack/);
    expect(goalDetailSource).toMatch(/backFallbackHref=\{goalsListPath\(\)\}/);
    expect(goalDetailSource).not.toMatch(/onBack=\{\(\) => router\.push\(goalsListPath/);
  });

  it("detail uses overflow menu instead of giant Edit/What-If buttons", () => {
    expect(goalDetailSource).toMatch(/GoalActionsSheet/);
    expect(goalDetailSource).toMatch(/includeWhatIf/);
    expect(goalDetailSource).not.toMatch(/label="Edit goal"/);
    expect(goalDetailSource).not.toMatch(/label="What-If"/);
    expect(goalDetailSource).not.toMatch(/View related transactions/);
    expect(goalDetailSource).toMatch(/Related transactions/);
  });

  it("recent contribution history is bounded and view-all opens full history", () => {
    expect(GOAL_DETAIL_HISTORY_PREVIEW_LIMIT).toBe(5);
    expect(goalDetailSource).toMatch(/history_limit:\s*GOAL_DETAIL_HISTORY_PREVIEW_LIMIT/);
    expect(goalDetailSource).toMatch(/Recent contributions/);
    expect(goalDetailSource).toMatch(/goalContributionHistoryPath/);
    expect(goalDetailSource).toMatch(/View all/);
    expect(historySource).toMatch(/listGoalContributions/);
    expect(historySource).toMatch(/useInfiniteQuery/);
    expect(historySource).toMatch(/page_size/);
  });
});

describe("Goal form simplification", () => {
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

  it("uses account picker sheet and date picker instead of chips/typed ISO", () => {
    expect(goalFormSource).toMatch(/@\/components\/forms/);
    expect(goalFormSource).toMatch(/Advanced options/);
    expect(goalFormSource).not.toMatch(/YYYY-MM-DD/);
    expect(goalFormSource).not.toMatch(/ChipSelect/);
    expect(goalFormSource).not.toMatch(/HorizontalScrollIndicator/);
  });

  it("hides advanced financial-engine settings by default", () => {
    expect(goalFormSource).toMatch(/advancedOpen/);
    expect(goalFormSource).toMatch(/Auto-fund on payday/);
    expect(goalFormSource).toMatch(/Reserve contributions from safe-to-spend/);
    expect(goalFormSource).toMatch(/Include in forecast/);
    expect(goalFormSource).toMatch(/Priority/);
    expect(goalFormSource).toMatch(/High/);
    expect(goalFormSource).toMatch(/Normal/);
    expect(goalFormSource).toMatch(/Low/);
    expect(goalFormSource).not.toMatch(/Highest/);
    expect(goalFormSource).not.toMatch(/Lowest/);
  });

  it("prevents duplicate submit while pending", () => {
    expect(goalFormSource).toMatch(/if \(saveMu\.isPending\) return/);
    expect(goalFormSource).toMatch(/disabled=\{saveMu\.isPending\}/);
  });
});

describe("Canonical forecast consistency", () => {
  it("dashboard, list, and detail share the same primary recommendation helper", () => {
    const goal = sampleGoal();
    const primary = goalPrimaryRecommendation(goal);
    expect(primary).toBe("Need $6,987.84/month to reach target");
    expect(goalCardSource).toMatch(/goalPrimaryRecommendation/);
    expect(goalDetailSource).toMatch(/goalPrimaryRecommendation|goalDetailPrimaryPaceLines/);
    expect(readFileSync(join(dir, "../dashboard/dashboardGoalDisplay.ts"), "utf8")).toMatch(
      /goalPrimaryRecommendation/
    );
  });

  it("does not recalculate projected completion or required monthly on mobile", () => {
    expect(goalDetailSource).not.toMatch(/projected_completion_date\s*=/);
    expect(goalDetailSource).toMatch(/goalDetailForecastRows|formatGoalTargetDate/);
    expect(goalCardSource).not.toMatch(/monthly_required\s*\*/);
  });

  it("preserves negative contribution amounts as canonical withdrawals", () => {
    expect(goalDetailSource).toMatch(/formatCurrency\(entry\.amount\)/);
    expect(goalDetailSource).not.toMatch(/Math\.abs/);
    expect(historySource).toMatch(/formatCurrency\(item\.amount\)/);
    expect(historySource).not.toMatch(/Math\.abs/);
  });
});
