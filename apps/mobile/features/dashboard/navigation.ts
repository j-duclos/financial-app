import type { DashboardAttentionItem, DashboardFirstCashShortfall, DashboardUpcomingTransaction } from "@budget-app/shared";
import {
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionIssueKind,
  attentionPrimaryIssue,
  attentionSeverityLabel,
  attentionShowsActionLine,
  ATTENTION_VIEW_ALL_PATH,
  upcomingTransactionNavTarget,
} from "@budget-app/shared";
import {
  transactionsForAccountPath,
  transactionsForForecastRiskPath,
  transactionsForLedgerFocusPath,
  type TransactionsTabPath,
} from "@/features/payment-planner/navigation";

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

function attentionForecastRiskPath(item: DashboardAttentionItem): TransactionsTabPath {
  return transactionsForForecastRiskPath({
    accountId: item.account_id,
    accountName: item.account_name,
    focusDate: item.risk_date,
    focusTransactionId: item.first_negative_transaction_id ?? null,
  });
}

export function firstCashShortfallTapDestination(
  shortfall: DashboardFirstCashShortfall
): TransactionsTabPath | null {
  if (shortfall.account_id == null) return null;
  return transactionsForForecastRiskPath({
    accountId: shortfall.account_id,
    accountName: shortfall.account_name ?? undefined,
    focusDate: shortfall.date,
    focusTransactionId: shortfall.first_negative_transaction_id ?? null,
  });
}

/** Individual Upcoming Money Flow row → account ledger with row focus. */
export function upcomingMoneyFlowRowDestination(
  txn: DashboardUpcomingTransaction
): TransactionsTabPath {
  const target = upcomingTransactionNavTarget(txn);
  return transactionsForLedgerFocusPath({
    accountId: target.accountId,
    accountName: target.accountName,
    focus: "ledger-event",
    focusDate: target.focusDate,
    focusTransactionId: target.focusTransactionId,
    focusRuleId: target.focusRuleId,
    focusEventId: target.focusEventId,
  });
}

export function attentionCardTapDestination(
  item: DashboardAttentionItem
): `/account/${number}` | TransactionsTabPath {
  if (attentionCardOpensLedger(item)) {
    if (item.risk_date || item.first_negative_transaction_id != null) {
      return attentionForecastRiskPath(item);
    }
    return transactionsForAccountPath(item.account_id, item.account_name);
  }
  return accountDetailPath(item.account_id);
}

export function attentionCardAccessibilityLabel(item: DashboardAttentionItem): string {
  const issue = attentionPrimaryIssue(item);
  const action = attentionShowsActionLine(item) ? attentionActionLine(item) : null;
  const destination = attentionCardOpensLedger(item)
    ? "Opens account transactions at the forecast risk."
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

/** Home Attention “View all” → Action Center (full recommendation list). */
export function attentionViewAllPath(): "/action-center" {
  return "/action-center";
}

/** @deprecated Prefer attentionViewAllPath — Accounts attention filter is not the recommendation list. */
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
