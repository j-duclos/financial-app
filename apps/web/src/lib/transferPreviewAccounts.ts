/** Resolve from/to for transfer preview without inventing account names. */

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
