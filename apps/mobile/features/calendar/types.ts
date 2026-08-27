import type { OperationalForecastDays } from "@budget-app/shared";

export type CalendarLookbackMonths = 0 | 1 | 2 | 3;

export type CalendarFilters = {
  /** Operational forecast window in days (30 / 60 / 90 / 180). */
  forecastDays: OperationalForecastDays;
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
