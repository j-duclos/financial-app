import { isPerfLoggingEnabled, perfLog } from "@budget-app/api-client";

export type TransactionsPageLoadPlan = {
  accountId: number | "";
  pastRange: { start: string; end: string };
  upcomingRange: { start: string; end: string };
  forecastRange: string;
  hideReconciledPast: boolean;
  householdTimelineEnabled: boolean;
  duplicateAccountCallsRemoved: boolean;
};

let loggedKey: string | null = null;

/** One log line per account/load plan in development. */
export function logTransactionsPageLoadPlan(plan: TransactionsPageLoadPlan): void {
  if (!isPerfLoggingEnabled() || plan.accountId === "") return;
  const key = `${plan.accountId}:${plan.pastRange.start}:${plan.pastRange.end}:${plan.upcomingRange.end}:${plan.forecastRange}:${plan.hideReconciledPast}:${plan.householdTimelineEnabled}`;
  if (loggedKey === key) return;
  loggedKey = key;

  perfLog(
    [
      "[PERF] transactions page initial load",
      `account=${plan.accountId}`,
      `listTransactions=${plan.pastRange.start}..${plan.pastRange.end}`,
      `getTimeline(upcoming)=${plan.upcomingRange.start}..${plan.upcomingRange.end} (${plan.forecastRange})`,
      `getAccount=1 (balance+forecast_summary+health+days=90)`,
      `listAccounts=cached`,
      `listCategories=cached`,
      `householdTimeline=${plan.householdTimelineEnabled ? "enabled (transfer/edit)" : "skipped"}`,
      `hideReconciledPast=${plan.hideReconciledPast}`,
      plan.duplicateAccountCallsRemoved ? "duplicate getAccount removed=yes" : "",
    ]
      .filter(Boolean)
      .join(" | ")
  );
}
