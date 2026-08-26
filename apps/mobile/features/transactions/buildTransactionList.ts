import type { Transaction, TimelineRow } from "@budget-app/shared";
import { isTransferTransaction } from "@/lib/transactionStatus";
import type { TransactionFilters } from "./types";

export type TransactionListRow =
  | {
      kind: "section";
      id: string;
      title: string;
    }
  | {
      kind: "upcoming";
      id: string;
      row: TimelineRow;
      runningBalance: string | null;
    }
  | {
      kind: "history";
      id: string;
      txn: Transaction;
      runningBalance: string | null;
    };

export function indexTimelineBalances(
  timeline: TimelineRow[] | undefined
): Map<number, { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }> {
  const map = new Map<number, { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }>();
  if (!timeline?.length) return map;
  for (const row of timeline) {
    const id = row.transaction_id;
    if (id == null) continue;
    map.set(id, {
      runningBalance: row.running_balance,
      reconciled: row.reconciled,
      reconciledBalance:
        row.reconciled_balance != null ? String(row.reconciled_balance) : null,
    });
  }
  return map;
}

function matchesClientFilters(
  txn: Transaction,
  filters: TransactionFilters,
  timelineRow?: TimelineRow
): boolean {
  const amount = Math.abs(parseFloat(txn.amount));
  if (filters.amountMin != null && amount < filters.amountMin) return false;
  if (filters.amountMax != null && amount > filters.amountMax) return false;

  if (filters.flow === "income" && txn.direction !== "INFLOW") return false;
  if (filters.flow === "expense" && txn.direction !== "OUTFLOW") return false;
  if (filters.flow === "transfer" && !isTransferTransaction(txn)) return false;

  if (filters.cleared === "cleared" && !txn.cleared) return false;
  if (filters.cleared === "pending" && txn.cleared) return false;

  const status = (txn.status ?? timelineRow?.status ?? "").toUpperCase();
  const isForecast = status === "PLANNED" || (timelineRow?.source === "rule" && !timelineRow.transaction_id);
  if (filters.forecast === "forecast" && !isForecast) return false;
  if (filters.forecast === "posted" && isForecast) return false;

  return true;
}

function runningBalanceForTransaction(
  txn: Transaction,
  balanceMap: Map<number, { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }>,
  showReconciled: boolean
): string | null {
  const entry = balanceMap.get(txn.id);
  if (!entry) return null;
  if (showReconciled && txn.reconciled && entry.reconciledBalance != null) {
    return null;
  }
  if (showReconciled && txn.reconciled) {
    return null;
  }
  return entry.runningBalance ?? null;
}

export function buildTransactionListRows(input: {
  upcoming: TimelineRow[];
  history: Transaction[];
  balanceMap: Map<number, { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }>;
  filters: TransactionFilters;
  today: string;
}): TransactionListRow[] {
  const rows: TransactionListRow[] = [];
  const upcoming = input.upcoming
    .filter((row) => row.date >= input.today)
    .filter((row) => {
      if (input.filters.accountId != null && row.account_id !== input.filters.accountId) return false;
      if (input.filters.categoryId != null && row.category_id !== input.filters.categoryId) return false;
      return true;
    });

  const filteredUpcoming = upcoming.filter((row) => {
    const amount = Math.abs(parseFloat(row.amount));
    if (input.filters.amountMin != null && amount < input.filters.amountMin) return false;
    if (input.filters.amountMax != null && amount > input.filters.amountMax) return false;
    if (input.filters.search.trim()) {
      const q = input.filters.search.trim().toLowerCase();
      if (!row.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (filteredUpcoming.length > 0) {
    rows.push({ kind: "section", id: "section-upcoming", title: "Upcoming" });
    for (const row of filteredUpcoming) {
      rows.push({
        kind: "upcoming",
        id: `upcoming-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`,
        row,
        runningBalance: row.running_balance ?? null,
      });
    }
  }

  const filteredHistory = input.history.filter((txn) => matchesClientFilters(txn, input.filters));

  if (filteredHistory.length > 0) {
    rows.push({ kind: "section", id: "section-history", title: "History" });
    for (const txn of filteredHistory) {
      rows.push({
        kind: "history",
        id: `history-${txn.id}`,
        txn,
        runningBalance: runningBalanceForTransaction(txn, input.balanceMap, input.filters.showReconciled),
      });
    }
  }

  return rows;
}

export function hasActiveClientOnlyFilters(filters: TransactionFilters): boolean {
  return (
    filters.flow !== "all" ||
    filters.cleared !== "all" ||
    filters.forecast !== "all" ||
    filters.amountMin != null ||
    filters.amountMax != null
  );
}
