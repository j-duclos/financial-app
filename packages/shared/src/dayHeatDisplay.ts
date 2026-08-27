import type {
  DashboardUpcomingGroup,
  DayHeatLevel,
  TimelineCalendarDay,
} from "./types";
import { formatCurrency } from "./utils";
import { normalizeSeverity, severityIconEmoji, severityLabel, type SeverityLevel } from "./severity";

function parseAmount(val: string | null | undefined): number {
  if (val == null || val === "") return 0;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : 0;
}

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

export function dayHeatReason(day: DayHeatSource): string | null {
  if (day.heat_reason) return day.heat_reason;
  if (day.risk_reason) return day.risk_reason;
  if (day.affected_account_name && day.is_negative && day.lowest_projected_balance != null) {
    return formatAccountProjectedBalance(day.affected_account_name, day.lowest_projected_balance);
  }
  if (day.below_buffer_amount && day.affected_account_name) {
    return `Below buffer: ${day.affected_account_name} ${formatCurrency(day.below_buffer_amount)}`;
  }
  return null;
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
