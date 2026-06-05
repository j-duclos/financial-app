import {
  formatCurrency,
  getEffectiveDisplayName,
  inferAccountRoleFromType,
} from "@budget-app/shared";
import type { Account, AccountRole } from "@budget-app/shared";
import { accountLifecycleStatus } from "./accountOrganization";
import { formatProjectionDate, lowestProjectedBalance } from "./accountHealthDisplay";
import { safeToSpendLabel } from "./safeToSpendLabels";

export type ForecastAlertKind =
  | "negative_projected"
  | "negative_safe_to_spend"
  | "over_limit";

export type ForecastAlertSeverity = "critical" | "risk";

export interface AccountForecastAlert {
  accountId: number;
  accountName: string;
  kind: ForecastAlertKind;
  severity: ForecastAlertSeverity;
  headline: string;
  detail: string;
  riskDate?: string | null;
}

function parseAmount(value: string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function showSafeToSpend(role: AccountRole | undefined, accountType: string): boolean {
  if (accountType === "CREDIT") return false;
  if (role === "credit_card" || role === "loan" || role === "investment") return false;
  return true;
}

function creditOverLimitAlert(acc: Account, name: string): AccountForecastAlert | null {
  const owed = parseAmount(acc.current_balance ?? acc.balance_owed);
  const limit = parseAmount(acc.credit_limit);
  if (limit <= 0) return null;

  const util = parseAmount(acc.utilization_percent);
  if (owed <= limit && util < 100) return null;

  const overBy = Math.max(0, owed - limit);
  const detail =
    overBy > 0
      ? `Owed ${formatCurrency(String(owed), acc.currency)} on a ${formatCurrency(String(limit), acc.currency)} limit (${formatCurrency(String(overBy), acc.currency)} over).`
      : util >= 100
        ? `Utilization is ${util.toFixed(0)}% of your ${formatCurrency(String(limit), acc.currency)} limit.`
        : "";

  return {
    accountId: acc.id,
    accountName: name,
    kind: "over_limit",
    severity: "critical",
    headline: `${name}: Over credit limit`,
    detail,
  };
}

function bankProjectionAlert(
  acc: Account,
  name: string,
  forecastDays: number
): AccountForecastAlert | null {
  const lowest = lowestProjectedBalance(acc);
  if (lowest == null) return null;

  const lowNum = parseAmount(lowest);
  if (lowNum >= 0) return null;

  const riskDate = acc.health_risk_date ?? acc.risk_date;
  const dateSuffix = riskDate ? ` on ${formatProjectionDate(riskDate)}` : "";

  return {
    accountId: acc.id,
    accountName: name,
    kind: "negative_projected",
    severity: "critical",
    headline: `${name}: Projected overdrawn`,
    detail: `Lowest projected in next ${forecastDays} days: ${formatCurrency(lowest, acc.currency)}${dateSuffix}.`,
    riskDate,
  };
}

function safeToSpendAlert(acc: Account, name: string): AccountForecastAlert | null {
  const role = acc.role ?? inferAccountRoleFromType(acc.account_type);
  if (!showSafeToSpend(role, acc.account_type)) return null;

  const sts = acc.available_to_spend;
  if (sts == null || parseAmount(sts) >= 0) return null;

  const riskDate = acc.health_risk_date ?? acc.risk_date;

  return {
    accountId: acc.id,
    accountName: name,
    kind: "negative_safe_to_spend",
    severity: "critical",
    headline: `${name}: Safe to spend is negative`,
    detail: `${safeToSpendLabel(role)}: ${formatCurrency(sts, acc.currency)}.`,
    riskDate,
  };
}

/** Accounts that may go negative, overdrawn, or over limit within the forecast window. */
export function buildAccountForecastAlerts(
  accounts: Account[],
  forecastDays: number
): AccountForecastAlert[] {
  const alerts: AccountForecastAlert[] = [];
  const seen = new Set<number>();

  for (const acc of accounts) {
    if (accountLifecycleStatus(acc) !== "active") continue;
    if (acc.include_in_forecast === false) continue;

    const name = getEffectiveDisplayName(acc);
    const candidates: (AccountForecastAlert | null)[] =
      acc.account_type === "CREDIT"
        ? [creditOverLimitAlert(acc, name)]
        : [
            bankProjectionAlert(acc, name, forecastDays),
            safeToSpendAlert(acc, name),
          ];

    for (const alert of candidates) {
      if (!alert || seen.has(alert.accountId)) continue;
      seen.add(alert.accountId);
      alerts.push(alert);
    }
  }

  const severityRank: Record<ForecastAlertSeverity, number> = {
    critical: 0,
    risk: 1,
  };

  return alerts.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.accountName.localeCompare(b.accountName)
  );
}
