import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GETTING_STARTED_COPY,
  isOnboardingFutureTransactionDate,
} from "@budget-app/shared";
import { isOnboardingFutureTransactionMode } from "@/features/onboarding/gettingStartedRoutes";
import {
  TRANSACTION_ENTRY_TYPE_OPTIONS,
  accountFieldLabel,
  applyEntryTypeChange,
  canonicalCreateAmount,
  createTransactionButtonLabel,
  defaultNewTransactionDateIso,
  emptyTransactionForm,
  entryTypeFromExistingTransaction,
  filterDestinationAccounts,
  onboardingFutureTransactionSaveHandoff,
  payeeOrSourceLabel,
  planNewTransactionSave,
  transactionFormVisibleFields,
  transferAmount,
  validateTransactionForm,
  type DestinationFilterAccount,
  type TransactionFormState,
} from "./transactionForm";

const dir = dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(join(dir, "TransactionFormScreen.tsx"), "utf8");

const BANK_TRANSFER_ID = 90;
const CARD_PAYMENT_CAT_ID = 91;

const householdAccounts: DestinationFilterAccount[] = [
  { id: 1, account_type: "CHECKING", householdId: 1 },
  { id: 2, account_type: "SAVINGS", householdId: 1 },
  { id: 3, account_type: "CREDIT", householdId: 1 },
  { id: 4, account_type: "CREDIT", householdId: 1 },
  { id: 5, account_type: "CHECKING", householdId: 2 },
];

function form(overrides: Partial<TransactionFormState> = {}): TransactionFormState {
  return {
    ...emptyTransactionForm(1, "2026-09-10"),
    ...overrides,
  };
}

describe("transaction form type-specific copy", () => {
  it("changes labels and primary button by transaction type", () => {
    expect(payeeOrSourceLabel("expense")).toBe("Payee");
    expect(payeeOrSourceLabel("income")).toBe("Source");
    expect(accountFieldLabel("transfer")).toBe("From account");
    expect(accountFieldLabel("card_payment")).toBe("From account");
    expect(createTransactionButtonLabel("expense", false)).toBe("Create expense");
    expect(createTransactionButtonLabel("income", false)).toBe("Create income");
    expect(createTransactionButtonLabel("transfer", false)).toBe("Create transfer");
    expect(createTransactionButtonLabel("card_payment", false)).toBe("Create card payment");
    expect(TRANSACTION_ENTRY_TYPE_OPTIONS.map((o) => o.label)).toEqual([
      "Expense",
      "Income",
      "Transfer",
      "Card payment",
    ]);
    expect(formSource).toMatch(/Transaction type/);
    expect(formSource).toMatch(/createTransfer\(/);
    expect(formSource).toMatch(/sanitizeUnsignedMoneyInput/);
    expect(formSource).toMatch(/keyboardType="decimal-pad"/);
  });

  it("uses entryType, not category name, to decide new-form transfer UI", () => {
    expect(formSource).toMatch(/isTransferLikeEntry\(form\.entryType\)/);
    expect(formSource).toMatch(/planNewTransactionSave/);
    expect(formSource).not.toMatch(/isTransferEntry = form\.entryType === "transfer" \|\| isTransferCategoryName/);
    expect(formSource).not.toMatch(/Destination account is required for transfers/);
  });
});

describe("transaction form validation and canonical amounts", () => {
  it("accepts 47.82 and signs expense vs income using existing convention", () => {
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "47.82",
      })
    ).toEqual({});
    expect(canonicalCreateAmount("expense", "47.82")).toBe("-47.82");
    expect(canonicalCreateAmount("income", "47.82")).toBe("47.82");
    expect(transferAmount("47.82")).toBe("47.82");
  });

  it("rejects Gasoline, zero, and missing required fields", () => {
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "Gasoline",
      }).amount
    ).toMatch(/valid/i);
    expect(
      validateTransactionForm({
        entryType: "income",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "0",
      }).amount
    ).toMatch(/greater than 0/);
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: "",
        transferToAccountId: "",
        dateIso: "",
        amount: "",
      })
    ).toMatchObject({
      account_id: "Account is required.",
      dateIso: "Date is required.",
    });
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-07",
        amount: "-47.82",
      }).amount
    ).toMatch(/valid/i);
  });

  it("requires distinct transfer source and destination and uses createTransfer", () => {
    expect(
      validateTransactionForm({
        entryType: "transfer",
        accountId: 3,
        transferToAccountId: 3,
        dateIso: "2026-09-07",
        amount: "25.00",
      }).transfer_to_account_id
    ).toMatch(/different accounts/);
    expect(
      validateTransactionForm({
        entryType: "transfer",
        accountId: 3,
        transferToAccountId: 4,
        dateIso: "2026-09-07",
        amount: "25.00",
      })
    ).toEqual({});
    expect(formSource).toMatch(/planNewTransactionSave/);
    expect(formSource).toMatch(/createTransfer\(plan\.body\)/);
  });

  it("never requires a destination while Expense or Income is selected", () => {
    expect(
      validateTransactionForm({
        entryType: "expense",
        accountId: 1,
        transferToAccountId: 4,
        dateIso: "2026-09-10",
        amount: "12.00",
      })
    ).toEqual({});
    expect(
      validateTransactionForm({
        entryType: "income",
        accountId: 1,
        transferToAccountId: 4,
        dateIso: "2026-09-10",
        amount: "12.00",
      })
    ).toEqual({});
  });

  it("requires a CREDIT destination for card payment", () => {
    expect(
      validateTransactionForm({
        entryType: "card_payment",
        accountId: 1,
        transferToAccountId: "",
        dateIso: "2026-09-10",
        amount: "100.00",
      }).transfer_to_account_id
    ).toMatch(/credit card/i);
    expect(
      validateTransactionForm({
        entryType: "card_payment",
        accountId: 1,
        transferToAccountId: 2,
        dateIso: "2026-09-10",
        amount: "100.00",
        destAccountType: "SAVINGS",
      }).transfer_to_account_id
    ).toMatch(/credit card/i);
    expect(
      validateTransactionForm({
        entryType: "card_payment",
        accountId: 1,
        transferToAccountId: 3,
        dateIso: "2026-09-10",
        amount: "100.00",
        destAccountType: "CREDIT",
      })
    ).toEqual({});
  });
});

