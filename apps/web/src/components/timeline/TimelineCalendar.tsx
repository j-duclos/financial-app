import type { TimelineCalendarDay, TimelineCalendarResponse } from "@budget-app/shared";
import {
  buildMonthGrid,
  calendarCellTone,
  calendarCellToneClass,
  calendarDayHeatDotClass,
  determineRiskContributionLabels,
  dayHasActivity,
  dayMap,
  formatCompactEnd,
  formatCompactMonthDay,
  formatCompactNet,
  monthLabelForCalendarSection,
  monthsInRange,
  parseAmount,
  todayIsoDate,
} from "../../lib/timelineCalendarUtils";
import StickyMonthHeader from "../shared/StickyMonthHeader";
import {
  determineForecastSeverity,
  forecastSeverityAriaLabel,
  forecastSeverityEndingClass,
  forecastSeverityIcon,
  forecastSeverityNetClass,
} from "../../lib/forecastSeverity";
import { formatRecoveryChip } from "../../lib/dayRecoveryDisplay";
import { isRecurringBillTransaction as isRecurringBill } from "../../lib/timelineBillMatching";
import { timelineBillStatusLabel } from "../../lib/timelineBillDisplay";
import { resolveBillPaymentStatus } from "../../lib/billPaymentStatus";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_SNIPPETS = 2;
/** Single-column mobile: cap width. Desktop two-up: each month fills its column. */
const CALENDAR_GRID_MAX_CLASS =
  "w-full max-w-[44rem] sm:max-w-[48rem] mx-auto lg:max-w-none lg:mx-0";

type Props = {
  data: TimelineCalendarResponse;
  selectedDate: string | null;
  onSelectDay: (day: TimelineCalendarDay) => void;
  onSelectTransaction?: (day: TimelineCalendarDay, txn: TimelineCalendarDay["transactions"][number]) => void;
};

