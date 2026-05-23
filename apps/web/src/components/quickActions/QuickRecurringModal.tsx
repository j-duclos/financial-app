import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatAccountOptionLabel, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, Category, RecurringRuleFrequency } from "@budget-app/shared";
import { createRule, listCategories } from "@budget-app/api-client";

export type QuickRecurringPreset = {
  accountId: number;
  householdId: number;
  direction: "INCOME" | "EXPENSE" | "TRANSFER";
  transferToAccountId?: number;
  defaultAmount?: string;
  defaultName?: string;
};

type Props = {
  open: boolean;
  preset: QuickRecurringPreset | null;
  accounts: Account[];
  onClose: () => void;
  onSuccess: (message: string) => void;
};

export default function QuickRecurringModal({
  open,
  preset,
  accounts,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const account = accounts.find((a) => a.id === preset?.accountId);

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "quick-rule", preset?.householdId],
    queryFn: () =>
      listCategories({ page_size: 500, household: preset!.householdId }),
    enabled: open && !!preset?.householdId,
  });

  const categories = categoriesData?.results ?? [];

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [transferToId, setTransferToId] = useState<number | "">("");
  const [frequency, setFrequency] = useState<RecurringRuleFrequency>("MONTHLY_DAY");
  const [dayOfMonth, setDayOfMonth] = useState(15);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const transferCategory = useMemo(() => {
    const name =
      preset?.direction === "TRANSFER" ? "Bank Transfer" : null;
    if (!name) return null;
    return categories.find((c: Category) => c.name === name || c.name === "Credit Card Payment");
  }, [categories, preset?.direction]);

  useEffect(() => {
    if (!open || !preset) return;
    setName(preset.defaultName ?? "");
    setAmount(preset.defaultAmount ?? "");
    setTransferToId(preset.transferToAccountId ?? "");
    setCategoryId(transferCategory?.id ?? "");
    setError(null);
    setStartDate(new Date().toISOString().slice(0, 10));
    setEndDate("");
  }, [open, preset, transferCategory?.id]);

  const createMu = useMutation({
    mutationFn: createRule,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
      onSuccess("Recurring schedule created.");
      onClose();
    },
    onError: (err: Error) => setError(err.message || "Could not create schedule"),
  });

  if (!open || !preset || !account) return null;

  const counterpartyAccounts = accounts.filter(
    (a) => a.id !== account.id && a.household?.id === account.household?.id
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preset || !account) return;
    setError(null);
    if (!name.trim() || !amount.trim()) {
      setError("Name and amount are required.");
      return;
    }
    const selectedCat = categories.find((c: Category) => c.id === categoryId);
    const catName = selectedCat?.name ?? "";
    const transferAllowed =
      catName === "Credit Card Payment" || catName === "Bank Transfer";

    createMu.mutate({
      household: preset.householdId,
      name: name.trim(),
      account_id: preset.accountId,
      transfer_to_account_id:
        transferAllowed && transferToId ? (transferToId as number) : null,
      category_id: categoryId || null,
      direction: preset.direction,
      amount,
      currency: account.currency || "USD",
      frequency,
      interval: 1,
      day_of_month: frequency === "MONTHLY_DAY" ? dayOfMonth : undefined,
      start_date: startDate,
      end_date: endDate || null,
      active: true,
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-lg shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Schedule recurring</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500">
            Close
          </button>
        </div>
        <p className="px-4 pt-2 text-sm text-gray-600">{getEffectiveDisplayName(account)}</p>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>
          {preset.direction === "TRANSFER" ? (
            <div>
              <label className="block text-sm font-medium text-gray-700">Transfer to</label>
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
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {categories.map((c: Category) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringRuleFrequency)}
                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="MONTHLY_DAY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
              </select>
            </div>
            {frequency === "MONTHLY_DAY" ? (
              <div>
                <label className="block text-sm font-medium text-gray-700">Day of month</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">End (optional)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="py-2 px-4 border rounded text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMu.isPending}
              className="py-2 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
            >
              {createMu.isPending ? "Saving…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
