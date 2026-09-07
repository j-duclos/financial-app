import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const goalsScreenSource = readFileSync(join(dir, "GoalsScreen.tsx"), "utf8");
const goalDetailSource = readFileSync(join(dir, "GoalDetailScreen.tsx"), "utf8");
const goalFormSource = readFileSync(join(dir, "GoalFormScreen.tsx"), "utf8");
const actionsSheetSource = readFileSync(join(dir, "GoalActionsSheet.tsx"), "utf8");
const hookSource = readFileSync(join(dir, "useGoalPlanLimit.ts"), "utf8");
const webGoalsSource = readFileSync(join(dir, "../../../web/src/pages/Goals.tsx"), "utf8");
const webGoalCardSource = readFileSync(
  join(dir, "../../../web/src/components/goals/GoalCard.tsx"),
  "utf8"
);
const webGoalDetailSource = readFileSync(join(dir, "../../../web/src/pages/GoalDetail.tsx"), "utf8");

function switchCaseBlock(source: string, action: string): string {
  const start = source.indexOf(`case "${action}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextCase = source.indexOf("case ", start + 1);
  const defaultIdx = source.indexOf("default:", start + 1);
  const candidates = [nextCase, defaultIdx].filter((i) => i >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

describe("mobile Goals Free/Premium goal-limit UX", () => {
  it("uses cached billing status and shared entitlement helpers, not a local plan or recount", () => {
    expect(hookSource).toMatch(/useBillingStatus/);
    expect(hookSource).toMatch(/atPlanLimit\(billing, "goals"\)/);
    expect(hookSource).toMatch(/goalUsageLabel\(billing\)/);
    expect(hookSource).toMatch(/goalLimitReachedMessage/);
    expect(hookSource).toMatch(/usePremiumUpgrade/);
    expect(hookSource).not.toMatch(/getBucketsOverview/);
    expect(hookSource).not.toMatch(/goalsQueryKeys/);
    expect(hookSource).not.toMatch(/status === "completed"/);
    expect(hookSource).not.toMatch(/status === "archived"/);
    expect(hookSource).not.toMatch(/status === "active"/);
    expect(goalsScreenSource).toMatch(/useGoalPlanLimit/);
    expect(goalsScreenSource).toMatch(/queryFn: \(\) => getBucketsOverview/);
    expect(goalsScreenSource.match(/queryFn: \(\) => getBucketsOverview/g)?.length).toBe(1);
    expect(goalFormSource.match(/queryFn: \(\) => getBucketsOverview/g)?.length).toBe(1);
    expect(goalDetailSource).not.toMatch(/getBucketsOverview/);
  });

  it("shows Free usage from billing and omits a Premium limit label", () => {
    expect(goalsScreenSource).toMatch(/usageLabel/);
    expect(goalsScreenSource).toMatch(/\{usageLabel\}/);
    expect(hookSource).toMatch(/goalUsageLabel\(billing\)/);
  });

  it("FREE below limit: + opens create and duplicate is allowed", () => {
    expect(goalsScreenSource).toMatch(/onCreateGoal/);
    expect(goalsScreenSource).toMatch(/if \(interceptIfLimited\(\)\) return/);
    expect(goalsScreenSource).toMatch(/router\.push\(goalCreatePath\(\)\)/);
    expect(switchCaseBlock(goalsScreenSource, "duplicate")).toMatch(/interceptIfLimited/);
    expect(switchCaseBlock(goalsScreenSource, "duplicate")).toMatch(/duplicateMu\.mutate/);
    expect(goalsScreenSource).not.toMatch(
      /onPress=\{\(\) => router\.push\(goalCreatePath\(\)\)\}/
    );
  });

  it("FREE at limit: + does not navigate and shows the upgrade prompt", () => {
    expect(hookSource).toMatch(/promptUpgrade\(GOAL_LIMIT_TITLE/);
    expect(hookSource).toMatch(/goalLimitReachedMessage\(billing\)/);
    expect(hookSource).toMatch(/You've reached the Free plan limit|goalLimitReachedMessage/);
    expect(goalsScreenSource).toMatch(/onPress=\{onCreateGoal\}/);
    expect(goalsScreenSource).toMatch(/onAction=\{onCreateGoal\}/);
    expect(goalsScreenSource).not.toMatch(
      /onPress=\{\(\) => router\.push\(goalCreatePath\(\)\)\}/
    );
  });

  it("direct create route shows a locked upgrade state and does not submit create", () => {
    expect(goalFormSource).toMatch(/!isEdit && goalsLimited/);
    expect(goalFormSource).toMatch(/if \(!isEdit && goalsLimited\) return/);
    expect(goalFormSource).toMatch(/Goal limit reached/);
    expect(goalFormSource).toMatch(/UPGRADE_TO_PREMIUM_LABEL/);
    expect(goalFormSource).toMatch(/startUpgrade/);
    expect(goalFormSource).toMatch(/createBucket/);
    const mutationFn = goalFormSource.slice(
      goalFormSource.indexOf("mutationFn: async"),
      goalFormSource.indexOf("onSuccess:")
    );
    expect(mutationFn).toMatch(/if \(!isEdit && goalsLimited\)/);
    expect(mutationFn).toMatch(/throw new Error\(limitReachedMessage\)/);
    expect(mutationFn.indexOf("goalsLimited")).toBeLessThan(mutationFn.indexOf("createBucket"));
  });

  it("editing an existing goal remains allowed at the limit", () => {
    expect(goalFormSource).toMatch(/isEdit \? "Edit goal" : "Create goal"/);
    expect(goalFormSource).toMatch(/updateBucket/);
    expect(goalFormSource).toMatch(/!isEdit && goalsLimited/);
    expect(switchCaseBlock(goalsScreenSource, "edit")).not.toMatch(/interceptIfLimited/);
    expect(switchCaseBlock(goalDetailSource, "edit")).not.toMatch(/interceptIfLimited/);
    expect(switchCaseBlock(goalsScreenSource, "edit")).toMatch(/goalEditPath/);
    expect(switchCaseBlock(goalDetailSource, "edit")).toMatch(/goalEditPath/);
  });

  it("duplicate does not call the duplicate API at the Free limit", () => {
    expect(switchCaseBlock(goalsScreenSource, "duplicate")).toMatch(
      /if \(interceptIfLimited\(\)\) return/
    );
    expect(switchCaseBlock(goalDetailSource, "duplicate")).toMatch(
      /if \(interceptIfLimited\(\)\) return/
    );
    expect(switchCaseBlock(goalsScreenSource, "duplicate")).toMatch(/duplicateMu\.mutate/);
    expect(switchCaseBlock(goalDetailSource, "duplicate")).toMatch(/duplicateMu\.mutate/);
    const listDup = switchCaseBlock(goalsScreenSource, "duplicate");
    expect(listDup.indexOf("interceptIfLimited")).toBeLessThan(listDup.indexOf("duplicateMu.mutate"));
    const detailDup = switchCaseBlock(goalDetailSource, "duplicate");
    expect(detailDup.indexOf("interceptIfLimited")).toBeLessThan(
      detailDup.indexOf("duplicateMu.mutate")
    );
  });

  it("pause, complete, archive, and delete remain allowed at the limit", () => {
    for (const action of ["pause", "complete", "archive", "delete"] as const) {
      expect(switchCaseBlock(goalsScreenSource, action)).not.toMatch(/interceptIfLimited/);
      expect(switchCaseBlock(goalDetailSource, action)).not.toMatch(/interceptIfLimited/);
    }
    expect(actionsSheetSource).toMatch(/Pause goal/);
    expect(actionsSheetSource).toMatch(/Mark complete/);
    expect(actionsSheetSource).toMatch(/Archive goal/);
    expect(actionsSheetSource).toMatch(/Delete goal/);
    expect(actionsSheetSource).toMatch(/Edit goal/);
    expect(actionsSheetSource).toMatch(/Duplicate goal/);
  });

  it("PREMIUM has no limit interception for create or duplicate", () => {
    expect(hookSource).toMatch(/atPlanLimit\(billing, "goals"\)/);
    expect(hookSource).toMatch(/if \(!goalsLimited\) return false/);
    expect(goalsScreenSource).toMatch(/router\.push\(goalCreatePath\(\)\)/);
    expect(switchCaseBlock(goalsScreenSource, "duplicate")).toMatch(/duplicateMu\.mutate/);
    expect(switchCaseBlock(goalDetailSource, "duplicate")).toMatch(/duplicateMu\.mutate/);
  });

  it("does not count completed or archived goals locally for quota", () => {
    expect(goalsScreenSource).toMatch(/g.status === "completed"/);
    expect(goalsScreenSource).toMatch(/g.status === "archived"/);
    expect(goalsScreenSource).toMatch(/Completed goals/);
    expect(goalsScreenSource).toMatch(/Archived goals/);
    expect(hookSource).toMatch(/atPlanLimit\(billing, "goals"\)/);
    expect(hookSource).not.toMatch(/completed/);
    expect(hookSource).not.toMatch(/archived/);
    expect(goalsScreenSource).not.toMatch(/atPlanLimit\([^)]*active/);
    expect(goalsScreenSource).not.toMatch(/active\.length\s*>=/);
  });
});

describe("mobile Goals What-If stays web-first", () => {
  it("does not expose What-If from mobile Goals list or detail", () => {
    expect(goalsScreenSource).not.toMatch(/includeWhatIf/);
    expect(goalDetailSource).not.toMatch(/includeWhatIf/);
    expect(goalDetailSource).not.toMatch(/Run What-If/);
    expect(goalsScreenSource).not.toMatch(/Run What-If/);
    expect(actionsSheetSource).toMatch(/includeWhatIf = false/);
    expect(actionsSheetSource).toMatch(/Run What-If/);
  });

  it("leaves web Goals Try in What-If behavior unchanged", () => {
    expect(webGoalCardSource).toMatch(/Try in What-If/);
    expect(webGoalDetailSource).toMatch(/Try in What-If/);
    expect(webGoalsSource).not.toMatch(/includeWhatIf/);
  });
});
