import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { resolveRuleOccurrence } from "@budget-app/api-client";
import { calendarMonthFromIsoDate, getEffectiveDisplayName, parseIsoDateParam } from "@budget-app/shared";
import type { TimelineCalendarTransaction } from "@budget-app/shared";
import {
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SkeletonBlock,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { resolveHouseholdId } from "@/lib/householdContext";
import { describeApiError } from "@/services/api";
import { usePageForecastWindow } from "@/hooks/usePageForecastWindow";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { transactionsForForecastRiskPath } from "@/features/payment-planner/navigation";
import { CalendarMonthGrid } from "./CalendarMonthGrid";
import { CalendarDaySummary } from "./CalendarDaySummary";
import { CalendarFiltersSheet } from "./CalendarFiltersSheet";
import { CalendarNextRiskBanner } from "./CalendarNextRiskBanner";
import {
  buildCalendarFilters,
  useCalendarData,
} from "./useCalendarData";
import {
  calendarAccountRiskPresentation,
} from "./calendarPresentation";
import {
  getCalendarEventDestination,
  navigateToCalendarEventDestination,
} from "./calendarEventNavigation";
import {
  dayMap,
  isDateBeforeLookback,
  isDateWithinForecast,
  selectedDateAfterMonthChange,
  shiftMonth,
} from "./calendarUtils";
import { DEFAULT_CALENDAR_EVENT_FILTER, type CalendarEventFilter } from "./types";

export function CalendarScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string }>();
  const deepLinkDate = useMemo(() => parseIsoDateParam(params.date), [params.date]);
  const { forecastDays, ready: forecastReady } = usePageForecastWindow();
  const { householdId: defaultHouseholdId, isReady: householdReady } = useDefaultHouseholdId();
  const today = todayStr();
  const [visibleYear, setVisibleYear] = useState(() => new Date().getFullYear());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(today);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  const [accountId, setAccountId] = useState<number | "">("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<CalendarEventFilter>(DEFAULT_CALENDAR_EVENT_FILTER);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const accountOptionsQuery = useAccountOptions({ householdId: defaultHouseholdId });
  const accounts = accountOptionsQuery.accounts;

  const householdId = resolveHouseholdId(defaultHouseholdId, accountId || null, accounts);

  const selectedAccountName = useMemo(() => {
    if (accountId === "") return null;
    const match = accounts.find((a) => a.id === accountId);
    return match ? getEffectiveDisplayName(match) : null;
  }, [accountId, accounts]);

  const filters = useMemo(
    () =>
      buildCalendarFilters({
        forecastDays: forecastDays,
        lookbackMonths: 1,
        accountId,
        householdId: householdId ?? undefined,
      }),
    [forecastDays, accountId, householdId]
  );

  const { days, summary, isLoading, isError, error, isFetching, refetchCalendar } = useCalendarData({
    visibleYear,
    visibleMonth,
    filters,
  });

  const dayByDate = useMemo(() => dayMap(days), [days]);
  const selectedDay = selectedDate ? dayByDate.get(selectedDate) : undefined;
  const dayOnNextRisk = summary?.next_risk_date ? dayByDate.get(summary.next_risk_date) : undefined;
  const outsideForecast = selectedDate
    ? !isDateWithinForecast(selectedDate, forecastDays, today) && selectedDate >= today
    : false;
  const outsideLookback = selectedDate
    ? isDateBeforeLookback(selectedDate, filters.lookbackMonths, today)
    : false;

  const goToMonth = useCallback((year: number, month: number) => {
    setVisibleYear(year);
    setVisibleMonth(month);
    setSelectedDate((prev) => selectedDateAfterMonthChange(prev, year, month));
  }, []);

  const goPrevMonth = useCallback(() => {
    const next = shiftMonth(visibleYear, visibleMonth, -1);
    goToMonth(next.year, next.month);
  }, [visibleYear, visibleMonth, goToMonth]);

  const goNextMonth = useCallback(() => {
    const next = shiftMonth(visibleYear, visibleMonth, 1);
    goToMonth(next.year, next.month);
  }, [visibleYear, visibleMonth, goToMonth]);

  const goToday = useCallback(() => {
    const now = new Date();
    goToMonth(now.getFullYear(), now.getMonth());
    setSelectedDate(todayStr());
  }, [goToMonth]);

  useEffect(() => {
    if (!deepLinkDate || deepLinkApplied) return;
    const { year, month } = calendarMonthFromIsoDate(deepLinkDate);
    setVisibleYear(year);
    setVisibleMonth(month);
    setSelectedDate(deepLinkDate);
    setDeepLinkApplied(true);
  }, [deepLinkDate, deepLinkApplied]);

  const onEventPress = useCallback(
    async (txn: TimelineCalendarTransaction) => {
      const destination = getCalendarEventDestination(txn);
      if (destination) {
        navigateToCalendarEventDestination(router as { push: (path: string) => void }, destination);
        return;
      }
      if (txn.rule_id && txn.account_id && txn.date) {
        router.push(`/recurring/${txn.rule_id}`);
        return;
      }
      if (txn.rule_id && txn.account_id && selectedDate) {
        const key = `${txn.rule_id}-${selectedDate}`;
        setResolvingId(key);
        try {
          const result = await resolveRuleOccurrence({
            rule_id: txn.rule_id,
            account_id: txn.account_id,
            occurrence_date: selectedDate,
          });
          router.push(`/transaction/${result.transaction_id}`);
        } catch {
          router.push(`/recurring/${txn.rule_id}`);
        } finally {
          setResolvingId(null);
        }
      }
    },
    [router, selectedDate]
  );

  const onAccountRiskPress = useCallback(() => {
    if (!selectedDate || !selectedDay) return;
    const risk = calendarAccountRiskPresentation(selectedDay, selectedDate);
    if (!risk?.accountId) return;
    router.push(
      transactionsForForecastRiskPath({
        accountId: risk.accountId,
        accountName: risk.accountName,
        focusDate: selectedDate,
        focusTransactionId: risk.focusTransactionId,
      }) as never
    );
  }, [router, selectedDate, selectedDay]);

  const activeFilterCount =
    (accountId !== "" ? 1 : 0) +
    (eventFilter.flow !== "all" ? 1 : 0) +
    (eventFilter.recurringOnly ? 1 : 0);

  if (!forecastReady || !householdReady) {
    return (
      <Screen scroll={false}>
        <SkeletonBlock lines={2} />
        <SkeletonBlock lines={8} />
        <SkeletonBlock lines={4} />
      </Screen>
    );
  }

  if (householdId == null) {
    return (
      <Screen scroll={false}>
        <EmptyState
          title="Default household required"
          message="Set a default household in Profile & Settings on web to view your calendar."
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.spacing.xxl }}
        refreshControl={
          <RefreshControl refreshing={isFetching && !isLoading} onRefresh={() => refetchCalendar()} />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.title }} accessibilityRole="header">
            Calendar
          </Text>
          <IconButton
            name="filter"
            accessibilityLabel={
              activeFilterCount > 0 ? `Calendar filters, ${activeFilterCount} active` : "Calendar filters"
            }
            onPress={() => setFiltersOpen(true)}
          />
        </View>

        <CalendarNextRiskBanner
          summary={summary}
          dayOnRiskDate={dayOnNextRisk}
          forecastDays={forecastDays}
          onNavigate={(path) => router.push(path as never)}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <IconButton name="chevron-left" accessibilityLabel="Previous month" onPress={goPrevMonth} />
          <Pressable onPress={goToday} accessibilityRole="button" accessibilityLabel="Go to today">
            <Text style={{ color: theme.colors.tint, fontWeight: "700" }}>Today</Text>
          </Pressable>
          <IconButton name="chevron-right" accessibilityLabel="Next month" onPress={goNextMonth} />
        </View>

        {isError ? (
          <ErrorState message={describeApiError(error)} onRetry={() => refetchCalendar()} />
        ) : isLoading && days.length === 0 ? (
          <SkeletonBlock lines={10} />
        ) : (
          <CalendarMonthGrid
            year={visibleYear}
            month={visibleMonth}
            days={days}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        )}

        <View style={{ marginTop: theme.spacing.sm }}>
          {selectedDate ? (
            outsideLookback ? (
              <EmptyState
                title="No history"
                message="This date is before the loaded history window. Pick a more recent date."
              />
            ) : (
              <CalendarDaySummary
                dateIso={selectedDate}
                day={selectedDay}
                outsideForecast={outsideForecast}
                forecastDays={forecastDays}
                eventFilter={eventFilter}
                accountName={selectedAccountName}
                onEventPress={onEventPress}
                onAccountRiskPress={onAccountRiskPress}
              />
            )
          ) : (
            <EmptyState title="Select a day" message="Tap a date to see activity and forecast details." />
          )}
          {resolvingId ? (
            <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: 8 }}>
              Opening transaction…
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <CalendarFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        accounts={accounts}
        accountsLoading={accountOptionsQuery.isLoading && accounts.length === 0}
        accountsError={accountOptionsQuery.isError}
        accountId={accountId}
        onAccountChange={setAccountId}
        eventFilter={eventFilter}
        onEventFilterChange={setEventFilter}
      />
    </Screen>
  );
}
