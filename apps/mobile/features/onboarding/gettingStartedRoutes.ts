import type { GettingStartedStepId } from "@budget-app/shared";

export const CALENDAR_ONBOARDING_SOURCE = "onboarding";
export const ONBOARDING_FUTURE_TRANSACTION_MODE = "future";

export const GETTING_STARTED_HOME_ROUTE = "/(app)/(tabs)";
export const GETTING_STARTED_EXPLORE_ROUTE = "/(app)/(tabs)/more";

export const GETTING_STARTED_ROUTES: Record<GettingStartedStepId, string> = {
  account: "/account/new",
  upcoming_transaction: `/transaction/new?source=${CALENDAR_ONBOARDING_SOURCE}&mode=${ONBOARDING_FUTURE_TRANSACTION_MODE}`,
  recurring: `/recurring/new?source=${CALENDAR_ONBOARDING_SOURCE}`,
  calendar: `/(app)/(tabs)/calendar?source=${CALENDAR_ONBOARDING_SOURCE}`,
};

export function firstRouteParam(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

export function isCalendarOnboardingSource(source: unknown): boolean {
  return firstRouteParam(source) === CALENDAR_ONBOARDING_SOURCE;
}

export function isOnboardingFutureTransactionMode(params: {
  source?: unknown;
  mode?: unknown;
}): boolean {
  return (
    isCalendarOnboardingSource(params.source) &&
    firstRouteParam(params.mode) === ONBOARDING_FUTURE_TRANSACTION_MODE
  );
}

export type CalendarOnboardingSheet = "intro" | "handoff" | null;

/** First sheet to show when Calendar becomes ready. Intro always wins over handoff. */
export function initialCalendarOnboardingSheet(opts: {
  fromOnboarding: boolean;
  introSeen: boolean;
  handoffSeen: boolean;
}): CalendarOnboardingSheet {
  if (!opts.introSeen) return "intro";
  if (opts.fromOnboarding && !opts.handoffSeen) return "handoff";
  return null;
}

/** After the one-time Calendar intro is dismissed. */
export function calendarSheetAfterIntroDismiss(opts: {
  fromOnboarding: boolean;
  handoffSeen: boolean;
}): CalendarOnboardingSheet {
  if (opts.fromOnboarding && !opts.handoffSeen) return "handoff";
  return null;
}
