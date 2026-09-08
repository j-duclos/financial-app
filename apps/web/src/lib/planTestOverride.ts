import type { QueryClient } from "@tanstack/react-query";
import { BILLING_STATUS_QUERY_KEY } from "./billing";
import { PROFILE_QUERY_KEY } from "./profileQuery";

/** Query prefixes that must refresh immediately after a simulated plan change. */
export const PLAN_TEST_OVERRIDE_QUERY_PREFIXES = [
  BILLING_STATUS_QUERY_KEY,
  PROFILE_QUERY_KEY,
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["transactions"],
  ["timeline"],
  ["timeline-calendar"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["accounts"],
  ["account"],
  ["rules"],
  ["recurring-rules"],
  ["recurring-rules-summary"],
  ["buckets"],
  ["goals-report"],
  ["monthly-reports"],
  ["debt-plan"],
  ["account-payoff"],
  ["dti"],
  ["recommendations"],
  ["onboarding"],
  ["projected-funds-alerts"],
] as const;

export function isWebDevBuild(): boolean {
  return import.meta.env.DEV === true;
}

export function invalidateAfterTestPlanChange(queryClient: QueryClient): void {
  for (const queryKey of PLAN_TEST_OVERRIDE_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
