import type {
  TimelineCalendarDay,
  TimelineCalendarPresentationStatus,
  TimelineCalendarSummary,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
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

/**
 * Single risk path for today/future cells.
 * Prefer backend presentation_status; fall back to legacy fields only when absent.
 * heat_level is not an independent override when presentation_status is present.
 */
function canonicalBalanceStatus(day: TimelineCalendarDay): TimelineCalendarPresentationStatus {
  if (day.presentation_status === "critical" || day.presentation_status === "warning" || day.presentation_status === "healthy") {
    return day.presentation_status;
  }
  // Legacy payloads: collapse duplicate flags into one status.
  if (day.is_negative === true || day.risk_level === "critical") {
    return "critical";
  }
  if (
    day.has_risk === true ||
    day.risk_level === "watch" ||
    parseCalendarAmount(day.below_buffer_amount) > 0
  ) {
    return "warning";
  }
  return "healthy";
}

/** Derive presentation status without new financial calculations. */
export function calendarDayPresentationStatus(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): CalendarDayPresentationStatus {
  const state = calendarDateState(dateIso, todayIso);
  // Past dates must never be warning/critical for presentation.
  if (state === "past") return "historical";

  const balanceStatus = canonicalBalanceStatus(day);

  if (state === "today") {
    if (balanceStatus === "critical") return "today_critical";
    if (balanceStatus === "warning") return "today_warning";
    return "today_healthy";
  }

  if (balanceStatus === "critical") return "future_critical";
  if (balanceStatus === "warning") return "future_warning";
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
  todayIso: string = todayStr(),
  _nextRiskDate?: string | null
): boolean {
  // Red account-risk cards are for actionable FUTURE shortfalls only — not today/past.
  if (calendarDateState(dateIso, todayIso) !== "future") return false;
  const status = canonicalBalanceStatus(day);
  if (status !== "critical" && status !== "warning") return false;

  // Quiet days that only inherited a carried marker from an earlier shortfall.
  const shortfallDate = day.lowest_projected_balance_date ?? null;
  if (shortfallDate != null && shortfallDate !== dateIso) return false;

  // Require a real negative (or below-buffer) projected balance for a cash account.
  const balance = parseCalendarAmount(
    day.lowest_projected_balance ?? (status === "critical" ? day.lowest_balance : null)
  );
  if (status === "critical") {
    return balance < 0;
  }
  return balance >= 0 && parseCalendarAmount(day.below_buffer_amount) > 0;
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

function isFirstShortfallDay(
  day: TimelineCalendarDay,
  dateIso: string,
  nextRiskDate?: string | null
): boolean {
  const first = day.first_account_shortfall_date ?? null;
  if (first != null && first !== "") return first === dateIso;
  if (nextRiskDate != null && nextRiskDate !== "") return nextRiskDate === dateIso;
  return true;
}

/** Account-level risk copy for future shortfall days only (never household day net). */
export function calendarAccountRiskPresentation(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr(),
  nextRiskDate?: string | null
): AccountRiskPresentation | null {
  if (!calendarDayShowsAccountRisk(day, dateIso, todayIso, nextRiskDate)) return null;

  const rawTxnId = day.lowest_projected_balance_transaction_id;
  const focusTransactionId =
    rawTxnId != null && rawTxnId !== "" ? Number(rawTxnId) : null;
  const focusIdStr = rawTxnId != null && rawTxnId !== "" ? String(rawTxnId) : null;
  const focusAccountId = day.lowest_projected_balance_account_id ?? null;

  // Prefer the matching calendar event's canonical balance_after — same Bal as Transactions.
  let focusTxn = (day.transactions ?? []).find((txn) => {
    if (focusIdStr == null) return false;
    const matchesId =
      String(txn.id ?? "") === focusIdStr || String(txn.transaction_id ?? "") === focusIdStr;
    if (!matchesId) return false;
    if (focusAccountId != null && txn.account_id != null && txn.account_id !== focusAccountId) {
      return false;
    }
    return txn.balance_after != null && txn.balance_after !== "";
  });

  // Fall back to this day's worst same-account event balance_after (still canonical).
  if (focusTxn == null && focusAccountId != null) {
    const candidates = (day.transactions ?? []).filter((txn) => {
      if (txn.account_id !== focusAccountId || txn.balance_after == null || txn.balance_after === "") {
        return false;
      }
      return true;
    });
    if (candidates.length > 0) {
      focusTxn = candidates.reduce((worst, txn) =>
        parseCalendarAmount(txn.balance_after) < parseCalendarAmount(worst.balance_after)
          ? txn
          : worst
      );
    }
  }

  if (focusTxn?.balance_after != null) {
    const bal = parseCalendarAmount(focusTxn.balance_after);
    const tone: "critical" | "warning" = bal < 0 ? "critical" : "warning";
    const afterDesc = (focusTxn.description || "").trim();
    const first = isFirstShortfallDay(day, dateIso, nextRiskDate);
    const shortfallLabel = first ? "First cash shortfall" : "Cash shortfall";
    return {
      accountName: focusTxn.account_name || "Account",
      balanceLabel: "Projected balance",
      balanceAmount: focusTxn.balance_after,
      detail:
        tone === "critical"
          ? afterDesc
            ? `${shortfallLabel} · after ${afterDesc}`
            : shortfallLabel
          : "Projected below buffer",
      tone,
      accountId: focusTxn.account_id ?? focusAccountId,
      focusTransactionId: Number.isFinite(focusTransactionId)
        ? focusTransactionId
        : focusTxn.transaction_id ?? null,
    };
  }

  // No matching same-account event with balance_after — refuse mixed/stale marker cards.
  return null;
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
    ? `${accountName} · ${shortDate} · ${projectedBalance != null ? formatCurrency(projectedBalance) : "—"}`
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

export type CalendarDayFlowCounts = {
  income: number;
  expense: number;
  transfer: number;
};

/** Event counts from loaded day transactions — not dollar amounts. */
export function calendarDayFlowCounts(day: TimelineCalendarDay): CalendarDayFlowCounts {
  let income = 0;
  let expense = 0;
  let transfer = 0;
  for (const txn of day.transactions) {
    if (txn.is_transfer) {
      transfer += 1;
      continue;
    }
    const amount = parseCalendarAmount(txn.amount);
    if (amount > 0) income += 1;
    else if (amount < 0) expense += 1;
  }
  return { income, expense, transfer };
}

export type CalendarDayCellFlowMarkers = {
  incomeLabel: string | null;
  expenseLabel: string | null;
};

/**
 * Compact grid markers: +2 / -5 from event counts.
 * If the day has income/expense totals but no listed events, show + / - without a fake count.
 */
export function calendarDayCellFlowMarkers(day: TimelineCalendarDay): CalendarDayCellFlowMarkers {
  const counts = calendarDayFlowCounts(day);
  const incomeFromTotal = parseCalendarAmount(day.income_total) > 0;
  const expenseFromTotal = parseCalendarAmount(day.expense_total) > 0;
  return {
    incomeLabel: counts.income > 0 ? `+${counts.income}` : incomeFromTotal ? "+" : null,
    expenseLabel: counts.expense > 0 ? `-${counts.expense}` : expenseFromTotal ? "-" : null,
  };
}

export function calendarDaySpokenDate(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export function calendarSelectedDayEmptyCopy(dateState: CalendarDateState): string {
  if (dateState === "today") return "No remaining activity expected for today.";
  return "No activity expected for this day.";
}

export function calendarSelectedDayEndingMetricLabel(dateState: CalendarDateState): string {
  return dateState === "past" ? "Ending balance" : "Projected ending balance";
}

function flowActivityPhrase(counts: CalendarDayFlowCounts, day: TimelineCalendarDay): string {
  const incomeActivity = counts.income > 0 || parseCalendarAmount(day.income_total) > 0;
  const expenseActivity = counts.expense > 0 || parseCalendarAmount(day.expense_total) > 0;
  const incomePhrase =
    counts.income === 1
      ? "1 income event"
      : counts.income > 1
        ? `${counts.income} income events`
        : incomeActivity
          ? "Income activity"
          : "No income";
  const expensePhrase =
    counts.expense === 1
      ? "1 expense"
      : counts.expense > 1
        ? `${counts.expense} expenses`
        : expenseActivity
          ? "Expense activity"
          : "No expenses";
  if (counts.income > 0 && counts.expense > 0) {
    return `${incomePhrase} and ${expensePhrase}.`;
  }
  return `${incomePhrase}. ${expensePhrase}.`;
}

export function calendarDayAccessibilityLabel(
  day: TimelineCalendarDay,
  dateIso: string,
  todayIso: string = todayStr()
): string {
  const status = calendarDayPresentationStatus(day, dateIso, todayIso);
  const state = calendarDateState(dateIso, todayIso);
  const counts = calendarDayFlowCounts(day);
  const parts = [calendarDaySpokenDate(dateIso) + "."];
  if (state === "today") parts.push("Today.");
  parts.push(flowActivityPhrase(counts, day));
  if (counts.transfer > 0) {
    parts.push(counts.transfer === 1 ? "1 transfer." : `${counts.transfer} transfers.`);
  }
  if (status === "future_critical" || status === "today_critical") {
    parts.push("Cash shortfall projected.");
  } else if (status === "future_warning" || status === "today_warning") {
    parts.push("Below buffer.");
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
