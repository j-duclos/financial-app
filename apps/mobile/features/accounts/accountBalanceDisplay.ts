import type { Account } from "@budget-app/shared";

/**
 * Mobile account balance label helpers.
 *
 * Semantics follow the backend / web financial model — this module only chooses
 * which canonical fields to display and how to label them. No local math.
 *
 * - Current (cash): posted / ledger-today-before-pending when forecast summary
 *   provides it; otherwise the list `available_balance`/`balance` field
 *   (same as Transactions ledger header / `?balance=true`).
 * - After pending: ledger end-of-day (`available_balance`/`balance`) when it
 *   differs from Current (typically unresolved same-day PLANNED still visible).
 * - Safe to spend: `available_to_spend` from forecast_summary (backend only).
 * - Credit: Owed / Available credit / Limit / Utilization — never cash labels.
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
 * otherwise the canonical list ledger balance.
 */
export function resolvePostedCurrentBalance(account: Account): string | null {
  if (account.account_type === "CREDIT") {
    return parseMoney(account.balance_owed ?? account.current_balance);
  }
  return forecastCurrentBalance(account) ?? resolveLedgerEndOfDayBalance(account);
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

  const current = resolvePostedCurrentBalance(account);
  const ledger = resolveLedgerEndOfDayBalance(account);
  const afterPending =
    amountsDiffer(current, ledger) && ledger != null ? ledger : null;

  return {
    kind: "cash",
    primary: current,
    primaryLabel: "Current balance",
    afterPending,
    safeToSpend: parseMoney(account.available_to_spend),
  };
}

/** Single primary amount for Accounts list cash rows — never forecast/STS. */
export function resolveListPrimaryBalance(account: Account): {
  label: string;
  amount: string | null;
} {
  if (account.account_type === "CREDIT") {
    return {
      label: "Owed",
      amount: parseMoney(account.balance_owed ?? account.current_balance),
    };
  }
  return {
    label: "Current",
    amount: resolveLedgerEndOfDayBalance(account),
  };
}

/** Whether a health/risk badge should show on the Accounts list. */
export function shouldShowAccountHealthBadge(
  status: string | null | undefined
): status is "watch" | "risk" | "critical" {
  return status === "watch" || status === "risk" || status === "critical";
}
