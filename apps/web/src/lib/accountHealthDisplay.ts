import { DEFAULT_TARGET_UTILIZATION_PERCENT, formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, AccountHealthDetails } from "@budget-app/shared";
import { riskStatusLabel } from "./safeToSpendLabels";
import { formatDateDisplay } from "./dateDisplay";

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

export function formatProjectionDate(dateIso: string): string {
  return formatDateDisplay(dateIso);
}

export function lowestProjectedBalance(account: Account): string | null {
  const details = account.health_details;
  return details?.lowest_projected_balance ?? account.lowest_projected_balance_30_days ?? null;
}

export function lowestProjectedDate(account: Account): string | null {
  return (
    account.lowest_projected_balance_date_30_days ??
    account.health_details?.lowest_projected_balance_date ??
    null
  );
}

export function firstShortfallDate(account: Account): string | null {
  return (
    account.first_negative_date ??
    account.health_details?.first_negative_date ??
    account.health_risk_date ??
    account.risk_date ??
    null
  );
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
      const target = parseAmount(
        account.target_utilization_percent ?? String(DEFAULT_TARGET_UTILIZATION_PERCENT)
      );
      const utilPart =
        util != null && account.utilization_percent != null
          ? `Utilization is ${parseFloat(account.utilization_percent).toFixed(0)}% (target ${target.toFixed(0)}%)`
          : "Over credit limit";
      return `${utilPart}: Pay ${formatCurrency(String(payAmount), currency)} toward ${displayName}`;
    }

    if (base.toLowerCase().includes("past due")) {
      const since = account.next_payment_due_date
        ? formatProjectionDate(account.next_payment_due_date)
        : null;
      return since ? `Past due since ${since}` : "Past due";
    }

    if (base.toLowerCase().includes("outdated")) {
      const lastKnown = account.next_payment_due_date
        ? formatProjectionDate(account.next_payment_due_date)
        : null;
      return lastKnown ? `Last known due ${lastKnown}` : base;
    }
  }

  if (
    account.account_type === "CREDIT" &&
    base.includes("Utilization is") &&
    account.utilization_percent != null
  ) {
    const target = parseAmount(
      account.target_utilization_percent ?? String(DEFAULT_TARGET_UTILIZATION_PERCENT)
    );
    const utilPct = parseFloat(account.utilization_percent).toFixed(0);
    const prefix = `Utilization is ${utilPct}% (target ${target.toFixed(0)}%)`;
    const colon = base.indexOf(":");
    if (colon >= 0) {
      return `${prefix}${base.slice(colon)}`;
    }
    return prefix;
  }

  const lowest = lowestProjectedBalance(account);
  if (lowest != null && (dateFmt || lowestProjectedDate(account) || firstShortfallDate(account))) {
    const lowestFmt = formatCurrency(lowest, currency);
    const lowNum = parseAmount(lowest);

    if (lowNum < 0 && base.includes("drops below zero")) {
      const firstNegative = parseAmount(
        account.health_details?.first_negative_balance ?? account.first_negative_balance
      );
      const moveAmt = firstNegative < 0 ? Math.abs(firstNegative) : Math.abs(lowNum);
      const moveFmt = formatCurrency(String(moveAmt), currency);
      const firstDate = firstShortfallDate(account);
      const lowestDate = lowestProjectedDate(account);
      const firstDateFmt = firstDate ? formatProjectionDate(firstDate) : dateFmt;
      const lowestDateFmt = lowestDate ? formatProjectionDate(lowestDate) : null;
      const datesDiffer = Boolean(firstDate && lowestDate && firstDate !== lowestDate);

      if (datesDiffer && firstDateFmt && lowestDateFmt) {
        return `First shortfall ${firstDateFmt}: add ${moveFmt}. Lowest projected ${lowestFmt} on ${lowestDateFmt}`;
      }
      return firstDateFmt ? `First shortfall ${firstDateFmt}: add ${moveFmt}` : `Add ${moveFmt}`;
    }

    if (
      (base.includes("below buffer") || base.includes("falls below your")) &&
      lowNum >= 0
    ) {
      const buffer = parseAmount(
        account.health_details?.minimum_buffer ?? account.minimum_buffer ?? "0"
      );
      const moveAmt = Math.max(0, buffer - lowNum);
      const lowestDate = lowestProjectedDate(account) ?? riskDate;
      const lowestDateFmt = lowestDate ? formatProjectionDate(lowestDate) : dateFmt;
      return `Projected balance falls to ${lowestFmt} on ${lowestDateFmt}: Move ${formatCurrency(String(moveAmt), currency)} before ${lowestDateFmt}`;
    }
  }

  const recommended = account.health_recommended_action?.trim();
  if (recommended && account.account_type !== "CREDIT") {
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
  if (lowest == null) return null;
  const lowestDate = lowestProjectedDate(account);
  const datePart = lowestDate ? ` on ${formatProjectionDate(lowestDate)}` : "";
  return `${displayName}: Lowest projected in next ${forecastDays} days: ${formatCurrency(
    lowest,
    account.currency
  )}${datePart}`;
}

export type HealthDetailLines = {
  lowestProjected?: string;
  riskDate?: string;
  upcomingNote?: string;
  recommendedAction?: string;
};

export function buildHealthDetailLines(account: Account): HealthDetailLines {
  const currency = account.currency;
  const lines: HealthDetailLines = {};

  const lowest = lowestProjectedBalance(account);
  if (lowest != null) {
    lines.lowestProjected = formatCurrency(lowest, currency);
  }

  const firstDate = firstShortfallDate(account);
  if (firstDate) {
    lines.riskDate = formatDateDisplay(firstDate);
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

  const firstDate = firstShortfallDate(account);
  const firstBal = d?.first_negative_balance ?? account.first_negative_balance;
  if (firstDate && firstBal != null && parseAmount(firstBal) < 0) {
    lines.push(
      `First shortfall: ${formatCurrency(firstBal, currency)} on ${formatHealthRiskDate(firstDate)}`
    );
  }

  const lowest = d?.lowest_projected_balance ?? account.lowest_projected_balance_30_days;
  const lowestDate = lowestProjectedDate(account);
  if (lowest != null) {
    const datePart = lowestDate ? ` on ${formatHealthRiskDate(lowestDate)}` : "";
    lines.push(`Lowest projected: ${formatCurrency(lowest, currency)}${datePart}`);
  }

  const sts = d?.available_to_spend ?? account.available_to_spend;
  if (sts != null && Math.abs(parseAmount(sts) - parseAmount(lowest)) >= 0.01) {
    lines.push(`Safe to spend: ${formatCurrency(sts, currency)}`);
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
