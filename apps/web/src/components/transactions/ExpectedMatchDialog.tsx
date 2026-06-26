import { useEffect, useState } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { ImportMatchCandidate } from "@budget-app/api-client";
import { getTransactionImportCandidates } from "@budget-app/api-client";
import { formatDateDisplay } from "./transactionsLedgerUtils";

type Props = {
  transactionId: number;
  label: string;
  currency: string;
  onMatch: (importedTransactionId: number) => void;
  onClose: () => void;
  pending?: boolean;
};

export default function ExpectedMatchDialog({
  transactionId,
  label,
  currency,
  onMatch,
  onClose,
  pending,
}: Props) {
  const [candidates, setCandidates] = useState<ImportMatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTransactionImportCandidates(transactionId)
      .then((res) => {
        if (!cancelled) setCandidates(res.candidates ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load candidates");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Match imported transaction</h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate" title={label}>
            For expected: {label}
          </p>
        </div>
        <div className="max-h-72 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-gray-500">Loading candidates…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && candidates.length === 0 && (
            <p className="text-sm text-gray-500">No unmatched imports found for this expected row.</p>
          )}
          {candidates.map((c) => (
            <button
              key={c.imported_transaction_id}
              type="button"
              disabled={pending}
              onClick={() => onMatch(c.imported_transaction_id)}
              className="w-full text-left rounded-md border border-gray-200 px-3 py-2 mb-2 hover:bg-blue-50 hover:border-blue-200 disabled:opacity-50"
            >
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium text-gray-900 truncate">{c.payee}</span>
                <span className="tabular-nums shrink-0">{formatCurrency(parseFloat(c.amount), currency)}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {formatDateDisplay(c.date)} · score {c.score}
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
