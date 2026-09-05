/** Resolve from/to for transfer preview without inventing account names. */

import type { Account } from "@budget-app/shared";
import { balanceOwed } from "./paymentPlannerDisplay";

export function transferPreviewAccountIds(args: {
  ledgerAccountId: number;
  counterpartyAccountId: number;
  amount: string;
  creditCardPayment: boolean;
}): { fromAccountId: number; toAccountId: number } {
  const { ledgerAccountId, counterpartyAccountId, amount, creditCardPayment } = args;
  if (creditCardPayment) {
    return { fromAccountId: ledgerAccountId, toAccountId: counterpartyAccountId };
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
