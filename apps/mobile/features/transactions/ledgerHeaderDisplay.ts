import type { Account } from "@budget-app/shared";
import {
  formatCurrency,
  getAccountInstitutionSubtitle,
  getEffectiveDisplayName,
} from "@budget-app/shared";

/**
 * Canonical posted/current balance for an account ledger header.
 *
 * ## Current balance priority (Web + Mobile Transactions header)
 *
 * 1. **Pending-adjusted ledger** — when Pending Transactions has rows, Current is the
 *    backend `balance_after` on the last pending row (same as the Pending section ending Bal).
 * 2. **Posted ledger ending** — when no pending rows and canonical history is fully loaded,
 *    Current is the backend `running_balance` on the last posted Recent row.
 * 3. **Account API fallback** — when pending is empty and history pagination is incomplete,
 *    or ledger rows lack balances, use `resolveAccountCurrentBalance` from the account summary
 *    (`available_balance` for assets, signed `balance` for credit).
 *
 * Forecast is always separate: last upcoming `balance_after` or account projected fields.
 * Client code must never recompute balances from amounts.
 *
 * Uses the same field priority as web `accountLedgerDisplayBalance` for API fallback.
 * NEVER uses projected / forecast / timeline running_balance fields as Current.
 */
export function resolveAccountCurrentBalance(
  account: {
    account_type?: string;
    available_balance?: string | null;
    balance?: string | null;
    balance_owed?: string | null;
    current_balance?: string | null;
    /** Explicitly ignored — must never become "Current". */
    projected_balance_30_days?: string | null;
    lowest_projected_balance_30_days?: string | null;
  } | null | undefined
): string | null {
  if (!account) return null;
  const isCredit = account.account_type === "CREDIT";

  const parse = (raw: string | null | undefined): string | null => {
    if (raw == null || String(raw).trim() === "") return null;
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? String(raw) : null;
  };

  if (isCredit) {
    const signed = parse(account.balance);
    if (signed != null) return signed;
    const owed = parse(account.balance_owed ?? account.current_balance);
    if (owed != null) {
      const n = parseFloat(owed);
      if (n > 0) return String(-n);
      return owed;
    }
    return null;
  }

  return parse(account.available_balance ?? account.balance);
}

/**
 * Compact identity line: "Main · Chase · Checking"
 */
export function formatLedgerAccountIdentity(
  account: Pick<Account, "effective_display_name" | "display_name" | "nickname" | "name" | "institution" | "account_type">
): string {
  const name = getEffectiveDisplayName(account);
  const subtitle = getAccountInstitutionSubtitle(account);
  return `${name} · ${subtitle}`;
}

export type LedgerHeaderBalances = {
  current: string | null;
  /** End-of-forecast or last upcoming balance-after — labeled Forecast, never Current. */
  forecast: string | null;
};

/**
 * Build header balance lines. `forecastBalance` must come from a forecast source
 * (last upcoming running_balance or account projected field) — never substitute for current.
 */
export function resolveLedgerHeaderBalances(input: {
  account: Parameters<typeof resolveAccountCurrentBalance>[0];
  forecastBalance?: string | null;
}): LedgerHeaderBalances {
  const current = resolveAccountCurrentBalance(input.account);
  const forecastRaw = input.forecastBalance;
  let forecast: string | null = null;
  if (forecastRaw != null && String(forecastRaw).trim() !== "") {
    const n = parseFloat(String(forecastRaw));
    if (Number.isFinite(n)) {
      // Never mirror a forecast value into Current via accidental reuse.
      if (current == null || parseFloat(current) !== n) {
        forecast = String(forecastRaw);
      } else {
        // Same numeric value is fine to show as Forecast only when it is a distinct label;
        // still allow showing forecast when it equals current (edge case).
        forecast = String(forecastRaw);
      }
    }
  }
  return { current, forecast };
}

export function formatLedgerHeaderBalanceLine(
  balances: LedgerHeaderBalances,
  currency = "USD",
  forecastDays?: number | null
): string | null {
  const parts: string[] = [];
  if (balances.current != null) {
    parts.push(`Current ${formatCurrency(balances.current, currency)}`);
  }
  if (balances.forecast != null) {
    const forecastLabel =
      forecastDays != null && forecastDays > 0
        ? `${forecastDays}-day forecast`
        : "Forecast";
    parts.push(`${forecastLabel} ${formatCurrency(balances.forecast, currency)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
