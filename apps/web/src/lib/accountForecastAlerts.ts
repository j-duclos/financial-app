import {
  formatCurrency,
  getEffectiveDisplayName,
  inferAccountRoleFromType,
} from "@budget-app/shared";
import type { Account, AccountRole } from "@budget-app/shared";
import { accountLifecycleStatus, isSpendingAccount } from "./accountOrganization";
import {
  firstShortfallDate,
  formatProjectionDate,
  lowestProjectedBalance,
  lowestProjectedDate,
} from "./accountHealthDisplay";
import { formatShortMonthDay } from "./dateDisplay";
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
  amountNeeded?: string | null;
}

export interface PortfolioForecastAlert {
  count: number;
  forecastDays: number;
  headline: string;
  earliestLine: string;
  earliestAccountId: number;
  resolveSpendingRisk: boolean;
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

function formatAlertDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const short = formatShortMonthDay(iso);
  return short === "None" ? formatProjectionDate(iso) : short;
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

function shortfallNeeded(acc: Account): string | null {
  const first = acc.health_details?.first_negative_balance ?? acc.first_negative_balance;
  const firstNum = parseAmount(first);
  if (firstNum < 0) return String(Math.abs(firstNum));
  const lowest = lowestProjectedBalance(acc);
  const lowNum = parseAmount(lowest);
  if (lowNum < 0) return String(Math.abs(lowNum));
  return null;
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

  const firstDate = firstShortfallDate(acc);
  const lowestDate = lowestProjectedDate(acc);
  const dateSuffix = lowestDate ? ` on ${formatProjectionDate(lowestDate)}` : "";
  const needed = shortfallNeeded(acc);

  return {
    accountId: acc.id,
    accountName: name,
    kind: "negative_projected",
    severity: "critical",
    headline: `${name}: Projected overdrawn`,
    detail: `Lowest projected in next ${forecastDays} days: ${formatCurrency(lowest, acc.currency)}${dateSuffix}.`,
    riskDate: firstDate ?? lowestDate,
    amountNeeded: needed,
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

/** Per-account forecast risks (used for group jump-to-risk, not the page banner). */
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
      (a.riskDate || "9999-12-31").localeCompare(b.riskDate || "9999-12-31") ||
      a.accountName.localeCompare(b.accountName)
  );
}

function nounForShortfalls(count: number): { headline: string } {
  if (count === 1) {
    return { headline: "1 spending account is projected to run short" };
  }
  return { headline: `${count} accounts are projected to run short` };
}

/**
 * Single portfolio-level banner: what is wrong, when, how much, one action.
 * Does not list every account — row-level health covers that.
 */
export function buildPortfolioForecastAlert(
  accounts: Account[],
  forecastDays: number
): PortfolioForecastAlert | null {
  const alerts = buildAccountForecastAlerts(accounts, forecastDays);
  const shortfalls = alerts.filter((a) => a.kind === "negative_projected");
  if (shortfalls.length > 0) {
    const earliest = [...shortfalls].sort(
      (a, b) =>
        (a.riskDate || "9999-12-31").localeCompare(b.riskDate || "9999-12-31") ||
        a.accountName.localeCompare(b.accountName)
    )[0];

    const n = shortfalls.length;
    const { headline: head } = nounForShortfalls(n);
    const headline = `${head} within ${forecastDays} days.`;

    const dateLabel = formatAlertDate(earliest.riskDate);
    const earliestAccount = accounts.find((a) => a.id === earliest.accountId);
    const currency = earliestAccount?.currency ?? "USD";
    const needed = earliest.amountNeeded
      ? formatCurrency(earliest.amountNeeded, currency)
      : null;
    const datePart = dateLabel ? ` on ${dateLabel}` : "";
    const amountPart = needed ? ` · ${needed} needed` : "";
    const earliestLine = `Earliest: ${earliest.accountName}${datePart}${amountPart}`;

    const resolveSpendingRisk = Boolean(
      earliestAccount && isSpendingAccount(earliestAccount)
    );

    return {
      count: n,
      forecastDays,
      headline,
      earliestLine,
      earliestAccountId: earliest.accountId,
      resolveSpendingRisk,
    };
  }

  const overLimit = alerts.filter((a) => a.kind === "over_limit");
  if (overLimit.length === 0) return null;

  const first = overLimit[0];
  const n = overLimit.length;
  return {
    count: n,
    forecastDays,
    headline:
      n === 1
        ? "1 credit card is over its limit."
        : `${n} credit cards are over their limits.`,
    earliestLine: first.detail || first.headline,
    earliestAccountId: first.accountId,
    resolveSpendingRisk: false,
  };
}
