import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineCalendarDay, TimelineCalendarTransaction } from "@budget-app/shared";
import { formatDateDisplay } from "../lib/dateDisplay";
import {
  getTimeline,
  getTimelineCalendar,
  getDashboardSummary,
  listScenarios,
  getProfile,
  listHouseholds,
} from "@budget-app/api-client";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import TimelineCalendar from "../components/timeline/TimelineCalendar";
import TimelineDayPanel from "../components/timeline/TimelineDayPanel";
import TimelineListView from "../components/timeline/TimelineListView";
import UpcomingMoneyFlowSection from "../components/dashboard/UpcomingMoneyFlowSection";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_5, METRIC_TILE_SKELETON_CLASS } from "../components/dashboard/metricTileLayout";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import {
  DEFAULT_TIMELINE_VIEW,
  filterTimelineFromDate,
  hasProjectedActivity,
  isIsoDateString,
  pickHorizonForFocusDate,
  timelineDayForDate,
  computeSafeUntilNextIncome,
  type TimelineHorizon,
  type TimelineLookbackMonths,
  type TimelineViewMode,
} from "../lib/timelineCalendarUtils";
import { PAGE_SHELL } from "../lib/pageLayout";
import { CALENDAR_SUMMARY } from "../lib/timelineTerminology";
import { UPCOMING_PAGE_TITLE } from "../lib/upcomingDisplay";
import { DEFAULT_PASSIVE_FORECAST_DAYS } from "../lib/safeToSpendLabels";

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
      role="group"
      aria-label="Timeline view"
    >
      {(["calendar", "list"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`px-3 py-1 text-sm font-medium rounded-md capitalize transition-colors ${
            viewMode === mode ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
          aria-pressed={viewMode === mode}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className={`${METRIC_TILE_GRID_5} mb-4`}>
      {Array.from({ length: 5 }).map((i) => (
        <div key={i} className={METRIC_TILE_SKELETON_CLASS} aria-hidden />
      ))}
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

export default function Timeline() {
  const [searchParams] = useSearchParams();
  const urlScenario = searchParams.get("scenario_id");
  const urlHorizon = searchParams.get("horizon");
  const urlFocusDate = searchParams.get("date");

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
  const [viewMode, setViewMode] = useState<TimelineViewMode>(() =>
    isIsoDateString(urlFocusDate) ? "calendar" : DEFAULT_TIMELINE_VIEW
  );
  const [selectedDay, setSelectedDay] = useState<TimelineCalendarDay | null>(null);
  const [initialBillTxn, setInitialBillTxn] = useState<TimelineCalendarTransaction | null>(null);
  const [transferPreset, setTransferPreset] = useState<QuickTransactionPreset | null>(null);
  const focusedDateRef = useRef<string | null>(null);

  const focusCalendarDay = useCallback((dateIso: string, days: TimelineCalendarDay[]) => {
    if (focusedDateRef.current === dateIso) return;
    focusedDateRef.current = dateIso;
    setViewMode("calendar");
    setSelectedDay(timelineDayForDate(days, dateIso));
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-timeline-date="${dateIso}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  useEffect(() => {
    if (!isIsoDateString(urlFocusDate)) {
      focusedDateRef.current = null;
      return;
    }
    focusedDateRef.current = null;
    setViewMode("calendar");
  }, [urlFocusDate]);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: dashboardSummary, isLoading: upcomingLoading } = useQuery({
    queryKey: ["dashboard-summary", "calendar-upcoming", DEFAULT_PASSIVE_FORECAST_DAYS],
    queryFn: () => getDashboardSummary({ forecast_days: DEFAULT_PASSIVE_FORECAST_DAYS }),
    staleTime: 60_000,
  });
  const { data: accountsData } = useOperationalAccounts();
  const { data: scenariosData } = useQuery({ queryKey: ["scenarios"], queryFn: () => listScenarios() });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const accounts = accountsData?.results ?? [];
  const scenarios = scenariosData?.results ?? [];
  const defaultHousehold = profile?.default_household ?? households?.[0]?.id;
  const resolvedHousehold = householdId || defaultHousehold;

  const calendarQuery = useQuery({
    queryKey: ["timeline-calendar", horizon, lookbackMonths, accountId, scenarioId, resolvedHousehold],
    queryFn: () =>
      getTimelineCalendar({
        horizon,
        lookback_months: lookbackMonths,
        account_id: accountId || undefined,
        scenario_id: scenarioId || undefined,
        household_id: resolvedHousehold || undefined,
      }),
    enabled: Boolean(resolvedHousehold),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const listQuery = useQuery({
    queryKey: ["timeline", horizon, lookbackMonths, accountId, scenarioId, resolvedHousehold],
    queryFn: () =>
      getTimeline({
        horizon,
        lookback_months: lookbackMonths,
        account_id: accountId || undefined,
        scenario_id: scenarioId || undefined,
        household_id: resolvedHousehold || undefined,
      }),
    enabled: viewMode === "list",
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const calendarData = calendarQuery.data;
  const timeline = listQuery.data?.timeline ?? [];

  useEffect(() => {
    if (!isIsoDateString(urlFocusDate) || !calendarData?.days) return;
    focusCalendarDay(urlFocusDate, calendarData.days);
  }, [urlFocusDate, calendarData, focusCalendarDay]);
  const isLoading =
    viewMode === "calendar"
      ? calendarQuery.isLoading
      : listQuery.isLoading || calendarQuery.isLoading;
  const error = viewMode === "calendar" ? calendarQuery.error : listQuery.error;
  const summary = calendarData?.summary;
  const safeUntil = calendarData ? computeSafeUntilNextIncome(calendarData.days) : null;
  const riskyAccounts = summary?.risky_accounts ?? [];

  return (
    <div className={`${PAGE_SHELL} py-4`}>
      <h1 className="text-lg font-semibold text-gray-900 mb-4">{UPCOMING_PAGE_TITLE}</h1>

      {upcomingLoading && (
        <div className="mb-6 h-32 rounded-lg bg-white shadow animate-pulse" aria-hidden />
      )}
      {dashboardSummary && !upcomingLoading && (
        <UpcomingMoneyFlowSection
          groups={dashboardSummary.upcoming_groups ?? []}
          days={dashboardSummary.upcoming_days}
          truncated={dashboardSummary.upcoming_truncated}
        />
      )}

      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
        Calendar view
      </h2>
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
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {viewMode === "calendar" && isLoading && <SummarySkeleton />}

      {viewMode === "calendar" && summary && !isLoading && (
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
              safeUntil?.nextIncomeDate
                ? safeUntil.safeAmount >= 0
                  ? `Safe until ${formatDateDisplay(safeUntil.nextIncomeDate)}: ${formatCurrency(safeUntil.safeAmount, "USD")}`
                  : `Unsafe before next paycheck: ${formatCurrency(safeUntil.safeAmount, "USD")}`
                : "No projected income in horizon"
            }
            valueClassName={
              safeUntil?.nextIncomeDate
                ? safeUntil.safeAmount >= 0
                  ? "text-emerald-700"
                  : "text-red-700"
                : "text-gray-700"
            }
            subtitle={
              safeUntil?.nextIncomeDate ? (
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

      {viewMode === "calendar" && !accountId && riskyAccounts.length > 0 && !isLoading && (
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

      {error && <p className="text-red-600 text-sm mb-2">{(error as Error).message}</p>}

      {isLoading ? (
        viewMode === "calendar" ? (
          <div>
            <p className="text-sm text-gray-500 mb-3">Building your financial calendar…</p>
            <CalendarSkeleton />
          </div>
        ) : (
          <p className="text-sm text-gray-500">Loading timeline…</p>
        )
      ) : viewMode === "calendar" && calendarData ? (
        hasProjectedActivity(calendarData.days) ? (
          <TimelineCalendar
            data={calendarData}
            selectedDate={selectedDay?.date ?? null}
            onSelectDay={(day) => {
              setSelectedDay(day);
              setInitialBillTxn(null);
            }}
            onSelectTransaction={(day, txn) => {
              setSelectedDay(day);
              setInitialBillTxn(txn);
            }}
          />
        ) : (
          <p className="text-center text-gray-500 py-12 bg-white border border-gray-200 rounded-lg">
            No projected activity in this horizon.
          </p>
        )
      ) : viewMode === "list" && calendarData ? (
        <TimelineListView
          timeline={filterTimelineFromDate(timeline, calendarData.start_date)}
          calendarDays={calendarData.days}
          singleAccountView={accountId !== ""}
        />
      ) : null}

      {selectedDay && (
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
          calendarDays={calendarData?.days}
          initialBillTxn={initialBillTxn}
          onCalendarRefresh={() => calendarQuery.refetch()}
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
          calendarQuery.refetch();
        }}
      />
    </div>
  );
}
