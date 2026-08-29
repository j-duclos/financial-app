import type { TimelineCalendarDay, TimelineCalendarSummary } from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";
import { todayStr } from "@/lib/dates";
import { parseCalendarAmount } from "./calendarUtils";

/** Local-date classification for calendar presentation. */
export type CalendarDateState = "past" | "today" | "future";

/** Presentation-only day status derived from canonical backend fields. */
export type CalendarDayPresentationStatus =
  | "historical"
  | "future_healthy"
  | "future_warning"
  | "future_critical"
  | "today_healthy"
  | "today_warning"
  | "today_critical";

/** Compact grid styling bucket (maps from presentation status). */
export type CalendarGridTone = "neutral" | "healthy" | "warning" | "critical";

export function calendarDateState(dateIso: string, todayIso: string = todayStr()): CalendarDateState {
  if (dateIso < todayIso) return "past";
  if (dateIso === todayIso) return "today";
  return "future";
}

function isFutureCritical(day: TimelineCalendarDay): boolean {
  return (
    day.is_negative === true ||
    day.risk_level === "critical" ||
    day.heat_level === "dangerous"
  );
}

function isFutureWarning(day: TimelineCalendarDay): boolean {
  if (isFutureCritical(day)) return false;
  return (
    day.has_risk === true ||
    day.risk_level === "watch" ||
    day.heat_level === "tight" ||
    parseCalendarAmount(day.below_buffer_amount) > 0
  );
}

/** Derive presentation status without new financial calculations. */
export function calendarDayPresentationStatus(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): CalendarDayPresentationStatus {
  const state = calendarDateState(dateIso, todayIso);
  if (state === "past") return "historical";

  if (state === "today") {
    if (isFutureCritical(day)) return "today_critical";
    if (isFutureWarning(day)) return "today_warning";
    return "today_healthy";
  }

  if (isFutureCritical(day)) return "future_critical";
  if (isFutureWarning(day)) return "future_warning";
  return "future_healthy";
}

export function calendarGridTone(status: CalendarDayPresentationStatus): CalendarGridTone {
  switch (status) {
    case "future_critical":
      return "critical";
    case "future_warning":
      return "warning";
    // Today never drives red/yellow grid fill — today uses the blue tint chrome.
    case "today_critical":
    case "today_warning":
    case "future_healthy":
    case "today_healthy":
      return "healthy";
    default:
      return "neutral";
  }
}

export function calendarGridShowsRiskIndicator(status: CalendarDayPresentationStatus): boolean {
  // Risk dots only on future days. Today must not look like an error state.
  return status === "future_critical" || status === "future_warning";
}

/**
 * Explicit cell chrome for the month grid.
 * isToday is independent of selection (local device date via todayIso).
 *
 * Background priority: today tint > future risk fill > neutral
 * Border priority: selected outline > today stronger border > risk/neutral border
 * Today never gets warning/critical fill.
 */
export type CalendarDayCellChrome = {
  isToday: boolean;
  isSelected: boolean;
  riskTone: CalendarGridTone;
  background: "neutral" | "today" | "warning" | "critical";
  border: "neutral" | "today" | "selected" | "warning" | "critical";
  borderWidth: 1 | 2;
  dayNumberWeight: "600" | "700";
};

export function resolveCalendarDayCellChrome(input: {
  dateIso: string;
  isSelected: boolean;
  riskTone: CalendarGridTone;
  todayIso?: string;
}): CalendarDayCellChrome {
  const todayIso = input.todayIso ?? todayStr();
  const isToday = input.dateIso === todayIso;
  const isSelected = input.isSelected;
  const riskTone = input.riskTone;
  const hasFutureRiskFill =
    !isToday && (riskTone === "warning" || riskTone === "critical");

  let background: CalendarDayCellChrome["background"] = "neutral";
  if (isToday) {
    background = "today";
  } else if (hasFutureRiskFill) {
    background = riskTone;
  }

  let border: CalendarDayCellChrome["border"] = "neutral";
  let borderWidth: 1 | 2 = 1;
  if (isSelected) {
    border = "selected";
    borderWidth = 2;
  } else if (isToday) {
    border = "today";
    borderWidth = 2;
  } else if (hasFutureRiskFill) {
    border = riskTone;
    borderWidth = 1;
  }

  return {
    isToday,
    isSelected,
    riskTone,
    background,
    border,
    borderWidth,
    dayNumberWeight: isToday || isSelected ? "700" : "600",
  };
}

export function calendarDayShowsAccountRisk(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): boolean {
  // Red account-risk cards are for actionable FUTURE shortfalls only — not today.
  if (calendarDateState(dateIso, todayIso) !== "future") return false;
  return isFutureCritical(day) || isFutureWarning(day);
}

/**
 * Household day cards show Income/Expenses only (no manufactured start/end).
 * Account-filtered cards may show canonical backend Ending balance.
 */
export function calendarDaySummaryShowsCanonicalEnding(
  balanceScope: TimelineCalendarDay["balance_scope"]
): boolean {
  return balanceScope === "account";
}