function DayCell({
  day,
  dateIso,
  isSelected,
  isToday,
  onSelect,
  onSelectTransaction,
}: {
  day?: TimelineCalendarDay;
  dateIso: string;
  isSelected: boolean;
  isToday: boolean;
  onSelect: () => void;
  onSelectTransaction?: (day: TimelineCalendarDay, txn: TimelineCalendarDay["transactions"][number]) => void;
}) {
  const d = new Date(`${dateIso}T12:00:00`);
  const dayNum = d.getDate();
  const active = day && dayHasActivity(day);
  const severity = day ? determineForecastSeverity(day) : "neutral";
  const tone = day ? calendarCellTone(day) : "empty";
  const recurring = (day?.transactions ?? []).filter(isRecurringBill);
  const snippets = recurring.slice(0, MAX_SNIPPETS);
  const hidden = Math.max(0, recurring.length - MAX_SNIPPETS);
  const recoveryChip = day ? formatRecoveryChip(day) : null;
  const net = day ? parseAmount(day.net_total) : 0;
  const ending = day ? parseAmount(day.ending_balance) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-timeline-date={dateIso}
      className={`relative w-full aspect-square min-h-0 max-h-[5.75rem] sm:max-h-[6.25rem] lg:max-h-[5.5rem] p-0.5 sm:p-1 border rounded-md text-left flex flex-col gap-0 scroll-mt-24 overflow-hidden
        transition-all duration-150 ease-out
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500
        ${calendarCellToneClass(tone, severity, Boolean(active))}
        ${isToday ? "border-2 border-sky-500 shadow-sm" : ""}
        ${isSelected ? "ring-2 ring-indigo-500 ring-offset-1 scale-[1.02] z-10" : "hover:scale-[1.01]"}
        ${severity === "dangerous" && !isSelected ? "hover:shadow-md" : ""}
      `}
      aria-label={day ? forecastSeverityAriaLabel(day, formatCompactMonthDay(dateIso)) : dateIso}
      aria-current={isToday ? "date" : isSelected ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-0.5 leading-none">
        <span className="text-[11px] font-semibold text-gray-800 tabular-nums">{dayNum}</span>
        {day ? (
          <span className="text-[10px] leading-none" aria-hidden>
            {forecastSeverityIcon(severity)}
          </span>
        ) : null}
      </div>

      {active && day ? (
        <div className="flex flex-col gap-0.5 mt-0.5 min-h-0 flex-1">
          <div className="text-[10px] leading-tight space-y-px">
            <div className={`${forecastSeverityNetClass(severity, net)}`}>
              {formatCompactNet(day.net_total)}
            </div>
            <div className={forecastSeverityEndingClass(severity, ending)}>
              {formatCompactEnd(day.ending_balance)}
            </div>
          </div>
          {recoveryChip && (
            <span
              className="text-[9px] leading-tight text-emerald-700 truncate"
              title={recoveryChip}
            >
              ↗ {recoveryChip}
            </span>
          )}
          <div className="mt-auto space-y-px">
            {snippets.length > 0 ? (
              <div className="text-[9px] uppercase font-semibold text-gray-500">Bills</div>
            ) : null}
            {snippets.map((t, i) => {
              const labels = determineRiskContributionLabels(day, t);
              return (
                <span
                  key={`${String(t.id ?? t.description)}-${i}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTransaction?.(day, t);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectTransaction?.(day, t);
                    }
                  }}
                  className="block w-full text-[9px] text-gray-600 truncate leading-tight text-left hover:text-gray-900 cursor-pointer"
                  title={`${t.description} · ${timelineBillStatusLabel(resolveBillPaymentStatus({ dueDate: dateIso, txn: t }))}`}
                >
                  • {t.description}
                  {labels.length > 0 ? " ⚠" : ""}
                </span>
              );
            })}
            {hidden > 0 && (
              <div className="text-[9px] text-indigo-600 leading-tight">+{hidden} more</div>
            )}
          </div>
        </div>
      ) : (
        <span className="text-[10px] text-gray-300 mt-0.5 select-none" aria-hidden>
          ·
        </span>
      )}
      {day ? (
        <span
          className={`absolute top-1 right-1 hidden sm:inline-block h-1.5 w-1.5 rounded-full ${calendarDayHeatDotClass(day)}`}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

function MonthCalendarSection({
  year,
  month,
  byDate,
  selectedDate,
  onSelectDay,
  onSelectTransaction,
}: {
  year: number;
  month: number;
  byDate: Map<string, TimelineCalendarDay>;
  selectedDate: string | null;
  onSelectDay: (day: TimelineCalendarDay) => void;
  onSelectTransaction?: (day: TimelineCalendarDay, txn: TimelineCalendarDay["transactions"][number]) => void;
}) {
  const grid = buildMonthGrid(year, month);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const today = todayIsoDate();

  return (
    <section className="scroll-mt-4 min-w-0">
      <StickyMonthHeader
        monthKey={monthKey}
        label={monthLabelForCalendarSection(year, month)}
        sticky
        stickyTopClass="top-0"
        className="mb-2 -mx-1 rounded-none"
      />
      <div className={`grid grid-cols-7 gap-0.5 sm:gap-1 mb-1 ${CALENDAR_GRID_MAX_CLASS}`}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-[10px] font-medium text-gray-400 py-0.5">
            {w}
          </div>
        ))}
      </div>
      <div className={`grid grid-cols-7 gap-0.5 sm:gap-1 ${CALENDAR_GRID_MAX_CLASS}`}>
        {grid.map((dateIso, idx) =>
          dateIso ? (
            <div key={dateIso} className="relative w-full min-w-0">
              <DayCell
                dateIso={dateIso}
                day={byDate.get(dateIso)}
                isToday={dateIso === today}
                isSelected={selectedDate === dateIso}
                onSelectTransaction={onSelectTransaction}
                onSelect={() => {
                  const day = byDate.get(dateIso) ?? {
                    date: dateIso,
                    income_total: "0",
                    expense_total: "0",
                    transfer_total: "0",
                    net_total: "0",
                    ending_balance: "0",
                    lowest_balance: "0",
                    risk_level: "none" as const,
                    risk_reason: null,
                    has_risk: false,
                    heat_level: "neutral",
                    transactions: [],
                  };
                  onSelectDay(day);
                }}
              />
            </div>
          ) : (
            <div
              key={`pad-${monthKey}-${idx}`}
              className="aspect-square w-full min-w-0 max-h-[5.75rem] sm:max-h-[6.25rem] lg:max-h-[5.5rem]"
              aria-hidden
            />
          )
        )}
      </div>
    </section>
  );
}

export default function TimelineCalendar({ data, selectedDate, onSelectDay, onSelectTransaction }: Props) {
  const byDate = dayMap(data.days);
  const months = monthsInRange(data.start_date, data.end_date);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-8 lg:gap-x-8 xl:gap-x-10">
      {months.map(({ year, month }) => (
        <MonthCalendarSection
          key={`${year}-${month}`}
          year={year}
          month={month}
          byDate={byDate}
          selectedDate={selectedDate}
          onSelectDay={onSelectDay}
          onSelectTransaction={onSelectTransaction}
        />
      ))}
    </div>
  );
}