describe("stale transfer category after switching to Expense", () => {
  it("clears transfer UI and saves via createTransaction, not createTransfer", () => {
    let state = form({ entryType: "expense" });
    state = applyEntryTypeChange({
      prev: state,
      nextType: "transfer",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(state.entryType).toBe("transfer");
    expect(state.category_id).toBe(BANK_TRANSFER_ID);

    state = {
      ...state,
      transfer_to_account_id: 2,
    };

    state = applyEntryTypeChange({
      prev: state,
      nextType: "expense",
      destAccountType: "SAVINGS",
      selectedCategoryName: "Bank Transfer",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });

    const fields = transactionFormVisibleFields(state.entryType);
    expect(fields.destination).toBe(false);
    expect(fields.transferPreview).toBe(false);
    expect(fields.category).toBe(true);
    expect(fields.payee).toBe(true);
    expect(state.transfer_to_account_id).toBe("");
    expect(state.category_id).toBe("");

    const plan = planNewTransactionSave({
      form: { ...state, amount: "12.50", payee: "Coffee" },
      isoDate: "2026-09-10",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.api).toBe("createTransaction");
    expect(plan.api).not.toBe("createTransfer");
    if (plan.api === "createTransaction") {
      expect(plan.body.amount).toBe("-12.50");
      expect(plan.body.payee).toBe("Coffee");
    }
  });
});

describe("Transfer -> Income", () => {
  it("shows Source and Category, hides destination, and creates a positive transaction", () => {
    let state = applyEntryTypeChange({
      prev: form({
        entryType: "transfer",
        category_id: BANK_TRANSFER_ID,
        transfer_to_account_id: 2,
      }),
      nextType: "income",
      destAccountType: "SAVINGS",
      selectedCategoryName: "Bank Transfer",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    const fields = transactionFormVisibleFields(state.entryType);
    expect(fields.destination).toBe(false);
    expect(fields.transferPreview).toBe(false);
    expect(fields.source).toBe(true);
    expect(fields.payee).toBe(false);
    expect(fields.category).toBe(true);
    expect(state.transfer_to_account_id).toBe("");

    const plan = planNewTransactionSave({
      form: { ...state, amount: "50.00", payee: "Payroll" },
      isoDate: "2026-09-10",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.api).toBe("createTransaction");
    expect(plan.api).not.toBe("createTransfer");
    if (plan.api === "createTransaction") {
      expect(plan.body.amount).toBe("50.00");
    }
  });
});

describe("Card payment createTransfer", () => {
  it("pays a credit card through the existing transfer API with Credit Card Payment category", () => {
    const state = form({
      account_id: 1,
      entryType: "card_payment",
      transfer_to_account_id: 3,
      amount: "100",
      category_id: CARD_PAYMENT_CAT_ID,
      memo: "September payment",
    });
    const fields = transactionFormVisibleFields(state.entryType);
    expect(fields.destination).toBe(true);
    expect(fields.category).toBe(false);
    expect(fields.transferPreview).toBe(true);
    expect(fields.payee).toBe(false);

    const plan = planNewTransactionSave({
      form: state,
      isoDate: "2026-09-10",
      destAccountType: "CREDIT",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(plan).toEqual({
      ok: true,
      api: "createTransfer",
      body: {
        from_account: 1,
        to_account: 3,
        amount: "100.00",
        date: "2026-09-10",
        payee: "Credit card payment",
        memo: "September payment",
        from_category_id: CARD_PAYMENT_CAT_ID,
      },
    });
  });

  it("Transfer -> Card payment drops a non-CREDIT destination and uses Credit Card Payment", () => {
    const next = applyEntryTypeChange({
      prev: form({
        entryType: "transfer",
        transfer_to_account_id: 2,
        category_id: BANK_TRANSFER_ID,
      }),
      nextType: "card_payment",
      destAccountType: "SAVINGS",
      selectedCategoryName: "Bank Transfer",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(next.entryType).toBe("card_payment");
    expect(next.transfer_to_account_id).toBe("");
    expect(next.category_id).toBe(CARD_PAYMENT_CAT_ID);
  });

  it("Card payment -> Transfer keeps a CREDIT destination and uses Bank Transfer", () => {
    const next = applyEntryTypeChange({
      prev: form({
        entryType: "card_payment",
        transfer_to_account_id: 3,
        category_id: CARD_PAYMENT_CAT_ID,
      }),
      nextType: "transfer",
      destAccountType: "CREDIT",
      selectedCategoryName: "Credit Card Payment",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(next.entryType).toBe("transfer");
    expect(next.transfer_to_account_id).toBe(3);
    expect(next.category_id).toBe(BANK_TRANSFER_ID);
  });

  it("Transfer -> Card payment keeps a CREDIT destination", () => {
    const next = applyEntryTypeChange({
      prev: form({
        entryType: "transfer",
        transfer_to_account_id: 3,
        category_id: BANK_TRANSFER_ID,
      }),
      nextType: "card_payment",
      destAccountType: "CREDIT",
      selectedCategoryName: "Bank Transfer",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(next.transfer_to_account_id).toBe(3);
    expect(next.category_id).toBe(CARD_PAYMENT_CAT_ID);
  });

  it("Expense <-> Income keeps a normal category and clears leftover transfer dest", () => {
    const toIncome = applyEntryTypeChange({
      prev: form({ entryType: "expense", category_id: 7, transfer_to_account_id: 2 }),
      nextType: "income",
      selectedCategoryName: "Groceries",
      bankTransferCategoryId: BANK_TRANSFER_ID,
      creditCardPaymentCategoryId: CARD_PAYMENT_CAT_ID,
    });
    expect(toIncome.entryType).toBe("income");
    expect(toIncome.category_id).toBe(7);
    expect(toIncome.transfer_to_account_id).toBe("");
  });
});

describe("card payment destination filter", () => {
  it("shows only CREDIT accounts for card payment and all non-source household accounts for transfer", () => {
    const cardDest = filterDestinationAccounts(householdAccounts, 1, "card_payment");
    expect(cardDest.map((a) => a.id)).toEqual([3, 4]);

    const transferDest = filterDestinationAccounts(householdAccounts, 1, "transfer");
    expect(transferDest.map((a) => a.id)).toEqual([2, 3, 4]);

    expect(filterDestinationAccounts(householdAccounts, 1, "expense")).toEqual([]);
    expect(filterDestinationAccounts(householdAccounts, 1, "income")).toEqual([]);
  });
});

describe("entryTypeFromExistingTransaction", () => {
  it("maps linked bank transfer, card payment, income, expense, and never infers Plaid as transfer", () => {
    expect(
      entryTypeFromExistingTransaction({
        direction: "OUTFLOW",
        linked_transaction_id: 9,
        transfer_to_account: { account_type: "SAVINGS" },
        category: { name: "Bank Transfer" },
      })
    ).toBe("transfer");
    expect(
      entryTypeFromExistingTransaction({
        direction: "OUTFLOW",
        linked_transaction_id: 9,
        transfer_to_account: { account_type: "CREDIT" },
        category: { name: "Credit Card Payment" },
      })
    ).toBe("card_payment");
    expect(
      entryTypeFromExistingTransaction({
        direction: "INFLOW",
        category: { name: "Salary" },
      })
    ).toBe("income");
    expect(
      entryTypeFromExistingTransaction({
        direction: "OUTFLOW",
        category: { name: "Groceries" },
      })
    ).toBe("expense");
    expect(
      entryTypeFromExistingTransaction({
        direction: "OUTFLOW",
        source: "PLAID",
        plaid_transaction_id: "txn_1",
        category: { name: "Credit Card Payment" },
        transfer_to_account: { account_type: "CREDIT" },
        linked_transaction_id: 4,
      })
    ).toBe("expense");
  });
});

describe("onboarding future-transaction mode", () => {
  it("defaults to tomorrow only in onboarding future mode", () => {
    expect(
      defaultNewTransactionDateIso({ isOnboardingFuture: false, todayIso: "2026-09-11" })
    ).toBe("2026-09-11");
    expect(
      defaultNewTransactionDateIso({ isOnboardingFuture: true, todayIso: "2026-09-11" })
    ).toBe("2026-09-12");
    expect(formSource).toMatch(/defaultNewTransactionDateIso/);
    expect(formSource).toMatch(/todayStr\(\)/);
  });

  it("shows forecast education only when source=onboarding and mode=future", () => {
    expect(isOnboardingFutureTransactionMode({ source: "onboarding", mode: "future" })).toBe(true);
    expect(isOnboardingFutureTransactionMode({ source: "onboarding", mode: "transfer" })).toBe(
      false
    );
    expect(isOnboardingFutureTransactionMode({ mode: "future" })).toBe(false);
    expect(formSource).toMatch(/testID="onboarding-future-transaction-hint"/);
    expect(formSource).toMatch(/GETTING_STARTED_COPY\.futureTransactionFormTitle/);
    expect(GETTING_STARTED_COPY.futureTransactionFormTitle).toBe("Add something coming up");
    expect(GETTING_STARTED_COPY.futureTransactionFormBody).toMatch(/bill, paycheck, purchase, transfer/);
  });

  it("returns home only for a saved date after today in onboarding future mode", () => {
    expect(
      onboardingFutureTransactionSaveHandoff({
        isOnboardingFuture: true,
        dateIso: "2026-09-12",
        todayIso: "2026-09-11",
      })
    ).toBe("home");
    expect(
      onboardingFutureTransactionSaveHandoff({
        isOnboardingFuture: true,
        dateIso: "2026-09-11",
        todayIso: "2026-09-11",
      })
    ).toBe("saved_not_future");
    expect(
      onboardingFutureTransactionSaveHandoff({
        isOnboardingFuture: true,
        dateIso: "2026-09-10",
        todayIso: "2026-09-11",
      })
    ).toBe("saved_not_future");
    expect(
      onboardingFutureTransactionSaveHandoff({
        isOnboardingFuture: false,
        dateIso: "2026-09-12",
        todayIso: "2026-09-11",
      })
    ).toBe("back");
    expect(isOnboardingFutureTransactionDate("2026-09-12", "2026-09-11")).toBe(true);
    expect(formSource).toMatch(/GETTING_STARTED_COPY\.futureTransactionSavedNotFuture/);
    expect(formSource).toMatch(/GETTING_STARTED_HOME_ROUTE/);
  });

  it("keeps all existing transaction types available for future-dated entries", () => {
    expect(TRANSACTION_ENTRY_TYPE_OPTIONS.map((o) => o.type)).toEqual([
      "expense",
      "income",
      "transfer",
      "card_payment",
    ]);
    expect(formSource).toMatch(/TRANSACTION_ENTRY_TYPE_OPTIONS\.map/);
  });
});
