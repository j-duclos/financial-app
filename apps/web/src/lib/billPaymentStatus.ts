import type { BillChecklistItem, BillChecklistStatus, TimelineCalendarTransaction } from "@budget-app/shared";
import { todayIsoDate } from "./timelineCalendarUtils";

export const DUE_SOON_DAYS = 3;

export type BillPaymentStatus = BillChecklistStatus;

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function daysUntilDue(dueDate: string, today: string): number {
  const due = new Date(`${dueDate}T12:00:00`);
  const now = new Date(`${today}T12:00:00`);
  return Math.round((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function isProjectedLedgerRow(txn: TimelineCalendarTransaction): boolean {
  const source = normalizeStatus(txn.source);
  const kind = normalizeStatus(txn.kind);
  const ledgerStatus = normalizeStatus(txn.status);

  if (txn.transaction_id != null && source === "actual") return false;
  if (txn.transaction_id != null && typeof txn.id === "number") return false;

  if (source === "rule" || source.includes("rule")) return true;
  if (ledgerStatus === "planned" || ledgerStatus === "projected") return true;
  if (typeof txn.id === "string" && /^r-\d+-/.test(txn.id) && txn.transaction_id == null) return true;
  if (txn.rule_id != null && txn.transaction_id == null) return true;
  if (kind.includes("project")) return true;
  return false;
}

function isReconciledTxn(txn: TimelineCalendarTransaction): boolean {
  if (txn.reconciled) return true;
  const ledgerStatus = normalizeStatus(txn.status);
  return ledgerStatus === "reconciled" || normalizeStatus(txn.source).includes("reconcile");
}

function isPaidActualTxn(txn: TimelineCalendarTransaction, dueDate: string, today: string): boolean {
  if (dueDate > today) return false;
  if (isProjectedLedgerRow(txn)) return false;

  const ledgerStatus = normalizeStatus(txn.status);
  if (ledgerStatus === "planned" || ledgerStatus === "projected") return false;
  if (isReconciledTxn(txn)) return false;

  if (!txn.transaction_id && typeof txn.id !== "number") return false;

  if (ledgerStatus === "cleared") return true;
  if (txn.cleared) return true;

  const source = normalizeStatus(txn.source);
  if (source === "plaid") return true;
  if (source === "actual" && txn.transaction_id != null) return true;
  if (source === "interest") return false;

  return false;
}

function mapOccurrenceStatus(status: BillChecklistStatus): BillPaymentStatus {
  if (status === "missed" || status === "likely_forgotten") return "late";
  return status;
}

/**
 * Resolve bill payment status for calendar rows and bill detail.
 * Prefer checklist occurrence status from the bills API when available.
 */
export function resolveBillPaymentStatus(params: {
  dueDate: string;
  txn?: TimelineCalendarTransaction | null;
  occurrence?: BillChecklistItem | null;
  todayIso?: string;
}): BillPaymentStatus {
  const { dueDate, txn, occurrence } = params;
  const today = params.todayIso ?? todayIsoDate();

  if (occurrence?.skipped) return "skipped";
  if (occurrence?.status) return mapOccurrenceStatus(occurrence.status);

  if (txn) {
    if (normalizeStatus(txn.source).includes("skip") || occurrence?.skipped) return "skipped";
    if (isReconciledTxn(txn)) return "reconciled";
    if (isPaidActualTxn(txn, dueDate, today)) return "paid";

    if (isProjectedLedgerRow(txn) || !txn.transaction_id) {
      if (dueDate < today) return "late";
      const days = daysUntilDue(dueDate, today);
      if (days >= 0 && days <= DUE_SOON_DAYS) return "due_soon";
      return "projected";
    }

    if (dueDate < today) return "late";
    const days = daysUntilDue(dueDate, today);
    if (days >= 0 && days <= DUE_SOON_DAYS) return "due_soon";
    return "projected";
  }

  if (dueDate < today) return "late";
  const days = daysUntilDue(dueDate, today);
  if (days >= 0 && days <= DUE_SOON_DAYS) return "due_soon";
  return "projected";
}

/** Payment history row label (planned vs actual). */
export function paymentHistoryStatusLabel(
  payment: { date: string; status: string; reconciled?: boolean },
  todayIso?: string
): string {
  const today = todayIso ?? todayIsoDate();
  const ledgerStatus = normalizeStatus(payment.status);

  if (payment.reconciled || ledgerStatus === "reconciled") return "Reconciled";
  if (ledgerStatus === "planned" || ledgerStatus === "projected") return "Planned";
  if (payment.date > today) return "Planned";

  if (
    ledgerStatus === "cleared" ||
    ledgerStatus === "paid" ||
    ledgerStatus.includes("clear") ||
    ledgerStatus.includes("paid")
  ) {
    return "Paid";
  }

  if (payment.date < today) return "Late";
  return "Planned";
}
