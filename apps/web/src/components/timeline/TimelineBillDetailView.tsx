import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import {
  billLinkTransaction,
  billSnoozeWarning,
  getBillOccurrenceDetail,
  getBillsOverview,
  listTransactions,
} from "@budget-app/api-client";
import { AUTOMATION_PATH } from "../../lib/automationDisplay";
import { formatBillForecastImpact } from "../../lib/billForecastImpact";
import {
  billStatusBadgeClass,
  confidenceLabel,
  formatDueDateShort,
} from "../../lib/billsDisplay";
import {
  formatRuleCadenceLabel,
  timelineBillStatusLabel,
} from "../../lib/timelineBillDisplay";
import { parseAmount } from "../../lib/timelineCalendarUtils";
import {
  matchBillOccurrence,
  monthKeyFromIso,
} from "../../lib/timelineBillMatching";
import { paymentHistoryStatusLabel, resolveBillPaymentStatus } from "../../lib/billPaymentStatus";
import { linkTransactionDateBounds } from "../../lib/billLinkTransactionCandidates";
import { splitRecurringBillPayments } from "../../lib/recurringDisplay";
import { todayIsoDate } from "../../lib/timelineCalendarUtils";
import LinkBillTransactionModal from "../bills/LinkBillTransactionModal";

type Props = {
  day: TimelineCalendarDay;
  txn: TimelineCalendarTransaction;
  calendarDays?: TimelineCalendarDay[];
  onBack: () => void;
  onDataChange?: () => void;
};

type BillPaymentRow = {
  id: number;
  date: string;
  amount: string;
  payee: string;
  status: string;
  reconciled?: boolean;
};

