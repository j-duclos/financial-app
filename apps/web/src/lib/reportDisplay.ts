import { formatCurrency, formatMonth, parseMonth } from "@budget-app/shared";

export function parseAmount(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/** Signed money for Reports: +$X / -$X / $0.00 */
export function formatSignedAmount(value: string | number): string {
  const n = parseAmount(value);
  const abs = formatCurrency(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return formatCurrency(0);
}

export function formatMonthLabel(ym: string): string {
  const { year, month } = parseMonth(ym);
  if (!year || !month) return ym;
  return formatMonth(year, month);
}

export function formatShortMonth(ym: string): string {
  const { year, month } = parseMonth(ym);
  if (!year || !month) return ym;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

export function formatDeltaVsPrevious(delta: string | undefined, previousMonth: string): string {
  if (delta == null) return "—";
  const n = parseAmount(delta);
  const label = formatShortMonth(previousMonth);
  if (n === 0) return `No change vs ${label}`;
  return `${formatSignedAmount(delta)} vs ${label}`;
}

export function formatPercentChange(pct: string | null | undefined): string | null {
  if (pct == null || pct === "") return null;
  const n = parseAmount(pct);
  if (!Number.isFinite(n)) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

export function deltaClassName(delta: string | number | undefined): string {
  const n = parseAmount(delta);
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-red-700";
  return "text-gray-500";
}

/** Hide noisy comparisons for tiny category rows. */
export function shouldShowCategoryDelta(
  total: string,
  delta: string | undefined,
  expenseAbsTotal: number
): boolean {
  if (delta == null) return false;
  const absTotal = Math.abs(parseAmount(total));
  const absDelta = Math.abs(parseAmount(delta));
  if (absDelta < 0.005) return false;
  if (expenseAbsTotal > 0 && absTotal / expenseAbsTotal < 0.01 && absDelta < 25) {
    return false;
  }
  return true;
}

export const REPORT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "cash-flow", label: "Cash Flow" },
  { id: "spending", label: "Spending" },
  { id: "goals", label: "Goals" },
  { id: "debt", label: "Debt" },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]["id"];

export function parseReportViewParam(value: string | null): ReportTab | null {
  if (!value) return null;
  if (value === "cash_flow") return "cash-flow";
  return REPORT_TABS.some((tab) => tab.id === value) ? (value as ReportTab) : null;
}
