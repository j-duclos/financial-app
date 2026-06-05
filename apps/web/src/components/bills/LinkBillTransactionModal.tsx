import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { BillChecklistItem, Transaction } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDueDateShort } from "../../lib/billsDisplay";
import { rankTransactionsForBillLink } from "../../lib/billLinkTransactionCandidates";

type Props = {
  bill: BillChecklistItem;
  transactions: Transaction[];
  isLoading?: boolean;
  isPending?: boolean;
  error?: string | null;
  /** When false, list is limited to dates near the due date; toggle expands to full month. */
  showFullMonth: boolean;
  onToggleFullMonth: (show: boolean) => void;
  onClose: () => void;
  onSelect: (transactionId: number) => void;
};

function LedgerRow({
  txn,
  disabled,
  onSelect,
}: {
  txn: Transaction;
  disabled?: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        className="w-full text-left px-3 py-2.5 text-sm rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 disabled:opacity-50"
        onClick={() => onSelect(txn.id)}
      >
        <div className="flex justify-between gap-3 items-baseline">
          <span className="font-medium text-gray-900 truncate">{txn.payee}</span>
          <span className="tabular-nums font-medium shrink-0">{formatCurrency(txn.amount)}</span>
        </div>
        <div className="text-xs text-gray-500 mt-0.5">{formatDueDateShort(txn.date)}</div>
      </button>
    </li>
  );
}

export default function LinkBillTransactionModal({
  bill,
  transactions,
  isLoading,
  isPending,
  error,
  showFullMonth,
  onToggleFullMonth,
  onClose,
  onSelect,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(
      (t) =>
        t.payee.toLowerCase().includes(q) ||
        (t.memo ?? "").toLowerCase().includes(q)
    );
  }, [transactions, search]);

  const { suggested, other } = useMemo(
    () => rankTransactionsForBillLink(filtered, bill),
    [filtered, bill]
  );

  const showSuggestedSections = !showFullMonth && !search.trim();

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        role="dialog"
        aria-labelledby="link-bill-title"
      >
        <div className="p-4 border-b shrink-0">
          <div className="flex justify-between items-start gap-2">
            <div>
              <h2 id="link-bill-title" className="font-semibold text-gray-900">
                Match from ledger — {bill.name}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Due {formatDueDateShort(bill.due_date)} · {bill.account.name} ·{" "}
                {formatCurrency(bill.amount)}
              </p>
            </div>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-800 text-xl leading-none"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="text-sm text-gray-600 mt-3">
            Choose the bank charge from your account that paid this bill. Forecasted rule rows are
            hidden — only real ledger transactions can be matched.
          </p>
          <input
            type="search"
            placeholder="Search payee or memo…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            autoFocus
          />
          {error ? (
            <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          ) : null}
        </div>

        <div className="overflow-y-auto flex-1 p-2 min-h-0">
          {isLoading && <p className="text-sm text-gray-500 px-3 py-4">Loading ledger…</p>}

          {!isLoading && filtered.length === 0 && (
            <p className="text-sm text-gray-500 px-3 py-4">
              No transactions found{search ? " for that search" : " in this date range"}.
            </p>
          )}

          {!isLoading && showSuggestedSections && suggested.length > 0 && (
            <section className="mb-3">
              <h3 className="text-xs font-semibold uppercase text-gray-500 px-3 py-1">
                Likely matches
              </h3>
              <ul className="space-y-0.5">
                {suggested.map(({ txn }) => (
                  <LedgerRow key={txn.id} txn={txn} disabled={isPending} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          )}

          {!isLoading && showSuggestedSections && other.length > 0 && (
            <section className="mb-3">
              <h3 className="text-xs font-semibold uppercase text-gray-500 px-3 py-1">
                Other nearby
              </h3>
              <ul className="space-y-0.5">
                {other.map(({ txn }) => (
                  <LedgerRow key={txn.id} txn={txn} disabled={isPending} onSelect={onSelect} />
                ))}
              </ul>
            </section>
          )}

          {!isLoading && (!showSuggestedSections || (suggested.length === 0 && other.length === 0)) && (
            <ul className="space-y-0.5">
              {filtered.map((txn) => (
                <LedgerRow key={txn.id} txn={txn} disabled={isPending} onSelect={onSelect} />
              ))}
            </ul>
          )}
        </div>

        <div className="p-3 border-t shrink-0 flex flex-wrap items-center justify-between gap-2 bg-gray-50">
          <button
            type="button"
            className="text-sm text-blue-600 hover:underline"
            onClick={() => onToggleFullMonth(!showFullMonth)}
          >
            {showFullMonth
              ? "Show only dates near due date"
              : "Show all transactions this month"}
          </button>
          <button
            type="button"
            className="text-sm text-gray-600 hover:text-gray-800"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
