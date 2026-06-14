import { isTransferLikeRow, type SourceBadgeInput } from "./sourceBadgeUtils";

export type TransactionStatusIcon = "reconciled" | "manual" | "rule" | "plaid" | "transfer";

export type TransactionStatusInput = SourceBadgeInput & {
  reconciled?: boolean;
  /** Raw Transaction.source from API / timeline (plaid, actual, rule, …). */
  txnSource?: string | null;
  /** MATCHED when a manual row is linked to a bank import. */
  importMatchStatus?: string | null;
  /** Set on ACTUAL rows imported from Plaid (including materialized orphans). */
  plaidTransactionId?: string | null;
  /** Timeline ledger layer: actual | rule | interest. */
  ledgerSource?: string | null;
  ruleId?: number | null;
  transactionId?: number | null;
  readOnly?: boolean;
  /** Linked leg of a two-sided transfer (Transaction API). */
  linkedTransactionId?: number | null;
  /** Destination account on a transfer outflow (Transaction API). */
  hasTransferDestination?: boolean;
};

export function resolveTransactionStatusIcons(
  input: TransactionStatusInput
): TransactionStatusIcon[] {
  const icons: TransactionStatusIcon[] = [];
  if (input.reconciled) icons.push("reconciled");

  if (input.ledgerSource === "interest") {
    return icons;
  }

  const txnSrc = (input.txnSource ?? "").toLowerCase();
  const ledgerSrc = (input.ledgerSource ?? "").toLowerCase();
  const importMatched = (input.importMatchStatus ?? "").toLowerCase() === "matched";
  const fromPlaid = Boolean((input.plaidTransactionId ?? "").trim());

  if (txnSrc === "plaid" || importMatched || fromPlaid) {
    icons.push("plaid");
  } else if (
    input.ruleId != null ||
    txnSrc === "rule" ||
    txnSrc === "one_time" ||
    ledgerSrc === "rule"
  ) {
    icons.push("rule");
  } else if (
    input.hasTransferDestination ||
    input.linkedTransactionId != null ||
    isTransferLikeRow(input)
  ) {
    icons.push("transfer");
  } else if (
    input.transactionId != null ||
    txnSrc === "actual" ||
    ledgerSrc === "actual" ||
    (!txnSrc && !ledgerSrc)
  ) {
    icons.push("manual");
  }

  return icons;
}

export const STATUS_ICON_LABELS: Record<TransactionStatusIcon, string> = {
  reconciled: "Reconciled",
  manual: "Manual Entry",
  rule: "Rule Based Scheduled",
  plaid: "Imported",
  transfer: "Transfer",
};
