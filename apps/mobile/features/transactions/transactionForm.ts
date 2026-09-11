import { isOnboardingFutureTransactionDate } from "@budget-app/shared";
import { addDaysToIsoDate } from "@/lib/dates";
import { isTransferCategoryName } from "@/lib/transactionsLedger";
import { isBankImportedTransaction } from "@/lib/transactionStatus";
import {
  parseUnsignedMoney,
  signedCanonicalAmount,
  validatePositiveMoney,
} from "@/lib/moneyInput";

export type TransactionEntryType = "expense" | "income" | "transfer" | "card_payment";

export type TransactionFormState = {
  account_id: number | "";
  dateIso: string;
  payee: string;
  amount: string;
  entryType: TransactionEntryType;
  category_id: number | "";
  memo: string;
  transfer_to_account_id: number | "";
};

export const TRANSACTION_ENTRY_TYPE_OPTIONS: { type: TransactionEntryType; label: string }[] = [
  { type: "expense", label: "Expense" },
  { type: "income", label: "Income" },
  { type: "transfer", label: "Transfer" },
  { type: "card_payment", label: "Card payment" },
];

export const BANK_TRANSFER_CATEGORY_NAME = "Bank Transfer";
export const CREDIT_CARD_PAYMENT_CATEGORY_NAME = "Credit Card Payment";

export type DestinationFilterAccount = {
  id: number;
  account_type: string;
  householdId: number | undefined;
};

export function isTransferLikeEntry(entryType: TransactionEntryType): boolean {
  return entryType === "transfer" || entryType === "card_payment";
}

export function defaultNewTransactionDateIso(opts: {
  isOnboardingFuture: boolean;
  todayIso: string;
}): string {
  return opts.isOnboardingFuture ? addDaysToIsoDate(opts.todayIso, 1) : opts.todayIso;
}

export function onboardingFutureTransactionSaveHandoff(opts: {
  isOnboardingFuture: boolean;
  dateIso: string;
  todayIso: string;
}): "home" | "saved_not_future" | "back" {
  if (!opts.isOnboardingFuture) return "back";
  if (isOnboardingFutureTransactionDate(opts.dateIso, opts.todayIso)) return "home";
  return "saved_not_future";
}

export function emptyTransactionForm(accountId?: number, dateIso = ""): TransactionFormState {
  return {
    account_id: accountId ?? "",
    dateIso,
    payee: "",
    amount: "",
    entryType: "expense",
    category_id: "",
    memo: "",
    transfer_to_account_id: "",
  };
}

export function createTransactionButtonLabel(
  entryType: TransactionEntryType,
  isEdit: boolean
): string {
  if (isEdit) return "Save changes";
  if (entryType === "income") return "Create income";
  if (entryType === "transfer") return "Create transfer";
  if (entryType === "card_payment") return "Create card payment";
  return "Create expense";
}

export function payeeOrSourceLabel(entryType: TransactionEntryType): string {
  return entryType === "income" ? "Source" : "Payee";
}

export function accountFieldLabel(entryType: TransactionEntryType): string {
  return isTransferLikeEntry(entryType) ? "From account" : "Account";
}

export function destinationFieldLabel(entryType: TransactionEntryType): string {
  return entryType === "card_payment" ? "Credit card" : "To account";
}

export function destinationPickerTitle(entryType: TransactionEntryType): string {
  return entryType === "card_payment" ? "Credit card" : "Transfer to";
}

export function createTransferPayee(entryType: TransactionEntryType): string {
  return entryType === "card_payment" ? "Credit card payment" : "Transfer";
}

export function transactionFormVisibleFields(entryType: TransactionEntryType): {
  account: boolean;
  date: boolean;
  transactionType: boolean;
  amount: boolean;
  payee: boolean;
  source: boolean;
  category: boolean;
  destination: boolean;
  notes: boolean;
  transferPreview: boolean;
} {
  const transferLike = isTransferLikeEntry(entryType);
  return {
    account: true,
    date: true,
    transactionType: true,
    amount: true,
    payee: entryType === "expense",
    source: entryType === "income",
    category: !transferLike,
    destination: transferLike,
    notes: true,
    transferPreview: transferLike,
  };
}

