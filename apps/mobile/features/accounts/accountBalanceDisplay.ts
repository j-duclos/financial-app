import type { Account } from "@budget-app/shared";

/**
 * Canonical balance label semantics (Accounts list + Account Detail).
 *
 * | Label            | Field / meaning                                              |
 * |------------------|--------------------------------------------------------------|
 * | Current          | Posted / before-pending: `forecast_summary.current_balance`  |
 * |                  | when enrichment is present; else ledger EOD fallback         |
 * | After pending    | Ledger EOD (`available_balance`/`balance`) when it differs   |
 * |                  | from Current (unresolved same-day PLANNED still on ledger)   |
 * | Safe to spend    | Backend `available_to_spend` (forecast)                      |
 * | Forecast balance | `projected_balance_30_days` — never labeled Current          |
 * | Bank available   | Not a separate RN Accounts field; cash `available_balance`   |
 * |                  | is app ledger EOD, not a second pending adjustment           |
 *
 * Credit uses Owed / Available credit — never cash Current labels.
 *
 * Transactions ledger header "Current Balance" (pending-section ending) is a
 * separate product invariant — see workspace rule / ForecastSummaryBar.
 *
 * No local financial math — only field selection and labeling.
 */

export type CashBalanceDisplay = {
  kind: "cash";
  /** Primary hero amount. */
  primary: string | null;
  primaryLabel: "Current balance";
  afterPending: string | null;
  safeToSpend: string | null;
};

export type CreditBalanceDisplay = {
  kind: "credit";
  owed: string | null;
  availableCredit: string | null;
  creditLimit: string | null;
  utilizationPercent: string | null;
  safeToSpend: string | null;
  forecastOwed: string | null;
};

export type AccountBalanceDisplay = CashBalanceDisplay | CreditBalanceDisplay;

export type ListPrimaryBalance = {
  label: "Current" | "Owed";
  amount: string | null;
  /** Ledger EOD when it differs from Current (cash only). */
  afterPending: string | null;
};

function parseMoney(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? String(raw) : null;
}

function amountsDiffer(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return false;
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) >= 0.005;
}

function forecastCurrentBalance(account: Account): string | null {
  const summary = account.forecast_summary;
  if (summary && typeof summary === "object") {
    return parseMoney(summary.current_balance);
  }
  return null;
}

/** Ledger end-of-day from `?balance=true` (may include unresolved same-day pending). */
export function resolveLedgerEndOfDayBalance(account: Account): string | null {
  if (account.account_type === "CREDIT") {
    return parseMoney(account.balance_owed ?? account.current_balance);
  }
  return parseMoney(account.available_balance ?? account.balance);
}

/**
 * Posted / before-pending current when forecast enrichment is present;
 * otherwise the canonical list ledger balance (same fallback as Detail).
 */
export function resolvePostedCurrentBalance(account: Account): string | null {
  if (account.account_type === "CREDIT") {
    return parseMoney(account.balance_owed ?? account.current_balance);
  }
  return forecastCurrentBalance(account) ?? resolveLedgerEndOfDayBalance(account);
}

/** After-pending (ledger EOD) only when it differs from posted Current. */
export function resolveAfterPendingBalance(account: Account): string | null {
  if (account.account_type === "CREDIT") return null;
  const current = resolvePostedCurrentBalance(account);
  const ledger = resolveLedgerEndOfDayBalance(account);
  return amountsDiffer(current, ledger) && ledger != null ? ledger : null;
}

/** Build labeled balance card fields for Account Detail. */
export function resolveAccountBalanceDisplay(account: Account): AccountBalanceDisplay {
  if (account.account_type === "CREDIT") {
    return {
      kind: "credit",
      owed: parseMoney(account.balance_owed ?? account.current_balance),
      availableCredit: parseMoney(account.available_credit ?? account.available_balance),
      creditLimit: parseMoney(account.credit_limit),
      utilizationPercent: account.utilization_percent ?? null,
      safeToSpend: parseMoney(account.available_to_spend),
      forecastOwed: parseMoney(account.projected_balance_30_days),
    };
  }

  return {
    kind: "cash",
    primary: resolvePostedCurrentBalance(account),
    primaryLabel: "Current balance",
    afterPending: resolveAfterPendingBalance(account),
    safeToSpend: parseMoney(account.available_to_spend),
  };
}

/**
 * Accounts list primary — same Current meaning as Account Detail.
 * Never uses forecast ending / STS as Current.
 */
export function resolveListPrimaryBalance(account: Account): ListPrimaryBalance {
  if (account.account_type === "CREDIT") {
    return {
      label: "Owed",
      amount: parseMoney(account.balance_owed ?? account.current_balance),
      afterPending: null,
    };
  }
  return {
    label: "Current",
    amount: resolvePostedCurrentBalance(account),
    afterPending: resolveAfterPendingBalance(account),
  };
}

/** Whether a health/risk badge should show on the Accounts list. */
export function shouldShowAccountHealthBadge(
  status: string | null | undefined
): status is "watch" | "risk" | "critical" {
  return status === "watch" || status === "risk" || status === "critical";
}
