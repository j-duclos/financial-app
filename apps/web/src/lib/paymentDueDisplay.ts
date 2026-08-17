import { formatCurrency } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import { formatShortMonthDay } from "./dateDisplay";

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

function formatPaymentInfoDate(iso: string): string | null {
  const label = formatShortMonthDay(iso);
  return label === "None" ? null : label;
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

function amountPart(account: Account): string {
  const amount = paymentDueAmount(account);
  const unavailable = paymentDueAmountUnavailable(account);
  if (unavailable || amount == null) return "Amount unavailable";
  return formatCurrency(amount, account.currency);
}

/**
 * Payment Info column: distinguish upcoming due dates from last-known historical dates.
 * Never treats a past date as an upcoming due date. Never presents $0.00 as a required payment
 * unless a positive amount is actually known.
 */
export function formatPaymentDueValue(account: Account, today = new Date()): string {
  const due = account.next_payment_due_date;
  const amount = paymentDueAmount(account);
  const unavailable = paymentDueAmountUnavailable(account);

  if (!due) {
    if (amount != null && !unavailable) {
      return `Amount ${formatCurrency(amount, account.currency)} · Due date unavailable`;
    }
    return "No payment data";
  }

  const dateLabel = formatPaymentInfoDate(due) ?? due;
  const stale = paymentDueIsStale(account, today);
  const days = daysUntilDue(due, today);
  const money = amountPart(account);

  if (stale || (days != null && days < 0)) {
    return `Last known ${dateLabel} · ${money}`;
  }
  return `Due ${dateLabel} · ${money}`;
}
