import type { DayRecoveryInfo } from "@budget-app/shared";
import { formatShortDate } from "./dayBiggestDrivers";

export type DayRecoverySource = DayRecoveryInfo;

export function hasRecoveryInfo(day: DayRecoverySource): boolean {
  return Boolean(day.recovery_date && day.recovery_days_until != null);
}

export function formatRecoveryBanner(day: DayRecoverySource): string | null {
  if (!hasRecoveryInfo(day)) return null;
  const dateLabel = formatShortDate(day.recovery_date!);
  const days = day.recovery_days_until!;
  const daysLabel = days === 1 ? "1 day" : `${days} days`;
  if (day.recovery_description) {
    return `Recovery expected ${dateLabel} (${daysLabel}) — ${day.recovery_description}`;
  }
  return `Recovery expected ${dateLabel} (${daysLabel})`;
}

export function formatRecoveryChip(day: DayRecoverySource): string | null {
  if (!hasRecoveryInfo(day)) return null;
  const dateLabel = formatShortDate(day.recovery_date!);
  if (day.recovery_is_payroll) {
    return `Payroll ${dateLabel}`;
  }
  return `Recovers ${dateLabel}`;
}

export function formatRecoveryDaysUntil(day: DayRecoverySource): string | null {
  if (!hasRecoveryInfo(day)) return null;
  const d = day.recovery_days_until!;
  if (d === 0) return "Recovers today";
  if (d === 1) return "1 day until recovery";
  return `${d} days until recovery`;
}

export function recoveryChipClass(day: DayRecoverySource): string {
  if (day.recovery_is_payroll) {
    return "bg-emerald-100 text-emerald-800 border-emerald-200";
  }
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}
