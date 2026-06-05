import type { CreditBalanceWarning, DayHeatLevel, DayLowestBalanceMarker } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { normalizeSeverity, severityTokens } from "./severity";
import {
  dayHeatReason,
  formatAccountProjectedBalance,
  heatReasonDuplicatesLowestMarker,
  resolveDayHeatLevel,
  type DayHeatSource,
} from "./dayHeatDisplay";

export type DayLowestSource = DayHeatSource &
  DayLowestBalanceMarker & {
    credit_balance_warnings?: CreditBalanceWarning[];
  };

export { formatAccountProjectedBalance };

export function shouldShowLowestBalanceMarker(
  day: DayLowestSource,
  heatLevel?: DayHeatLevel
): boolean {
  const level = heatLevel ?? resolveDayHeatLevel(day);
  const balance = parseAmount(day.lowest_projected_balance);
  const below = parseAmount(day.below_buffer_amount);

  if (day.show_lowest_balance_marker === true && day.lowest_projected_balance != null) {
    return true;
  }
  if (level === "tight" || level === "dangerous") {
    if (day.lowest_projected_balance != null && (balance < 0 || below > 0)) {
      return true;
    }
  }
  if (day.show_lowest_balance_marker === false) {
    return false;
  }
  if (balance < 0) return true;
  return below > 0;
}

function parseAmount(val: string | null | undefined): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

export function lowestMarkerSeverity(
  day: DayLowestSource,
  heatLevel?: DayHeatLevel
): "critical" | "at_risk" | "watch" {
  const level = heatLevel ?? resolveDayHeatLevel(day);
  if (level === "dangerous" || day.is_negative || parseAmount(day.lowest_projected_balance) < 0) {
    return "critical";
  }
  if (level === "tight") return "at_risk";
  return "watch";
}

export function warningLineSeverity(
  day: DayLowestSource,
  heatLevel?: DayHeatLevel,
  creditWarningSeverity?: string | null
): "critical" | "at_risk" | "watch" {
  if (creditWarningSeverity) {
    const normalized = normalizeSeverity(creditWarningSeverity);
    if (normalized === "critical") return "critical";
    if (normalized === "at_risk") return "at_risk";
    if (normalized === "watch") return "watch";
  }
  return lowestMarkerSeverity(day, heatLevel);
}

export function lowestMarkerTextClass(
  severity: "critical" | "at_risk" | "watch" | "dangerous" | "tight"
): string {
  return severityTokens(severity).warningTextClass;
}

export function lowestMarkerIconClass(
  severity: "critical" | "at_risk" | "watch" | "dangerous" | "tight"
): string {
  return severityTokens(severity).iconClass;
}

/** Full Timeline / list header line */
export function formatTimelineLowestMarker(
  day: DayLowestSource,
  options?: { singleAccountView?: boolean }
): string | null {
  if (!shouldShowLowestBalanceMarker(day)) return null;
  const bal = day.lowest_projected_balance;
  if (bal == null) return null;

  const name = day.lowest_projected_balance_account_name;
  const after = day.lowest_projected_balance_after_description;
  const severity = lowestMarkerSeverity(day);
  const formattedBal = formatCurrency(bal);
  const balance = parseAmount(bal);

  if (balance < 0) {
    if (options?.singleAccountView || !name) {
      return `Projected ${formattedBal}`;
    }
    return formatAccountProjectedBalance(name, bal);
  }

  if (after && name) {
    return `Lowest after ${after}: ${name} ${formattedBal}`;
  }
  if (options?.singleAccountView || !name) {
    if (severity === "tight" && parseAmount(day.below_buffer_amount) > 0) {
      return `Lowest projected balance: ${formattedBal} below buffer`;
    }
    return `Lowest projected balance: ${formattedBal}`;
  }
  if (severity === "tight" && parseAmount(day.below_buffer_amount) > 0) {
    const gap = formatCurrency(day.below_buffer_amount!);
    return `Lowest projected balance: ${name} ${formattedBal} below buffer (${gap})`;
  }
  return `Lowest projected balance: ${name} ${formattedBal}`;
}

/** Compact Dashboard upcoming line */
export function formatDashboardLowestMarker(day: DayLowestSource): string | null {
  if (!shouldShowLowestBalanceMarker(day)) return null;
  const bal = day.lowest_projected_balance;
  if (bal == null) return null;
  const name = day.lowest_projected_balance_account_name ?? "Account";
  if (parseAmount(bal) < 0) {
    return formatAccountProjectedBalance(name, bal);
  }
  if (parseAmount(day.below_buffer_amount) > 0) {
    return `Below buffer: ${name} ${formatCurrency(day.below_buffer_amount)}`;
  }
  return `${name} lowest: ${formatCurrency(bal)}`;
}

/** Inline warnings for day headers — one line per account, no heat/lowest duplicates. */
export function inlineProjectedBalanceWarnings(day: DayLowestSource): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const row of day.credit_balance_warnings ?? []) {
    const name = row.account_name?.trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    lines.push(row.message);
  }

  if (!heatReasonDuplicatesLowestMarker(day)) {
    const heatReason = dayHeatReason(day);
    const heatAccount = day.affected_account_name?.trim().toLowerCase();
    if (heatReason && heatAccount && !seen.has(heatAccount)) {
      seen.add(heatAccount);
      lines.push(heatReason);
    } else if (heatReason && !heatAccount) {
      lines.push(heatReason);
    }
  }

  const lowest = formatDashboardLowestMarker(day);
  if (lowest) {
    const name = day.lowest_projected_balance_account_name?.trim().toLowerCase();
    if (!name || !seen.has(name)) {
      if (name) seen.add(name);
      lines.push(lowest);
    }
  }

  // Legacy API: skip cash-style "X projected -$…" heat lines for credit card names.
  return lines.filter((line) => {
    const creditNames = new Set(
      (day.credit_balance_warnings ?? []).map((w) => w.account_name.trim().toLowerCase())
    );
    if (creditNames.size === 0) return true;
    for (const creditName of creditNames) {
      if (line.toLowerCase().startsWith(`${creditName} projected`)) return false;
    }
    return true;
  });
}

export function lowestMarkerAriaLabel(day: DayLowestSource): string | null {
  const text = formatTimelineLowestMarker(day);
  if (!text) return null;
  if (parseAmount(day.lowest_projected_balance) < 0) {
    return text;
  }
  const severity = lowestMarkerSeverity(day);
  const prefix =
    severity === "critical" ? "Warning: projected negative balance." : "Warning: below buffer.";
  return `${prefix} ${text}`;
}

export function formatDayDetailLowestSection(
  day: DayLowestSource,
  dateLabel: string
): { headline: string; avoidOverdraft: string | null; restoreBuffer: string | null } | null {
  if (!shouldShowLowestBalanceMarker(day) || day.lowest_projected_balance == null) {
    return null;
  }
  const name = day.lowest_projected_balance_account_name ?? "Account";
  const bal = formatCurrency(day.lowest_projected_balance);
  const after = day.lowest_projected_balance_after_description;
  const headline = after
    ? `${name} ${bal} after ${after}`
    : `${name} ${bal}`;

  const toZero = parseAmount(day.amount_needed_to_zero);
  const toBuffer = parseAmount(day.amount_needed_to_buffer);

  return {
    headline,
    avoidOverdraft:
      toZero > 0 ? `Move ${formatCurrency(String(toZero))} before ${dateLabel}` : null,
    restoreBuffer:
      toBuffer > 0 ? `Move ${formatCurrency(String(toBuffer))} before ${dateLabel}` : null,
  };
}
