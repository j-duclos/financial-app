import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, FinancialGoal } from "@budget-app/shared";
import { contributeToBucket, previewBucketContribution } from "@budget-app/api-client";

type Props = {
  open: boolean;
  goal: FinancialGoal;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function ContributeModal({ open, goal, accounts, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [fromAccountId, setFromAccountId] = useState<number | "">("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<"transfer" | "manual">("transfer");

  const cashAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (a.status === "active" || !a.status) &&
          !a.is_hidden &&
          (a.account_type === "CHECKING" ||
            a.account_type === "SAVINGS" ||
            a.account_type === "CASH")
      ),
    [accounts]
  );

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setDate(today);
    setMethod(goal.linked_account || goal.linked_credit_account ? "transfer" : "manual");
    const defaultFrom = cashAccounts.find((a) => a.id !== goal.linked_account)?.id;
    setFromAccountId(defaultFrom ?? cashAccounts[0]?.id ?? "");
  }, [open, goal, cashAccounts, today]);

  const canPreview =
    open && fromAccountId !== "" && parseFloat(amount) > 0 && method === "transfer";

  const { data: preview } = useQuery({
    queryKey: ["bucket-contribute-preview", goal.id, fromAccountId, amount, date],
    queryFn: () =>
      previewBucketContribution(goal.id, {
        from_account: fromAccountId as number,
        amount,
        date,
      }),
    enabled: canPreview,
  });

  const contributeMu = useMutation({
    mutationFn: () =>
      contributeToBucket(goal.id, {
        from_account: fromAccountId !== "" ? (fromAccountId as number) : undefined,
        amount,
        date,
        method,
      }),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  if (!open) return null;

  const needsFromAccount = method === "transfer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Contribute to {goal.name}</h2>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
              Close
            </button>
          </div>

          <label className="block text-sm">
            <span className="text-gray-700">From account</span>
            <select
              value={fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value ? Number(e.target.value) : "")}
              disabled={method === "manual" && !goal.linked_account && !goal.is_debt_goal}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select account</option>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {getEffectiveDisplayName(a)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Amount</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <fieldset className="text-sm space-y-2">
            <legend className="text-gray-700 font-medium">How to record</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={method === "transfer"}
                onChange={() => setMethod("transfer")}
                disabled={!goal.linked_account && !goal.linked_credit_account}
              />
              Transfer to funding account
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={method === "manual"}
                onChange={() => setMethod("manual")}
              />
              Record manually
            </label>
          </fieldset>

          {preview && (
            <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm space-y-1">
              <p>
                <span className="text-gray-500">Current:</span>{" "}
                <span className="font-medium">{formatCurrency(preview.current_amount)}</span>
              </p>
              <p>
                <span className="text-gray-500">After:</span>{" "}
                <span className="font-medium text-green-800">
                  {formatCurrency(preview.after_amount)}
                </span>
              </p>
              {preview.safe_to_spend_before != null && preview.safe_to_spend_after != null && (
                <p className="text-xs text-gray-600 pt-1 border-t border-gray-200 mt-2">
                  <span className="text-gray-500">Forecast impact — Safe to spend:</span>{" "}
                  {formatCurrency(preview.safe_to_spend_before)} →{" "}
                  {formatCurrency(preview.safe_to_spend_after)}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                contributeMu.isPending ||
                !amount ||
                parseFloat(amount) <= 0 ||
                (needsFromAccount && fromAccountId === "")
              }
              onClick={() => contributeMu.mutate()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {contributeMu.isPending ? "Saving…" : method === "transfer" ? "Transfer" : "Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
