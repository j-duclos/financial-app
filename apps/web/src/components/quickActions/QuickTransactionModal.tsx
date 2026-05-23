import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatAccountOptionLabel, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, Category } from "@budget-app/shared";
import { createTransaction, createTransfer, listCategories } from "@budget-app/api-client";

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
      return "Pay credit card";
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
  const householdId = account?.household?.id;

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
  const [error, setError] = useState<string | null>(null);

  const isTransfer =
    preset?.mode === "transfer" ||
    preset?.mode === "credit_card_payment";
  const isPayment = preset?.mode === "credit_card_payment";

  const transferCategory = useMemo(() => {
    const name = isPayment ? "Credit Card Payment" : "Bank Transfer";
    return categories.find((c: Category) => c.name === name) ?? null;
  }, [categories, isPayment]);

  const counterpartyAccounts = useMemo(() => {
    if (!account) return [];
    return accounts.filter(
      (a) =>
        a.id !== account.id &&
        a.household?.id === account.household?.id &&
        (isPayment ? a.account_type === "CREDIT" : true)
    );
  }, [account, accounts, isPayment]);

  useEffect(() => {
    if (!open || !preset) return;
    setDate(todayStr());
    setPayee(preset.defaultPayee ?? "");
    setAmount(preset.defaultAmount ?? "");
    setError(null);
    setCategoryId(transferCategory?.id ?? "");
    if (preset.mode === "credit_card_payment") {
      setTransferFromId(preset.transferFromAccountId ?? preset.accountId);
      setTransferToId(preset.transferToAccountId ?? "");
    } else if (preset.mode === "transfer") {
      setTransferFromId(preset.transferFromAccountId ?? preset.accountId);
      setTransferToId(preset.transferToAccountId ?? "");
    } else {
      setTransferFromId("");
      setTransferToId("");
    }
  }, [open, preset, transferCategory?.id]);

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
    if (isTransfer) return -abs;
    if (preset!.mode === "income" || preset!.mode === "contribution") return abs;
    if (preset!.mode === "purchase" && account!.account_type === "CREDIT") return -abs;
    return -abs;
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

    if (isTransfer) {
      const from = (transferFromId || preset.accountId) as number;
      const to = transferToId as number;
      if (!to) {
        setError("Select a destination account.");
        return;
      }
      transferMu.mutate({
        from_account: from,
        to_account: to,
        amount: String(Math.abs(signed)),
        date,
        payee: payee.trim() || (isPayment ? "Credit card payment" : "Transfer"),
        from_category_id: transferCategory?.id ?? (categoryId || null),
      });
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
        <p className="px-4 pt-2 text-sm text-gray-600">
          {getEffectiveDisplayName(account)}
          {isTransfer && transferToId
            ? ` → ${getEffectiveDisplayName(accounts.find((a) => a.id === transferToId)!)}`
            : ""}
        </p>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
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
          {!isTransfer ? (
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
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
          ) : (
            <>
              {preset.mode === "credit_card_payment" ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Pay from</label>
                  <select
                    value={transferFromId}
                    onChange={(e) => setTransferFromId(Number(e.target.value))}
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  >
                    {accounts
                      .filter(
                        (a) =>
                          a.account_type !== "CREDIT" &&
                          a.household?.id === account.household?.id
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {formatAccountOptionLabel(a)}
                        </option>
                      ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  {isPayment ? "Credit card" : "To account"}
                </label>
                <select
                  value={transferToId}
                  onChange={(e) => setTransferToId(Number(e.target.value))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Select account</option>
                  {counterpartyAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
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
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