function BillPaymentList({
  title,
  emptyMessage,
  payments,
}: {
  title: string;
  emptyMessage?: string;
  payments: BillPaymentRow[];
}) {
  if (payments.length === 0 && !emptyMessage) return null;

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">{title}</h3>
      {payments.length === 0 ? (
        emptyMessage ? <p className="text-sm text-gray-500">{emptyMessage}</p> : null
      ) : (
        <ul className="space-y-2 max-h-52 overflow-y-auto">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="text-sm flex justify-between gap-2 border-b border-gray-50 pb-1"
            >
              <span className="text-gray-700 min-w-0 truncate">
                {formatDueDateShort(payment.date)} · {payment.payee} ·{" "}
                {formatCurrency(payment.amount)} · {paymentHistoryStatusLabel(payment)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function TimelineBillDetailView({
  day,
  txn,
  calendarDays = [],
  onBack,
  onDataChange,
}: Props) {
  const queryClient = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkShowAllMonth, setLinkShowAllMonth] = useState(false);
  const month = monthKeyFromIso(day.date);

  const billsQuery = useQuery({
    queryKey: ["timeline-bills-overview", month],
    queryFn: () => getBillsOverview({ month, months_before: 0, months_after: 0 }),
  });

  const matchedOccurrence = useMemo(() => {
    const items = billsQuery.data?.checklist.items ?? [];
    return matchBillOccurrence(items, day, txn);
  }, [billsQuery.data, day, txn]);

  const detailQuery = useQuery({
    queryKey: ["timeline-bill-detail", matchedOccurrence?.id],
    queryFn: () => getBillOccurrenceDetail(matchedOccurrence!.id),
    enabled: matchedOccurrence != null,
  });

  const bounds = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, "0");
    return { after: `${y}-${mm}-01`, before: `${y}-${mm}-${String(last).padStart(2, "0")}` };
  }, [month]);

  const linkBounds = useMemo(
    () =>
      matchedOccurrence
        ? linkTransactionDateBounds(matchedOccurrence.due_date)
        : bounds,
    [matchedOccurrence, bounds]
  );
  const linkQueryBounds = linkShowAllMonth ? bounds : linkBounds;

  useEffect(() => {
    if (!linkOpen) setLinkShowAllMonth(false);
  }, [linkOpen]);

  const { data: monthTransactions, isLoading: linkTransactionsLoading } = useQuery({
    queryKey: [
      "transactions",
      month,
      matchedOccurrence?.account.id,
      linkQueryBounds.after,
      linkQueryBounds.before,
      linkOpen,
    ],
    queryFn: () =>
      listTransactions({
        account: matchedOccurrence?.account.id,
        date_after: linkQueryBounds.after,
        date_before: linkQueryBounds.before,
        page_size: 200,
      }),
    enabled: linkOpen && matchedOccurrence != null,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["timeline-bills-overview"] });
    queryClient.invalidateQueries({ queryKey: ["bills-overview"] });
    queryClient.invalidateQueries({ queryKey: ["timeline-bill-detail"] });
    queryClient.invalidateQueries({ queryKey: ["bill-detail"] });
    queryClient.invalidateQueries({ queryKey: ["timeline-calendar"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
    onDataChange?.();
  };

  const actionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      transactionId,
    }: {
      id: number;
      action: "link" | "snooze";
      transactionId?: number;
    }) => {
      if (action === "snooze") return billSnoozeWarning(id);
      if (action === "link" && transactionId) return billLinkTransaction(id, transactionId);
      throw new Error("Invalid action");
    },
    onSuccess: () => {
      setLinkOpen(false);
      invalidate();
    },
  });

  const occ = detailQuery.data?.occurrence ?? matchedOccurrence;
  const status = resolveBillPaymentStatus({
    dueDate: occ?.due_date ?? day.date,
    txn,
    occurrence: occ ?? matchedOccurrence,
  });
  const forecast = formatBillForecastImpact(day, txn, calendarDays);
  const canLink = occ && status !== "reconciled";
  const canSnooze = Boolean(occ?.warnings?.length);

  const { history: paymentHistory, forecast: paymentForecast } = useMemo(() => {
    const rows = detailQuery.data?.payment_history ?? [];
    if (!rows.length) return { history: [], forecast: [] };
    return splitRecurringBillPayments(rows, todayIsoDate());
  }, [detailQuery.data?.payment_history]);

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
        >
          ← Back to day
        </button>

        <header className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">{occ?.name ?? txn.description}</h2>
          <p className="text-sm text-gray-500">
            Due {formatDueDateShort(occ?.due_date ?? day.date)} · {txn.account_name}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${billStatusBadgeClass(status)}`}>
              {timelineBillStatusLabel(status)}
            </span>
            {occ?.autopay_label ? (
              <span className="text-xs bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded-full">
                {occ.autopay_label}
              </span>
            ) : null}
          </div>
        </header>

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-2">Payment summary</h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-gray-500">Amount</dt>
              <dd className="font-semibold text-lg tabular-nums">
                {formatCurrency(occ?.amount ?? txn.amount ?? "0")}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Last paid</dt>
              <dd className="font-medium">{occ?.paid_date ? formatDueDateShort(occ.paid_date) : "—"}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Average</dt>
              <dd className="font-medium">
                {occ?.average_amount ? formatCurrency(occ.average_amount) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Confidence</dt>
              <dd className="font-medium">
                {occ?.payment_confidence
                  ? confidenceLabel(occ.payment_confidence).split(" ")[0]
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Linked account</dt>
              <dd className="font-medium">{occ?.account.name ?? txn.account_name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Category</dt>
              <dd className="font-medium">{occ?.category?.name ?? txn.category ?? "—"}</dd>
            </div>
          </dl>
        </section>

        {detailQuery.isLoading && <p className="text-sm text-gray-500">Loading payments…</p>}

        {!detailQuery.isLoading && detailQuery.data ? (
          <>
            <BillPaymentList
              title="Payment history"
              payments={paymentHistory}
              emptyMessage="No matched payments yet. Use Match from ledger to link past charges."
            />
            <BillPaymentList title="Payment forecast" payments={paymentForecast} />
          </>
        ) : null}

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 mb-1">Recurring rule</h3>
          {detailQuery.data?.rule ? (
            <div className="text-sm space-y-0.5">
              <p className="font-medium text-gray-900">{detailQuery.data.rule.name}</p>
              <p className="text-gray-600">{formatRuleCadenceLabel(detailQuery.data.rule.frequency)}</p>
              <p className="text-gray-500 text-xs">
                {occ?.account.name ?? txn.account_name}
                {occ?.category?.name ? ` · ${occ.category.name}` : ""}
                {" · Active"}
              </p>
              <Link to={AUTOMATION_PATH} className="text-xs text-blue-600 hover:underline inline-block mt-1">
                Edit automation →
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No linked recurring rule found.</p>
          )}
        </section>

        <section
          className={`rounded-lg border p-3 ${
            forecast.tone === "risk" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <h3 className="text-xs font-semibold uppercase text-gray-600 mb-1">Forecast impact</h3>
          <p
            className={`text-sm font-medium ${
              forecast.tone === "risk" ? "text-amber-900" : "text-emerald-800"
            }`}
          >
            {forecast.headline}
          </p>
          {forecast.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
              {forecast.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </section>

        {occ?.warnings && occ.warnings.length > 0 && (
          <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
            {occ.warnings.map((warning) => (
              <li key={warning.id}>{warning.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-gray-200 px-4 py-3 flex flex-wrap gap-2 shrink-0 bg-gray-50">
        <Link
          to={`/transactions?date=${occ?.due_date ?? day.date}&account=${occ?.account.id ?? ""}`}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
        >
          Open in Transactions
        </Link>
        {detailQuery.data?.rule ? (
          <Link
            to={AUTOMATION_PATH}
            className="text-sm px-3 py-1.5 rounded-md border border-gray-300 bg-white hover:bg-gray-50"
          >
            Edit automation
          </Link>
        ) : null}
        {canLink && matchedOccurrence ? (
          <button
            type="button"
            disabled={actionMutation.isPending}
            onClick={() => setLinkOpen(true)}
            className="text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Match from ledger
          </button>
        ) : null}
        {canSnooze && matchedOccurrence ? (
          <button
            type="button"
            disabled={actionMutation.isPending}
            onClick={() => actionMutation.mutate({ id: matchedOccurrence.id, action: "snooze" })}
            className="text-sm text-gray-500 hover:underline ml-auto"
          >
            Snooze warning
          </button>
        ) : null}
      </div>

      {linkOpen && matchedOccurrence && (
        <LinkBillTransactionModal
          bill={matchedOccurrence}
          transactions={monthTransactions?.results ?? []}
          isLoading={linkTransactionsLoading}
          isPending={actionMutation.isPending}
          showFullMonth={linkShowAllMonth}
          onToggleFullMonth={setLinkShowAllMonth}
          onClose={() => setLinkOpen(false)}
          onSelect={(transactionId) =>
            actionMutation.mutate({
              id: matchedOccurrence.id,
              action: "link",
              transactionId,
            })
          }
        />
      )}
    </>
  );
}
