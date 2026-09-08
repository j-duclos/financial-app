import type { BillingPlan, BillingStatus, TestPlanOverride } from "./types";

export type SimulatedPlanChoice = "real" | "FREE" | "PREMIUM";

export function canShowPlanTestControls(
  billing: BillingStatus | undefined | null,
  isDevBuild: boolean
): boolean {
  return Boolean(isDevBuild && billing?.test_override_available === true);
}

export function simulatedPlanChoice(
  billing: BillingStatus | undefined | null
): SimulatedPlanChoice {
  const override = billing?.test_plan_override;
  if (override === "FREE" || override === "PREMIUM") return override;
  return "real";
}

export function simulatedPlanChoiceLabel(choice: SimulatedPlanChoice): string {
  if (choice === "PREMIUM") return "Premium";
  if (choice === "FREE") return "Free";
  return "Real billing";
}

export function testPlanIndicatorLabel(
  billing: BillingStatus | undefined | null,
  isDevBuild: boolean
): string | null {
  if (!canShowPlanTestControls(billing, isDevBuild)) return null;
  const override = billing?.test_plan_override;
  if (override !== "FREE" && override !== "PREMIUM") return null;
  return override === "PREMIUM" ? "TEST: Premium" : "TEST: Free";
}

export function effectivePlanLabel(billing: BillingStatus | undefined | null): BillingPlan {
  if (billing?.effective_plan === "PREMIUM" || billing?.effective_plan === "FREE") {
    return billing.effective_plan;
  }
  return billing?.is_premium ? "PREMIUM" : "FREE";
}

export function choiceToTestPlanOverride(choice: SimulatedPlanChoice): TestPlanOverride {
  if (choice === "real") return null;
  return choice;
}
