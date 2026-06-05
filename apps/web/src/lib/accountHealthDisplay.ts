import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, AccountHealthDetails } from "@budget-app/shared";
import { riskStatusLabel } from "./safeToSpendLabels";

function parseAmount(value: string | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Short inline reason shown next to the health badge (e.g. "Watch — Low safe-to-spend"). */
export function healthInlineLabel(
  status: string | null | undefined,
  reason?: string | null
): string {
  const label = riskStatusLabel(status);
  const short = reason?.trim() || defaultHealthReason(status);
  if (!short) return label;
  return `${label} — ${short}`;
}

function defaultHealthReason(status: string | null | undefined): string | null {
  switch (status) {
    case "healthy":
      return "Above buffer";
    case "watch":
      return "Needs attention";
    case "risk":
      return "Below buffer soon";
    case "critical":
      return "Immediate action needed";
    default:
      return null;
  }
}

import { formatDateDisplay } from "./dateDisplay";

export function formatProjectionDate(dateIso: string): string {
  return formatDateDisplay(dateIso);
}

export function lowestProjectedBalance(account: Account): string | null {
  const details = account.health_details;
  return details?.lowest_projected_balance ?? account.lowest_projected_balance_30_days ?? null;
}

/** Actionable health line on account cards (projection + what to do). */
export function buildAccountListHealthReason(
  reason: string | null | undefined,
  account: Account
): string | null {
  const base = reason?.trim();
  if (!base) return null;

  const currency = account.currency;
  const displayName = getEffectiveDisplayName(account);
  const riskDate = account.health_risk_date ?? account.risk_date;
  const dateFmt = riskDate ? formatProjectionDate(riskDate) : null;

  if (account.account_type === "CREDIT") {
    const owed = parseAmount(account.balance_owed ?? account.current_balance);
    const limit = parseAmount(account.credit_limit);
    if (limit > 0 && owed > limit) {
      const payAmount = owed - limit;
      const util = account.utilization_percent;
      const target = parseAmount(account.target_utilization_percent ?? "10");
      const utilPart =
        util != null && account.utilization_percent != null
          ? `Utilization is ${parseFloat(account.utilization_percent).toFixed(0)}% (target ${target.toFixed(0)}%)`
          : "Over credit limit";
      return `${utilPart}: Pay ${formatCurrency(String(payAmount), currency)} toward ${displayName}`;
    }
  }

  if (
    account.account_type === "CREDIT" &&
    base.includes("Utilization is") &&
    account.utilization_percent != null
  ) {
    const target = parseAmount(account.target_utilization_percent ?? "10");
    const utilPct = parseFloat(account.utilization_percent).toFixed(0);
    const prefix = `Utilization is ${utilPct}% (target ${target.toFixed(0)}%)`;
    const colon = base.indexOf(":");
    if (colon >= 0) {
      return `${prefix}${base.slice(colon)}`;
    }
    return prefix;
  }

  const lowest = lowestProjectedBalance(account);
  if (lowest != null && dateFmt) {
    const lowestFmt = formatCurrency(lowest, currency);
    const lowNum = parseAmount(lowest);
    const safeToSpend = parseAmount(
      account.health_details?.available_to_spend ?? account.available_to_spend
    );
    const hasSafeToSpend =
      account.health_details?.available_to_spend != null ||
      account.available_to_spend != null;

    if (lowNum < 0 && base.includes("drops below zero")) {
      const firstNegative = parseAmount(
        account.health_details?.first_negative_balance ?? account.first_negative_balance
      );
      const moveAmt =
        firstNegative < 0
          ? Math.abs(firstNegative)
          : hasSafeToSpend
            ? Math.abs(safeToSpend)
            : Math.abs(lowNum);
      const moveFmt = formatCurrency(String(moveAmt), currency);
      const safeFmt = hasSafeToSpend
        ? formatCurrency(String(safeToSpend), currency)
        : null;
      if (safeFmt != null && Math.abs(safeToSpend - lowNum) >= 0.01) {
        return `Projected balance drops to ${lowestFmt} on ${dateFmt}; Safe to spend is ${safeFmt}. Move ${moveFmt} before ${dateFmt}`;
      }
      return `Projected balance drops to ${lowestFmt} on ${dateFmt}: Move ${moveFmt} before ${dateFmt}`;
    }

    if (
      (base.includes("below buffer") || base.includes("falls below your")) &&
      lowNum >= 0
    ) {
      const buffer = parseAmount(
        account.health_details?.minimum_buffer ?? account.minimum_buffer ?? "0"
      );
      const moveAmt = Math.max(0, buffer - lowNum);
      return `Projected balance falls to ${lowestFmt} on ${dateFmt}: Move ${formatCurrency(String(moveAmt), currency)} before ${dateFmt}`;
    }
  }

  const recommended = account.health_recommended_action?.trim();
  if (recommended) {
    if (base.includes(recommended)) return base;
    return `${base}: ${recommended}`;
  }

  return base;
}

/** @deprecated Use buildAccountListHealthReason */
export function enrichHealthReason(
  reason: string | null | undefined,
  account: Account
): string | null {
  return buildAccountListHealthReason(reason, account);
}

/** Detail lines shown under the health badge on the Accounts list (no duplicates). */
export function accountListHealthDetailLines(account: Account): string[] {
  const lines: string[] = [];
  if (account.upcoming_outflows_30_days) {
    lines.push(
      `Upcoming outflows: ${formatCurrency(account.upcoming_outflows_30_days, account.currency)}`
    );
  }
  return lines;
}

export function formatLowestProjectedWindowLine(
  displayName: string,
  account: Account,
  forecastDays: number
): string | null {
  const lowest = lowestProjectedBalance(account);
  const riskDate = account.health_risk_date ?? account.risk_date;
  if (lowest == null || !riskDate) return null;
  return `${displayName}: Lowest projected in next ${forecastDays} days: ${formatCurrency(
    lowest,
    account.currency
  )} on ${formatProjectionDate(riskDate)}`;
}

export type HealthDetailLines = {
  lowestProjected?: string;
  riskDate?: string;
  upcomingNote?: string;
  recommendedAction?: string;
};

export function buildHealthDetailLines(account: Account): HealthDetailLines {
  const details = account.health_details;
  const currency = account.currency;
  const lines: HealthDetailLines = {};

  const lowest = lowestProjectedBalance(account);
  if (lowest != null) {
    lines.lowestProjected = formatCurrency(lowest, currency);
  }

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (riskDate) {
    lines.riskDate = formatDateDisplay(riskDate);
  }

  if (account.health_recommended_action) {
    lines.recommendedAction = account.health_recommended_action;
  }

  return lines;
}

export function formatHealthRiskDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return formatDateDisplay(isoDate);
}

/** Full detail list for popovers and modals (includes lowest, risk date, action). */
export function healthDetailsSummary(
  account: Account,
  details?: AccountHealthDetails | null
): string[] {
  const lines: string[] = [];
  const d = details ?? account.health_details;
  const currency = account.currency;

  const lowest = d?.lowest_projected_balance ?? account.lowest_projected_balance_30_days;
  if (lowest != null) {
    lines.push(`Lowest projected: ${formatCurrency(lowest, currency)}`);
  }

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (riskDate) {
    lines.push(`Risk date: ${formatHealthRiskDate(riskDate)}`);
  }

  if (account.upcoming_outflows_30_days) {
    lines.push(
      `Upcoming outflows: ${formatCurrency(account.upcoming_outflows_30_days, currency)}`
    );
  }

  if (account.health_recommended_action) {
    lines.push(account.health_recommended_action);
  }

  return lines;
}
