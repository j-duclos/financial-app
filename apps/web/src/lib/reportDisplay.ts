import { formatCurrency, formatMonth, parseMonth } from "@budget-app/shared";

/**
 * Parse a canonical report amount. Returns null for missing/malformed/non-finite values.
 * Do not treat invalid API data as $0.
 */
export function parseOptionalAmount(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Prefer {@link parseOptionalAmount} when distinguishing invalid from zero. */
export function parseAmount(value: string | number | null | undefined): number {
  return parseOptionalAmount(value) ?? 0;
}

/** Signed money for Reports: +$X / -$X / $0.00. Invalid → em dash. */
export function formatSignedAmount(value: string | number | null | undefined): string {
  const n = parseOptionalAmount(value);
  if (n == null) return "—";
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
  const n = parseOptionalAmount(delta);
  if (n == null) return "—";
  const label = formatShortMonth(previousMonth);
  if (n === 0) return `No change vs ${label}`;
  return `${formatSignedAmount(delta)} vs ${label}`;
}

export function formatPercentChange(pct: string | null | undefined): string | null {
  if (pct == null || pct === "") return null;
  const n = parseOptionalAmount(pct);
  if (n == null) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${n}%`;
}

/** Format backend-owned expense_share_percent — does not compute share from amounts. */
export function formatExpenseSharePercent(share: string | null | undefined): string | null {
  if (share == null || share === "") return null;
  const n = parseOptionalAmount(share);
  if (n == null) return null;
  return `${Math.round(n)}%`;
}

export function deltaClassName(delta: string | number | undefined): string {
  const n = parseOptionalAmount(delta);
  if (n == null || n === 0) return "text-gray-500";
  if (n > 0) return "text-emerald-700";
  return "text-red-700";
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
