import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getBillsOverview } from "@budget-app/api-client";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { Link } from "react-router-dom";
import { ChevronRight, TrendingUp } from "lucide-react";
import DayHeatHeader from "../shared/DayHeatHeader";
import { AUTOMATION_PATH } from "../../lib/automationDisplay";
import { formatDateDisplay } from "../../lib/dateDisplay";
import {
  formatDayDetailLowestSection,
  lowestMarkerSeverity,
} from "../../lib/dayLowestBalanceDisplay";
import { severityTokens } from "../../lib/severity";
import {
  dayHeatReason,
  dayHeatShowsReason,
  resolveDayHeatLevel,
} from "../../lib/dayHeatDisplay";
import {
  formatRecoveryBanner,
  formatRecoveryDaysUntil,
  hasRecoveryInfo,
  recoveryChipClass,
} from "../../lib/dayRecoveryDisplay";
import { determineForecastSeverity } from "../../lib/forecastSeverity";
import { netColorClass } from "../../lib/upcomingDisplay";
import {
  determineRiskContributionLabels,
  formatShortMoney,
  groupTransactionsByKind,
  parseAmount,
  type TimelineHorizon,
} from "../../lib/timelineCalendarUtils";
import { resolveBillPaymentStatus } from "../../lib/billPaymentStatus";
import { isRecurringBillTransaction, matchBillOccurrence, monthKeyFromIso } from "../../lib/timelineBillMatching";
import { timelineBillStatusLabel } from "../../lib/timelineBillDisplay";
import { billStatusBadgeClass } from "../../lib/billsDisplay";
import { shouldShowTransferSimulation } from "../../lib/transferSimulation";
import TransferSimulationPanel from "./TransferSimulationPanel";
import TimelineBillDetailView from "./TimelineBillDetailView";
import type { Account } from "@budget-app/shared";

type Props = {
  day: TimelineCalendarDay;
  onClose: () => void;
  singleAccountView?: boolean;
  accounts?: Account[];
  horizon?: TimelineHorizon;
  householdId?: number;
  scenarioId?: number | null;
  calendarDays?: TimelineCalendarDay[];
  initialBillTxn?: TimelineCalendarTransaction | null;
  onCalendarRefresh?: () => void;
  onCreateTransfer?: (preset: {
    transferFromAccountId: number;
    transferToAccountId: number;
    defaultAmount: string;
    defaultDate: string;
  }) => void;
};

function BillTxnLine({
  txn,
  day,
  occurrence,
  onSelect,
}: {
  txn: TimelineCalendarTransaction;
  day: TimelineCalendarDay;
  occurrence?: ReturnType<typeof matchBillOccurrence>;
  onSelect: (txn: TimelineCalendarTransaction) => void;
}) {
  const amt = parseAmount(txn.amount);
  const status = resolveBillPaymentStatus({ dueDate: day.date, txn, occurrence });
  const riskLabels = determineRiskContributionLabels(day, txn);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(txn)}
        className="w-full text-sm flex justify-between gap-2 py-1.5 px-1 rounded-md hover:bg-indigo-50/60 border border-transparent hover:border-indigo-100 group"
      >
        <span className="text-gray-700 truncate text-left min-w-0 flex items-center gap-1">
          <span className="truncate">
            − {txn.description}
            <span
              className={`ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${billStatusBadgeClass(status)}`}
            >
              {timelineBillStatusLabel(status)}
            </span>
            {riskLabels.length > 0 ? (
              <span className="ml-1 text-[10px] text-amber-700 font-medium">⚠</span>
            ) : null}
          </span>
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-gray-400 group-hover:text-indigo-600"
            aria-hidden
          />
        </span>
        <span className={`font-medium shrink-0 tabular-nums ${amt >= 0 ? "text-green-600" : "text-red-600"}`}>
          {formatCurrency(txn.amount ?? "0", "USD")}
        </span>
      </button>
    </li>
  );
}

function StaticTxnLine({
  txn,
  prefix,
}: {
  txn: TimelineCalendarTransaction;
  prefix: string;
}) {
  const amt = parseAmount(txn.amount);
  return (
    <li className="text-sm flex justify-between gap-2 py-0.5 px-1">
      <span className="text-gray-700 truncate">
        {prefix} {txn.description}
        {txn.is_transfer ? (
          <span className="ml-1 text-xs text-gray-500">({txn.account_name})</span>
        ) : null}
      </span>
      <span className={`font-medium shrink-0 tabular-nums ${amt >= 0 ? "text-green-600" : "text-red-600"}`}>
        {formatCurrency(txn.amount ?? "0", "USD")}
      </span>
    </li>
  );
}

