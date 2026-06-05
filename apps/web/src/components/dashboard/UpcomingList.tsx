import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardUpcomingGroup, DashboardUpcomingTransaction } from "@budget-app/shared";
import DayHeatHeader from "../shared/DayHeatHeader";
import StickyMonthHeader from "../shared/StickyMonthHeader";
import { formatDateDisplay } from "../../lib/dateDisplay";
import { formatRecoveryChip } from "../../lib/dayRecoveryDisplay";
import {
  UPCOMING_CALENDAR_PATH,
  UPCOMING_PER_DAY_VISIBLE,
  dailyNetFromTotals,
  groupShowsTransferNote,
  groupUpcomingByMonth,
  initialUpcomingDayCollapsed,
  netColorClass,
  upcomingAccountFlowLabel,
  upcomingDisplayTransactions,
  upcomingDayCollapseLabel,
  upcomingDayShowMoreLabel,
  upcomingDayTransactionCount,
  upcomingDayTransactionSummary,
  upcomingEmptyMessage,
  upcomingKindBadgeClass,
  upcomingKindBadgeLabel,
  upcomingKindBadgeTitle,
  UPCOMING_KIND_BADGE_COLUMN,
  upcomingListUsesStickyScroll,
  upcomingTruncatedMessage,
  upcomingTimelineLinkLabel,
  upcomingTransferAccountsLabel,
} from "../../lib/upcomingDisplay";