export function calendarPastAccountEndingLabel(accountName?: string | null): string {
  return accountName ? `${accountName} ending balance` : "Account ending balance";
}

export type AccountRiskPresentation = {
  accountName: string;
  balanceLabel: string;
  balanceAmount: string;
  detail: string | null;
  tone: "critical" | "warning";
  accountId: number | null;
  focusTransactionId: number | null;
};

/** Account-level risk copy for today/future days (household or account scope). */
export function calendarAccountRiskPresentation(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): AccountRiskPresentation | null {
  if (!calendarDayShowsAccountRisk(day, dateIso, todayIso)) return null;

  const accountName =
    day.lowest_projected_balance_account_name ??
    day.affected_account_name ??
    "Account";
  const balance =
    day.lowest_projected_balance ??
    (day.is_negative ? day.lowest_balance : null) ??
    day.lowest_balance;
  const balanceNum = parseCalendarAmount(balance);
  const tone: "critical" | "warning" =
    day.is_negative === true || day.risk_level === "critical" || day.heat_level === "dangerous"
      ? "critical"
      : "warning";

  const state = calendarDateState(dateIso, todayIso);
  const balanceLabel =
    state === "today" ? "Projected ending" : "Projected balance";

  let detail: string | null = null;
  if (tone === "critical") {
    detail =
      state === "today" && dateIso === todayIso
        ? "First cash shortfall today"
        : "First cash shortfall";
  } else if (day.risk_reason) {
    detail = day.risk_reason;
  } else {
    detail = "Projected below buffer";
  }

  const rawTxnId = day.lowest_projected_balance_transaction_id;
  const focusTransactionId =
    rawTxnId != null && rawTxnId !== "" ? Number(rawTxnId) : null;

  return {
    accountName,
    balanceLabel,
    balanceAmount: balance ?? "0",
    detail,
    tone,
    accountId: day.lowest_projected_balance_account_id ?? null,
    focusTransactionId: Number.isFinite(focusTransactionId) ? focusTransactionId : null,
  };
}

export type NextCashShortfallBanner = {
  title: string;
  subtitle: string;
  accessibilityLabel: string;
  riskDate: string;
  accountId: number;
  accountName: string;
  focusTransactionId: number | null;
  projectedBalance: string | null;
  tone: "critical" | "warning";
};

function formatShortMonthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Human-readable next-risk banner from canonical summary (+ optional day detail). */
export function nextCashShortfallBanner(
  summary: TimelineCalendarSummary,
  dayOnRiskDate?: TimelineCalendarDay
): NextCashShortfallBanner | null {
  const riskDate = summary.next_risk_date;
  if (!riskDate) return null;

  const risky =
    summary.risky_accounts.find((a) => a.risk_date === riskDate) ?? summary.risky_accounts[0];
  if (!risky?.account_id) return null;

  const accountName = risky.account_name;
  const shortDate = formatShortMonthDay(riskDate);
  const projectedBalance =
    dayOnRiskDate?.lowest_projected_balance ??
    risky.lowest_projected_balance ??
    summary.lowest_balance;
  const isCritical = risky.risk_status === "critical" || parseCalendarAmount(projectedBalance) < 0;
  const tone: "critical" | "warning" = isCritical ? "critical" : "warning";

  const title = isCritical ? "Next cash shortfall" : "Next below-buffer day";
  const subtitle = isCritical
    ? `${accountName} · ${shortDate} · ${projectedBalance ?? "—"}`
    : `${accountName} may dip below buffer ${shortDate}`;

  const rawTxnId = dayOnRiskDate?.lowest_projected_balance_transaction_id;
  const focusTransactionId =
    rawTxnId != null && rawTxnId !== "" ? Number(rawTxnId) : null;

  return {
    title,
    subtitle,
    accessibilityLabel: `${title}. ${accountName}. ${formatDateDisplay(riskDate)}. Projected balance ${projectedBalance ?? "unknown"}. Opens account transactions at the forecast risk.`,
    riskDate,
    accountId: risky.account_id,
    accountName,
    focusTransactionId: Number.isFinite(focusTransactionId) ? focusTransactionId : null,
    projectedBalance,
    tone,
  };
}

export function noCashShortfallsCopy(forecastDays: number): string {
  return `No cash shortfalls in the next ${forecastDays} days`;
}

export function calendarDayAccessibilityLabel(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): string {
  const status = calendarDayPresentationStatus(day, dateIso, todayIso);
  const state = calendarDateState(dateIso, todayIso);
  const events = day.transactions.length;
  const net = parseCalendarAmount(day.net_total);
  const parts = [dateIso, state, status.replace(/_/g, " ")];
  if (events > 0) parts.push(`${events} events`);
  if (net !== 0) parts.push(`net ${net.toFixed(2)}`);
  if (status === "future_critical" || status === "today_critical") {
    parts.push("projected negative balance");
  }
  return parts.join(", ");
}
