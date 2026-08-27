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
  getProfile,
  getScenarioComparison,
  listAccounts,
  listHouseholds,
  listRules,
  listScenarioAddedRecurring,
  listScenarioCategoryShocks,
  listScenarioOneTimeEvents,
  listScenarioOverrides,
  listScenarios,
  updateScenario,
  updateScenarioAddedRecurring,
  updateScenarioCategoryShock,
  updateScenarioOneTimeEvent,
  updateScenarioOverride,
} from "@budget-app/api-client";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import type { ForecastHorizon } from "./types";
import { scenarioInputStamp, whatIfQueryKeys } from "./queryKeys";

export function useWhatIfProfile() {
  return useQuery({
    queryKey: whatIfQueryKeys.profile,
    queryFn: getProfile,
    staleTime: 60_000,
  });
}

export function useWhatIfHouseholds() {
  return useQuery({
    queryKey: whatIfQueryKeys.households,
    queryFn: listHouseholds,
    staleTime: 60_000,
  });
}

export function useWhatIfScenarios() {
  return useQuery({
    queryKey: whatIfQueryKeys.scenarios,
    queryFn: () => listScenarios(),
    staleTime: 30_000,
  });
}

export function useScenarioChanges(scenarioId: number | null) {
  const overrides = useQuery({
    queryKey: whatIfQueryKeys.scenarioOverrides(scenarioId ?? 0),
    queryFn: () => listScenarioOverrides(scenarioId!),
    enabled: scenarioId != null,
  });
  const events = useQuery({
    queryKey: whatIfQueryKeys.scenarioEvents(scenarioId ?? 0),
    queryFn: () => listScenarioOneTimeEvents(scenarioId!),
    enabled: scenarioId != null,
  });
  const shocks = useQuery({
    queryKey: whatIfQueryKeys.scenarioShocks(scenarioId ?? 0),
    queryFn: () => listScenarioCategoryShocks(scenarioId!),
    enabled: scenarioId != null,
  });
  const addedRecurring = useQuery({
    queryKey: whatIfQueryKeys.scenarioAddedRecurring(scenarioId ?? 0),
    queryFn: () => listScenarioAddedRecurring(scenarioId!),
    enabled: scenarioId != null,
  });

  const changesLoading =
    scenarioId != null &&
    (overrides.isLoading || events.isLoading || shocks.isLoading || addedRecurring.isLoading);

  const changesReady =
    scenarioId == null ||
    (overrides.isSuccess && events.isSuccess && shocks.isSuccess && addedRecurring.isSuccess);

  return {
    overrides: overrides.data,
    events: events.data,
    shocks: shocks.data,
    addedRecurring: addedRecurring.data,
    changesLoading,
    changesReady,
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
  const rules = useQuery({
    queryKey: whatIfQueryKeys.rules,
    queryFn: () => listRules(),
    enabled,
    staleTime: 60_000,
  });
  /** Shared picker SoT — same cache as Transactions / Recurring / Spending Limits. */
  const categories = useCategoryOptions({
    householdId: householdId ?? null,
    enabled: enabled && householdId != null,
  });
  return { accounts, rules, categories };
}

/** Invalidate only scenario-scoped queries — never real financial data. */
export function invalidateScenarioQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  scenarioId: number | null
) {
  void queryClient.invalidateQueries({ queryKey: whatIfQueryKeys.scenarios });
  if (scenarioId != null) {
    void queryClient.invalidateQueries({
      queryKey: whatIfQueryKeys.scenarioOverrides(scenarioId),
    });
    void queryClient.invalidateQueries({ queryKey: whatIfQueryKeys.scenarioEvents(scenarioId) });
    void queryClient.invalidateQueries({ queryKey: whatIfQueryKeys.scenarioShocks(scenarioId) });
    void queryClient.invalidateQueries({
      queryKey: whatIfQueryKeys.scenarioAddedRecurring(scenarioId),
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

export { scenarioInputStamp };
