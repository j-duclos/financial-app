import { formatCurrency } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";

const STALE_PAYMENT_DUE_DAYS = 45;

function parseAmount(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function daysUntilDue(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const due = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

export function paymentDueIsStale(account: Account, today = new Date()): boolean {
  if (account.payment_due_is_stale) return true;
  const days = daysUntilDue(account.next_payment_due_date, today);
  return days != null && days < -STALE_PAYMENT_DUE_DAYS;
}

/** Amount due for display: known minimum/statement, else null when a zero likely means unknown. */
export function paymentDueAmount(account: Account): string | null {
  if (account.payment_due_amount != null && account.payment_due_amount !== "") {
    return account.payment_due_amount;
  }
  const minPay = parseAmount(account.minimum_payment_amount);
  if (minPay != null && minPay > 0) return String(minPay);
  const statement = parseAmount(account.statement_balance);
  if (statement != null && statement > 0) return String(statement);
  return null;
}

export function paymentDueAmountUnavailable(account: Account): boolean {
  if (account.payment_due_amount_unavailable) return true;
  const owed = parseAmount(account.balance_owed ?? account.current_balance) ?? 0;
  return paymentDueAmount(account) == null && owed > 0;
}

export function formatPaymentDueValue(account: Account): string {
  const due = account.next_payment_due_date;
  if (!due) return "—";
  const dateLabel = formatDateDisplay(due);
  const stale = paymentDueIsStale(account);
  const amount = paymentDueAmount(account);
  const unavailable = paymentDueAmountUnavailable(account);

  if (stale) {
    if (unavailable || amount == null) return `Last known ${dateLabel} · Amount unavailable`;
    return `Last known ${dateLabel} · ${formatCurrency(amount, account.currency)}`;
  }
  if (unavailable) return `${dateLabel} · Amount unavailable`;
  if (amount != null) return `${dateLabel} · ${formatCurrency(amount, account.currency)}`;
  return dateLabel;
}
