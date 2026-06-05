import type { Account } from "@budget-app/shared";
import {
  accountHealthStatus,
  accountLifecycleStatus,
  isAtRisk,
} from "./accountOrganization";

export interface AccountsPageStats {
  totalCount: number;
  activeCount: number;
  criticalCount: number;
  atRiskCount: number;
  bankLoginCount: number;
  linkedAccountCount: number;
}

export function computeAccountsPageStats(
  accounts: Account[],
  bankLoginCount = 0,
  linkedAccountCount = 0
): AccountsPageStats {
  let activeCount = 0;
  let criticalCount = 0;
  let atRiskCount = 0;

  for (const acc of accounts) {
    const lifecycle = accountLifecycleStatus(acc);
    if (lifecycle === "active") activeCount += 1;
    const health = accountHealthStatus(acc);
    if (lifecycle === "active" && health === "critical") criticalCount += 1;
    if (lifecycle === "active" && isAtRisk(acc)) atRiskCount += 1;
  }

  return {
    totalCount: accounts.length,
    activeCount,
    criticalCount,
    atRiskCount,
    bankLoginCount,
    linkedAccountCount,
  };
}

/** Compact one-line summary for the Accounts page header. */
export function formatAccountsPageSummaryLine(stats: AccountsPageStats): string {
  const parts: string[] = [
    `${stats.totalCount} account${stats.totalCount === 1 ? "" : "s"}`,
  ];

  if (stats.bankLoginCount > 0 || stats.linkedAccountCount > 0) {
    parts.push(
      `${stats.bankLoginCount} bank login${stats.bankLoginCount === 1 ? "" : "s"}`
    );
  }

  parts.push(`${stats.activeCount} active`);

  if (stats.criticalCount > 0) {
    parts.push(`${stats.criticalCount} critical`);
  } else if (stats.atRiskCount > 0) {
    parts.push(`${stats.atRiskCount} at risk`);
  }

  return parts.join(" • ");
}

/** Returns true when global dashboard-style totals should not appear on Accounts. */
export function accountsPageShowsGlobalTotals(): boolean {
  return false;
}
