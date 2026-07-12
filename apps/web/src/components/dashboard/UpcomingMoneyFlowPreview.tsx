import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardUpcomingGroup, DashboardUpcomingTransaction } from "@budget-app/shared";
import { formatDateDisplay } from "../../lib/dateDisplay";
import {
  UPCOMING_CALENDAR_PATH,
  UPCOMING_PREVIEW_TRANSFER_FOOTER,
  UPCOMING_SECTION_TITLE,
  buildUpcomingDashboardPreview,
  dailyNetFromTotals,
  groupUpcomingByMonth,
  netColorClass,
  upcomingKindBadgeLabel,
  upcomingPreviewProjectedEndBalance,
  upcomingTimelineLinkLabel,
} from "../../lib/upcomingDisplay";

type Props = {
  groups: DashboardUpcomingGroup[];
  nextIssue?: {
    risk_date: string | null;
    account_name?: string;
    reason?: string;
  } | null;
};

function PreviewTransactionRow({ txn }: { txn: DashboardUpcomingTransaction }) {
  const amountNum = txn.amount != null ? parseFloat(txn.amount) : null;
  const isCardPayment = txn.is_credit_card_payment;
  const isTransfer = !isCardPayment && (txn.is_transfer || txn.is_internal_transfer);
  const isIncome = !isTransfer && !isCardPayment && amountNum != null && amountNum > 0;
  const isExpense = amountNum != null && amountNum < 0;

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 border-b border-gray-100 last:border-0 text-sm items-start">
      <p className="text-xs text-gray-500 pt-0.5">{formatDateDisplay(txn.date)}</p>
      <div className="min-w-0">
        <p className="font-medium text-gray-900 truncate">{txn.description}</p>
        <p className="text-xs text-gray-500">{upcomingKindBadgeLabel(txn)}</p>
      </div>
      <div className="text-right shrink-0">
        {txn.amount != null && (
          <p
            className={`font-medium tabular-nums ${
              isIncome ? "text-green-600" : isExpense ? "text-red-600" : "text-gray-900"
            }`}
          >
            {isIncome ? "+" : ""}
            {formatCurrency(txn.amount)}
          </p>
        )}
      </div>
    </li>
  );
}

function PreviewDaySummary({
  group,
  accountName,
  firstNegativeWarning,
}: {
  group: DashboardUpcomingGroup;
  accountName?: string | null;
  firstNegativeWarning?: string | null;
}) {
  const net = dailyNetFromTotals(group.income_total, group.expense_total);
  const endBalance = upcomingPreviewProjectedEndBalance(group, accountName);

  return (
    <div className="mt-2 mb-3 pt-2 border-t border-dashed border-gray-200 text-sm space-y-1">
      <p className="text-xs font-medium text-gray-700">{formatDateDisplay(group.date)}</p>
      {firstNegativeWarning ? (
        <p className="text-xs text-amber-800 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
          <span>{firstNegativeWarning}</span>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs max-w-md">
        <div>
          <span className="text-gray-500">Income</span>
          <p className="text-green-700 font-medium tabular-nums">
            +{formatCurrency(group.income_total)}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Expenses</span>
          <p className="text-red-700 font-medium tabular-nums">
            -{formatCurrency(group.expense_total)}
          </p>
        </div>
        <div>
          <span className="text-gray-500">Net</span>
          <p className={`font-medium tabular-nums ${netColorClass(net)}`}>
            {net > 0 ? "+" : ""}
            {formatCurrency(net.toFixed(2))}
          </p>
        </div>
        {endBalance != null ? (
          <div>
            <span className="text-gray-500">Projected end-of-day balance</span>
            <p
              className={`font-medium tabular-nums ${
                parseFloat(endBalance) < 0 ? "text-red-700" : "text-gray-900"
              }`}
            >
              {formatCurrency(endBalance)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Compact dashboard preview: 7 days, max 5 items, next risk day, link to calendar. */
export default function UpcomingMoneyFlowPreview({ groups, nextIssue }: Props) {
  const preview = buildUpcomingDashboardPreview(groups, nextIssue);

  if (preview.days.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-3 text-sm text-gray-600">
        No upcoming transactions in the next {preview.daysHorizon} days.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-3 space-y-3">
      {preview.nextRisk ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800/90">
            Next cash risk
          </p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              {preview.nextRisk.accountName ? (
                <p className="font-semibold text-amber-950">{preview.nextRisk.accountName}</p>
              ) : null}
              <p className="text-amber-900">{formatDateDisplay(preview.nextRisk.date)}</p>
            </div>
            {preview.nextRisk.projectedEndBalance != null ? (
              <div className="text-right">
                <p className="text-xs text-amber-800/90">Projected end-of-day balance</p>
                <p className="font-semibold tabular-nums text-amber-950">
                  {formatCurrency(preview.nextRisk.projectedEndBalance)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview.truncated && preview.truncatedMessage ? (
        <p className="text-xs text-amber-900 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
          {preview.truncatedMessage}
        </p>
      ) : null}

      <div>
        {(preview.spansMultipleMonths
          ? groupUpcomingByMonth(preview.groups)
          : [{ monthKey: "single", monthLabel: "", items: preview.days.map((d) => d.group) }]
        ).map(({ monthKey, monthLabel, items }) => {
          const dayBlocks = preview.days.filter((d) => items.some((g) => g.date === d.group.date));
          return (
            <div key={monthKey} className="mb-2 last:mb-0">
              {preview.spansMultipleMonths && monthLabel ? (
                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {monthLabel}
                </p>
              ) : null}
              {dayBlocks.map((dayBlock) => (
                <div key={dayBlock.group.date} className="mb-1 last:mb-0">
                  <ul>
                    {dayBlock.transactions.map((txn) => (
                      <PreviewTransactionRow key={txn.id} txn={txn} />
                    ))}
                  </ul>
                  <PreviewDaySummary
                    group={dayBlock.group}
                    accountName={preview.nextRisk?.accountName}
                    firstNegativeWarning={dayBlock.firstNegativeWarning}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {preview.anyTransfers ? (
        <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">
          {UPCOMING_PREVIEW_TRANSFER_FOOTER}
        </p>
      ) : null}
    </div>
  );
}

export function UpcomingMoneyFlowPreviewSection({
  groups,
  nextIssue,
}: Props) {
  return (
    <section aria-label={UPCOMING_SECTION_TITLE}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {UPCOMING_SECTION_TITLE}
        </h2>
        <Link to={UPCOMING_CALENDAR_PATH} className="text-xs text-blue-600 hover:underline shrink-0">
          {upcomingTimelineLinkLabel()}
        </Link>
      </div>
      <UpcomingMoneyFlowPreview groups={groups} nextIssue={nextIssue} />
    </section>
  );
}
