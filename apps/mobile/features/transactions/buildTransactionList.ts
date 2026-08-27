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
  const isForecast =
    status === "PLANNED" || (timelineRow?.source === "rule" && !timelineRow.transaction_id);
  if (filters.forecast === "forecast" && !isForecast) return false;
  if (filters.forecast === "posted" && isForecast) return false;

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const hay = `${txn.payee} ${txn.memo ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }

  return true;
}

function matchesTimelineClientFilters(row: TimelineRow, filters: TransactionFilters): boolean {
  const amount = Math.abs(parseFloat(row.amount));
  if (filters.amountMin != null && amount < filters.amountMin) return false;
  if (filters.amountMax != null && amount > filters.amountMax) return false;
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

function timelineRowFlowDirection(row: TimelineRow): "INFLOW" | "OUTFLOW" | null {
  const t = (row.type || "").toUpperCase();
  if (t === "OUTFLOW" || t === "EXPENSE") return "OUTFLOW";
  if (t === "INFLOW" || t === "INCOME") return "INFLOW";
  return null;
}

/** Signed amount for sectioned ledger continuation (matches web). */
export function signedTimelineLedgerAmount(row: TimelineRow): number {
  const raw = parseFloat(row.amount);
  if (Number.isNaN(raw)) return 0;
  const flow = timelineRowFlowDirection(row);
  if (flow === "OUTFLOW") return -Math.abs(raw);
  if (flow === "INFLOW") return Math.abs(raw);
  return raw;
}

/**
 * Continue the ledger balance through pending then upcoming.
 * Anchor = end of posted Recent (last history running_balance).
 * Do NOT use timeline running_balance for these sections — those are chronological
 * full-timeline values and break the Recent → Pending → Upcoming section layout.
 */
export function continueLedgerBalances(input: {
  postedEndingBalance: number | null;
  pending: TimelineRow[];
  upcoming: TimelineRow[];
}): { pendingBalances: string[]; upcomingBalances: string[]; endingBalance: number | null } {
  let running = input.postedEndingBalance;
  const pendingBalances: string[] = [];
  const upcomingBalances: string[] = [];

  for (const row of input.pending) {
    if (running == null || !Number.isFinite(running)) {
      pendingBalances.push(row.running_balance ?? "");
      continue;
    }
    running = running + signedTimelineLedgerAmount(row);
    pendingBalances.push(running.toFixed(2));
  }

  for (const row of input.upcoming) {
    if (running == null || !Number.isFinite(running)) {
      upcomingBalances.push(row.running_balance ?? "");
      continue;
    }
    running = running + signedTimelineLedgerAmount(row);
    upcomingBalances.push(running.toFixed(2));
  }

  return {
    pendingBalances,
    upcomingBalances,
    endingBalance: running != null && Number.isFinite(running) ? running : null,
  };
}

function parseBalance(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** Last upcoming row's balance for header — prefer section-continued value when provided. */
export function forecastBalanceFromUpcoming(upcoming: TimelineRow[]): string | null {
  if (upcoming.length === 0) return null;
  const last = upcoming[upcoming.length - 1];
  return last.running_balance ?? null;
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
  recentRangeLabel?: string;
  upcomingRangeLabel?: string;
  /**
   * Posted ledger anchor when Recent is empty — account current/posted balance.
   * Pending/Upcoming continue from end of Recent (or this anchor).
   */
  postedLedgerAnchor?: number | null;
}): TransactionListRow[] {
  const rows: TransactionListRow[] = [];
  const showRecent = input.filters.forecast !== "forecast";
  const showPendingUpcoming = input.filters.forecast !== "posted" && !input.isSearchMode;

  // --- Recent (posted / historical) — API already returns ascending ledger order ---
  let postedEndingBalance: number | null = null;

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
      const filteredHistory = input.history
        .filter((txn) => !isPendingExpectedTransaction(txn, input.today))
        .filter((txn) => matchesClientFilters(txn, input.filters));

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
          const parsed = parseBalance(bal);
          if (parsed != null) postedEndingBalance = parsed;
        }
      }
    }
  }

  // Fallback anchor when Recent is empty: use account posted balance if provided.
  if (postedEndingBalance == null && input.postedLedgerAnchor != null) {
    postedEndingBalance = input.postedLedgerAnchor;
  }

  // --- Pending then Upcoming: ONE continuous chain from end of Recent ---
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

      const continued = continueLedgerBalances({
        postedEndingBalance,
        pending,
        upcoming,
      });

      if (pending.length > 0) {
        rows.push({ kind: "section", id: "section-pending", title: "Pending" });
        pending.forEach((row, i) => {
          rows.push({
            kind: "pending",
            id: `pending-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`,
            row,
            runningBalance: continued.pendingBalances[i] || null,
          });
        });
      }

      if (upcoming.length > 0 || input.upcomingRangeLabel) {
        rows.push({
          kind: "section",
          id: "section-upcoming",
          title: "Upcoming",
          rangeLabel: input.upcomingRangeLabel,
          rangeKind: "upcoming",
        });
        upcoming.forEach((row, i) => {
          rows.push({
            kind: "upcoming",
            id: `upcoming-${row.transaction_id ?? row.date}-${row.description}-${row.amount}`,
            row,
            runningBalance: continued.upcomingBalances[i] || null,
          });
        });
      }
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
