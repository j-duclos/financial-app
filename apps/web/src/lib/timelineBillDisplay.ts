import type { BillChecklistStatus } from "@budget-app/shared";
import { billStatusLabel } from "./billsDisplay";
import type { TimelineTxnStatus } from "./timelineCalendarUtils";

/** Calendar drill-down status labels (aligned with bills checklist). */
export function timelineBillStatusLabel(status: BillChecklistStatus | TimelineTxnStatus): string {
  return billStatusLabel(status);
}

export function formatRuleCadenceLabel(frequency: string | undefined): string {
  if (!frequency) return "Recurring";
  const normalized = frequency.replace(/_/g, " ").toLowerCase();
  if (normalized.includes("monthly day")) return "Monthly on scheduled day";
  if (normalized.includes("monthly")) return "Monthly";
  if (normalized.includes("biweekly")) return "Every two weeks";
  if (normalized.includes("weekly")) return "Weekly";
  if (normalized.includes("yearly")) return "Yearly";
  return frequency;
}
