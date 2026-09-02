import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  getSpendingTargetsSummary,
  listSpendingTargets,
} from "@budget-app/api-client";
import type { SpendingTargetMetrics } from "@budget-app/shared";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { budgetQueryKeys } from "./queryKeys";
import type { BudgetCategoryRow, BudgetPeriodAnchor } from "./types";

export function useBudgetData(period: BudgetPeriodAnchor) {
  const { householdId, isReady: householdReady } = useDefaultHouseholdId();
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const summaryQuery = useQuery({
    queryKey: budgetQueryKeys.summary(householdId, period.monthKey, period.anchor),
    queryFn: () =>
      getSpendingTargetsSummary({
        household: householdId ?? undefined,
        anchor: period.anchor,
      }),
    enabled: householdId != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const targetsQuery = useQuery({
    queryKey: budgetQueryKeys.targets(householdId, period.monthKey, period.anchor),
    queryFn: () =>
      listSpendingTargets({
        household: householdId ?? undefined,
        anchor: period.anchor,
        active: true,
      }),
    enabled: householdId != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const summaryMatchesPeriod =
    summaryQuery.data != null && summaryQuery.data.anchor_date.slice(0, 7) === period.monthKey;
  const targetsMatchPeriod = !targetsQuery.isPlaceholderData;
  const dataMatchesPeriod = summaryMatchesPeriod && targetsMatchPeriod;
  const isUpdatingPeriod =
    (summaryQuery.isFetching || targetsQuery.isFetching) && !dataMatchesPeriod;

  const metricsById = useMemo(() => {
    const map = new Map<number, SpendingTargetMetrics>();
    for (const row of summaryQuery.data?.targets ?? []) {
      map.set(row.target_id, row);
    }
    return map;
  }, [summaryQuery.data?.targets]);

  const rows: BudgetCategoryRow[] = useMemo(() => {
    const targets = targetsQuery.data?.results ?? [];
    return targets
      .map((target) => {
        const metrics = metricsById.get(target.id) ?? target.metrics;
        if (!metrics) return null;
        return { target, metrics };
      })
      .filter((row): row is BudgetCategoryRow => row != null);
  }, [targetsQuery.data?.results, metricsById]);

  const primaryLoading =
    householdId != null &&
    rows.length === 0 &&
    (summaryQuery.isPending || targetsQuery.isPending);

  const refetch = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([summaryQuery.refetch(), targetsQuery.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [summaryQuery, targetsQuery]);

  return {
    householdId,
    householdReady,
    summaryQuery,
    targetsQuery,
    summary: dataMatchesPeriod ? summaryQuery.data : undefined,
    rows: dataMatchesPeriod ? rows : [],
    dataMatchesPeriod,
    isUpdatingPeriod,
    isLoading: !householdReady || primaryLoading,
    /** List is unusable without targets; summary failure is progressive. */
    isError: targetsQuery.isError,
    summaryError: summaryQuery.isError,
    error: targetsQuery.error ?? summaryQuery.error,
    isFetching: summaryQuery.isFetching || targetsQuery.isFetching,
    pullRefreshing,
    refetch,
  };
}
