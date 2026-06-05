/**
 * Unified forecast severity for calendar, timeline, dashboard, and account warnings.
 */
import type { DayHeatLevel } from "@budget-app/shared";
import {
  dayHeatAriaLabel,
  dayHeatDotClass,
  dayHeatEmoji,
  dayHeatHeaderAccentClass,
  dayHeatLabel,
  dayHeatReason,
  dayHeatShowsReason,
  heatLevelToSeverity,
  resolveDayHeatLevel,
  type DayHeatSource,
} from "./dayHeatDisplay";
import {
  normalizeSeverity,
  severityCalendarCellClass,
  severityEndingClass,
  severityIconEmoji,
  severityLabel,
  severityNetClass,
  severityShowsAlert,
  severityTokens,
  type SeverityLevel,
} from "./severity";

export type ForecastSeverity = DayHeatLevel;

export type ForecastSeveritySource = DayHeatSource;

export function forecastSeverityLevel(day: ForecastSeveritySource): SeverityLevel {
  return heatLevelToSeverity(determineForecastSeverity(day));
}

/** Canonical severity for a forecast day or upcoming group. */
export function determineForecastSeverity(day: ForecastSeveritySource): ForecastSeverity {
  return resolveDayHeatLevel(day);
}

export function forecastSeverityLabel(severity: ForecastSeverity): string {
  return severityLabel(heatLevelToSeverity(severity));
}

export function forecastSeverityIcon(severity: ForecastSeverity): string {
  return severityIconEmoji(heatLevelToSeverity(severity));
}

export function forecastSeverityShowsWarning(severity: ForecastSeverity): boolean {
  return severityShowsAlert(heatLevelToSeverity(severity));
}

export function forecastSeverityReason(day: ForecastSeveritySource): string | null {
  return dayHeatReason(day);
}

export function forecastSeverityAriaLabel(day: ForecastSeveritySource, dateLabel: string): string {
  return dayHeatAriaLabel(day, dateLabel);
}

/** Calendar cell background + border. */
export function forecastSeverityCellClass(severity: ForecastSeverity, hasActivity: boolean): string {
  return severityCalendarCellClass(heatLevelToSeverity(severity), hasActivity);
}

export function forecastSeverityDotClass(severity: ForecastSeverity): string {
  return dayHeatDotClass(severity);
}

export function forecastSeverityHeaderAccent(severity: ForecastSeverity): string {
  return dayHeatHeaderAccentClass(severity);
}

export function forecastSeverityRowTint(severity: ForecastSeverity): string {
  return severityTokens(severity).rowTintClass;
}

/** Net / ending balance emphasis by severity. */
export function forecastSeverityNetClass(severity: ForecastSeverity, net: number): string {
  return severityNetClass(heatLevelToSeverity(severity), net);
}

export function forecastSeverityEndingClass(severity: ForecastSeverity, ending: number): string {
  return severityEndingClass(heatLevelToSeverity(severity), ending);
}

export {
  resolveDayHeatLevel,
  dayHeatLabel,
  dayHeatEmoji,
  dayHeatDotClass,
  dayHeatHeaderAccentClass,
  heatLevelToSeverity,
  normalizeSeverity,
  severityTokens,
};
