import type { ReportTab } from "./reportDisplay";

export type ReportHistoryMonths = 6 | 12 | 24;

export type ReportFilters = {
  monthKey: string;
  historyMonths: ReportHistoryMonths;
};

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  monthKey: "",
  historyMonths: 12,
};

export type ReportTypeCard = {
  id: ReportTab;
  label: string;
  description: string;
  icon: "dashboard" | "exchange" | "pie-chart" | "bullseye" | "credit-card";
};

export const REPORT_TYPE_CARDS: ReportTypeCard[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Income, expenses, net, and highlights",
    icon: "dashboard",
  },
  {
    id: "cash-flow",
    label: "Cash Flow",
    description: "Income vs expenses trend over time",
    icon: "exchange",
  },
  {
    id: "spending",
    label: "Spending",
    description: "Category breakdown and limit performance",
    icon: "pie-chart",
  },
  {
    id: "goals",
    label: "Goals",
    description: "Savings progress and funding activity",
    icon: "bullseye",
  },
  {
    id: "debt",
    label: "Debt",
    description: "Credit card interest and payoff outlook",
    icon: "credit-card",
  },
];

export const REPORT_HISTORY_OPTIONS: { value: ReportHistoryMonths; label: string }[] = [
  { value: 6, label: "6 months" },
  { value: 12, label: "12 months" },
  { value: 24, label: "24 months" },
];

export function countActiveReportFilters(
  filters: ReportFilters,
  defaults: ReportFilters
): number {
  let n = 0;
  if (filters.historyMonths !== defaults.historyMonths) n += 1;
  return n;
}
