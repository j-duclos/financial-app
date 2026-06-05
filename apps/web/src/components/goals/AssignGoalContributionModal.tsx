import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { FinancialGoal, Transaction } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { assignGoalContribution, listAllBuckets } from "@budget-app/api-client";
import { formatDateDisplay } from "../../lib/dateDisplay";

type SplitLine = { bucketId: number | ""; amount: string };

type Props = {
  open: boolean;
  transaction: Transaction;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AssignGoalContributionModal({
  open,
  transaction,
  onClose,
  onSuccess,
}: Props) {
  const [lines, setLines] = useState<SplitLine[]>([{ bucketId: "", amount: "" }]);

  const { data: buckets = [] } = useQuery({
    queryKey: ["buckets", "assign"],
    queryFn: () => listAllBuckets(),
    enabled: open,
  });

  const activeBuckets = useMemo(
    () =>
      buckets.filter(
        (b: FinancialGoal) =>
          (b.status === "active" || b.status === "paused") &&
          (!b.linked_account || b.linked_account === transaction.account)
      ),
    [buckets, transaction.account]
  );

  const txnAmount = Math.abs(parseFloat(transaction.amount));

  useEffect(() => {
    if (!open) return;
    setLines([{ bucketId: "", amount: String(txnAmount || "") }]);
  }, [open, transaction.id, txnAmount]);

  const assignMu = useMutation({
    mutationFn: async () => {
      for (const line of lines) {
        if (!line.bucketId || !line.amount || parseFloat(line.amount) <= 0) continue;
        await assignGoalContribution({
          bucket: line.bucketId as number,
          transaction: transaction.id,
          amount: line.amount,
        });
      }
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  if (!open) return null;

  const splitTotal = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Assign to goal bucket</h2>
            <button type="button" onClick={onClose} className="text-gray-500">
              Close
            </button>
          </div>
          <p className="text-sm text-gray-600">
            Transaction: {transaction.payee || "—"} · {formatCurrency(transaction.amount)} on{" "}
            {formatDateDisplay(transaction.date)}
          </p>

          {activeBuckets.length === 0 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              No active buckets for this account. Create a goal and link this account first.
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-end">
                  <label className="flex-1 text-sm">
                    <span className="text-gray-600">Bucket</span>
                    <select
                      value={line.bucketId}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx
                              ? { ...l, bucketId: e.target.value ? Number(e.target.value) : "" }
                              : l
                          )
                        )
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">Select</option>
                      {activeBuckets.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="w-28 text-sm">
                    <span className="text-gray-600">Amount</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={line.amount}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) => (i === idx ? { ...l, amount: e.target.value } : l))
                        )
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>
              ))}
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => setLines((prev) => [...prev, { bucketId: "", amount: "" }])}
              >
                + Split across another bucket
              </button>
              {txnAmount > 0 && splitTotal > txnAmount + 0.01 && (
                <p className="text-xs text-red-600">Split total exceeds transaction amount.</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={assignMu.isPending || activeBuckets.length === 0}
              onClick={() => assignMu.mutate()}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md disabled:opacity-50"
            >
              {assignMu.isPending ? "Saving…" : "Assign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
