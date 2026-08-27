import type { Transaction, TimelineRow } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";

/** Build a timeline row shape for import-match detection from a transaction detail record. */
export function transactionToMatchingTimelineRow(txn: Transaction): TimelineRow {
  const accountId = txn.account_id ?? txn.account?.id ?? 0;
  const direction = (txn.direction ?? "").toUpperCase();
  return {
    date: txn.date,
    description: txn.payee,
    account_id: accountId,
    account_name: getEffectiveDisplayName(txn.account),
    category_id: txn.category?.id ?? txn.category_id ?? null,
    category_name: txn.category?.name ?? null,
    amount: txn.amount,
    type: direction === "INFLOW" ? "income" : "expense",
    status: txn.status ?? "PLANNED",
    source:
      (txn.source ?? "").toUpperCase() === "RULE"
        ? "rule"
        : txn.rule_id != null
          ? "rule"
          : "actual",
    rule_id: txn.rule_id ?? null,
    transaction_id: txn.id,
    running_balance: txn.running_balance ?? "0.00",
    txn_source: txn.source ?? null,
    import_match_status: txn.import_match_status ?? null,
    plaid_transaction_id: txn.plaid_transaction_id ?? null,
  };
}
