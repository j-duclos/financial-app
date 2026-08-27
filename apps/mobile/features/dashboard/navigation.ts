import type { DashboardAttentionItem } from "@budget-app/shared";
import {
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionIssueKind,
  attentionPrimaryIssue,
  attentionSeverityLabel,
  attentionShowsActionLine,
  ATTENTION_VIEW_ALL_PATH,
} from "@budget-app/shared";
import { transactionsForAccountPath } from "@/features/payment-planner/navigation";

export { ATTENTION_VIEW_ALL_PATH };

export function accountDetailPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

/** Cash-flow issues open the filtered ledger; account-condition issues open account details. */
export function attentionCardOpensLedger(item: DashboardAttentionItem): boolean {
  const kind = attentionIssueKind(item);
  if (kind === "credit") return false;
  if (kind === "transfer") return true;
  const depository =
    item.account_type === "CHECKING" ||
    item.account_type === "SAVINGS" ||
    item.account_role === "spending" ||
    item.account_role === "savings";
  return depository;
}

export function attentionCardTapDestination(
  item: DashboardAttentionItem
):
  | `/account/${number}`
  | ReturnType<typeof transactionsForAccountPath> {
  if (attentionCardOpensLedger(item)) {
    return transactionsForAccountPath(item.account_id, item.account_name);
  }
  return accountDetailPath(item.account_id);
}

export function attentionCardAccessibilityLabel(item: DashboardAttentionItem): string {
  const issue = attentionPrimaryIssue(item);
  const action = attentionShowsActionLine(item) ? attentionActionLine(item) : null;
  const destination = attentionCardOpensLedger(item)
    ? "Opens account transactions."
    : "Opens account details.";
  return [
    item.account_name,
    attentionAccountTypeLabel(item),
    attentionSeverityLabel(item.status),
    issue,
    action,
    destination,
  ]
    .filter(Boolean)
    .join(". ");
}

/** Accounts tab root (not a secondary stack push). */
export function accountsTabPath(): "/(app)/(tabs)/accounts" {
  return "/(app)/(tabs)/accounts";
}

export function accountsAttentionFilterPath(): {
  pathname: "/(app)/(tabs)/accounts";
  params: { attention: string };
} {
  return {
    pathname: "/(app)/(tabs)/accounts",
    params: { attention: "1" },
  };
}

export function paymentPlannerAccountPath(accountId: number): {
  pathname: "/payment-planner";
  params: { account: string };
} {
  return {
    pathname: "/payment-planner",
    params: { account: String(accountId) },
  };
}

export function calendarDatePath(date: string): {
  pathname: "/(app)/(tabs)/calendar";
  params: { date: string };
} {
  return {
    pathname: "/(app)/(tabs)/calendar",
    params: { date },
  };
}

export { goalDetailPath, goalsListPath } from "@/features/goals/navigation";