export function internalCategoryIdForEntry(
  entryType: TransactionEntryType,
  bankTransferCategoryId?: number | null,
  creditCardPaymentCategoryId?: number | null
): number | null {
  if (entryType === "card_payment") return creditCardPaymentCategoryId ?? null;
  if (entryType === "transfer") return bankTransferCategoryId ?? null;
  return null;
}

/**
 * Map an existing transaction to a form entry type once at edit init.
 * Does not continuously override UI from the selected category.
 * Imported Plaid rows stay expense/income — never inferred as transfers.
 */
export function entryTypeFromExistingTransaction(txn: {
  direction?: string | null;
  category?: { name?: string } | null;
  transfer_to_account?: { account_type?: string } | null;
  linked_transaction_id?: number | null;
  source?: string | null;
  plaid_transaction_id?: string | null;
}): TransactionEntryType {
  if (isBankImportedTransaction(txn)) {
    return txn.direction === "INFLOW" ? "income" : "expense";
  }
  const catName = txn.category?.name;
  const destType = (txn.transfer_to_account?.account_type ?? "").toUpperCase();
  const linked = txn.transfer_to_account != null || txn.linked_transaction_id != null;
  if (linked || isTransferCategoryName(catName)) {
    if (destType === "CREDIT" || catName === CREDIT_CARD_PAYMENT_CATEGORY_NAME) {
      return "card_payment";
    }
    return "transfer";
  }
  return txn.direction === "INFLOW" ? "income" : "expense";
}

export function applyEntryTypeChange(input: {
  prev: TransactionFormState;
  nextType: TransactionEntryType;
  destAccountType?: string | null;
  selectedCategoryName?: string | null;
  bankTransferCategoryId?: number | null;
  creditCardPaymentCategoryId?: number | null;
}): TransactionFormState {
  const { prev, nextType } = input;
  let transfer_to_account_id = prev.transfer_to_account_id;
  let category_id = prev.category_id;
  const bankId = input.bankTransferCategoryId ?? null;
  const cardId = input.creditCardPaymentCategoryId ?? null;

  if (!isTransferLikeEntry(nextType)) {
    transfer_to_account_id = "";
    const wasInternalCategory =
      isTransferCategoryName(input.selectedCategoryName ?? undefined) ||
      category_id === bankId ||
      category_id === cardId;
    if (wasInternalCategory) category_id = "";
  } else if (nextType === "card_payment") {
    const destType = (input.destAccountType ?? "").toUpperCase();
    if (typeof transfer_to_account_id === "number" && destType !== "CREDIT") {
      transfer_to_account_id = "";
    }
    category_id = cardId ?? "";
  } else {
    if (typeof transfer_to_account_id === "number" && transfer_to_account_id === prev.account_id) {
      transfer_to_account_id = "";
    }
    category_id = bankId ?? "";
  }

  return { ...prev, entryType: nextType, transfer_to_account_id, category_id };
}

export function filterDestinationAccounts(
  accounts: DestinationFilterAccount[],
  sourceId: number | "" | null,
  entryType: TransactionEntryType
): DestinationFilterAccount[] {
  if (!isTransferLikeEntry(entryType) || typeof sourceId !== "number") return [];
  const source = accounts.find((a) => a.id === sourceId);
  if (!source) return [];
  return accounts.filter((a) => {
    if (a.id === sourceId) return false;
    if (a.householdId !== source.householdId) return false;
    if (entryType === "card_payment") return a.account_type.toUpperCase() === "CREDIT";
    return true;
  });
}

