import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardUpcomingGroup } from "@budget-app/shared";
import HoverTooltip from "../HoverTooltip";
import { formatShortMonthDay } from "../../lib/dateDisplay";
import { FIRST_CASH_SHORTFALL } from "../../lib/dashboardTerminology";
import {
  UPCOMING_CALENDAR_PATH,
  UPCOMING_PREVIEW_TRANSFER_FOOTER,
  UPCOMING_SECTION_TITLE,
  buildUpcomingDashboardPreview,
  upcomingFullTimelineLinkLabel,
  upcomingPreviewAmountClass,
  upcomingPreviewBalanceClass,
  upcomingPreviewRowClass,
  type UpcomingPreviewNextIssue,
  type UpcomingPreviewTxnRow,
} from "../../lib/upcomingDisplay";

type Props = {
  groups: DashboardUpcomingGroup[];
  nextIssue?: UpcomingPreviewNextIssue;
};

function PreviewTransactionRow({ row }: { row: UpcomingPreviewTxnRow }) {
  const { txn, isFirstZeroCross } = row;
  const amountNum = txn.amount != null ? parseFloat(txn.amount) : null;
  const balanceNum = txn.balance_after != null ? parseFloat(txn.balance_after) : null;
  const isIncome = amountNum != null && amountNum > 0;

  return (
    <li
      className={`grid grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:grid-cols-[4.5rem_minmax(0,1fr)_5.75rem_5.75rem] gap-x-3 gap-y-0.5 py-1.5 border-b border-gray-100 last:border-0 text-sm items-baseline ${upcomingPreviewRowClass(isFirstZeroCross)}`}
    >
      <p className="text-xs text-gray-500">{formatShortMonthDay(txn.date)}</p>
      <p className="font-medium text-gray-900 truncate min-w-0">{txn.description}</p>
      <div className="text-right shrink-0 sm:contents">
        {txn.amount != null && amountNum != null && (
          <p
            className={`font-medium tabular-nums sm:text-right ${upcomingPreviewAmountClass(amountNum, txn)}`}
          >
            {isIncome ? "+" : ""}
            {formatCurrency(txn.amount)}
          </p>
        )}
        {txn.balance_after != null && balanceNum != null ? (
          <p className={`text-right ${upcomingPreviewBalanceClass(balanceNum, isFirstZeroCross)}`}>
            {formatCurrency(txn.balance_after)}
          </p>
        ) : (
          <p className="text-right text-gray-400">—</p>
        )}
      </div>
    </li>
  );
}

/** Compact dashboard preview: ~5 transactions with running balance, first shortfall, link to calendar. */
export default function UpcomingMoneyFlowPreview({ groups, nextIssue }: Props) {
  const preview = buildUpcomingDashboardPreview(groups, nextIssue);

  if (preview.transactions.length === 0) {
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
          <div className="flex items-center gap-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800/90">
              {FIRST_CASH_SHORTFALL.label}
            </p>
            <HoverTooltip label={FIRST_CASH_SHORTFALL.help}>
              <HelpCircle
                className="h-3.5 w-3.5 shrink-0 text-amber-700/80 hover:text-amber-900"
                aria-hidden
              />
            </HoverTooltip>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              {preview.nextRisk.accountName ? (
                <p className="font-semibold text-amber-950">{preview.nextRisk.accountName}</p>
              ) : null}
              <p className="text-amber-900">{formatShortMonthDay(preview.nextRisk.date)}</p>
            </div>
            {preview.nextRisk.projectedEndBalance != null ? (
              <div className="text-right">
                <p className="text-xs text-amber-800/90">{FIRST_CASH_SHORTFALL.amountLabel}</p>
                <p className="font-semibold tabular-nums text-red-800">
                  {formatCurrency(preview.nextRisk.projectedEndBalance)}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="min-w-[18rem]">
          {preview.truncated && preview.truncatedMessage ? (
            <p className="text-[11px] text-gray-500 mb-1.5">{preview.truncatedMessage}</p>
          ) : null}
          <div className="hidden sm:grid grid-cols-[4.5rem_minmax(0,1fr)_5.75rem_5.75rem] gap-x-3 px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            <span>Date</span>
            <span>Transaction</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Balance after</span>
          </div>
          <ul>
            {preview.transactions.map((row) => (
              <PreviewTransactionRow key={row.txn.id} row={row} />
            ))}
          </ul>
        </div>
      </div>

      {preview.anyTransfers ? (
        <p className="text-xs text-gray-500 pt-1 border-t border-gray-100">
          {UPCOMING_PREVIEW_TRANSFER_FOOTER}
        </p>
      ) : null}

      <div className="flex justify-end pt-0.5">
        <Link to={UPCOMING_CALENDAR_PATH} className="text-xs font-medium text-blue-600 hover:underline">
          {upcomingFullTimelineLinkLabel()}
        </Link>
      </div>
    </div>
  );
}

export function UpcomingMoneyFlowPreviewSection({
  groups,
  nextIssue,
}: Props) {
  return (
    <section aria-label={UPCOMING_SECTION_TITLE}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {UPCOMING_SECTION_TITLE}
      </h2>
      <UpcomingMoneyFlowPreview groups={groups} nextIssue={nextIssue} />
    </section>
  );
}
