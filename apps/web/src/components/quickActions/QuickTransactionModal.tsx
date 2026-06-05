import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatAccountOptionLabel, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, Category } from "@budget-app/shared";
import { createTransaction, createTransfer, listCategories } from "@budget-app/api-client";
import {
  amountForPaymentPlanOption,
  type PaymentPlanOptionId,
} from "../../lib/paymentPlannerDisplay";
import { isTransferCategoryName } from "../transactions/transactionsLedgerUtils";
import PaymentPlannerSection from "./PaymentPlannerSection";

export type QuickTransactionMode =
  | "expense"
  | "income"
  | "purchase"
  | "transfer"
  | "credit_card_payment"
  | "contribution";

export type QuickTransactionPreset = {
  accountId: number;
  mode: QuickTransactionMode;
  transferToAccountId?: number;
  transferFromAccountId?: number;
  defaultAmount?: string;
  defaultPayee?: string;
  defaultDate?: string;
  /** Prefills payment planner radio selection (credit card / loan payments). */
  paymentPlanOption?: PaymentPlanOptionId;
};

type Props = {
  open: boolean;
  preset: QuickTransactionPreset | null;
  accounts: Account[];
  onClose: () => void;
  onSuccess: (message: string) => void;
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function accountHouseholdId(account: Account | undefined): number | undefined {
  if (!account) return undefined;
  const h = account.household as Account["household"] | number | undefined;
  if (typeof h === "object" && h != null && "id" in h) return h.id;
  if (typeof h === "number") return h;
  return undefined;
}

function titleForMode(mode: QuickTransactionMode): string {
  switch (mode) {
    case "expense":
      return "Add expense";
    case "income":
      return "Add income";
    case "purchase":
      return "Add purchase";
    case "transfer":
      return "Transfer money";
    case "credit_card_payment":
      return "Record credit card payment";
    case "contribution":
      return "Add contribution";
    default:
      return "Add transaction";
  }
}

export default function QuickTransactionModal({
  open,
  preset,
  accounts,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const account = accounts.find((a) => a.id === preset?.accountId);
  const householdId = accountHouseholdId(account);

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "quick-txn", householdId],
    queryFn: () =>
      listCategories({
        page_size: 500,
        ...(householdId ? { household: householdId } : {}),
      }),
    enabled: open && !!householdId,
  });

  const categories = categoriesData?.results ?? [];

  const [date, setDate] = useState(todayStr());
  const [payee, setPayee] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [transferToId, setTransferToId] = useState<number | "">("");
  const [transferFromId, setTransferFromId] = useState<number | "">("");
  const [paymentPlanOption, setPaymentPlanOption] =
    useState<PaymentPlanOptionId>("statement_balance");
  const [error, setError] = useState<string | null>(null);

  const isDedicatedTransfer =
    preset?.mode === "transfer" || preset?.mode === "credit_card_payment";
  const isPayment = preset?.mode === "credit_card_payment";
  const isBankTransfer = preset?.mode === "transfer";

  const transferCategory = useMemo(() => {
    const name = isPayment ? "Credit Card Payment" : "Bank Transfer";
    return categories.find((c: Category) => c.name === name) ?? null;
  }, [categories, isPayment]);

  const selectedCategory = useMemo(
    () => (categoryId ? categories.find((c: Category) => c.id === categoryId) : null),
    [categories, categoryId]
  );

  const categoryDrivenTransfer =
    !isDedicatedTransfer && isTransferCategoryName(selectedCategory?.name);

  const bankTransferAccounts = useMemo(() => {
    if (!account) return [];
    const hid = accountHouseholdId(account);
    return accounts.filter(
      (a) => accountHouseholdId(a) === hid && a.account_type !== "CREDIT"
    );
  }, [account, accounts]);

  const debtPaymentAccounts = useMemo(() => {
    if (!account) return [];
    const hid = accountHouseholdId(account);
    return accounts.filter(
      (a) =>
        accountHouseholdId(a) === hid &&
        (a.account_type === "CREDIT" || a.account_type === "LOAN")
    );
  }, [account, accounts]);

  const categoryTransferDestinations = useMemo(() => {
    if (!account || !preset) return [];
    const hid = accountHouseholdId(account);
    const isCcPayment = selectedCategory?.name === "Credit Card Payment";
    return accounts.filter((a) => {
      if (accountHouseholdId(a) !== hid) return false;
      if (a.id === preset.accountId) return false;
      if (isCcPayment) return a.account_type === "CREDIT";
      return true;
    });
  }, [account, accounts, preset, selectedCategory?.name]);

  const fromAccount = accounts.find((a) => a.id === transferFromId);
  const toAccount = accounts.find((a) => a.id === transferToId);
  const paymentCard = isPayment ? toAccount : null;

  function applyPaymentPlanOption(option: PaymentPlanOptionId, card: Account | undefined) {
    setPaymentPlanOption(option);
    if (option === "custom_amount" || !card) return;
    const next = amountForPaymentPlanOption(card, option);
    if (next) setAmount(next);
  }

  useEffect(() => {
    if (!open || !preset || !account) return;
    setDate(preset.defaultDate && preset.defaultDate >= todayStr() ? preset.defaultDate : todayStr());
    setPayee(preset.defaultPayee ?? "");
    setAmount(preset.defaultAmount ?? "");
    setError(null);
    setCategoryId(transferCategory?.id ?? "");
    setPaymentPlanOption(
      preset.paymentPlanOption ??
        (preset.defaultAmount ? "custom_amount" : "statement_balance")
    );

    if (preset.mode === "credit_card_payment") {
      const validFrom =
        preset.transferFromAccountId != null &&
        bankTransferAccounts.some((a) => a.id === preset.transferFromAccountId);
      setTransferFromId(
        validFrom
          ? preset.transferFromAccountId!
          : (bankTransferAccounts[0]?.id ?? "")
      );
      const validTo =
        preset.transferToAccountId != null &&
        debtPaymentAccounts.some((a) => a.id === preset.transferToAccountId);
      setTransferToId(
        validTo ? preset.transferToAccountId! : (debtPaymentAccounts[0]?.id ?? "")
      );
    } else if (preset.mode === "transfer") {
      const fundingInbound =
        preset.transferToAccountId != null &&
        preset.transferToAccountId === preset.accountId &&
        preset.transferFromAccountId == null;
      const defaultFrom =
        preset.transferFromAccountId ??
        (fundingInbound
          ? ""
          : account.account_type !== "CREDIT"
            ? preset.accountId
            : "");
      setTransferFromId(defaultFrom);
      setTransferToId(preset.transferToAccountId ?? "");
    } else {
      setTransferFromId("");
      setTransferToId("");
    }
  }, [
    open,
    preset,
    account,
    transferCategory?.id,
    bankTransferAccounts,
    debtPaymentAccounts,
  ]);

  useEffect(() => {
    if (!open || !isPayment || !paymentCard) return;
    if (paymentPlanOption === "custom_amount") return;
    const next = amountForPaymentPlanOption(paymentCard, paymentPlanOption);
    if (next) setAmount(next);
  }, [open, isPayment, paymentCard?.id, paymentPlanOption]);

  const createMu = useMutation({
    mutationFn: createTransaction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onSuccess("Transaction added.");
      onClose();
    },
    onError: (err: Error) => setError(err.message || "Could not save transaction"),
  });

  const transferMu = useMutation({
    mutationFn: createTransfer,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      onSuccess("Transfer recorded.");
      onClose();
    },
    onError: (err: Error) => setError(err.message || "Could not save transfer"),
  });

  if (!open || !preset || !account) return null;

  function signedAmount(): number | null {
    const n = parseFloat(amount);
    if (!amount.trim() || Number.isNaN(n) || n === 0) return null;
    const abs = Math.abs(n);
    if (isDedicatedTransfer || categoryDrivenTransfer) return -abs;
    if (preset!.mode === "income" || preset!.mode === "contribution") return abs;
    if (preset!.mode === "purchase" && account!.account_type === "CREDIT") return -abs;
    return -abs;
  }

  function submitTransfer(from: number, to: number, signed: number) {
    if (!from) {
      setError("Select a source account.");
      return;
    }
    if (!to) {
      setError("Select a destination account.");
      return;
    }
    if (from === to) {
      setError("Choose two different accounts.");
      return;
    }
    transferMu.mutate({
      from_account: from,
      to_account: to,
      amount: String(Math.abs(signed)),
      date,
      payee:
        payee.trim() ||
        (isPayment || selectedCategory?.name === "Credit Card Payment"
          ? "Credit card payment"
          : "Transfer"),
      from_category_id: transferCategory?.id ?? (categoryId || null),
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preset || !account) return;
    setError(null);
    const signed = signedAmount();
    if (signed == null) {
      setError("Enter a non-zero amount.");
      return;
    }

    if (isDedicatedTransfer) {
      submitTransfer(transferFromId as number, transferToId as number, signed);
      return;
    }

    if (categoryDrivenTransfer) {
      submitTransfer(preset.accountId, transferToId as number, signed);
      return;
    }

    createMu.mutate({
      account_id: preset.accountId,
      date,
      payee: payee.trim() || "—",
      amount: String(signed),
      category_id: categoryId || null,
    });
  }

  const pending = createMu.isPending || transferMu.isPending;
  const isCcPaymentCategory = selectedCategory?.name === "Credit Card Payment";

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-txn-title"
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between gap-2">
          <h2 id="quick-txn-title" className="text-lg font-semibold text-gray-900">
            {titleForMode(preset.mode)}
          </h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">
            Close
          </button>
        </div>
        {isBankTransfer && fromAccount && toAccount ? (
          <p className="px-4 pt-2 text-sm text-gray-600">
            {getEffectiveDisplayName(fromAccount)} → {getEffectiveDisplayName(toAccount)}
          </p>
        ) : isPayment && fromAccount && toAccount ? (
          <p className="px-4 pt-2 text-sm text-gray-600">
            {getEffectiveDisplayName(fromAccount)} → {getEffectiveDisplayName(toAccount)}
          </p>
        ) : null}
        {isPayment && paymentCard ? (
          <div className="px-4 pt-2">
            <PaymentPlannerSection
              card={paymentCard}
              accounts={accounts}
              planOption={paymentPlanOption}
              onPlanOptionChange={(opt) => applyPaymentPlanOption(opt, paymentCard)}
            />
          </div>
        ) : null}
        {!isPayment && categoryDrivenTransfer && toAccount ? (
          <p className="px-4 pt-2 text-sm text-gray-600">
            {getEffectiveDisplayName(account)} → {getEffectiveDisplayName(toAccount)}
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className="p-4 space-y-3 border-t border-gray-100">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div>
            <label className="block text-sm font-medium text-gray-700">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder="Payee or memo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              placeholder={preset.mode === "income" ? "Positive amount" : "Amount"}
              required
            />
          </div>
          {!isDedicatedTransfer ? (
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value ? Number(e.target.value) : "");
                  setTransferToId("");
                }}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {categories
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c: Category) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          {isBankTransfer ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">From account</label>
                <select
                  value={transferFromId}
                  onChange={(e) =>
                    setTransferFromId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select account</option>
                  {bankTransferAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">To account</label>
                <select
                  value={transferToId}
                  onChange={(e) =>
                    setTransferToId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select account</option>
                  {bankTransferAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          {isPayment ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">Pay from</label>
                <select
                  value={transferFromId}
                  onChange={(e) =>
                    setTransferFromId(e.target.value ? Number(e.target.value) : "")
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select account</option>
                  {bankTransferAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Credit card</label>
                <select
                  value={transferToId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : "";
                    setTransferToId(id);
                    if (id && paymentPlanOption !== "custom_amount") {
                      const card = debtPaymentAccounts.find((a) => a.id === id);
                      if (card) {
                        const next = amountForPaymentPlanOption(card, paymentPlanOption);
                        if (next) setAmount(next);
                      }
                    }
                  }}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select card</option>
                  {debtPaymentAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          {categoryDrivenTransfer ? (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                {isCcPaymentCategory ? "Credit card" : "Transfer to"}
              </label>
              <select
                value={transferToId}
                onChange={(e) =>
                  setTransferToId(e.target.value ? Number(e.target.value) : "")
                }
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                required
              >
                <option value="">
                  {isCcPaymentCategory ? "Select card" : "Select account"}
                </option>
                {categoryTransferDestinations.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatAccountOptionLabel(a)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 border border-gray-300 rounded text-sm hover:bg-gray-50"
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="py-2 px-4 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : isPayment ? "Record payment" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