function UpcomingTransactionRow({
  txn,
  dayTransactions,
}: {
  txn: DashboardUpcomingTransaction;
  dayTransactions: DashboardUpcomingTransaction[];
}) {
  const amountNum = txn.amount != null ? parseFloat(txn.amount) : null;
  const isCardPayment = txn.is_credit_card_payment;
  const isTransfer = !isCardPayment && (txn.is_transfer || txn.is_internal_transfer);
  const isIncome = !isTransfer && !isCardPayment && amountNum != null && amountNum > 0;
  const isExpense = amountNum != null && amountNum < 0;
  const routeLabel = upcomingTransferAccountsLabel(txn);
  const showFlowSubline =
    !routeLabel &&
    (txn.is_transfer || txn.is_internal_transfer || txn.is_credit_card_payment);

  return (
    <li
      className={`grid gap-x-2 gap-y-0.5 py-1.5 border-b border-gray-100 last:border-0 text-sm items-start ${
        txn.risk_flag ? "bg-amber-50/80 -mx-2 px-2 rounded" : ""
      }`}
      style={{
        gridTemplateColumns: `${UPCOMING_KIND_BADGE_COLUMN} minmax(0, 1fr) auto`,
      }}
    >
      <span
        title={upcomingKindBadgeTitle(txn)}
        className={`w-full text-center text-[10px] font-medium leading-tight px-1 py-0.5 rounded-full whitespace-nowrap ${upcomingKindBadgeClass(txn)}`}
      >
        {upcomingKindBadgeLabel(txn)}
      </span>
      <div className="min-w-0">
        <p className="font-medium text-gray-900 truncate">{txn.description}</p>
        <p className="text-xs text-gray-600 truncate">
          {routeLabel ?? txn.account_name}
        </p>
        {showFlowSubline && (
          <p className="text-xs text-gray-500 truncate">
            {upcomingAccountFlowLabel(txn, dayTransactions)}
          </p>
        )}
        {txn.balance_after != null && (
          <p className="text-xs text-gray-500">
            Balance after: {formatCurrency(txn.balance_after)}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        {txn.amount != null && (
          <p
            className={`font-medium ${
              isIncome ? "text-green-600" : isExpense ? "text-red-600" : "text-gray-900"
            }`}
          >
            {isIncome ? "+" : ""}
            {formatCurrency(txn.amount)}
          </p>
        )}
        {txn.risk_flag && (
          <AlertTriangle className="inline h-3.5 w-3.5 text-amber-600 mt-0.5" aria-label="Risk" />
        )}
      </div>
    </li>
  );
}

function UpcomingDayGroup({
  group,
  collapsed,
  onToggleCollapse,
  txnListExpanded,
  onToggleTxnListExpand,
}: {
  group: DashboardUpcomingGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  txnListExpanded: boolean;
  onToggleTxnListExpand: () => void;
}) {
  const dayLimit = group.visible_transaction_limit ?? UPCOMING_PER_DAY_VISIBLE;
  const net = dailyNetFromTotals(group.income_total, group.expense_total);
  const displayTxns = upcomingDisplayTransactions(group);
  const txnCount = upcomingDayTransactionCount(group);
  const hidden = Math.max(0, displayTxns.length - dayLimit);
  const showAllTxns = txnListExpanded || hidden === 0;
  const visibleTxns = showAllTxns ? displayTxns : displayTxns.slice(0, dayLimit);
  const recoveryChip = formatRecoveryChip(group);

  const dateTitle = formatDateDisplay(group.date);

  return (
    <section
      className="border-b border-gray-200 last:border-0 pb-3 last:pb-0"
      aria-label={`${dateTitle} ${group.day_of_week}`}
    >
      <DayHeatHeader
        day={group}
        dateTitle={dateTitle}
        dateSub={group.day_of_week}
        incomeTotal={group.income_total}
        expenseTotal={group.expense_total}
        netTotal={group.net_total}
        netColorClass={netColorClass(net)}
        compact
        trailing={
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {upcomingDayCollapseLabel(collapsed)}
          </button>
        }
      />
      {collapsed && (
        <p className="text-xs text-gray-500 -mt-1 mb-1 pl-2">
          {upcomingDayTransactionSummary(txnCount)}
          {recoveryChip ? (
            <span className="ml-2 text-emerald-700 font-medium">↗ {recoveryChip}</span>
          ) : null}
        </p>
      )}

      {!collapsed && (
        <>
          <ul>
            {visibleTxns.map((txn) => (
              <UpcomingTransactionRow key={txn.id} txn={txn} dayTransactions={displayTxns} />
            ))}
          </ul>

          {hidden > 0 && !txnListExpanded && (
            <button
              type="button"
              onClick={onToggleTxnListExpand}
              className="mt-1 text-xs text-blue-600 hover:underline"
            >
              {upcomingDayShowMoreLabel(hidden)}
            </button>
          )}
          {hidden > 0 && txnListExpanded && (
            <button
              type="button"
              onClick={onToggleTxnListExpand}
              className="mt-1 text-xs text-blue-600 hover:underline"
            >
              Show fewer
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function UpcomingList({
  groups,
  days,
  truncated,
}: {
  groups: DashboardUpcomingGroup[];
  days: number;
  truncated?: boolean;
}) {
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>(() =>
    initialUpcomingDayCollapsed(groups)
  );
  const [expandedTxnDays, setExpandedTxnDays] = useState<Record<string, boolean>>({});

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-3 text-sm text-gray-600">
        {upcomingEmptyMessage().replace("14", String(days))}
      </div>
    );
  }

  const anyTransferNote = groups.some(groupShowsTransferNote);
  const monthGroups = groupUpcomingByMonth(groups);
  const stickyMonths = upcomingListUsesStickyScroll(groups);

  const listBody = (
    <>
      {monthGroups.map(({ monthKey, monthLabel, items: dayGroups }) => (
        <div key={monthKey} className="mb-1 last:mb-0">
          <StickyMonthHeader
            monthKey={monthKey}
            label={monthLabel}
            sticky={stickyMonths}
            compact
            stickyTopClass="top-0"
          />
          {dayGroups.map((group) => (
            <UpcomingDayGroup
              key={group.date}
              group={group}
              collapsed={!!collapsedDays[group.date]}
              onToggleCollapse={() =>
                setCollapsedDays((prev) => ({
                  ...prev,
                  [group.date]: !prev[group.date],
                }))
              }
              txnListExpanded={!!expandedTxnDays[group.date]}
              onToggleTxnListExpand={() =>
                setExpandedTxnDays((prev) => ({
                  ...prev,
                  [group.date]: !prev[group.date],
                }))
              }
            />
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="bg-white rounded-lg shadow p-3 space-y-3">
      {truncated && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>{upcomingTruncatedMessage()}</span>
          <Link
            to={UPCOMING_CALENDAR_PATH}
            className="font-medium text-blue-700 hover:underline shrink-0"
          >
            {upcomingTimelineLinkLabel()}
          </Link>
        </div>
      )}
      {listBody}

      <div
        className={`flex flex-wrap items-center gap-2 pt-1.5 border-t border-gray-100 ${
          anyTransferNote ? "justify-between" : "justify-end"
        }`}
      >
        {anyTransferNote && (
          <p className="text-xs text-gray-500">
            Transfers are shown but excluded from daily net.
          </p>
        )}
        <Link to={UPCOMING_CALENDAR_PATH} className="text-sm text-blue-600 hover:underline shrink-0">
          {upcomingTimelineLinkLabel()}
        </Link>
      </div>
    </div>
  );
}
