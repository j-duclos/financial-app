import {
  parseUnsignedMoney,
  signedCanonicalAmount,
  validatePositiveMoney,
} from "@/lib/moneyInput";

export type TransactionEntryType = "expense" | "income" | "transfer";

export function createTransactionButtonLabel(
  entryType: TransactionEntryType,
  isEdit: boolean
): string {
  if (isEdit) return "Save changes";
  if (entryType === "income") return "Create income";
  if (entryType === "transfer") return "Create transfer";
  return "Create expense";
}

export function payeeOrSourceLabel(entryType: TransactionEntryType): string {
  return entryType === "income" ? "Source" : "Payee";
}

export function accountFieldLabel(entryType: TransactionEntryType): string {
  return entryType === "transfer" ? "From account" : "Account";
}

export function validateTransactionForm(input: {
  entryType: TransactionEntryType;
  accountId: number | "";
  transferToAccountId: number | "";
  dateIso: string;
  amount: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof input.accountId !== "number") {
    errors.account_id = input.entryType === "transfer" ? "From account is required." : "Account is required.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateIso)) {
    errors.dateIso = "Date is required.";
  }
  const amountErr = validatePositiveMoney(input.amount);
  if (amountErr) errors.amount = amountErr;
  if (input.entryType === "transfer") {
    if (typeof input.transferToAccountId !== "number") {
      errors.transfer_to_account_id = "To account is required.";
    } else if (input.transferToAccountId === input.accountId) {
      errors.transfer_to_account_id = "Choose two different accounts.";
    }
  }
  return errors;
}

export function canonicalCreateAmount(
  entryType: TransactionEntryType,
  unsigned: string
): string {
  return signedCanonicalAmount(entryType, unsigned);
}

export function transferAmount(unsigned: string): string {
  const n = parseUnsignedMoney(unsigned);
  return n == null ? unsigned : n.toFixed(2);
}
