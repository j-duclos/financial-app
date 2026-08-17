import type { ExtendedCashRisk, ExtendedCashRiskResponse } from "@budget-app/shared";
import { formatShortMonthDay } from "./dateDisplay";
import { pickHorizonForFocusDate } from "./timelineCalendarUtils";
import { UPCOMING_CALENDAR_PATH } from "./upcomingDisplay";

export function isLookingAheadVisible(
  payload: ExtendedCashRiskResponse | undefined,
  forecastDays: number
): payload is ExtendedCashRiskResponse & { risk: ExtendedCashRisk } {
  const risk = payload?.risk;
  if (!risk) return false;
  return risk.days_from_as_of > forecastDays;
}

export function lookingAheadCalendarPath(
  risk: ExtendedCashRisk,
  todayIso?: string
): string {
  const horizon = pickHorizonForFocusDate(risk.first_negative_date, todayIso);
  return `${UPCOMING_CALENDAR_PATH}?date=${encodeURIComponent(risk.first_negative_date)}&horizon=${horizon}`;
}

function daysFromNowLabel(days: number): string {
  if (days === 1) return "1 day from now";
  return `${days} days from now`;
}

export function lookingAheadMessage(risk: ExtendedCashRisk): string {
  const when = `${formatShortMonthDay(risk.first_negative_date)}, ${daysFromNowLabel(risk.days_from_as_of)}`;
  const extras = risk.additional_accounts ?? [];
  if (extras.length === 0) {
    return `${risk.account_name} is projected to fall below $0 on ${when}.`;
  }
  if (extras.length === 1) {
    return `${risk.account_name} and ${extras[0].account_name} are projected to fall below $0 on ${when}.`;
  }
  return `${risk.account_name} and ${extras.length} other accounts are projected to fall below $0 on ${when}.`;
}
