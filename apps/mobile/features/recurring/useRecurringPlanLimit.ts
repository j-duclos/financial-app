import { useCallback } from "react";
import {
  atPlanLimit,
  isPremium,
  FREE_PLAN_LIMITS,
  recurringRulesLimitReachedMessage,
  recurringRulesUsageLabel,
} from "@budget-app/shared";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";

const RECURRING_LIMIT_TITLE = "Recurring limit reached";

/**
 * Free/Premium recurring-rule quota from cached billing status.
 * Does not fetch rules or recount active/paused locally — backend usage is authoritative.
 */
export function useRecurringPlanLimit() {
  const { billing, isLoading: billingLoading } = useBillingStatus();
  const { promptUpgrade, startUpgrade } = usePremiumUpgrade();
  const limited = atPlanLimit(billing, "recurring_rules");
  const usageLabel = recurringRulesUsageLabel(billing);
  const limitReachedMessage = recurringRulesLimitReachedMessage(billing);
  const limit = billing?.entitlements?.limits.recurring_rules ??
    (isPremium(billing) ? null : FREE_PLAN_LIMITS.recurring_rules);
  const usage = billing?.entitlements?.usage.recurring_rules;

  const interceptIfLimited = useCallback(() => {
    if (!limited) return false;
    promptUpgrade(RECURRING_LIMIT_TITLE, recurringRulesLimitReachedMessage(billing));
    return true;
  }, [billing, limited, promptUpgrade]);

  return {
    billing,
    billingLoading,
    limited,
    limit,
    usage,
    usageLabel,
    limitReachedMessage,
    interceptIfLimited,
    startUpgrade,
  };
}
