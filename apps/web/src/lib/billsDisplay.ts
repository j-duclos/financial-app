import type { BillChecklistItem, BillChecklistStatus } from "@budget-app/shared";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatBillMonthTitle(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return monthKey;
  return `${MONTH_NAMES[m - 1].toUpperCase()} ${y}`;
}

export function formatBillMonthSection(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function billStatusLabel(status: BillChecklistStatus): string {
  switch (status) {
    case "projected":
      return "Scheduled";
    case "due_soon":
      return "Due soon";
    case "paid":
      return "Paid";
    case "reconciled":
      return "Reconciled";
    case "late":
    case "missed":
      return "Late";
    case "likely_forgotten":
      return "Likely forgotten";
    case "skipped":
      return "Skipped";
    default:
      return status;
  }
}

export function billStatusIcon(status: BillChecklistStatus): string {
  switch (status) {
    case "paid":
    case "reconciled":
      return "✓";
    case "late":
    case "missed":
      return "⚠";
    case "likely_forgotten":
      return "⚠";
    case "due_soon":
      return "○";
    default:
      return "○";
  }
}

/** Row styling per spec: red border late, amber due soon, green paid, gray projected. */
export function billRowClass(status: BillChecklistStatus): string {
  switch (status) {
    case "late":
    case "missed":
      return "border-l-4 border-l-red-500 bg-red-50/80";
    case "likely_forgotten":
      return "border-l-4 border-l-amber-500 bg-amber-50/60";
    case "due_soon":
      return "border-l-4 border-l-amber-400 bg-amber-50/40";
    case "paid":
    case "reconciled":
      return "border-l-4 border-l-emerald-500 bg-emerald-50/30";
    case "skipped":
      return "border-l-4 border-l-gray-200 bg-gray-50 opacity-60";
    case "projected":
      return "border-l-4 border-l-blue-300 bg-blue-50/40";
    default:
      return "border-l-4 border-l-gray-200 bg-white";
  }
}

export function billStatusBadgeClass(status: BillChecklistStatus): string {
  switch (status) {
    case "projected":
      return "bg-blue-50 text-blue-800";
    case "due_soon":
      return "bg-amber-100 text-amber-900";
    case "paid":
      return "bg-green-100 text-green-800";
    case "reconciled":
      return "bg-green-100 text-green-900 ring-1 ring-green-300";
    case "late":
    case "missed":
      return "bg-red-100 text-red-800";
    case "likely_forgotten":
      return "bg-orange-100 text-orange-900";
    case "skipped":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

import { formatDateDisplay } from "./dateDisplay";

export function formatDueDateShort(isoDate: string): string {
  return formatDateDisplay(isoDate);
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function confidenceLabel(level: string | undefined): string {
  if (level === "high") return "High confidence paid";
  if (level === "medium") return "Medium confidence";
  if (level === "low") return "Low confidence detected";
  return "";
}
