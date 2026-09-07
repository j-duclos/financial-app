import { useCallback } from "react";
import {
  atPlanLimit,
  goalLimitReachedMessage,
  goalUsageLabel,
} from "@budget-app/shared";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";

const GOAL_LIMIT_TITLE = "Goal limit reached";

/**
 * Free/Premium goal quota from cached billing status.
 * Does not fetch goals or recount active/paused locally — backend usage is authoritative.
 */
export function useGoalPlanLimit() {
  const { billing, isLoading: billingLoading } = useBillingStatus();
  const { promptUpgrade, startUpgrade } = usePremiumUpgrade();
  const goalsLimited = atPlanLimit(billing, "goals");
  const usageLabel = goalUsageLabel(billing);
  const limitReachedMessage = goalLimitReachedMessage(billing);

  const interceptIfLimited = useCallback(() => {
    if (!goalsLimited) return false;
    promptUpgrade(GOAL_LIMIT_TITLE, goalLimitReachedMessage(billing));
    return true;
  }, [billing, goalsLimited, promptUpgrade]);

  return {
    billing,
    billingLoading,
    goalsLimited,
    usageLabel,
    limitReachedMessage,
    interceptIfLimited,
    startUpgrade,
  };
}
