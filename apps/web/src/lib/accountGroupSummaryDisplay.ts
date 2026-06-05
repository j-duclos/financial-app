import { formatCurrency } from "@budget-app/shared";
import type { AccountGroupBy, AccountGroupSummary } from "./accountOrganization";
import { safeToSpendLabel } from "./safeToSpendLabels";
import type { AccountRole } from "@budget-app/shared";

function isCreditGroupKey(groupKey: string, groupBy: AccountGroupBy): boolean {
  if (groupBy === "type") return groupKey === "CREDIT";
  if (groupBy === "role") return groupKey === "credit_card" || groupKey === "loan";
  return false;
}

function isSavingsGroupKey(groupKey: string, groupBy: AccountGroupBy): boolean {
  if (groupBy === "role") {
    return groupKey === "savings" || groupKey === "emergency_fund" || groupKey === "cash_reserve";
  }
  if (groupBy === "type") return groupKey === "SAVINGS";
  return false;
}

function safeToSpendGroupLabel(groupKey: string, groupBy: AccountGroupBy): string {
  if (groupBy === "role") {
    return safeToSpendLabel(groupKey as AccountRole);
  }
  return "Available after buffer";
}

export function formatGroupSummaryParts(
  groupKey: string,
  groupBy: AccountGroupBy,
  summary: AccountGroupSummary
): string[] {
  const parts: string[] = [];
  const currency = summary.currency;
  const fmt = (n: number) => formatCurrency(String(n.toFixed(2)), currency);

  if (isCreditGroupKey(groupKey, groupBy) && summary.totalDebt > 0) {
    parts.push(`Balance owed: ${fmt(summary.totalDebt)}`);
    if (summary.avgUtilization != null) {
      parts.push(`Average utilization: ${summary.avgUtilization.toFixed(0)}%`);
    }
  } else if (isSavingsGroupKey(groupKey, groupBy) && summary.totalSafeToSpend > 0) {
    parts.push(`${safeToSpendGroupLabel(groupKey, groupBy)}: ${fmt(summary.totalSafeToSpend)}`);
    if (summary.lowestProjected != null) {
      parts.push(`Lowest projected: ${fmt(summary.lowestProjected)}`);
    }
  } else if (summary.totalBalance !== 0) {
    parts.push(`Total: ${fmt(summary.totalBalance)}`);
    if (
      !isCreditGroupKey(groupKey, groupBy) &&
      summary.totalSafeToSpend > 0 &&
      !isSavingsGroupKey(groupKey, groupBy)
    ) {
      parts.push(`Safe to spend: ${fmt(summary.totalSafeToSpend)}`);
    }
    if (summary.lowestProjected != null && !isSavingsGroupKey(groupKey, groupBy)) {
      parts.push(`Lowest projected: ${fmt(summary.lowestProjected)}`);
    }
  }

  if (summary.riskCount > 0) {
    parts.push(
      `${summary.riskCount} account${summary.riskCount === 1 ? "" : "s"} at risk`
    );
  }

  return parts;
}
