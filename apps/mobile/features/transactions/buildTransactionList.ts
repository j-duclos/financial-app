import type { Transaction, TimelineRow } from "@budget-app/shared";
import { isTransferTransaction } from "@/lib/transactionStatus";
import type { TransactionFilters } from "./types";
import {
  isForecastTimelineRow,
  isPendingExpectedTimelineRow,
  isPendingExpectedTransaction,
} from "./pendingSemantics";

export type TransactionListRow =
  | {
      kind: "section";
      id: string;
      title: string;
      rangeLabel?: string;
      rangeKind?: "recent" | "upcoming";
    }
  | {
      kind: "skeleton";
      id: string;
      section: "recent" | "pending" | "upcoming";
    }
  | {
      kind: "upcoming";
      id: string;
      row: TimelineRow;
      runningBalance: string | null;
    }
  | {
      kind: "pending";
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
  const map = new Map<
    number,
    { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }
  >();
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
  timelineRow?: TimelineRow,
  options?: { skipSearch?: boolean; skipCategory?: boolean }
): boolean {
  const amount = Math.abs(parseFloat(txn.amount));
  if (filters.amountMin != null && amount < filters.amountMin) return false;
  if (filters.amountMax != null && amount > filters.amountMax) return false;

  if (filters.flow === "income" && txn.direction !== "INFLOW") return false;
  if (filters.flow === "expense" && txn.direction !== "OUTFLOW") return false;
  if (filters.flow === "transfer" && !isTransferTransaction(txn)) return false;

  const status = (txn.status ?? timelineRow?.status ?? "").toUpperCase();
  const isForecast =
    status === "PLANNED" || (timelineRow?.source === "rule" && !timelineRow.transaction_id);
  if (filters.forecast === "forecast" && !isForecast) return false;
  if (filters.forecast === "posted" && isForecast) return false;

  if (!options?.skipCategory && filters.categoryId != null) {
    const catId = txn.category?.id ?? txn.category_id;
    if (catId !== filters.categoryId) return false;
  }

  if (!options?.skipSearch && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hay = `${txn.payee} ${txn.memo ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

function matchesTimelineClientFilters(row: TimelineRow, filters: TransactionFilters): boolean {
  const amount = Math.abs(parseFloat(row.amount));
  const signed = parseFloat(row.amount);
  if (filters.amountMin != null && amount < filters.amountMin) return false;
  if (filters.amountMax != null && amount > filters.amountMax) return false;
  if (filters.flow === "income" && signed <= 0) return false;
  if (filters.flow === "expense" && signed >= 0) return false;
  if (filters.flow === "transfer") {
    const xfer =
      row.type === "transfer" ||
      (row.category_name ?? "").trim() === "Bank Transfer" ||
      (row.category_name ?? "").trim() === "Credit Card Payment";
    if (!xfer) return false;
  }
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    if (!row.description.toLowerCase().includes(q)) return false;
  }
  if (filters.categoryId != null && row.category_id !== filters.categoryId) return false;
  if (filters.accountId != null && row.account_id !== filters.accountId) return false;
  return true;
}

function runningBalanceForTransaction(
  txn: Transaction,
  balanceMap: Map<
    number,
    { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }
  >,
  showReconciled: boolean
): string | null {
  // Prefer API-attached canonical balance from include_running_balance.
  if (txn.running_balance != null && String(txn.running_balance).trim() !== "") {
    if (showReconciled && txn.reconciled) return null;
    return String(txn.running_balance);
  }
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

function compareTimelineAsc(a: TimelineRow, b: TimelineRow): number {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) return byDate;
  const aid = a.transaction_id ?? 0;
  const bid = b.transaction_id ?? 0;
  if (aid !== bid) return aid - bid;
  return String(a.description).localeCompare(String(b.description));
}

/**
 * Canonical Bal for Pending/Upcoming rows — backend `balance_after` (ledger-section
 * continuation from posted Recent ending). Falls back to running_balance only when
 * the API omitted balance_after (older responses).
 *
 * React Native must not recompute these values from amounts.
 */
export function timelineRowLedgerBalance(row: TimelineRow): string | null {
  if (row.balance_after != null && String(row.balance_after).trim() !== "") {
    return String(row.balance_after);
  }
  if (row.running_balance != null && String(row.running_balance).trim() !== "") {
    return String(row.running_balance);
  }
  return null;
}

/** Last upcoming row's balance for header — prefers balance_after. */
export function forecastBalanceFromUpcoming(upcoming: TimelineRow[]): string | null {
  if (upcoming.length === 0) return null;
  return timelineRowLedgerBalance(upcoming[upcoming.length - 1]);
}

/**
 * Canonical Current balance from unfiltered ledger data (before presentation filters).
 * Matches web pendingSectionEndingBalance → currentBalanceFromLedgerSections priority.
 */
export function currentBalanceFromLedgerData(input: {
  pending: TimelineRow[];
  history: Transaction[];
  today: string;
  showReconciled: boolean;
  /** When false, history may omit older rows — do not use last loaded row as Current. */
  historyComplete: boolean;
}): string | null {
  if (input.pending.length > 0) {
    return timelineRowLedgerBalance(input.pending[input.pending.length - 1]);
  }

  if (!input.historyComplete) {
    return null;
  }

  const canonicalHistory = input.history
    .filter((txn) => !isPendingExpectedTransaction(txn, input.today))
    .filter((txn) => input.showReconciled || !txn.reconciled);

  if (canonicalHistory.length === 0) return null;
  const last = canonicalHistory[canonicalHistory.length - 1];
  if (last.running_balance != null && String(last.running_balance).trim() !== "") {
    return String(last.running_balance);
  }
  return null;
}

export function buildTransactionListRows(input: {
  upcoming: TimelineRow[];
  pending: TimelineRow[];
  history: Transaction[];
  balanceMap: Map<
    number,
    { runningBalance: string; reconciled?: boolean; reconciledBalance?: string | null }
  >;
  filters: TransactionFilters;
  today: string;
  /** When recent history is still loading, emit a skeleton section. */
  recentLoading?: boolean;
  /** When timeline (pending/upcoming) is still loading. */
  timelineLoading?: boolean;
  /** Search mode: do not force ledger ascending presentation labels. */
  isSearchMode?: boolean;
  /** When true, search/category were applied server-side on history — skip client re-filter. */
  serverFilteredHistory?: boolean;
  recentRangeLabel?: string;
  upcomingRangeLabel?: string;
}): TransactionListRow[] {
  const rows: TransactionListRow[] = [];
  const showRecent = input.filters.forecast !== "forecast";
  const showPendingUpcoming = input.filters.forecast !== "posted";

  // --- Recent (posted / historical) — API already returns ascending ledger order ---
  if (showRecent) {
    if (input.recentLoading && input.history.length === 0) {
      rows.push({
        kind: "section",
        id: "section-recent",
        title: input.isSearchMode ? "Search results" : "Recent",
        rangeLabel: input.isSearchMode ? undefined : input.recentRangeLabel,
        rangeKind: input.isSearchMode ? undefined : "recent",
      });
      rows.push({ kind: "skeleton", id: "skeleton-recent", section: "recent" });
    } else {
      let filteredHistory = input.history
        .filter((txn) => !isPendingExpectedTransaction(txn, input.today))
        .filter((txn) => input.filters.showReconciled || !txn.reconciled)
        .filter((txn) =>
          matchesClientFilters(txn, input.filters, undefined, {
            skipSearch: input.serverFilteredHistory && input.isSearchMode,
            skipCategory: input.serverFilteredHistory && input.filters.categoryId != null,
          })
        );

      if (input.isSearchMode) {
        filteredHistory = filteredHistory.slice().sort((a, b) => {
          const byDate = b.date.localeCompare(a.date);
          if (byDate !== 0) return byDate;
          return b.id - a.id;
        });
      }

      if (filteredHistory.length > 0 || input.recentRangeLabel) {
        rows.push({
          kind: "section",
          id: "section-recent",
          title: input.isSearchMode ? "Search results" : "Recent",
          rangeLabel: input.isSearchMode ? undefined : input.recentRangeLabel,
          rangeKind: input.isSearchMode ? undefined : "recent",
        });
        for (const txn of filteredHistory) {
          const bal = runningBalanceForTransaction(
            txn,
            input.balanceMap,
            input.filters.showReconciled
          );
          rows.push({
            kind: "history",
            id: `history-${txn.id}`,
            txn,
            runningBalance: bal,
          });
        }
      }
    }
  }

  // --- Pending then Upcoming: Bal from backend balance_after only ---
  if (showPendingUpcoming) {
    if (input.timelineLoading) {
      rows.push({ kind: "section", id: "section-pending", title: "Pending" });
      rows.push({ kind: "skeleton", id: "skeleton-pending", section: "pending" });
      rows.push({
        kind: "section",
        id: "section-upcoming",
        title: "Upcoming",
        rangeLabel: input.upcomingRangeLabel,
        rangeKind: "upcoming",
      });
      rows.push({ kind: "skeleton", id: "skeleton-upcoming", section: "upcoming" });
    } else {
      const pending = input.pending
        .filter((row) => matchesTimelineClientFilters(row, input.filters))
        .slice()
        .sort(compareTimelineAsc);
      const upcoming = input.upcoming
        .filter((row) => isForecastTimelineRow(row, input.today))
        .filter((row) => matchesTimelineClientFilters(row, input.filters))
        .slice()
        .sort(compareTimelineAsc);

      if (pending.length > 0) {
        rows.push({ kind: "section", id: "section-pending", title: "Pending" });
        for (const row of pending) {
          rows.push({
            kind: "pending",
            id: `pending-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`,
            row,
            runningBalance: timelineRowLedgerBalance(row),
          });
        }
      }

      if (upcoming.length > 0 || input.upcomingRangeLabel) {
        rows.push({
          kind: "section",
          id: "section-upcoming",
          title: "Upcoming",
          rangeLabel: input.upcomingRangeLabel,
          rangeKind: "upcoming",
        });
        for (const row of upcoming) {
          rows.push({
            kind: "upcoming",
            id: `upcoming-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`,
            row,
            runningBalance: timelineRowLedgerBalance(row),
          });
        }
      }
    }
  }

  return rows;
}

export function hasActiveClientOnlyFilters(filters: TransactionFilters): boolean {
  return (
    filters.flow !== "all" ||
    filters.forecast !== "all" ||
    filters.amountMin != null ||
    filters.amountMax != null
  );
}

export function partitionTimelineForLedger(
  timeline: TimelineRow[],
  today: string,
  accountId: number | null
): { pending: TimelineRow[]; upcoming: TimelineRow[] } {
  const scoped = timeline.filter(
    (row) => accountId == null || row.account_id === accountId
  );
  const pending = scoped
    .filter((row) => isPendingExpectedTimelineRow(row, today))
    .slice()
    .sort(compareTimelineAsc);
  const upcoming = scoped
    .filter((row) => isForecastTimelineRow(row, today))
    .slice()
    .sort(compareTimelineAsc);
  return { pending, upcoming };
}
