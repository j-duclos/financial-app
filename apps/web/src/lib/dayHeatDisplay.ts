import type {
  DashboardUpcomingGroup,
  DayHeatLevel,
  DayLowestBalanceMarker,
  TimelineCalendarDay,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  normalizeSeverity,
  severityIconEmoji,
  severityLabel,
  severityTokens,
  type SeverityLevel,
} from "./severity";

function parseAmount(val: string | null | undefined): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

/** Compact inline warning (e.g. Main projected -$19.62). */
export function formatAccountProjectedBalance(
  accountName: string,
  balance: string | number
): string {
  return `${accountName} projected ${formatCurrency(balance)}`;
}

export type DayHeatSource = Pick<
  DashboardUpcomingGroup,
  | "heat_level"
  | "heat_label"
  | "heat_reason"
  | "affected_account_name"
  | "lowest_projected_balance"
  | "below_buffer_amount"
  | "is_negative"
  | "has_risk"
  | "risk_reason"
> &
  Pick<
    TimelineCalendarDay,
    | "heat_level"
    | "heat_label"
    | "heat_reason"
    | "affected_account_name"
    | "lowest_projected_balance"
    | "below_buffer_amount"
    | "is_negative"
    | "risk_level"
    | "has_risk"
    | "risk_reason"
  >;

export function resolveDayHeatLevel(day: DayHeatSource): DayHeatLevel {
  if (day.heat_level) return day.heat_level;
  if (day.is_negative || day.risk_level === "critical") return "dangerous";
  if (day.has_risk || day.risk_level === "watch") return "tight";
  // Quiet default when API omits heat — active healthy days should send heat_level explicitly.
  return "neutral";
}

export function heatLevelToSeverity(level: DayHeatLevel): SeverityLevel {
  return normalizeSeverity(level);
}

export function dayHeatLabel(level: DayHeatLevel): string {
  return severityLabel(heatLevelToSeverity(level));
}

export function dayHeatEmoji(level: DayHeatLevel): string {
  return severityIconEmoji(heatLevelToSeverity(level));
}

export function dayHeatAriaLabel(day: DayHeatSource, dateLabel: string): string {
  const level = resolveDayHeatLevel(day);
  const label = day.heat_label ?? dayHeatLabel(level);
  const reason = dayHeatReason(day);
  if (reason) return `${label} day ${dateLabel}: ${reason}`;
  return `${label} day ${dateLabel}`;
}

function normalizeLegacyHeatReason(day: DayHeatSource): string | null {
  const raw = day.heat_reason;
  if (!raw) return null;
  const legacy = /^(?:Worst:\s*)?(.+?)\s+projected negative$/i.exec(raw.trim());
  if (!legacy) return raw;
  const account = legacy[1].trim();
  if (
    day.affected_account_name &&
    account.toLowerCase() !== day.affected_account_name.trim().toLowerCase()
  ) {
    return raw;
  }
  const bal = day.lowest_projected_balance;
  if (bal != null && parseAmount(bal) < 0) {
    return formatAccountProjectedBalance(account, bal);
  }
  return raw;
}

export function heatReasonDuplicatesLowestMarker(
  day: DayHeatSource &
    Pick<DayLowestBalanceMarker, "lowest_projected_balance_account_name" | "lowest_projected_balance">
): boolean {
  const heatAccount = day.affected_account_name?.trim().toLowerCase();
  const lowestAccount = day.lowest_projected_balance_account_name?.trim().toLowerCase();
  if (!heatAccount || !lowestAccount || heatAccount !== lowestAccount) return false;
  if (parseAmount(day.lowest_projected_balance) >= 0) return false;
  return day.is_negative === true || resolveDayHeatLevel(day) === "dangerous";
}

export function dayHeatReason(day: DayHeatSource): string | null {
  if (day.heat_reason) return normalizeLegacyHeatReason(day);
  if (day.risk_reason) return day.risk_reason;
  if (day.affected_account_name && day.is_negative && day.lowest_projected_balance != null) {
    return formatAccountProjectedBalance(
      day.affected_account_name,
      day.lowest_projected_balance
    );
  }
  if (day.below_buffer_amount && day.affected_account_name) {
    return `Below buffer: ${day.affected_account_name} ${formatCurrency(day.below_buffer_amount)}`;
  }
  return null;
}

export function dayHeatHeaderAccentClass(level: DayHeatLevel): string {
  return severityTokens(level).headerAccentClass;
}

export function dayHeatDotClass(level: DayHeatLevel): string {
  return `${severityTokens(level).dotClass} ring-2`;
}

export function dayHeatShowsReason(level: DayHeatLevel): boolean {
  const sev = heatLevelToSeverity(level);
  return sev === "critical" || sev === "at_risk" || sev === "watch";
}

export function calendarCellToneFromHeat(level: DayHeatLevel): "empty" | "healthy" | "watch" | "critical" {
  const sev = heatLevelToSeverity(level);
  if (sev === "critical") return "critical";
  if (sev === "at_risk" || sev === "watch") return "watch";
  if (level === "healthy") return "healthy";
  return "empty";
}
