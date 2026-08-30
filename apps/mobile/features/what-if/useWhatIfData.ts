import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createScenario,
  createScenarioAddedRecurring,
  createScenarioCategoryShock,
  createScenarioOneTimeEvent,
  createScenarioOverride,
  deleteScenario,
  deleteScenarioAddedRecurring,
  deleteScenarioCategoryShock,
  deleteScenarioOneTimeEvent,
  deleteScenarioOverride,
  duplicateScenario,
  getScenarioChanges,
  getScenarioComparison,
  listAccounts,
  listScenarios,
  updateScenario,
  updateScenarioAddedRecurring,
  updateScenarioCategoryShock,
  updateScenarioOneTimeEvent,
  updateScenarioOverride,
} from "@budget-app/api-client";
import type { Account, ScenarioChangesResponse } from "@budget-app/shared";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { useHouseholds } from "@/hooks/useHouseholds";
import { useProfile } from "@/lib/profileQuery";
import { useRules } from "@/hooks/useRules";
import type { ForecastHorizon } from "./types";
import { scenarioInputStamp, whatIfQueryKeys } from "./queryKeys";

export function useWhatIfScenarios() {
  return useQuery({
    queryKey: whatIfQueryKeys.scenarios,
    queryFn: () => listScenarios(),
    staleTime: 30_000,
  });
}

export function useScenarioChanges(scenarioId: number | null, householdId?: number | null) {
  const changesQuery = useQuery({
    queryKey: whatIfQueryKeys.scenarioChanges(scenarioId ?? 0, householdId),
    queryFn: () => getScenarioChanges(scenarioId!),
    enabled: scenarioId != null,
    staleTime: 30_000,
  });

  const overrides = changesQuery.data?.overrides;
  const events = changesQuery.data?.one_time_events;
  const shocks = changesQuery.data?.category_shocks;
  const addedRecurring = changesQuery.data?.added_recurring;

  return {
    overrides,
    events,
    shocks,
    addedRecurring,
    changesQuery,
    changesLoading: scenarioId != null && changesQuery.isLoading,
    changesReady: scenarioId == null || changesQuery.isSuccess,
    changesError: changesQuery.isError,
    refetchChanges: changesQuery.refetch,
  };
}

