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

export function useScenarioChanges(scenarioId: number | null) {
  const changesQuery = useQuery({
    queryKey: whatIfQueryKeys.scenarioChanges(scenarioId ?? 0),
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
    queryFn: () =>
      getScenarioComparison(scenarioId!, {
        horizon,
        household_id: householdId,
      }),
    enabled: scenarioId != null && changesReady,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useWhatIfFormData(enabled: boolean, householdId: number | undefined) {
  const accounts = useQuery({
    queryKey: whatIfQueryKeys.accounts,
    queryFn: () =>
      listAccounts({
        active_only: true,
        page_size: 500,
        balance: "true",
      }),
    enabled,
    staleTime: 60_000,
  });
  /** Shared rules list — same cache as Automation / Recurring. */
  const rulesQuery = useRules({ enabled });
  /** Shared picker SoT — same cache as Transactions / Recurring / Spending Limits. */
  const categories = useCategoryOptions({
    householdId: householdId ?? null,
    enabled: enabled && householdId != null,
  });
  return { accounts, rules: rulesQuery, categories };
}

/** Invalidate only scenario-scoped queries — never real financial data. */
export function invalidateScenarioQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  scenarioId: number | null
) {
  void queryClient.invalidateQueries({ queryKey: whatIfQueryKeys.scenarios });
  if (scenarioId != null) {
    void queryClient.invalidateQueries({
      queryKey: whatIfQueryKeys.scenarioChanges(scenarioId),
    });
    void queryClient.invalidateQueries({ queryKey: ["what-if-scenario-compare", scenarioId] });
  }
}

export function useScenarioMutations(scenarioId: number | null) {
  const queryClient = useQueryClient();

  const invalidate = () => invalidateScenarioQueries(queryClient, scenarioId);

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
    onSuccess: () => invalidateScenarioQueries(queryClient, null),
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