export default function TimelineDayPanel({
  day,
  onClose,
  singleAccountView = false,
  accounts = [],
  horizon = "6m",
  householdId,
  scenarioId,
  calendarDays = [],
  initialBillTxn = null,
  onCalendarRefresh,
  onCreateTransfer,
}: Props) {
  const [selectedBillTxn, setSelectedBillTxn] = useState<TimelineCalendarTransaction | null>(
    initialBillTxn
  );

  const billsQuery = useQuery({
    queryKey: ["timeline-bills-overview", monthKeyFromIso(day.date)],
    queryFn: () =>
      getBillsOverview({
        month: monthKeyFromIso(day.date),
        months_before: 0,
        months_after: 0,
      }),
  });

  const billOccurrences = billsQuery.data?.checklist.items ?? [];

  const resolveOccurrence = useMemo(
    () => (txn: TimelineCalendarTransaction) => matchBillOccurrence(billOccurrences, day, txn),
    [billOccurrences, day]
  );

  const { income, expenses, transfers } = groupTransactionsByKind(day.transactions);
  const recurringBills = expenses.filter(isRecurringBillTransaction);
  const otherExpenses = expenses.filter((txn) => !isRecurringBillTransaction(txn));
  const net = parseAmount(day.net_total);
  const severity = determineForecastSeverity(day);
  const d = new Date(`${day.date}T12:00:00`);
  const dateTitle = formatDateDisplay(day.date);
  const dateHeaderLabel = `${dateTitle} ${d.toLocaleDateString("en-US", { weekday: "short" })}`;
  const lowestDetail = formatDayDetailLowestSection(day, dateTitle);
  const heatLevel = resolveDayHeatLevel(day);
  const heatReason = dayHeatReason(day);
  const riskAlert =
    lowestDetail ??
    (dayHeatShowsReason(heatLevel) && heatReason
      ? { headline: heatReason, avoidOverdraft: null, restoreBuffer: null }
      : null);
  const markerSeverity = lowestMarkerSeverity(day, severity);
  const markerAlertClass = severityTokens(markerSeverity).cardClass;
  const [showRiskWhy, setShowRiskWhy] = useState(false);
  const riskReasons = [
    day.heat_reason,
    day.risk_reason,
    ...((day.credit_balance_warnings ?? []).map((w) => w.message) || []),
    ...((day.biggest_drivers ?? [])
      .filter((driver) => parseAmount(driver.amount) < 0)
      .slice(0, 2)
      .map((driver) => `${driver.description} reduces projected liquidity`)),
  ].filter(Boolean) as string[];

  useEffect(() => {
    setSelectedBillTxn(initialBillTxn);
  }, [day.date, initialBillTxn]);

  const inBillDetail = selectedBillTxn != null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/30 backdrop-blur-[1px] animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={inBillDetail ? `Bill details for ${selectedBillTxn.description}` : `Details for ${dateHeaderLabel}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col motion-safe:animate-in motion-safe:slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {!inBillDetail && (
          <div className="border-b border-gray-200 px-4 py-3 shrink-0">
            <div className="flex items-start justify-between gap-3">
              <DayHeatHeader
                day={day}
                dateTitle={dateHeaderLabel}
                incomeTotal={day.income_total}
                expenseTotal={day.expense_total}
                netTotal={day.net_total}
                netColorClass={netColorClass(net)}
                compact
                singleAccountView={singleAccountView}
                hideInlineRisk
                panelLayout
              />
              <button
                type="button"
                onClick={onClose}
                className="text-gray-500 hover:text-gray-800 text-sm px-2 py-1.5 shrink-0 rounded-md hover:bg-gray-100 -mt-0.5"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {inBillDetail ? (
          <TimelineBillDetailView
            day={day}
            txn={selectedBillTxn}
            calendarDays={calendarDays}
            onBack={() => setSelectedBillTxn(null)}
            onDataChange={onCalendarRefresh}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {hasRecoveryInfo(day) && (
                <section
                  className={`rounded-md border px-3 py-2 text-sm ${recoveryChipClass(day)}`}
                  aria-label="Recovery forecast"
                >
                  <div className="flex items-start gap-2">
                    <TrendingUp className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-medium">{formatRecoveryBanner(day)}</p>
                      {formatRecoveryDaysUntil(day) && (
                        <p className="text-xs opacity-90">{formatRecoveryDaysUntil(day)}</p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {riskAlert && (
                <section
                  className={`rounded-md px-3 py-2 text-sm space-y-1 ${markerAlertClass}`}
                  aria-label="Projected balance risk"
                >
                  <p className="font-semibold text-gray-900 flex items-center gap-1">
                    <span aria-hidden>⚠</span> Lowest projected balance
                  </p>
                  <p className="text-gray-900 font-medium">{riskAlert.headline}</p>
                  {riskAlert.avoidOverdraft && (
                    <p className="text-red-800 text-xs">
                      <span className="font-semibold">To avoid overdraft:</span> {riskAlert.avoidOverdraft}
                    </p>
                  )}
                  {riskAlert.restoreBuffer && (
                    <p className="text-amber-900 text-xs">
                      <span className="font-semibold">To restore buffer:</span> {riskAlert.restoreBuffer}
                    </p>
                  )}
                </section>
              )}

              {(day.has_risk ||
                (day.heat_level && day.heat_level !== "healthy" && day.heat_level !== "neutral")) && (
                <section className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setShowRiskWhy((value) => !value)}
                    className="w-full text-left font-semibold text-amber-900"
                  >
                    Why am I at risk? {showRiskWhy ? "−" : "+"}
                  </button>
                  {showRiskWhy && (
                    <div className="mt-2 space-y-2 text-xs">
                      <ul className="space-y-1 text-amber-900">
                        {riskReasons.length > 0 ? (
                          riskReasons.map((reason, index) => (
                            <li key={`${reason}-${index}`}>- {reason}</li>
                          ))
                        ) : (
                          <li>- Projected obligations create a temporary unsafe period.</li>
                        )}
                      </ul>
                      <div className="pt-1 border-t border-amber-200">
                        <p className="font-semibold text-amber-900">Suggested fixes</p>
                        <ul className="space-y-1 text-amber-800 mt-1">
                          <li>- Move funds from a lower-priority account</li>
                          <li>- Delay discretionary spending before next income</li>
                          <li>- Reduce or reschedule non-critical payments</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {shouldShowTransferSimulation(day) && onCreateTransfer && accounts.length > 0 && (
                <TransferSimulationPanel
                  day={day}
                  accounts={accounts}
                  horizon={horizon}
                  householdId={householdId}
                  scenarioId={scenarioId}
                  onCreateTransfer={onCreateTransfer}
                />
              )}

              {income.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Income</h3>
                  <ul className="space-y-0">
                    {income.map((t, i) => (
                      <StaticTxnLine key={i} txn={t} prefix="+" />
                    ))}
                  </ul>
                </section>
              )}

              {recurringBills.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Bills & recurring</h3>
                  <p className="text-[10px] text-gray-500 mb-1">Tap a bill for payment history and forecast impact.</p>
                  <ul className="space-y-0">
                    {recurringBills.map((t, i) => (
                      <BillTxnLine
                        key={`bill-${i}`}
                        txn={t}
                        day={day}
                        occurrence={resolveOccurrence(t)}
                        onSelect={setSelectedBillTxn}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {otherExpenses.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Other expenses</h3>
                  <ul className="space-y-0">
                    {otherExpenses.map((t, i) => (
                      <StaticTxnLine key={i} txn={t} prefix="−" />
                    ))}
                  </ul>
                </section>
              )}

              {transfers.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">Transfers</h3>
                  <ul className="space-y-0">
                    {transfers.map((t, i) => (
                      <StaticTxnLine key={i} txn={t} prefix="↔" />
                    ))}
                  </ul>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Transfers affect account balances but are excluded from household net cash flow.
                  </p>
                </section>
              )}

              <div className="border-t border-gray-100 pt-2 text-sm space-y-1">
                <div className="flex justify-between text-gray-600">
                  <span>Net cash flow</span>
                  <span className={`tabular-nums ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatShortMoney(day.net_total, true)}
                  </span>
                </div>
                <div className="flex justify-between font-medium text-gray-900">
                  <span>Ending balance</span>
                  <span className="tabular-nums">{formatCurrency(day.ending_balance, "USD")}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 px-4 py-3 flex flex-wrap gap-2 shrink-0">
              <Link
                to={`/transactions?date=${day.date}`}
                className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Open in Transactions
              </Link>
              <Link
                to="/transactions?add=1"
                className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Add transaction
              </Link>
              <Link
                to={AUTOMATION_PATH}
                className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
              >
                Add automation
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
