import { formatCurrency, formatMonth, parseMonth } from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";

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

export type ComparisonTone = "positive" | "negative" | "neutral";

export function comparisonTone(delta: string | number | undefined): ComparisonTone {
  const n = parseAmount(delta);
  if (n > 0) return "positive";
  if (n < 0) return "negative";
  return "neutral";
}

export function comparisonSubtitle(
  delta: string | undefined,
  percentChange: string | null | undefined,
  previousMonth: string | undefined
): string | undefined {
  if (!previousMonth || delta == null) return undefined;
  const pct = formatPercentChange(percentChange);
  const vs = formatDeltaVsPrevious(delta, previousMonth);
  return pct ? `${vs} (${pct})` : vs;
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

export function parseReportTypeParam(value: string | undefined): ReportTab | null {
  if (!value) return null;
  if (value === "cash_flow") return "cash-flow";
  return REPORT_TABS.some((tab) => tab.id === value) ? (value as ReportTab) : null;
}

export function reportTabLabel(tab: ReportTab): string {
  return REPORT_TABS.find((t) => t.id === tab)?.label ?? tab;
}

export function formatProjectedCompletion(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return formatDateDisplay(iso);
}

export function expenseSharePercent(amount: string, expenseSubtotal: number): string {
  const abs = Math.abs(parseAmount(amount));
  if (expenseSubtotal <= 0) return "—";
  const share = (abs / expenseSubtotal) * 100;
  return share >= 1 ? `${share.toFixed(0)}%` : "<1%";
}
