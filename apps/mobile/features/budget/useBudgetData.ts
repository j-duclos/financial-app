import { useMemo } from "react";
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

  return {
    householdId,
    householdReady,
    summaryQuery,
    targetsQuery,
    summary: summaryQuery.data,
    rows,
    isLoading: !householdReady || primaryLoading,
    isError: summaryQuery.isError || targetsQuery.isError,
    error: summaryQuery.error ?? targetsQuery.error,
    isFetching: summaryQuery.isFetching || targetsQuery.isFetching,
    refetch: () => {
      void summaryQuery.refetch();
      void targetsQuery.refetch();
    },
  };
}
