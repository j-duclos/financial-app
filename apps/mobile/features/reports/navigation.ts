import type { ReportTab } from "./reportDisplay";
import type { ReportFilters } from "./types";

export function reportDetailPath(type: ReportTab, filters: ReportFilters) {
  return {
    pathname: "/reports/[type]" as const,
    params: {
      type,
      month: filters.monthKey,
      months: String(filters.historyMonths),
    },
  };
}

export function categoryDetailPath(
  categoryId: number,
  filters: ReportFilters,
  categoryName?: string
) {
  return {
    pathname: "/reports/category/[categoryId]" as const,
    params: {
      categoryId: String(categoryId),
      month: filters.monthKey,
      months: String(filters.historyMonths),
      name: categoryName ?? "",
    },
  };
}

export function transactionsForReportCategory(
  categoryId: number,
  periodStart: string,
  periodEnd: string
) {
  return {
    pathname: "/(app)/(tabs)/transactions" as const,
    params: {
      category: String(categoryId),
      dateFrom: periodStart,
      dateTo: periodEnd,
    },
  };
}

export function transactionsForReportPeriod(periodStart: string, periodEnd: string) {
  return {
    pathname: "/(app)/(tabs)/transactions" as const,
    params: {
      dateFrom: periodStart,
      dateTo: periodEnd,
    },
  };
}

export function parseReportRouteParams(params: {
  month?: string;
  months?: string;
}): Pick<ReportFilters, "monthKey" | "historyMonths"> | null {
  const monthKey = params.month;
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return null;
  const months = Number(params.months);
  const historyMonths = months === 6 || months === 12 || months === 24 ? months : 12;
  return { monthKey, historyMonths };
}
