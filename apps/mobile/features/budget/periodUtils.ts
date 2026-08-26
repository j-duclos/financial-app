import { addMonthsToIsoDate, formatDateDisplay, todayStr } from "@/lib/dates";
import type { BudgetPeriodAnchor } from "./types";

export function anchorFromMonth(year: number, month: number): string {
  const mm = String(month + 1).padStart(2, "0");
  return `${year}-${mm}-15`;
}

export function periodAnchorFromDate(iso: string): BudgetPeriodAnchor {
  return {
    anchor: iso,
    monthKey: iso.slice(0, 7),
  };
}

export function currentPeriodAnchor(today = todayStr()): BudgetPeriodAnchor {
  return periodAnchorFromDate(today);
}

export function shiftPeriodAnchor(current: BudgetPeriodAnchor, deltaMonths: number): BudgetPeriodAnchor {
  const next = addMonthsToIsoDate(current.anchor, deltaMonths);
  return periodAnchorFromDate(next);
}

export function formatPeriodLabel(anchor: BudgetPeriodAnchor): string {
  const [y, m] = anchor.monthKey.split("-").map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatPeriodRange(start: string, end: string): string {
  return `${formatDateDisplay(start)} – ${formatDateDisplay(end)}`;
}
