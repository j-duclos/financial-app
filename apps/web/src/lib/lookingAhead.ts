import type { ExtendedCashRisk } from "@budget-app/shared";
import { isLookingAheadVisible, lookingAheadMessage } from "@budget-app/shared";
import { pickHorizonForFocusDate } from "./timelineCalendarUtils";
import { UPCOMING_CALENDAR_PATH } from "./upcomingDisplay";

export { isLookingAheadVisible, lookingAheadMessage };

/** Web Calendar deep link for the Looking Ahead banner CTA. */
export function lookingAheadCalendarPath(
  risk: ExtendedCashRisk,
  todayIso?: string
): string {
  const horizon = pickHorizonForFocusDate(risk.first_negative_date, todayIso);
  return `${UPCOMING_CALENDAR_PATH}?date=${encodeURIComponent(risk.first_negative_date)}&horizon=${horizon}`;
}
