import { useEffect, useMemo, useState } from "react";
import type { BillChecklistItem, BillOccurrenceDetail } from "@budget-app/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import {
  billLinkTransaction,
  getBillOccurrenceDetail,
  listTransactions,
  pauseRule,
  resumeRule,
} from "@budget-app/api-client";
import LinkBillTransactionModal from "../bills/LinkBillTransactionModal";
import { AUTOMATION_PATH } from "../../lib/automationDisplay";
import { linkTransactionDateBounds } from "../../lib/billLinkTransactionCandidates";
import {
  cadenceLabel,
  deriveRecurringPaymentStatus,
  formatRecurringDate,
  recurringConfidenceLabel,
  recurringPaymentStatusBadgeClass,
  recurringPaymentStatusLabel,
  pickChecklistOccurrenceForRule,
  splitRecurringBillPayments,
  type RecurringListItem,
} from "../../lib/recurringDisplay";
import { todayIsoDate } from "../../lib/timelineCalendarUtils";

function monthDateBounds(monthKey: string): { after: string; before: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    after: `${y}-${mm}-01`,
    before: `${y}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

type Props = {
  item: RecurringListItem;
  month: string;
  checklistItems: BillChecklistItem[];
  onClose: () => void;
  onLinkModalOpenChange?: (open: boolean) => void;
};

function Sparkline({ points }: { points: Array<{ label: string; amount: string | null }> }) {
  const values = points.map((p) => (p.amount ? parseFloat(p.amount) : 0));
  const max = Math.max(...values, 1);
  const w = 200;
  const h = 48;
  const coords = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12 text-blue-600" aria-hidden>
      <path d={coords.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function PaymentList({
  title,
  payments,
}: {
  title: string;
  payments: Array<{ id: number; date: string; amount: string; payee: string }>;
}) {
  if (payments.length === 0) return null;
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">{title}</h3>
      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {payments.map((p) => (
          <li key={p.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
            <span>
              {formatRecurringDate(p.date)} · {p.payee}
            </span>
            <span className="tabular-nums font-medium">{formatCurrency(p.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function RecurringDetailPanel({
  item,
  month,
  checklistItems,
  onClose,
  onLinkModalOpenChange,
}: Props) {
  const { rule, occurrence, paymentStatus: listStatus } = item;
  const queryClient = useQueryClient();
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkBill, setLinkBill] = useState<BillChecklistItem | null>(null);
  const [linkShowAllMonth, setLinkShowAllMonth] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<BillOccurrenceDetail | null>(null);

  const linkTarget = useMemo(() => {
    return (
      pickChecklistOccurrenceForRule(checklistItems, rule.id, todayIsoDate()) ?? occurrence ?? null
    );
  }, [checklistItems, rule.id, occurrence]);

  const detailOccurrenceId = linkTarget?.id;

  useEffect(() => {
    onLinkModalOpenChange?.(linkOpen);
  }, [linkOpen, onLinkModalOpenChange]);

  useEffect(() => {
    if (!linkOpen) {
      setLinkShowAllMonth(false);
      setLinkBill(null);
    }
  }, [linkOpen]);

  const monthBounds = useMemo(() => monthDateBounds(month), [month]);
  const linkBounds = useMemo(
    () => (linkBill ? linkTransactionDateBounds(linkBill.due_date) : monthBounds),
    [linkBill, monthBounds]
  );
  const linkQueryBounds = linkShowAllMonth ? monthBounds : linkBounds;

  const { data: linkTransactions, isLoading: linkTransactionsLoading } = useQuery({
    queryKey: [
      "transactions",
      "bill-link",
      month,
      linkBill?.account.id,
      linkQueryBounds.after,
      linkQueryBounds.before,
    ],
    queryFn: () =>
      listTransactions({
        account: linkBill!.account.id,
        date_after: linkQueryBounds.after,
        date_before: linkQueryBounds.before,
        page_size: 200,
      }),
    enabled: linkOpen && !!linkBill?.account.id,
  });

  const linkMutation = useMutation({
    mutationFn: ({ occurrenceId, transactionId }: { occurrenceId: number; transactionId: number }) =>
      billLinkTransaction(occurrenceId, transactionId),
    onSuccess: async (result, variables) => {
      setLinkOpen(false);
      setLinkError(null);
      setDetailSnapshot(result.detail);
      queryClient.setQueryData(["bill-detail", variables.occurrenceId], result.detail);
      const linked = result.detail.linked_transactions[0];
      setMatchNotice(
        linked
          ? `Matched ${formatRecurringDate(linked.date)} · ${linked.payee} (${formatCurrency(linked.amount)}).`
          : "Transaction matched."
      );
      await queryClient.invalidateQueries({ queryKey: ["bills-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
    },
    onError: (err: Error) => {
      setLinkError(err.message || "Could not link that transaction.");
    },
  });

  const { data: detailQuery, isLoading } = useQuery({
    queryKey: ["bill-detail", detailOccurrenceId],
    queryFn: () => getBillOccurrenceDetail(detailOccurrenceId!),
    enabled: !!detailOccurrenceId,
  });

  const data = detailSnapshot ?? detailQuery;

  useEffect(() => {
    setDetailSnapshot(null);
    setMatchNotice(null);
  }, [item.rule.id, detailOccurrenceId]);

  const lifecycleMutation = useMutation({
    mutationFn: async (action: "pause" | "resume") => {
      if (action === "pause") return pauseRule(rule.id);
      return resumeRule(rule.id);
    },
    onSuccess: (_data, action) => {
      setLifecycleNotice(action === "pause" ? "Rule paused." : "Rule resumed.");
      queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      queryClient.invalidateQueries({ queryKey: ["bills-overview"] });
    },
  });

  const occ = data?.occurrence ?? linkTarget ?? occurrence;
  const avgAmount = data?.occurrence?.average_amount ?? item.averageAmount;

  const displayStatus = useMemo(() => {
    if (!occ) return listStatus;
    return deriveRecurringPaymentStatus(rule, occ);
  }, [occ, listStatus, rule]);

  const { history: paymentHistory, forecast: paymentForecast } = useMemo(() => {
    if (!data?.payment_history?.length) {
      return { history: [], forecast: [] };
    }
    return splitRecurringBillPayments(data.payment_history, todayIsoDate());
  }, [data?.payment_history]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-xl border-l border-gray-200 flex flex-col">
      <div className="p-4 border-b flex justify-between items-start gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{rule.name}</h2>
          <p className="text-sm text-gray-500">
            {cadenceLabel(rule)} · {rule.account.effective_display_name ?? rule.account.name}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {!rule.active && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
              Paused
            </span>
          )}
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${recurringPaymentStatusBadgeClass(displayStatus)}`}
          >
            {recurringPaymentStatusLabel(displayStatus)}
          </span>
          {item.autopayLabel && (
            <span className="text-xs bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-full">
              {item.autopayLabel}
            </span>
          )}
          {item.confidence && (
            <span className="text-xs text-gray-600">
              Confidence: {recurringConfidenceLabel(item.confidence)}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Average amount</dt>
            <dd className="font-semibold text-lg">
              {avgAmount ? formatCurrency(avgAmount) : formatCurrency(rule.amount)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Cadence</dt>
            <dd className="font-medium">{cadenceLabel(rule)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Next scheduled</dt>
            <dd className="font-medium">{formatRecurringDate(item.nextOccurrence)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Last matched</dt>
            <dd className="font-medium">{formatRecurringDate(occ?.paid_date ?? item.lastPaidDate)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Category</dt>
            <dd className="font-medium">{item.categorySubtitle}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Status</dt>
            <dd className="font-medium">{rule.active ? "Active" : "Paused"}</dd>
          </div>
        </dl>

        {lifecycleNotice && (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {lifecycleNotice}
          </p>
        )}

        {matchNotice && (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            {matchNotice}
          </p>
        )}

        {isLoading && detailOccurrenceId && (
          <p className="text-sm text-gray-500">Loading payments…</p>
        )}

        {data?.amount_trend && data.amount_trend.some((p) => p.amount) && (
          <section>
            <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Amount history</h3>
            <Sparkline points={data.amount_trend} />
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-1">Recurring rule</h3>
          <p className="text-sm text-gray-800">{rule.name}</p>
          <Link
            to={`${AUTOMATION_PATH}?edit=${rule.id}`}
            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
          >
            Edit rule →
          </Link>
        </section>

        <PaymentList title="Payment history" payments={paymentHistory} />
        <PaymentList title="Payment forecast" payments={paymentForecast} />

        {data?.linked_transactions && data.linked_transactions.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">
              Linked transactions
            </h3>
            <ul className="space-y-2">
              {data.linked_transactions.map((t) => (
                <li key={t.id} className="flex justify-between text-sm">
                  <span>
                    {formatRecurringDate(t.date)} · {t.payee}
                  </span>
                  <span className="tabular-nums">{formatCurrency(t.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="p-4 border-t flex flex-wrap gap-2 bg-gray-50">
        {linkTarget && (
          <button
            type="button"
            disabled={linkMutation.isPending}
            onClick={() => {
              setLinkError(null);
              setLinkBill(linkTarget);
              setLinkOpen(true);
            }}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-white disabled:opacity-50"
          >
            Match from ledger
          </button>
        )}
        <Link
          to={`${AUTOMATION_PATH}?edit=${rule.id}`}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-white"
        >
          Edit rule
        </Link>
        {rule.active ? (
          <button
            type="button"
            disabled={lifecycleMutation.isPending}
            onClick={() => {
              setLifecycleNotice(null);
              lifecycleMutation.mutate("pause");
            }}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-white disabled:opacity-50"
          >
            {lifecycleMutation.isPending ? "Pausing…" : "Pause rule"}
          </button>
        ) : (
          <button
            type="button"
            disabled={lifecycleMutation.isPending}
            onClick={() => {
              setLifecycleNotice(null);
              lifecycleMutation.mutate("resume");
            }}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-white disabled:opacity-50"
          >
            {lifecycleMutation.isPending ? "Resuming…" : "Resume rule"}
          </button>
        )}
        <Link
          to={`/transactions?account=${rule.account.id}`}
          className="px-3 py-1.5 text-sm text-gray-600 hover:underline ml-auto"
        >
          Open ledger
        </Link>
      </div>

      {linkError && (
        <p className="px-4 pb-2 text-sm text-red-700 bg-red-50 border-t border-red-100">{linkError}</p>
      )}

      {linkOpen && linkBill && (
        <LinkBillTransactionModal
          bill={linkBill}
          transactions={linkTransactions?.results ?? []}
          isLoading={linkTransactionsLoading}
          isPending={linkMutation.isPending}
          error={linkError}
          showFullMonth={linkShowAllMonth}
          onToggleFullMonth={setLinkShowAllMonth}
          onClose={() => {
            setLinkOpen(false);
            setLinkError(null);
          }}
          onSelect={(transactionId) =>
            linkMutation.mutate({ occurrenceId: linkBill.id, transactionId })
          }
        />
      )}
    </div>
  );
}
