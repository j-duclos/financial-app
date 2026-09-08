/** Resolve from/to for transfer preview without inventing account names. */

import type { Account } from "@budget-app/shared";
import { balanceOwed } from "./paymentPlannerDisplay";

export function transferPreviewAccountIds(args: {
  ledgerAccountId: number;
  counterpartyAccountId: number;
  amount: string;
  creditCardPayment: boolean;
  /** When set, this wins over amount sign (inline add keeps direction even if amount is unsigned). */
  direction?: "INFLOW" | "OUTFLOW";
}): { fromAccountId: number; toAccountId: number } {
  const { ledgerAccountId, counterpartyAccountId, amount, creditCardPayment, direction } = args;
  if (creditCardPayment) {
    return { fromAccountId: ledgerAccountId, toAccountId: counterpartyAccountId };
  }
  if (direction === "OUTFLOW") {
    return { fromAccountId: ledgerAccountId, toAccountId: counterpartyAccountId };
  }
  if (direction === "INFLOW") {
    return { fromAccountId: counterpartyAccountId, toAccountId: ledgerAccountId };
  }
  const n = parseFloat(String(amount).trim());
  if (Number.isFinite(n) && n < 0) {
    return { fromAccountId: ledgerAccountId, toAccountId: counterpartyAccountId };
  }
  if (Number.isFinite(n) && n > 0) {
    return { fromAccountId: counterpartyAccountId, toAccountId: ledgerAccountId };
  }
  return { fromAccountId: ledgerAccountId, toAccountId: counterpartyAccountId };
}

export function transferPreviewAmountReady(amount: string): boolean {
  const trimmed = String(amount).trim();
  if (trimmed === "") return true;
  return Number.isFinite(parseFloat(trimmed));
}

export function transferPreviewAmountPayload(amount: string): string {
  const trimmed = String(amount).trim();
  if (trimmed === "") return "0";
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n)) return "0";
  return trimmed;
}

export function parsePreviewMoney(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Ledger-signed amount in the edit form so −2331 can be typed to +2331. */
export function signedAmountForEditForm(
  amount: string | number,
  ledgerFlow?: "INFLOW" | "OUTFLOW" | null
): string {
  const n = parseFloat(String(amount));
  if (!Number.isFinite(n)) return "";
  if (ledgerFlow === "OUTFLOW") return (-Math.abs(n)).toFixed(2);
  if (ledgerFlow === "INFLOW") return Math.abs(n).toFixed(2);
  return n.toFixed(2);
}

export function directionFromSignedAmount(amount: string): "INFLOW" | "OUTFLOW" | null {
  const n = parseFloat(String(amount).trim());
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? "OUTFLOW" : "INFLOW";
}

export function applyDirectionToSignedAmount(
  amount: string,
  direction: "INFLOW" | "OUTFLOW"
): string {
  const n = parseFloat(String(amount).trim());
  if (!Number.isFinite(n) || n === 0) return amount;
  const abs = Math.abs(n);
  return (direction === "OUTFLOW" ? -abs : abs).toFixed(2);
}

function moneyText(n: number): string {
  return n.toFixed(2);
}

/**
 * Canonical signed ledger for a cash/savings dest — `account.balance` from `?balance=true`.
 * Never starting_balance (stale) or current_balance (credit owed).
 */
export function accountLedgerBalanceToday(account: Account | null | undefined): number | null {
  if (!account) return null;
  return parsePreviewMoney(account.balance);
}

/**
 * Inline bank-transfer footer: dest's current ledger, then this draft amount.
 * Amount sign matches inline submit (negative = leave the open ledger / arrive at dest).
 */
export function inlineBankDestLedgerPreview(args: {
  destinationAccount: Account | null | undefined;
  amount: string;
}): { before: string; after: string } | null {
  const current = accountLedgerBalanceToday(args.destinationAccount);
  if (current == null) return null;
  const n = parseFloat(String(args.amount).trim());
  const destDelta = Number.isFinite(n) ? -n : 0;
  return { before: moneyText(current), after: moneyText(current + destDelta) };
}

/** Pick source vs destination preview legs by the account the UI is naming. */
export function previewBalancesForAccountId(args: {
  labeledAccountId: number;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  sourceBefore?: string | number | null;
  sourceAfter?: string | number | null;
  destBefore?: string | number | null;
  destAfter?: string | number | null;
}): { before: string; after: string } | null {
  const { labeledAccountId, fromAccountId, toAccountId } = args;
  if (toAccountId === labeledAccountId && args.destBefore != null && args.destAfter != null) {
    return { before: String(args.destBefore), after: String(args.destAfter) };
  }
  if (fromAccountId === labeledAccountId && args.sourceBefore != null && args.sourceAfter != null) {
    return { before: String(args.sourceBefore), after: String(args.sourceAfter) };
  }
  return null;
}

function positiveOwed(n: number | null): number | null {
  if (n == null) return null;
  return n < 0 ? Math.abs(n) : n;
}

/** Positive amount owed on the payment destination. Zero is a real value, not missing. */
export function destinationCardOwedAmount(args: {
  previewOwedBefore?: string | number | null;
  previewDestSignedBefore?: string | number | null;
  destinationAccount?: Account | null;
}): number | null {
  const fromPreviewOwed = positiveOwed(parsePreviewMoney(args.previewOwedBefore));
  if (fromPreviewOwed != null) return fromPreviewOwed;
  const signed = parsePreviewMoney(args.previewDestSignedBefore);
  if (signed != null) return signed < 0 ? Math.abs(signed) : 0;
  const acc = args.destinationAccount;
  if (!acc) return null;
  const fromAccount = positiveOwed(balanceOwed(acc));
  if (fromAccount != null) return fromAccount;
  const current = parsePreviewMoney(acc.current_balance);
  if (current != null) return current < 0 ? Math.abs(current) : current;
  const start = parsePreviewMoney(acc.starting_balance);
  if (start != null && String(acc.account_type ?? "").toUpperCase() === "CREDIT") {
    return start < 0 ? Math.abs(start) : 0;
  }
  return null;
}

/**
 * Dated transfer/card-payment preview only. Never falls back to a current or
 * starting account balance — those are not future projected balances.
 */
export function projectedCardOwedFromPreview(args: {
  previewOwedBefore?: string | number | null;
  previewDestSignedBefore?: string | number | null;
}): number | null {
  const fromPreviewOwed = positiveOwed(parsePreviewMoney(args.previewOwedBefore));
  if (fromPreviewOwed != null) return fromPreviewOwed;
  const signed = parsePreviewMoney(args.previewDestSignedBefore);
  if (signed != null) return signed < 0 ? Math.abs(signed) : 0;
  return null;
}
