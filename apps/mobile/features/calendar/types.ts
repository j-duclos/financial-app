import type { OperationalForecastDays } from "@budget-app/shared";

export type CalendarHorizon = "14d" | "3m" | "6m" | "12m";

export type CalendarLookbackMonths = 0 | 1 | 2 | 3;

export type CalendarFilters = {
  horizon: CalendarHorizon;
  lookbackMonths: CalendarLookbackMonths;
  accountId: number | "";
  scenarioId: number | "";
  householdId: number | undefined;
};

export type CalendarFlowFilter = "all" | "income" | "expense" | "transfer";

export type CalendarEventFilter = {
  flow: CalendarFlowFilter;
  recurringOnly: boolean;
};

export const DEFAULT_CALENDAR_EVENT_FILTER: CalendarEventFilter = {
  flow: "all",
  recurringOnly: false,
};

/** Map operational forecast window to calendar API horizon (backend-owned range). */
export function horizonForForecastDays(days: OperationalForecastDays): CalendarHorizon {
  if (days <= 30) return "3m";
  if (days <= 90) return "3m";
  if (days <= 180) return "6m";
  return "12m";
}
