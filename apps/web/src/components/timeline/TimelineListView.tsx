import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineRow } from "@budget-app/shared";
import StickyMonthHeader from "../shared/StickyMonthHeader";
import { formatTimelineLowestMarker } from "../../lib/dayLowestBalanceDisplay";
import { formatRecoveryChip } from "../../lib/dayRecoveryDisplay";
import {
  determineForecastSeverity,
  forecastSeverityIcon,
  forecastSeverityNetClass,
  forecastSeverityRowTint,
} from "../../lib/forecastSeverity";
import { formatDateDisplay } from "../../lib/dateDisplay";
import { TIMELINE_LIST_MONTH_STICKY_TOP } from "../../lib/monthGroupDisplay";
import { isSupersededPlannedTimelineRow } from "../transactions/transactionsLedgerUtils";
import {
  dayMap,
  formatCompactNet,
  formatShortMoney,
  groupTimelineDayGroupsByMonth,
  groupTimelineRowsByDate,
  parseAmount,
  resolveListDayMetrics,
  timelineRowBalanceAfter,
} from "../../lib/timelineCalendarUtils";

type Props = {
  timeline: TimelineRow[];
  calendarDays: TimelineCalendarDay[];
  singleAccountView?: boolean;
};

export default function TimelineListView({
  timeline,
  calendarDays,
  singleAccountView = false,
}: Props) {
  const dayGroups = groupTimelineRowsByDate(timeline);
  const monthGroups = groupTimelineDayGroupsByMonth(dayGroups);
  const byDate = dayMap(calendarDays);
  const useScroll = dayGroups.length > 14 || monthGroups.length > 1;

  const defaultExpanded = useMemo(() => {
    const stressed = new Set<string>();
    for (const { date } of dayGroups) {
      const cal = byDate.get(date);
      if (cal) {
        const sev = determineForecastSeverity(cal);
        if (sev === "dangerous" || sev === "tight") stressed.add(date);
      }
    }
    return stressed;
  }, [dayGroups, byDate]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const isExpanded = (date: string) => {
    if (expanded.has(date)) return true;
    if (expanded.size === 0 && defaultExpanded.has(date)) return true;
    return false;
  };

  const toggleDay = (date: string) => {
    setExpanded((prev) => {
      const next = new Set(prev.size === 0 ? defaultExpanded : prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  if (timeline.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-gray-500 bg-white border border-gray-200 rounded-lg">
        No timeline entries in range.
      </p>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div
        className={
          useScroll
            ? "max-h-[min(70vh,calc(100dvh-12rem))] overflow-y-auto overscroll-y-contain"
            : undefined
        }
      >
        {monthGroups.map(({ monthKey, monthLabel, items: daysInMonth }) => (
          <section key={monthKey}>
            <div className={useScroll ? `sticky ${TIMELINE_LIST_MONTH_STICKY_TOP} z-20` : ""}>
              <StickyMonthHeader monthKey={monthKey} label={monthLabel} sticky={false} />
            </div>

            {daysInMonth.map(({ date, rows: dayRows }) => {
              const rows = dayRows.filter(
                (row) => !isSupersededPlannedTimelineRow(row, timeline)
              );
              const { calendarDay, netTotal, endingBalance } = resolveListDayMetrics(
                date,
                rows,
                calendarDays
              );
              const net = parseAmount(netTotal);
              const severity = determineForecastSeverity(calendarDay);
              const dateTitle = formatDateDisplay(date);
              const open = isExpanded(date);
              const lowestLine = formatTimelineLowestMarker(calendarDay, { singleAccountView });
              const recoveryChip = formatRecoveryChip(calendarDay);

              return (
                <div
                  key={date}
                  className={`border-b border-gray-100 last:border-b-0 ${forecastSeverityRowTint(severity)}`}
                >
                  <div className="border-b border-gray-100 bg-gray-50/40">
                    <button
                      type="button"
                      onClick={() => toggleDay(date)}
                      className="w-full px-3 py-2 flex items-start gap-2 text-left hover:bg-gray-50/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                      aria-expanded={open}
                    >
                      {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 mt-0.5" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 mt-0.5" aria-hidden />
                      )}
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-semibold text-gray-900 text-sm">
                            {dateTitle} {forecastSeverityIcon(severity)}
                          </span>
                          {recoveryChip && (
                            <span className="text-[10px] px-1.5 py-0 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              {recoveryChip}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs tabular-nums">
                          <span className={forecastSeverityNetClass(severity, net)}>
                            {formatCompactNet(netTotal)}
                          </span>
                          <span className="text-gray-600">
                            Ending balance {formatShortMoney(endingBalance)}
                          </span>
                          {lowestLine && (
                            <span className="text-red-700 truncate max-w-full">{lowestLine}</span>
                          )}
                        </div>
                        {!open && rows.length > 0 && (
                          <p className="text-[10px] text-gray-500">
                            {rows.length} transaction{rows.length === 1 ? "" : "s"} — expand
                          </p>
                        )}
                      </div>
                      <span className={`text-sm font-medium shrink-0 ${netColorClass(net)}`}>
                        {formatNetDisplay(net)}
                      </span>
                    </button>
                  </div>

                  {open && (
                    <div className="divide-y divide-gray-50">
                      {rows.map((row, i) => {
                        const balanceAfter =
                          timelineRowBalanceAfter(row, calendarDay) ?? row.running_balance;
                        return (
                        <div
                          key={`${date}-${i}`}
                          className={`grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm ${
                            row.source === "rule" ? "bg-amber-50/40" : ""
                          }`}
                        >
                          <span className="text-gray-900 truncate font-medium">{row.description}</span>
                          <span className="hidden sm:block text-gray-500 truncate text-xs">
                            {row.account_name}
                          </span>
                          <span
                            className={`text-right font-medium tabular-nums ${
                              parseFloat(row.amount) >= 0 ? "text-green-600" : "text-red-600"
                            }`}
                          >
                            {parseFloat(row.amount) >= 0 ? "+" : ""}
                            {formatCurrency(row.amount, "USD")}
                          </span>
                          <span className="hidden sm:block text-right text-xs text-gray-500 tabular-nums">
                            {formatCurrency(balanceAfter, "USD")}
                          </span>
                          <span className="col-span-2 sm:col-span-4 text-[10px] text-gray-400 flex gap-2">
                            <span>{row.category_name ?? "—"}</span>
                            <span
                              className={
                                row.source === "rule"
                                  ? "text-amber-700"
                                  : "text-gray-500"
                              }
                            >
                              {row.source === "actual" ? "Actual" : "Planned"}
                            </span>
                          </span>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
