import type { ImportMatchCandidate } from "@budget-app/api-client";
import {
  formatCurrency,
  MATCH_IMPORTED_TRANSACTION_LABEL,
  NO_IMPORT_CANDIDATES_MESSAGE,
} from "@budget-app/shared";

type Props = {
  open: boolean;
  plannedLabel: string;
  candidates: ImportMatchCandidate[];
  loading: boolean;
  loadError: string | null;
  matchError: string | null;
  matching: boolean;
  pendingCandidate: ImportMatchCandidate | null;
  onClose: () => void;
  onRetryLoad: () => void;
  onSelectCandidate: (candidate: ImportMatchCandidate) => void;
  onCancelConfirm: () => void;
  onConfirmMatch: () => void;
};

function formatCandidateDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ImportMatchDialog({
  open,
  plannedLabel,
  candidates,
  loading,
  loadError,
  matchError,
  matching,
  pendingCandidate,
  onClose,
  onRetryLoad,
  onSelectCandidate,
  onCancelConfirm,
  onConfirmMatch,
}: Props) {
  if (!open) return null;

  const confirming = pendingCandidate != null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-match-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="import-match-title" className="text-lg font-semibold text-gray-900">
          {confirming ? "Confirm match" : MATCH_IMPORTED_TRANSACTION_LABEL}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {confirming
            ? `Link "${plannedLabel}" to the selected bank import?`
            : `Choose the bank import that matches "${plannedLabel}".`}
        </p>

        {matchError ? (
          <div
            role="alert"
            className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {matchError}
          </div>
        ) : null}

        {confirming && pendingCandidate ? (
          <div className="mt-4 space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 px-3 py-3 text-sm">
              <p className="font-medium text-gray-900">{pendingCandidate.payee}</p>
              <p className="mt-1 text-gray-600">
                {formatCandidateDate(pendingCandidate.date)} ·{" "}
                {formatCurrency(pendingCandidate.amount)}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelConfirm}
                disabled={matching}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onConfirmMatch}
                disabled={matching}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {matching ? "Matching…" : "Match"}
              </button>
            </div>
          </div>
        ) : loading ? (
          <p className="mt-6 text-sm text-gray-600">Loading import candidates…</p>
        ) : loadError ? (
          <div className="mt-4 space-y-3">
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {loadError}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={onRetryLoad}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        ) : candidates.length === 0 ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-600">{NO_IMPORT_CANDIDATES_MESSAGE}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100 rounded border border-gray-200">
            {candidates.map((candidate) => (
              <li key={candidate.imported_transaction_id}>
                <button
                  type="button"
                  onClick={() => onSelectCandidate(candidate)}
                  className="block w-full px-3 py-3 text-left hover:bg-blue-50/60"
                >
                  <span className="block font-medium text-gray-900">{candidate.payee}</span>
                  <span className="mt-0.5 block text-xs text-gray-600">
                    {formatCandidateDate(candidate.date)} · {formatCurrency(candidate.amount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!confirming && !loading && !loadError && candidates.length > 0 ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={matching}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
