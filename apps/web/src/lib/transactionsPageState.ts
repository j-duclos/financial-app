import type { TimeFilter } from "../components/transactions/transactionsLedgerUtils";
import type { TransactionKind } from "../components/transactions/transactionKindUtils";

const ACCOUNT_ID_KEY = "budget-app:transactions:accountId";
const TIME_FILTER_KEY = "budget-app:transactions:timeFilter";
const KIND_FILTER_KEY = "budget-app:transactions:kindFilter";
const AMOUNT_MIN_KEY = "budget-app:transactions:amountMin";
const AMOUNT_MAX_KEY = "budget-app:transactions:amountMax";

const KIND_FILTERS: TransactionKind[] = ["Expense", "Income", "Transfer", "Card Payment"];

const TIME_FILTERS: TimeFilter[] = ["14d", "1m", "3m", "6m", "12m", "18m", "24m", "36m"];

export function loadStoredTransactionsAccountId(): number | "" {
  if (typeof window === "undefined") return "";
  try {
    const raw = sessionStorage.getItem(ACCOUNT_ID_KEY);
    if (!raw) return "";
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : "";
  } catch {
    return "";
  }
}

export function saveStoredTransactionsAccountId(accountId: number | ""): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof accountId === "number" && accountId > 0) {
      sessionStorage.setItem(ACCOUNT_ID_KEY, String(accountId));
    } else {
      sessionStorage.removeItem(ACCOUNT_ID_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadStoredTransactionsTimeFilter(): TimeFilter {
  if (typeof window === "undefined") return "3m";
  try {
    const raw = sessionStorage.getItem(TIME_FILTER_KEY);
    if (raw && TIME_FILTERS.includes(raw as TimeFilter)) {
      return raw as TimeFilter;
    }
  } catch {
    /* ignore */
  }
  return "3m";
}

export function saveStoredTransactionsTimeFilter(timeFilter: TimeFilter): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(TIME_FILTER_KEY, timeFilter);
  } catch {
    /* ignore */
  }
}

export function loadStoredTransactionsKindFilter(): TransactionKind | "" {
  if (typeof window === "undefined") return "";
  try {
    const raw = sessionStorage.getItem(KIND_FILTER_KEY);
    if (raw && KIND_FILTERS.includes(raw as TransactionKind)) {
      return raw as TransactionKind;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function saveStoredTransactionsKindFilter(kind: TransactionKind | ""): void {
  if (typeof window === "undefined") return;
  try {
    if (kind) {
      sessionStorage.setItem(KIND_FILTER_KEY, kind);
    } else {
      sessionStorage.removeItem(KIND_FILTER_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function loadStoredTransactionsAmountMin(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(AMOUNT_MIN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function loadStoredTransactionsAmountMax(): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(AMOUNT_MAX_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveStoredTransactionsAmountRange(min: string, max: string): void {
  if (typeof window === "undefined") return;
  try {
    if (min.trim()) {
      sessionStorage.setItem(AMOUNT_MIN_KEY, min);
    } else {
      sessionStorage.removeItem(AMOUNT_MIN_KEY);
    }
    if (max.trim()) {
      sessionStorage.setItem(AMOUNT_MAX_KEY, max);
    } else {
      sessionStorage.removeItem(AMOUNT_MAX_KEY);
    }
  } catch {
    /* ignore */
  }
}
