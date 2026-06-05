import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { ReconciliationSessionDetail, ReconciliationSessionSummary } from "@budget-app/shared";
import {
  markUndoableSessions,
  sessionStatusLabel,
} from "../../lib/reconcileHistoryDisplay";
import {
  getReconciliationSession,
  listReconciliationSessions,
  undoReconciliationSession,
} from "@budget-app/api-client";
import { ApiError } from "@budget-app/api-client";
import TransactionStatusIcons from "../transactions/TransactionStatusIcons";
import { formatDateDisplay, formatDateTimeDisplay } from "../../lib/dateDisplay";
import { isTransferCategoryName } from "../transactions/transactionsLedgerUtils";


function formatCompletedAt(iso: string | null | undefined): string {
  return formatDateTimeDisplay(iso);
}

function parseAmount(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  accountId: number;
  open: boolean;
  onClose: () => void;
  onUndoSuccess: () => void;
};

export default function ReconcileHistoryModal({ accountId, open, onClose, onUndoSuccess }: Props) {
  const queryClient = useQueryClient();
  const [detailId, setDetailId] = useState<number | null>(null);
  const [undoTarget, setUndoTarget] = useState<ReconciliationSessionSummary | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoSuccess, setUndoSuccess] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["reconcile-sessions", accountId],
    queryFn: () => listReconciliationSessions(accountId),
    enabled: open && !!accountId,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["reconcile-session", detailId],
    queryFn: () => getReconciliationSession(detailId as number),
    enabled: open && detailId != null,
  });

  const undoMu = useMutation({
    mutationFn: (sessionId: number) => undoReconciliationSession(sessionId),
    onSuccess: async (result) => {
      setUndoTarget(null);
      setDetailId(null);
      setUndoError(null);
      setUndoSuccess(
        `Reconciliation undone. ${result.transactions_unreconciled_count} transaction(s) marked unreconciled.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["reconcile-sessions", accountId] });
      onUndoSuccess();
    },
    onError: (err: unknown) => {
      setUndoError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  useEffect(() => {
    if (!open) {
      setDetailId(null);
      setUndoTarget(null);
      setUndoError(null);
      setUndoSuccess(null);
    }
  }, [open]);

  if (!open) return null;

  const sessions = markUndoableSessions(data?.results ?? []);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconcile-history-title"
        className="bg-white w-full sm:max-w-2xl rounded-t-xl sm:rounded-lg shadow-xl max-h-[90vh] overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 id="reconcile-history-title" className="text-lg font-semibold">
            {detailId != null ? "Reconciliation details" : "Reconciliation history"}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (detailId != null) setDetailId(null);
              else onClose();
            }}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            {detailId != null ? "Back" : "Close"}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {undoSuccess && (
            <p className="mb-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
              {undoSuccess}
            </p>
          )}

          {detailId != null ? (
            <SessionDetailView detail={detail} loading={detailLoading} />
          ) : (
            <>
              {isLoading && <p className="text-sm text-gray-500">Loading history…</p>}
              {error && (
                <p className="text-sm text-red-600">{(error as Error).message}</p>
              )}
              {!isLoading && !error && sessions.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">No reconciliation history yet.</p>
              )}
              <ul className="space-y-3">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="border border-gray-200 rounded-lg p-4 bg-gray-50/50"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <p className="font-medium text-gray-900">
                        {formatDateDisplay(session.period_start_date)} –{" "}
                        {formatDateDisplay(session.period_end_date)}
                      </p>
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          session.is_active
                            ? session.is_balanced
                              ? "bg-green-100 text-green-800"
                              : "bg-amber-100 text-amber-800"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {sessionStatusLabel(session)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">
                      {session.transaction_count} transaction
                      {session.transaction_count === 1 ? "" : "s"}
                    </p>
                    <p className="text-sm text-gray-600">
                      Bank balance: {formatCurrency(parseAmount(session.bank_balance))}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Completed: {formatCompletedAt(session.completed_at)}
                      {session.undone_at ? ` · Undone: ${formatCompletedAt(session.undone_at)}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setDetailId(session.id)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                      >
                        View details
                      </button>
                      {session.can_undo && (
                        <button
                          type="button"
                          onClick={() => {
                            setUndoError(null);
                            setUndoTarget(session);
                          }}
                          className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {undoTarget && (
          <UndoConfirmDialog
            session={undoTarget}
            error={undoError}
            pending={undoMu.isPending}
            onCancel={() => {
              setUndoTarget(null);
              setUndoError(null);
            }}
            onConfirm={() => undoMu.mutate(undoTarget.id)}
          />
        )}
      </div>
    </div>
  );
}

function SessionDetailView({
  detail,
  loading,
}: {
  detail: ReconciliationSessionDetail | undefined;
  loading: boolean;
}) {
  if (loading) return <p className="text-sm text-gray-500">Loading details…</p>;
  if (!detail) return <p className="text-sm text-gray-500">Session not found.</p>;

  return (
    <div className="space-y-4">
      <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <DetailRow label="Account" value={detail.account_name} />
        <DetailRow label="Period start" value={formatDateDisplay(detail.period_start_date)} />
        <DetailRow label="Period end" value={formatDateDisplay(detail.period_end_date)} />
        <DetailRow label="Opening balance" value={formatCurrency(parseAmount(detail.opening_balance))} />
        <DetailRow label="App balance" value={formatCurrency(parseAmount(detail.app_balance))} />
        <DetailRow label="Bank balance" value={formatCurrency(parseAmount(detail.bank_balance))} />
        <DetailRow label="Difference" value={formatCurrency(parseAmount(detail.difference))} />
        <DetailRow label="Completed" value={formatCompletedAt(detail.completed_at)} />
        {detail.completed_by && <DetailRow label="Completed by" value={detail.completed_by} />}
        <DetailRow label="Transactions" value={String(detail.transaction_count)} />
      </dl>

      <div>
        <h3 className="text-sm font-medium text-gray-800 mb-2">Transactions included</h3>
        {detail.transactions.length === 0 ? (
          <p className="text-sm text-gray-500">No transactions recorded for this session.</p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payee</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Balance</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {detail.transactions.map((t) => {
                  const amt = parseAmount(t.amount);
                  return (
                    <tr key={t.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateDisplay(t.date)}</td>
                      <td className="px-3 py-2">{t.payee}</td>
                      <td className="px-3 py-2">{t.category ?? "—"}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          amt >= 0 ? "text-green-700" : "text-red-700"
                        }`}
                      >
                        {formatCurrency(amt)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {t.reconciled_balance != null
                          ? formatCurrency(parseAmount(t.reconciled_balance))
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <TransactionStatusIcons
                          reconciled
                          txnSource={t.source}
                          transactionId={t.id}
                          type={amt >= 0 ? "INFLOW" : "OUTFLOW"}
                          direction={amt >= 0 ? "INFLOW" : "OUTFLOW"}
                          category_name={t.category ?? undefined}
                          description={t.payee}
                          readOnly={t.source === "INTEREST"}
                          hasTransferDestination={isTransferCategoryName(t.category ?? undefined)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 font-medium">{value}</dd>
    </>
  );
}

function UndoConfirmDialog({
  session,
  error,
  pending,
  onCancel,
  onConfirm,
}: {
  session: ReconciliationSessionSummary;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="undo-reconcile-title"
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="undo-reconcile-title" className="text-lg font-semibold mb-2">
          Undo reconciliation?
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          This will mark the transactions from this reconciliation as unreconciled again.
          Transactions will not be deleted or changed.
        </p>
        <ul className="text-sm text-gray-700 space-y-1 mb-4">
          <li>
            Period: {formatDateDisplay(session.period_start_date)} –{" "}
            {formatDateDisplay(session.period_end_date)}
          </li>
          <li>Transactions: {session.transaction_count}</li>
          <li>Bank balance: {formatCurrency(parseAmount(session.bank_balance))}</li>
        </ul>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Undoing…" : "Undo reconciliation"}
          </button>
        </div>
      </div>
    </div>
  );
}