export function validateTransactionForm(input: {
  entryType: TransactionEntryType;
  accountId: number | "";
  transferToAccountId: number | "";
  dateIso: string;
  amount: string;
  destAccountType?: string | null;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const transferLike = isTransferLikeEntry(input.entryType);
  if (typeof input.accountId !== "number") {
    errors.account_id = transferLike ? "From account is required." : "Account is required.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateIso)) {
    errors.dateIso = "Date is required.";
  }
  const amountErr = validatePositiveMoney(input.amount);
  if (amountErr) errors.amount = amountErr;

  if (input.entryType === "expense" || input.entryType === "income") {
    return errors;
  }

  if (input.entryType === "transfer") {
    if (typeof input.transferToAccountId !== "number") {
      errors.transfer_to_account_id = "To account is required.";
    } else if (input.transferToAccountId === input.accountId) {
      errors.transfer_to_account_id = "Choose two different accounts.";
    }
    return errors;
  }

  if (typeof input.transferToAccountId !== "number") {
    errors.transfer_to_account_id = "Credit card is required.";
  } else if (input.transferToAccountId === input.accountId) {
    errors.transfer_to_account_id = "Choose two different accounts.";
  } else if ((input.destAccountType ?? "").toUpperCase() !== "CREDIT") {
    errors.transfer_to_account_id = "Choose a credit card.";
  }
  return errors;
}

export function canonicalCreateAmount(
  entryType: TransactionEntryType,
  unsigned: string
): string {
  if (entryType === "card_payment") return signedCanonicalAmount("transfer", unsigned);
  return signedCanonicalAmount(entryType, unsigned);
}

export function transferAmount(unsigned: string): string {
  const n = parseUnsignedMoney(unsigned);
  return n == null ? unsigned : n.toFixed(2);
}

export type NewTransactionSavePlan =
  | { ok: false; errors: Record<string, string> }
  | {
      ok: true;
      api: "createTransfer";
      body: {
        from_account: number;
        to_account: number;
        amount: string;
        date: string;
        payee: string;
        memo: string;
        from_category_id: number | null;
      };
    }
  | {
      ok: true;
      api: "createTransaction";
      body: {
        account_id: number;
        date: string;
        payee: string;
        amount: string;
        category_id: number | null;
        memo: string;
      };
    };

/** New-form save: entryType is authoritative. Never infers transfer from category. */
export function planNewTransactionSave(input: {
  form: TransactionFormState;
  isoDate: string;
  destAccountType?: string | null;
  bankTransferCategoryId?: number | null;
  creditCardPaymentCategoryId?: number | null;
}): NewTransactionSavePlan {
  const errors = validateTransactionForm({
    entryType: input.form.entryType,
    accountId: input.form.account_id,
    transferToAccountId: input.form.transfer_to_account_id,
    dateIso: input.isoDate,
    amount: input.form.amount,
    destAccountType: input.destAccountType,
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const form = input.form;
  if (typeof form.account_id !== "number") {
    return { ok: false, errors: { account_id: "Account is required." } };
  }

  if (isTransferLikeEntry(form.entryType)) {
    if (typeof form.transfer_to_account_id !== "number") {
      return { ok: false, errors };
    }
    const fallbackCat = internalCategoryIdForEntry(
      form.entryType,
      input.bankTransferCategoryId,
      input.creditCardPaymentCategoryId
    );
    return {
      ok: true,
      api: "createTransfer",
      body: {
        from_account: form.account_id,
        to_account: form.transfer_to_account_id,
        amount: transferAmount(form.amount),
        date: input.isoDate,
        payee: createTransferPayee(form.entryType),
        memo: form.memo,
        from_category_id: typeof form.category_id === "number" ? form.category_id : fallbackCat,
      },
    };
  }

  return {
    ok: true,
    api: "createTransaction",
    body: {
      account_id: form.account_id,
      date: input.isoDate,
      payee: form.payee.trim() || "—",
      amount: canonicalCreateAmount(form.entryType, form.amount),
      category_id: typeof form.category_id === "number" ? form.category_id : null,
      memo: form.memo,
    },
  };
}
