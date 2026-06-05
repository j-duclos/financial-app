import type { BillChecklistItem, Transaction } from "@budget-app/shared";

/** Bank/import rows only — rule-generated PLANNED forecast rows are not match targets. */
export function filterLinkableLedgerTransactions(
  transactions: Transaction[],
  bill: Pick<BillChecklistItem, "rule_id">
): Transaction[] {
  if (bill.rule_id == null) return transactions;
  return transactions.filter(
    (txn) => !(txn.rule_id === bill.rule_id && txn.status === "PLANNED")
  );
}

function normalizePayee(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function payeeTokens(value: string): string[] {
  return normalizePayee(value)
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Score how likely a ledger row matches a bill occurrence (higher = better). */
export function scoreTransactionForBillLink(
  bill: Pick<BillChecklistItem, "name" | "amount" | "due_date">,
  txn: Pick<Transaction, "payee" | "amount" | "date">
): number {
  let score = 0;
  const billName = normalizePayee(bill.name);
  const payee = normalizePayee(txn.payee);
  if (billName && payee) {
    if (billName === payee) score += 100;
    else if (payee.includes(billName) || billName.includes(payee)) score += 75;
    else {
      const billTokens = payeeTokens(bill.name);
      const txnTokens = payeeTokens(txn.payee);
      const overlap = billTokens.filter((t) => txnTokens.some((u) => u.includes(t) || t.includes(u)));
      if (overlap.length > 0) score += 40 + overlap.length * 10;
    }
  }

  const billAmount = Math.abs(parseFloat(bill.amount) || 0);
  const txnAmount = Math.abs(parseFloat(txn.amount) || 0);
  if (billAmount > 0 && txnAmount > 0) {
    const diff = Math.abs(txnAmount - billAmount) / billAmount;
    if (diff <= 0.02) score += 45;
    else if (diff <= 0.1) score += 30;
    else if (diff <= 0.25) score += 10;
  }

  const due = new Date(`${bill.due_date}T12:00:00`);
  const txnDate = new Date(`${txn.date.slice(0, 10)}T12:00:00`);
  const dayDiff = Math.round((txnDate.getTime() - due.getTime()) / 86_400_000);
  const absDays = Math.abs(dayDiff);
  if (absDays <= 2) score += 35;
  else if (absDays <= 5) score += 25;
  else if (absDays <= 10) score += 12;
  else if (absDays <= 21) score += 4;

  return score;
}

export function linkTransactionDateBounds(dueDate: string): { after: string; before: string } {
  const due = new Date(`${dueDate.slice(0, 10)}T12:00:00`);
  const after = new Date(due);
  after.setDate(after.getDate() - 21);
  const before = new Date(due);
  before.setDate(before.getDate() + 7);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { after: fmt(after), before: fmt(before) };
}

export type RankedBillLinkTransaction = {
  txn: Transaction;
  score: number;
};

export function rankTransactionsForBillLink(
  transactions: Transaction[],
  bill: Pick<BillChecklistItem, "name" | "amount" | "due_date" | "rule_id">,
  options?: { minSuggestedScore?: number }
): { suggested: RankedBillLinkTransaction[]; other: RankedBillLinkTransaction[] } {
  const minScore = options?.minSuggestedScore ?? 50;
  const linkable = filterLinkableLedgerTransactions(transactions, bill);
  const ranked = linkable
    .map((txn) => ({ txn, score: scoreTransactionForBillLink(bill, txn) }))
    .sort((a, b) => b.score - a.score || a.txn.date.localeCompare(b.txn.date));

  const suggested = ranked.filter((r) => r.score >= minScore);
  const suggestedIds = new Set(suggested.map((r) => r.txn.id));
  const other = ranked.filter((r) => !suggestedIds.has(r.txn.id));
  return { suggested, other };
}
