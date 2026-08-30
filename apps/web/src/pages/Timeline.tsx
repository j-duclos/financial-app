import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { formatDateDisplay } from "../lib/dateDisplay";
import { listScenarios, getProfile, listHouseholds } from "@budget-app/api-client";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import { useMoneyFlowCalendar } from "../hooks/useMoneyFlowCalendar";
import TimelineCalendar from "../components/timeline/TimelineCalendar";
import TimelineDayPanel from "../components/timeline/TimelineDayPanel";
import UpcomingMoneyFlowSection from "../components/dashboard/UpcomingMoneyFlowSection";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_5 } from "../components/dashboard/metricTileLayout";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import {
  DEFAULT_TIMELINE_VIEW,
  hasProjectedActivity,
  isIsoDateString,
  parseTimelineViewParam,
  pickHorizonForFocusDate,
  timelineDayForDate,
  type TimelineHorizon,
  type TimelineLookbackMonths,
  type TimelineViewMode,
  type SafeUntilSummary,
} from "../lib/timelineCalendarUtils";
import { PAGE_SHELL } from "../lib/pageLayout";
import { CALENDAR_SUMMARY } from "../lib/timelineTerminology";
import { UPCOMING_PAGE_TITLE, buildUpcomingMoneyFlowFromCalendarDays } from "../lib/upcomingDisplay";

type Horizon = TimelineHorizon;

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: TimelineViewMode;
  onChange: (mode: TimelineViewMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5"
      role="tablist"
      aria-label="Calendar views"
    >
      {(
        [
          { id: "timeline", label: "Timeline" },
          { id: "calendar", label: "Calendar" },
        ] as const
      ).map((mode) => {
        const selected = viewMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(mode.id)}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
              selected ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-32 bg-gray-200 rounded" />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="aspect-square w-full min-w-0 bg-gray-100 rounded-md" />
        ))}
      </div>
    </div>
  );
}

/** Backend-owned safe_until only — no client-side financial fallback from calendar rows. */
function safeUntilFromSummary(
  summary:
    | {
        safe_until?: {
          next_income_date: string | null;
          safe_amount: string;
          unsafe_date: string | null;
          obligations_before_income: string;
          current_balance: string;
        } | null;
      }
    | undefined
): SafeUntilSummary | null {
  const raw = summary?.safe_until;
  if (!raw) return null;
  return {
    nextIncomeDate: raw.next_income_date,
    safeAmount: Number(raw.safe_amount),
    unsafeDate: raw.unsafe_date,
    obligationsBeforeIncome: Number(raw.obligations_before_income),
    currentBalance: Number(raw.current_balance),
  };
}

