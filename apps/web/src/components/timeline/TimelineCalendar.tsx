import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TimelineCalendarDay } from "@budget-app/shared";
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
const CALENDAR_GRID_MAX_CLASS =
  "w-full max-w-[44rem] sm:max-w-[48rem] mx-auto lg:max-w-none lg:mx-0";

type FailedChunk = {
  start: string;
  end: string;
  onRetry: () => void;
};

type Props = {
  rangeStart: string;
  rangeEnd: string;
  days: TimelineCalendarDay[];
  selectedDate: string | null;
  onSelectDay: (day: TimelineCalendarDay) => void;
  onSelectTransaction?: (
    day: TimelineCalendarDay,
    txn: TimelineCalendarDay["transactions"][number]
  ) => void;
  pendingMonthKeys?: Set<string>;
  failedChunks?: FailedChunk[];
  remainingCount?: number;
  loadingRemaining?: boolean;
  onLoadMore?: () => void;
  eagerMonthCount?: number;
  onMonthVisible?: (year: number, month: number) => void;
};

const DayCell = memo(function DayCell({
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
  onSelect: (dateIso: string) => void;
  onSelectTransaction?: (
    day: TimelineCalendarDay,
    txn: TimelineCalendarDay["transactions"][number]
  ) => void;
}) {
  const dayNum = Number(dateIso.slice(8, 10));
  const active = Boolean(day && dayHasActivity(day));

  if (!day) {
    return (
      <button
        type="button"
        onClick={() => onSelect(dateIso)}
        data-timeline-date={dateIso}
        className={`w-full aspect-square min-h-0 max-h-[5.75rem] sm:max-h-[6.25rem] lg:max-h-[5.5rem] p-0.5 sm:p-1 border border-gray-100 rounded-md text-left bg-white
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500
          ${isToday ? "border-2 border-sky-500" : ""}
          ${isSelected ? "ring-2 ring-indigo-500 ring-offset-1 z-10" : ""}
        `}
        aria-label={dateIso}
        aria-current={isToday ? "date" : isSelected ? "true" : undefined}
      >
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{dayNum}</span>
      </button>
    );
  }

  if (!active) {
    const severity = day ? determineForecastSeverity(day) : "neutral";
    const tone = day ? calendarCellTone(day) : "empty";
    return (
      <button
        type="button"
        onClick={() => onSelect(dateIso)}
        data-timeline-date={dateIso}
        className={`relative w-full aspect-square min-h-0 max-h-[5.75rem] sm:max-h-[6.25rem] lg:max-h-[5.5rem] p-0.5 sm:p-1 border rounded-md text-left flex flex-col gap-0 scroll-mt-24 overflow-hidden
          transition-all duration-150 ease-out
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500
          ${calendarCellToneClass(tone, severity, false)}
          ${isToday ? "border-2 border-sky-500 shadow-sm" : ""}
          ${isSelected ? "ring-2 ring-indigo-500 ring-offset-1 scale-[1.02] z-10" : "hover:scale-[1.01]"}
        `}
        aria-label={day ? forecastSeverityAriaLabel(day, dateIso) : dateIso}
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
        <span className="text-[10px] text-gray-300 mt-0.5 select-none" aria-hidden>
          ·
        </span>
        {day ? (
          <span
            className={`absolute top-1 right-1 hidden sm:inline-block h-1.5 w-1.5 rounded-full ${calendarDayHeatDotClass(day)}`}
            aria-hidden
          />
        ) : null}
      </button>
    );
  }

  const severity = determineForecastSeverity(day);
  const tone = calendarCellTone(day);
  const recurring = day.transactions.filter(isRecurringBill);
  const snippets = recurring.slice(0, MAX_SNIPPETS);
  const hidden = Math.max(0, recurring.length - MAX_SNIPPETS);
  const recoveryChip = formatRecoveryChip(day);
  const net = parseAmount(day.net_total);
  const ending = parseAmount(day.ending_balance);

  return (
    <button
      type="button"
      onClick={() => onSelect(dateIso)}
      data-timeline-date={dateIso}
      className={`relative w-full aspect-square min-h-0 max-h-[5.75rem] sm:max-h-[6.25rem] lg:max-h-[5.5rem] p-0.5 sm:p-1 border rounded-md text-left flex flex-col gap-0 scroll-mt-24 overflow-hidden
        transition-all duration-150 ease-out
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500
        ${calendarCellToneClass(tone, severity, true)}
        ${isToday ? "border-2 border-sky-500 shadow-sm" : ""}
        ${isSelected ? "ring-2 ring-indigo-500 ring-offset-1 scale-[1.02] z-10" : "hover:scale-[1.01]"}
        ${severity === "dangerous" && !isSelected ? "hover:shadow-md" : ""}
      `}
      aria-label={forecastSeverityAriaLabel(day, formatCompactMonthDay(dateIso))}
      aria-current={isToday ? "date" : isSelected ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-0.5 leading-none">
        <span className="text-[11px] font-semibold text-gray-800 tabular-nums">{dayNum}</span>
        <span className="text-[10px] leading-none" aria-hidden>
          {forecastSeverityIcon(severity)}
        </span>
      </div>
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
          <span className="text-[9px] leading-tight text-emerald-700 truncate" title={recoveryChip}>
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
      <span
        className={`absolute top-1 right-1 hidden sm:inline-block h-1.5 w-1.5 rounded-full ${calendarDayHeatDotClass(day)}`}
        aria-hidden
      />
    </button>
  );
});

const MonthCalendarSection = memo(function MonthCalendarSection({
  year,
  month,
  byDate,
  selectedDate,
  onSelectDay,
  onSelectTransaction,
  pending,
  failed,
}: {
  year: number;
  month: number;
  byDate: Map<string, TimelineCalendarDay>;
  selectedDate: string | null;
  onSelectDay: (day: TimelineCalendarDay) => void;
  onSelectTransaction?: (
    day: TimelineCalendarDay,
    txn: TimelineCalendarDay["transactions"][number]
  ) => void;
  pending?: boolean;
  failed?: FailedChunk | null;
}) {
  const grid = buildMonthGrid(year, month);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const today = todayIsoDate();
  const handleSelect = useCallback(
    (dateIso: string) => {
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
    },
    [byDate, onSelectDay]
  );

  return (
    <section className="scroll-mt-4 min-w-0" aria-label={monthLabelForCalendarSection(year, month)}>
      <StickyMonthHeader
        monthKey={monthKey}
        label={monthLabelForCalendarSection(year, month)}
        sticky
        stickyTopClass="top-0"
        className="mb-2 -mx-1 rounded-none"
      />
      {failed ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 mb-2">
          Couldn’t load {monthLabelForCalendarSection(year, month)}.
          <button
            type="button"
            className="ml-2 font-medium text-indigo-700 underline"
            onClick={failed.onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
      {pending && !failed ? (
        <div
          className="h-48 rounded-md bg-gray-100 animate-pulse mb-2"
          aria-busy="true"
        >
          <span className="sr-only">Loading {monthLabelForCalendarSection(year, month)}…</span>
        </div>
      ) : (
        <>
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
                    onSelect={handleSelect}
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
        </>
      )}
    </section>
  );
});

function LazyMonthMount({
  eager,
  label,
  year,
  month,
  onVisible,
  children,
}: {
  eager: boolean;
  label: string;
  year: number;
  month: number;
  onVisible?: (year: number, month: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(eager);
  useEffect(() => {
    if (eager) setMounted(true);
  }, [eager]);
  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setMounted(true);
      onVisible?.(year, month);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          onVisible?.(year, month);
        }
      },
      { rootMargin: "240px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted, year, month, onVisible]);

  return (
    <div ref={ref}>
      {mounted ? (
        children
      ) : (
        <section className="scroll-mt-4 min-w-0" aria-label={label}>
          <h2 className="text-[10px] sm:text-xs font-semibold tracking-wide text-gray-500 uppercase px-3 py-2">
            {label}
          </h2>
          <p className="px-3 pb-2 text-sm text-gray-500">Loading {label}…</p>
          <div className="h-48 rounded-md bg-gray-50" aria-hidden />
        </section>
      )}
    </div>
  );
}

export default function TimelineCalendar({
  rangeStart,
  rangeEnd,
  days,
  selectedDate,
  onSelectDay,
  onSelectTransaction,
  pendingMonthKeys,
  failedChunks = [],
  remainingCount = 0,
  loadingRemaining = false,
  onLoadMore,
  eagerMonthCount = 2,
  onMonthVisible,
}: Props) {
  const byDate = useMemo(() => dayMap(days), [days]);
  const months = useMemo(() => monthsInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-8 lg:gap-x-8 xl:gap-x-10">
        {months.map(({ year, month }, index) => {
          const key = `${year}-${String(month + 1).padStart(2, "0")}`;
          const pending = pendingMonthKeys?.has(key) ?? false;
          const failed =
            failedChunks.find((chunk) => chunk.start.slice(0, 7) <= key && chunk.end.slice(0, 7) >= key) ??
            null;
          return (
            <LazyMonthMount
              key={`${year}-${month}`}
              eager={index < eagerMonthCount}
              label={monthLabelForCalendarSection(year, month)}
              year={year}
              month={month}
              onVisible={onMonthVisible}
            >
              <MonthCalendarSection
                year={year}
                month={month}
                byDate={byDate}
                selectedDate={selectedDate}
                onSelectDay={onSelectDay}
                onSelectTransaction={onSelectTransaction}
                pending={pending}
                failed={failed}
              />
            </LazyMonthMount>
          );
        })}
      </div>
      {(loadingRemaining || remainingCount > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-600">
          {loadingRemaining ? <span>Loading remaining months…</span> : null}
          {remainingCount > 0 && onLoadMore ? (
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
              onClick={onLoadMore}
            >
              Load more months
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