export function useScenarioComparison(
  scenarioId: number | null,
  horizon: ForecastHorizon,
  householdId: number | undefined,
  financialRevision: number | undefined,
  inputStamp: string,
  changesReady: boolean
) {
  return useQuery({
    queryKey: whatIfQueryKeys.compare(
      scenarioId ?? 0,
      horizon,
      householdId,
      financialRevision,
      inputStamp
    ),
    queryFn: ({ signal }) =>
      getScenarioComparison(scenarioId!, {
        horizon,
        household_id: householdId,
        signal,
      }),
    enabled: scenarioId != null && changesReady,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export type WhatIfFormDataNeeds = {
  /** Lightweight picker accounts (id/name/type) — shared account-options cache. */
  accountsLight?: boolean;
  /** Enriched balances — only for debt payment forms. */
  accountsWithBalance?: boolean;
  rules?: boolean;
  categories?: boolean;
};

/**
 * Progressive form datasets: do not load accounts/rules/categories until a concrete
 * change form needs them. Add Change menu alone should not fetch picker data.
 */
export function useWhatIfFormData(needs: WhatIfFormDataNeeds, householdId: number | undefined) {
  const needLight = Boolean(needs.accountsLight) && !needs.accountsWithBalance;
  const needBalance = Boolean(needs.accountsWithBalance);

  const lightAccounts = useAccountOptions({
    householdId: householdId ?? null,
    enabled: needLight && householdId != null,
  });

  const balanceAccounts = useQuery({
    queryKey: whatIfQueryKeys.accounts(householdId),
    queryFn: () =>
      listAccounts({
        active_only: true,
        page_size: 500,
        balance: "true",
        household: householdId,
      }),
    enabled: needBalance && householdId != null,
    staleTime: 60_000,
  });

  const rulesQuery = useRules({ enabled: Boolean(needs.rules) });
  const categories = useCategoryOptions({
    householdId: householdId ?? null,
    enabled: Boolean(needs.categories) && householdId != null,
  });

  const accounts: Account[] = needBalance
    ? (balanceAccounts.data?.results ?? [])
    : lightAccounts.accounts;

  return {
    accounts,
    accountsQuery: needBalance ? balanceAccounts : lightAccounts,
    rules: rulesQuery,
    categories,
  };
}

/**
 * Invalidate only scenario-scoped queries — never real financial data.
 * Comparison refreshes via inputStamp when scenario-changes settle (avoid double compare).
 */
export function invalidateScenarioQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  scenarioId: number | null,
  householdId?: number | null
) {
  void queryClient.invalidateQueries({ queryKey: whatIfQueryKeys.scenarios });
  if (scenarioId != null) {
    void queryClient.invalidateQueries({
      queryKey: whatIfQueryKeys.scenarioChanges(scenarioId, householdId),
    });
  }
}

/**
 * Explicit pull-to-refresh graph: scenario list → changes → one comparison.
 * Does not use invalidate-as-refresh (avoids duplicate compare requests).
 */
export async function refreshWhatIfScenario(args: {
  queryClient: ReturnType<typeof useQueryClient>;
  scenarioId: number | null;
  horizon: ForecastHorizon;
  householdId: number | undefined;
  financialRevision: number | undefined;
  scenarioUpdatedAt?: string;
}): Promise<void> {
  const {
    queryClient,
    scenarioId,
    horizon,
    householdId,
    financialRevision,
    scenarioUpdatedAt,
  } = args;

  const scenariosPage = await queryClient.fetchQuery({
    queryKey: whatIfQueryKeys.scenarios,
    queryFn: () => listScenarios(),
  });

  if (scenarioId == null) return;

  const freshUpdatedAt =
    scenariosPage.results?.find((s) => s.id === scenarioId)?.updated_at ?? scenarioUpdatedAt;

  const changes = await queryClient.fetchQuery({
    queryKey: whatIfQueryKeys.scenarioChanges(scenarioId, householdId),
    queryFn: () => getScenarioChanges(scenarioId),
  });

  const stamp = scenarioInputStamp({
    scenarioUpdatedAt: freshUpdatedAt,
    overrides: changes.overrides,
    events: changes.one_time_events,
    shocks: changes.category_shocks,
    addedRecurring: changes.added_recurring,
  });

  await queryClient.fetchQuery({
    queryKey: whatIfQueryKeys.compare(
      scenarioId,
      horizon,
      householdId,
      financialRevision,
      stamp
    ),
    queryFn: () =>
      getScenarioComparison(scenarioId, {
        horizon,
        household_id: householdId,
      }),
  });
}

export function useScenarioMutations(
  scenarioId: number | null,
  householdId?: number | null
) {
  const queryClient = useQueryClient();

  const invalidate = () => invalidateScenarioQueries(queryClient, scenarioId, householdId);

  const createScenarioMu = useMutation({
    mutationFn: createScenario,
    onSuccess: invalidate,
  });

  const updateScenarioMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateScenario>[1] }) =>
      updateScenario(id, data),
    onSuccess: invalidate,
  });

  const deleteScenarioMu = useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => invalidateScenarioQueries(queryClient, null, householdId),
  });

  const duplicateScenarioMu = useMutation({
    mutationFn: (id: number) => duplicateScenario(id),
    onSuccess: invalidate,
  });

  return {
    createScenarioMu,
    updateScenarioMu,
    deleteScenarioMu,
    duplicateScenarioMu,
    invalidate,
    createScenarioOverride,
    updateScenarioOverride,
    deleteScenarioOverride,
    createScenarioOneTimeEvent,
    updateScenarioOneTimeEvent,
    deleteScenarioOneTimeEvent,
    createScenarioAddedRecurring,
    updateScenarioAddedRecurring,
    deleteScenarioAddedRecurring,
    createScenarioCategoryShock,
    updateScenarioCategoryShock,
    deleteScenarioCategoryShock,
  };
}

export { useProfile, useHouseholds, scenarioInputStamp };
export type { ScenarioChangesResponse };
