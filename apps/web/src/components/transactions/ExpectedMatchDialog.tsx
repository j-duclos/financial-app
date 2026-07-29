import { useEffect, useState } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { ImportMatchCandidate, ImportMatchDiagnostic } from "@budget-app/api-client";
import { getTransactionImportCandidates } from "@budget-app/api-client";
import { formatDateDisplay } from "./transactionsLedgerUtils";

const REASON_LABELS: Record<string, string> = {
  already_matched_to_another_row: "already matched to another row",
  already_matched_as_planned_row: "already matched as the expected row",
  marked_duplicate: "hidden as a duplicate import",
  ignored_import: "ignored import",
  reconciled: "reconciled — unlock the period to change it",
  not_a_bank_import: "manually entered, not a bank import",
  different_bank_transaction_id: "belongs to a different bank transaction",
  excluded_by_candidate_filters: "outside the match rules",
  planned_row_already_carries_a_bank_id: "this expected row already carries a bank id",
  planned_row_already_matched: "this expected row is already matched",
  planned_row_not_eligible: "this row cannot be matched",
  planned_row_has_no_amount: "this row has no amount",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

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
  const [diagnostics, setDiagnostics] = useState<ImportMatchDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTransactionImportCandidates(transactionId)
      .then((res) => {
        if (cancelled) return;
        setCandidates(res.candidates ?? []);
        setDiagnostics(res.diagnostics ?? []);
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
            <div>
              <p className="text-sm text-gray-500">No unmatched imports found for this expected row.</p>
              {diagnostics.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-700">Nearby bank rows were skipped:</p>
                  <ul className="mt-1 space-y-1">
                    {diagnostics.map((d, i) => (
                      <li key={d.transaction_id ?? `r-${i}`} className="text-xs text-gray-500">
                        {d.payee ? (
                          <span className="text-gray-700">
                            {d.date ? `${formatDateDisplay(d.date)} · ` : ""}
                            {d.payee}
                          </span>
                        ) : null}
                        {d.payee ? " — " : ""}
                        {reasonLabel(d.reason)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
                {c.reject ? ` · weak match (${reasonLabel(String(c.reject))})` : ""}
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
