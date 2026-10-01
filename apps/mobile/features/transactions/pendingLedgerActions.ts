import type { TimelineRow } from "@budget-app/shared";
import {
  isImportMatchStatusMatched,
  MATCH_IMPORTED_TRANSACTION_LABEL,
} from "@budget-app/shared";
import { resolveRuleOccurrence } from "@budget-app/api-client";
import { isPlannedScheduledTimelineRow } from "./pendingSemantics";
import { transactionRowEditPath } from "./transactionRowNavigation";

export type PendingRowActionKind = "matchImport" | "skip" | "edit";

export type PendingRowAction = {
  kind: PendingRowActionKind;
  label: string;
};

export function pendingRowHasActions(row: TimelineRow): boolean {
  if (row.reconciled) return false;
  if (row.source === "interest") return false;
  if (!isPlannedScheduledTimelineRow(row)) return false;
  if (isImportMatchStatusMatched(row.import_match_status)) return false;
  return row.transaction_id != null || row.rule_id != null;
}

export function pendingRowCanMatchImport(row: TimelineRow): boolean {
  return pendingRowHasActions(row);
}

export function getPendingRowActions(row: TimelineRow): PendingRowAction[] {
  if (!pendingRowHasActions(row)) return [];
  return [
    { kind: "matchImport", label: MATCH_IMPORTED_TRANSACTION_LABEL },
    { kind: "skip", label: "Skip" },
    { kind: "edit", label: "Edit" },
  ];
}

export function pendingSkipConfirmationMessage(row: TimelineRow): string {
  if (row.source === "rule" || row.rule_id != null) {
    return (
      "This scheduled payment will be removed from the forecast. " +
      "Future occurrences of the recurring rule will continue."
    );
  }
  return "This scheduled payment will be removed from the forecast.";
}

export async function resolvePendingRowTransactionId(row: TimelineRow): Promise<number | null> {
  if (row.transaction_id != null) return row.transaction_id;
  if (row.rule_id == null) return null;
  const accountId = Number(row.account_id);
  if (!Number.isFinite(accountId)) return null;
  const resolved = await resolveRuleOccurrence({
    rule_id: row.rule_id,
    account_id: accountId,
    occurrence_date: row.date,
  });
  return resolved.transaction_id ?? null;
}

export function pendingRowEditHref(transactionId: number) {
  return transactionRowEditPath(transactionId);
}
