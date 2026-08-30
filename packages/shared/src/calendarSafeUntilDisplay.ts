import type { CalendarSafeUntil } from "./types";
import { formatDateDisplay } from "./dateDisplay";

export type CalendarSafeUntilTone = "positive" | "negative" | "neutral" | "muted";

export type CalendarSafeUntilPresentation = {
  primaryText: string;
  tone: CalendarSafeUntilTone;
  subtitle: string | null;
};

type FormatMoney = (amount: string) => string;

/**
 * Presentation-only mapping from backend safe_until status — no financial math.
 */
export function calendarSafeUntilPresentation(
  safeUntil: CalendarSafeUntil | null | undefined,
  formatMoney: FormatMoney
): CalendarSafeUntilPresentation {
  if (!safeUntil) {
    return {
      primaryText: "Unavailable",
      tone: "muted",
      subtitle: null,
    };
  }

  switch (safeUntil.status) {
    case "available": {
      const amount = safeUntil.safe_amount ?? "0";
      const nextIncome = safeUntil.next_income_date;
      if (!nextIncome) {
        return {
          primaryText: "Unavailable",
          tone: "muted",
          subtitle: safeUntil.reason,
        };
      }
      const safeAmount = Number(amount);
      if (Number.isFinite(safeAmount) && safeAmount >= 0) {
        return {
          primaryText: `Safe until ${formatDateDisplay(nextIncome)}: ${formatMoney(amount)}`,
          tone: "positive",
          subtitle: "Current balance less obligations before next income",
        };
      }
      return {
        primaryText: `Unsafe before next paycheck: ${formatMoney(amount)}`,
        tone: "negative",
        subtitle: safeUntil.unsafe_date
          ? `Projected unsafe date: ${formatDateDisplay(safeUntil.unsafe_date)}`
          : "Projected unsafe date: Unknown",
      };
    }
    case "no_upcoming_income":
      return {
        primaryText: "No projected income in horizon",
        tone: "neutral",
        subtitle: null,
      };
    case "unavailable":
    default:
      return {
        primaryText: "Unavailable",
        tone: "muted",
        subtitle: safeUntil.reason,
      };
  }
}
