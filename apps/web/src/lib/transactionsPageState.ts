import type { TimeFilter } from "../components/transactions/transactionsLedgerUtils";

const ACCOUNT_ID_KEY = "budget-app:transactions:accountId";
const TIME_FILTER_KEY = "budget-app:transactions:timeFilter";

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
