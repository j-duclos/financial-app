import type { TimelineCalendarTransaction } from "@budget-app/shared";
import type { TransactionRowDestination } from "@/features/transactions/transactionRowNavigation";
import {
  transactionRowDetailPath,
  transactionRowEditPath,
} from "@/features/transactions/transactionRowNavigation";
import type { CalendarDateState } from "./calendarPresentation";

export function calendarEventStatusLabel(
  txn: TimelineCalendarTransaction,
  dateState: CalendarDateState
): string | null {
  const status = txn.status?.toUpperCase();
  if (status === "CLEARED" || status === "RECONCILED") return "Posted";
  if (status === "PENDING") return "Pending";
  if (txn.is_transfer) return "Transfer";
  if ((status === "PLANNED" || txn.kind === "projected") && dateState !== "past") return "Forecast";
  if (txn.rule_id && !txn.transaction_id) return "Recurring";
  if (txn.transaction_id != null && dateState === "past") return "Posted";
  return null;
}

function isBankImportedCalendarTxn(txn: TimelineCalendarTransaction): boolean {
  const src = (txn.source ?? "").toUpperCase();
  return src === "PLAID";
}

function isRuleGeneratedCalendarTxn(txn: TimelineCalendarTransaction): boolean {
  const src = (txn.source ?? "").toUpperCase();
  return src === "RULE" || txn.rule_id != null;
}

/** Manual editable calendar events open Edit directly (Transactions ledger parity). */
export function prefersDirectEditFromCalendar(txn: TimelineCalendarTransaction): boolean {
  if (txn.reconciled) return false;
  if (isBankImportedCalendarTxn(txn)) return false;
  if (isRuleGeneratedCalendarTxn(txn)) return false;
  if (txn.is_transfer) return false;

  const src = (txn.source ?? "").toUpperCase();
  if (src === "INTEREST") return false;

  const status = (txn.status ?? "").toUpperCase();
  if (status === "PLANNED") {
    return src === "ONE_TIME";
  }

  if (txn.transaction_id != null) {
    return src === "ONE_TIME" || src === "ACTUAL" || src === "";
  }

  return false;
}

export function getCalendarEventDestination(
  txn: TimelineCalendarTransaction
): TransactionRowDestination | null {
  if (txn.transaction_id == null) return null;
  if (prefersDirectEditFromCalendar(txn)) {
    return { type: "edit", transactionId: txn.transaction_id };
  }
  return { type: "detail", transactionId: txn.transaction_id };
}

export function navigateToCalendarEventDestination(
  router: { push: (path: string) => void },
  destination: TransactionRowDestination
): void {
  router.push(
    destination.type === "edit"
      ? transactionRowEditPath(destination.transactionId)
      : transactionRowDetailPath(destination.transactionId)
  );
}
