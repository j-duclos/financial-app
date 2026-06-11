import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { ReconcileTransactionRow } from "@budget-app/shared";
import { deleteTransaction } from "@budget-app/api-client";
import { ApiError } from "@budget-app/api-client";
import { formatDateDisplay } from "../../lib/dateDisplay";

function parseAmount(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  transactions: ReconcileTransactionRow[];
  periodLabel: string;
  onClose: () => void;
  onEdit: (txn: ReconcileTransactionRow) => void;
  onRemoved: (ids: number[]) => void;
};

export default function ReconcileRemainingPanel({
  transactions,
  periodLabel,
  onClose,
  onEdit,
  onRemoved,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length;

  const selectedTotal = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      if (selectedIds.has(t.id)) sum += parseAmount(t.amount);
    }
    return sum;
  }, [transactions, selectedIds]);

  const bulkDeleteMu = useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id) => deleteTransaction(id)));
      return ids;
    },
    onSuccess: (ids) => {
      setDeleteError(null);
      setSelectedIds(new Set());
      onRemoved(ids);
    },
    onError: (err: unknown) => {
      setDeleteError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map((t) => t.id)));
    }
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const msg =
      ids.length === 1
        ? `Delete the selected transaction?`
        : `Delete ${ids.length} selected transactions?`;
    if (window.confirm(msg)) {
      bulkDeleteMu.mutate(ids);
    }
  }

  if (transactions.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Review remaining transactions</h2>
          <p className="text-sm text-gray-600 mt-1">
            Reconciliation for {periodLabel} is saved. These {transactions.length} transaction
            {transactions.length === 1 ? "" : "s"} were not on your bank statement. Delete duplicates
            or mistakes, or edit each one individually.
          </p>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-amber-50/60">
          <div className="text-sm text-gray-700">
            {selectedIds.size > 0 ? (
              <>
                <span className="font-medium">{selectedIds.size} selected</span>
                <span className="text-gray-500 ml-2 tabular-nums">
                  ({formatCurrency(selectedTotal)} total)
                </span>
              </>
            ) : (
              <span className="text-gray-500">Select transactions to delete in bulk</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0 || bulkDeleteMu.isPending}
              className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {bulkDeleteMu.isPending ? "Deleting…" : "Delete selected"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1">
          <table className="min-w-full w-full table-fixed divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all remaining transactions"
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-[12%]">Date</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-[38%]">Payee</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 w-[20%]">Category</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-[15%]">Amount</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 w-[10%]">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((t) => {
                const amt = parseAmount(t.amount);
                return (
                  <tr
                    key={t.id}
                    className={selectedIds.has(t.id) ? "bg-amber-50/50" : "hover:bg-gray-50"}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                        aria-label={`Select ${t.payee}`}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {formatDateDisplay(t.date)}
                    </td>
                    <td className="px-3 py-2 min-w-0">
                      <span className="font-medium text-gray-900 block truncate" title={t.payee}>
                        {t.payee}
                      </span>
                      {t.memo ? (
                        <span className="block text-xs text-gray-500 truncate" title={t.memo}>
                          {t.memo}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{t.category ?? "—"}</td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-medium ${
                        amt >= 0 ? "text-green-700" : "text-red-700"
                      }`}
                    >
                      {formatCurrency(amt)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onEdit(t)}
                        className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
