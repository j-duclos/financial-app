import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { resolveListPrimaryBalance } from "@/features/accounts/accountBalanceDisplay";

/**
 * Picker amount line from ledger-enriched accounts (`?balance=true`).
 * Do not pass lightweight account-options rows — those can carry Plaid
 * `current_balance` / missing ledger fields and look wildly wrong.
 */
export function formatAccountSelectorBalanceLine(account: Account | null | undefined): string | null {
  if (account == null) return null;
  const primary = resolveListPrimaryBalance(account);
  if (primary.amount == null) return null;
  return `${primary.label} ${formatCurrency(primary.amount, account.currency ?? "USD")}`;
}