export default function Timeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlScenario = searchParams.get("scenario_id");
  const urlHorizon = searchParams.get("horizon");
  const urlFocusDate = searchParams.get("date");
  const urlView = parseTimelineViewParam(searchParams.get("view"));

  const [horizon, setHorizon] = useState<Horizon>(() => {
    if (urlHorizon === "14d" || urlHorizon === "3m" || urlHorizon === "6m" || urlHorizon === "12m" || urlHorizon === "24m") {
      return urlHorizon;
    }
    if (isIsoDateString(urlFocusDate)) {
      return pickHorizonForFocusDate(urlFocusDate);
    }
    return "6m";
  });
  const [lookbackMonths, setLookbackMonths] = useState<TimelineLookbackMonths>(0);
  const [accountId, setAccountId] = useState<number | "">("");
  const [scenarioId, setScenarioId] = useState<number | "">(() => {
    const n = urlScenario ? Number(urlScenario) : NaN;
    return Number.isFinite(n) ? n : "";
  });
  const [householdId] = useState<number | "">("");

  useEffect(() => {
    const n = urlScenario ? Number(urlScenario) : NaN;
    if (Number.isFinite(n)) setScenarioId(n);
    if (urlHorizon === "14d" || urlHorizon === "3m" || urlHorizon === "6m" || urlHorizon === "12m" || urlHorizon === "24m") {
      setHorizon(urlHorizon);
    } else if (isIsoDateString(urlFocusDate)) {
      setHorizon(pickHorizonForFocusDate(urlFocusDate));
    }
  }, [urlScenario, urlHorizon, urlFocusDate]);
  const viewMode: TimelineViewMode = isIsoDateString(urlFocusDate)
    ? "calendar"
    : (urlView ?? DEFAULT_TIMELINE_VIEW);
  const [selectedDay, setSelectedDay] = useState<TimelineCalendarDay | null>(null);
  const [initialBillTxn, setInitialBillTxn] = useState<TimelineCalendarTransaction | null>(null);
  const [transferPreset, setTransferPreset] = useState<QuickTransactionPreset | null>(null);
  const focusedDateRef = useRef<string | null>(null);

  const focusCalendarDay = useCallback((dateIso: string, days: TimelineCalendarDay[]) => {
    if (focusedDateRef.current === dateIso) return;
    focusedDateRef.current = dateIso;
    setSelectedDay(timelineDayForDate(days, dateIso));
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-timeline-date="${dateIso}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: accountsData } = useOperationalAccounts();
  const { data: scenariosData } = useQuery({ queryKey: ["scenarios"], queryFn: () => listScenarios() });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const accounts = accountsData?.results ?? [];
  const scenarios = scenariosData?.results ?? [];
  const defaultHousehold = profile?.default_household ?? households?.[0]?.id;
  const resolvedHousehold = householdId || defaultHousehold;

  const calendar = useMoneyFlowCalendar({
    viewMode,
    horizon,
    lookbackMonths,
    accountId,
    scenarioId,
    householdId: resolvedHousehold || undefined,
  });

  const upcomingMoneyFlow = useMemo(
    () =>
      viewMode === "timeline" && calendar.upcomingDays.length
        ? buildUpcomingMoneyFlowFromCalendarDays(calendar.upcomingDays)
        : null,
    [calendar.upcomingDays, viewMode]
  );
  const safeUntil = useMemo(
    () => (viewMode === "calendar" ? safeUntilFromSummary(calendar.summary) : null),
    [calendar.summary, viewMode]
  );

  const onSelectDay = useCallback((day: TimelineCalendarDay) => {
    setSelectedDay(day);
    setInitialBillTxn(null);
  }, []);
  const onSelectTransaction = useCallback(
    (day: TimelineCalendarDay, txn: TimelineCalendarTransaction) => {
      setSelectedDay(day);
      setInitialBillTxn(txn);
    },
    []
  );

  useEffect(() => {
    if (!isIsoDateString(urlFocusDate) || !calendar.days.length) return;
    if (!calendar.days.some((day) => day.date === urlFocusDate)) return;
    focusCalendarDay(urlFocusDate, calendar.days);
  }, [urlFocusDate, calendar.days, focusCalendarDay]);

  const summary = calendar.summary;
  const riskyAccounts = summary?.risky_accounts ?? [];
  const calendarError = viewMode === "calendar" ? calendar.calendarError : calendar.upcomingError;

  const changeView = useCallback(
    (mode: TimelineViewMode) => {
      if (mode === "timeline") {
        setSelectedDay(null);
        setInitialBillTxn(null);
        focusedDateRef.current = null;
      }
      const next = new URLSearchParams(searchParams);
      next.set("view", mode);
      if (mode === "timeline") next.delete("date");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return (
    <div className={`${PAGE_SHELL} py-4`}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">{UPCOMING_PAGE_TITLE}</h1>
        <p className="text-sm text-gray-600 mt-1">
          What is going to happen — projected cash flow from balances plus planned and recurring activity.
        </p>
      </div>

      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date Range</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="14d">14 days</option>
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="12m">12 months</option>
            <option value="24m">24 months</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Show History</label>
          <select
            value={lookbackMonths}
            onChange={(e) => setLookbackMonths(Number(e.target.value) as TimelineLookbackMonths)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value={0}>Current Months</option>
            <option value={1}>1 prior month</option>
            <option value={2}>2 prior months</option>
            <option value={3}>3 prior months</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Account</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[160px]"
          >
            <option value="">All accounts</option>
            {accounts.map((a: { id: number; name: string }) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Scenario</label>
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[160px]"
          >
            <option value="">Base</option>
            {scenarios.map((s: { id: number; name: string }) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">View</label>
          <ViewToggle viewMode={viewMode} onChange={changeView} />
        </div>
      </div>

      {viewMode === "calendar" && !summary && (
        <div className={`${METRIC_TILE_GRID_5} mb-4`}>
          {(
            [
              CALENDAR_SUMMARY.nextRiskDate,
              CALENDAR_SUMMARY.safeUntilNextIncome,
              CALENDAR_SUMMARY.lowestProjectedBalance,
              CALENDAR_SUMMARY.highestProjectedBalance,
              CALENDAR_SUMMARY.upcomingIncomeExpenses,
            ] as const
          ).map((metric) => (
            <DashboardMetricTile
              key={metric.label}
              label={metric.label}
              help={metric.help}
              value="Calculating..."
              valueClassName="text-gray-400"
            />
          ))}
        </div>
      )}

      {viewMode === "calendar" && summary && (
        <div className={`${METRIC_TILE_GRID_5} mb-4`}>
          <DashboardMetricTile
            label={CALENDAR_SUMMARY.nextRiskDate.label}
            help={CALENDAR_SUMMARY.nextRiskDate.help}
            value={summary.next_risk_date ? formatDateDisplay(summary.next_risk_date) : "None"}
            valueClassName="text-amber-700"
          />
          <DashboardMetricTile
            label={CALENDAR_SUMMARY.safeUntilNextIncome.label}
            help={CALENDAR_SUMMARY.safeUntilNextIncome.help}
            value={
              summary.safe_until == null
                ? "Unavailable"
                : safeUntil?.nextIncomeDate
                  ? safeUntil.safeAmount >= 0
                    ? `Safe until ${formatDateDisplay(safeUntil.nextIncomeDate)}: ${formatCurrency(safeUntil.safeAmount, "USD")}`
                    : `Unsafe before next paycheck: ${formatCurrency(safeUntil.safeAmount, "USD")}`
                  : "No projected income in horizon"
            }
            valueClassName={
              summary.safe_until == null
                ? "text-gray-500"
                : safeUntil?.nextIncomeDate
                  ? safeUntil.safeAmount >= 0
                    ? "text-emerald-700"
                    : "text-red-700"
                  : "text-gray-700"
            }
            subtitle={
              summary.safe_until == null ? (
                <span className="text-gray-500">Safe-until summary not loaded</span>
              ) : safeUntil?.nextIncomeDate ? (
                safeUntil.safeAmount >= 0 ? (
                  <span className="text-gray-500">
                    Current balance less obligations before next income
                  </span>
                ) : (
                  <span className="text-gray-500">
                    Projected unsafe date:{" "}
                    {safeUntil.unsafeDate ? formatDateDisplay(safeUntil.unsafeDate) : "Unknown"}
                  </span>
                )
              ) : undefined
            }
          />
          <DashboardMetricTile
            label={CALENDAR_SUMMARY.lowestProjectedBalance.label}
            help={CALENDAR_SUMMARY.lowestProjectedBalance.help}
            value={
              summary.lowest_balance != null
                ? formatCurrency(summary.lowest_balance, "USD")
                : "—"
            }
            subtitle={
              summary.lowest_balance_date
                ? formatDateDisplay(summary.lowest_balance_date)
                : undefined
            }
          />
          <DashboardMetricTile
            label={CALENDAR_SUMMARY.highestProjectedBalance.label}
            help={CALENDAR_SUMMARY.highestProjectedBalance.help}
            value={
              summary.best_balance != null ? formatCurrency(summary.best_balance, "USD") : "—"
            }
            valueClassName="text-emerald-700"
            subtitle={
              summary.best_balance_date
                ? formatDateDisplay(summary.best_balance_date)
                : undefined
            }
          />
          <DashboardMetricTile
            label={CALENDAR_SUMMARY.upcomingIncomeExpenses.label}
            help={CALENDAR_SUMMARY.upcomingIncomeExpenses.help}
            value={`+${formatCurrency(summary.total_income, "USD")}`}
            valueClassName="text-green-600"
            subtitle={
              <span className="text-base sm:text-lg md:text-xl font-semibold tabular-nums text-red-600">
                -{formatCurrency(summary.total_expenses, "USD")}
              </span>
            }
          />
        </div>
      )}

      {viewMode === "calendar" && !accountId && riskyAccounts.length > 0 && !calendar.summaryLoading && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 mb-1">Accounts to watch</p>
          <div className="flex flex-wrap gap-2">
            {riskyAccounts.map((a) => (
              <div
                key={a.account_id}
                className="text-xs bg-amber-50 border border-amber-200 rounded-md px-2 py-1"
              >
                <span className="font-medium">{a.account_name}</span>
                {a.risk_date ? (
                  <span className="text-gray-600"> · {formatDateDisplay(a.risk_date)}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}

      {calendarError && <p className="text-red-600 text-sm mb-2">{(calendarError as Error).message}</p>}

      {viewMode === "timeline" && calendar.upcomingLoading && (
        <div className="mb-6 h-32 rounded-lg bg-white shadow animate-pulse" aria-hidden />
      )}
      {viewMode === "timeline" && upcomingMoneyFlow && !calendar.upcomingLoading && (
        <UpcomingMoneyFlowSection
          groups={upcomingMoneyFlow.groups}
          days={upcomingMoneyFlow.days}
          truncated={upcomingMoneyFlow.truncated}
        />
      )}

      {viewMode === "calendar" && calendar.loadingInitial ? (
        <div>
          <p className="text-sm text-gray-500 mb-3">Building your financial calendar…</p>
          <CalendarSkeleton />
        </div>
      ) : viewMode === "calendar" && calendar.firstChunkReady ? (
        hasProjectedActivity(calendar.days) || calendar.loadingRemaining ? (
          <TimelineCalendar
            rangeStart={calendar.range.start}
            rangeEnd={calendar.range.end}
            days={calendar.days}
            selectedDate={selectedDay?.date ?? null}
            onSelectDay={onSelectDay}
            onSelectTransaction={onSelectTransaction}
            pendingMonthKeys={calendar.pendingMonthKeys}
            failedChunks={calendar.failedChunks}
            remainingCount={calendar.remainingCount}
            loadingRemaining={calendar.loadingRemaining}
            onLoadMore={calendar.loadMoreMonths}
            eagerMonthCount={calendar.eagerMonthCount}
            onMonthVisible={calendar.ensureMonthLoaded}
          />
        ) : (
          <p className="text-center text-gray-500 py-12 bg-white border border-gray-200 rounded-lg">
            No projected activity in this horizon.
          </p>
        )
      ) : viewMode === "timeline" && !calendar.upcomingLoading && !upcomingMoneyFlow ? (
        <p className="text-center text-gray-500 py-12 bg-white border border-gray-200 rounded-lg">
          No projected activity in this horizon.
        </p>
      ) : null}

      {selectedDay && viewMode === "calendar" && (
        <TimelineDayPanel
          day={selectedDay}
          onClose={() => {
            setSelectedDay(null);
            setInitialBillTxn(null);
          }}
          singleAccountView={accountId !== ""}
          accounts={accounts}
          horizon={horizon}
          householdId={resolvedHousehold || undefined}
          scenarioId={scenarioId !== "" ? scenarioId : null}
          calendarDays={calendar.days}
          initialBillTxn={initialBillTxn}
          onCalendarRefresh={() => calendar.refetchCalendar()}
          onCreateTransfer={({
            transferFromAccountId,
            transferToAccountId,
            defaultAmount,
            defaultDate,
          }) => {
            const toAcc = accounts.find((a) => a.id === transferToAccountId);
            const isCcPayment = toAcc?.account_type === "CREDIT";
            setTransferPreset({
              accountId: transferFromAccountId,
              mode: isCcPayment ? "credit_card_payment" : "transfer",
              transferFromAccountId,
              transferToAccountId,
              defaultAmount,
              defaultPayee: isCcPayment ? "Credit card payment" : "Transfer",
              defaultDate,
            });
          }}
        />
      )}

      <QuickTransactionModal
        open={transferPreset != null}
        preset={
          transferPreset
            ? {
                ...transferPreset,
                accountId: transferPreset.transferFromAccountId ?? transferPreset.accountId,
              }
            : null
        }
        accounts={accounts}
        onClose={() => setTransferPreset(null)}
        onSuccess={() => {
          setTransferPreset(null);
          calendar.refetchCalendar();
        }}
      />
    </div>
  );
}
