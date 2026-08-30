import React, { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type {
  Scenario,
  ScenarioAddedRecurring,
  ScenarioCategoryShock,
  ScenarioOneTimeEvent,
  ScenarioRuleOverride,
  ScenarioTemplateKey,
} from "@budget-app/shared";
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
} from "@/components/ui";
import { useTheme } from "@/theme";
import { describeApiError } from "@/services/api";
import { ComparisonSection } from "./components/ComparisonSection";
import { DetailedImpactSection } from "./components/DetailedImpactSection";
import { PlanSummaryCard, comparisonHorizonMonths } from "./components/PlanSummaryCard";
import { ScenarioChangeRow } from "./components/ScenarioChangeRow";
import { ScenarioContextBanner } from "./components/ScenarioContextBanner";
import { WhatIfEmptyState } from "./components/WhatIfEmptyState";
import { ChipRow } from "./components/ChipRow";
import { PlanActionsSheet } from "./components/PlanActionsSheet";
import { PlanPickerSheet } from "./components/PlanPickerSheet";
import { AddChangeMenuSheet, ChangeKindSheet } from "./forms/ChangeKindSheet";
import { CreateScenarioSheet } from "./forms/CreateScenarioSheet";
import { DebtPaymentSheet } from "./forms/DebtPaymentSheet";
import { NewRecurringSheet } from "./forms/NewRecurringSheet";
import { OneTimeEventSheet } from "./forms/OneTimeEventSheet";
import { OverrideFormSheet } from "./forms/OverrideFormSheet";
import { FORECAST_PERIOD_OPTIONS, horizonToMonths } from "./display";
import { parsePositiveIntParam } from "./navigation";
import { buildPlanIncludes, type PlanIncludeItem } from "./scenarioPlainLanguage";
import {
  isDebtPaymentOverride,
  isDebtRecurringPayment,
  isDebtScenarioEvent,
} from "./scenarioDebtPayment";
import { horizonMonthsToParam } from "./scenarioTemplates";
import type {
  EventPreset,
  ExpenseChangeKind,
  ForecastHorizon,
  IncomeChangeKind,
  NewRecurringDirection,
  OverrideContext,
} from "./types";
import {
  invalidateScenarioQueries,
  refreshWhatIfScenario,
  scenarioInputStamp,
  useHouseholds,
  useProfile,
  useScenarioChanges,
  useScenarioComparison,
  useScenarioMutations,
  useWhatIfFormData,
  useWhatIfScenarios,
} from "./useWhatIfData";
import { useQueryClient } from "@tanstack/react-query";

export function WhatIfScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ goal?: string; debt?: string }>();
  const contextGoalId = parsePositiveIntParam(params.goal);
  const contextDebtId = parsePositiveIntParam(params.debt);

  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [forecastPeriod, setForecastPeriod] = useState<ForecastHorizon>("12m");
  const [showDetails, setShowDetails] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<ScenarioTemplateKey>("blank");
  const [planPickerOpen, setPlanPickerOpen] = useState(false);
  const [planActionsOpen, setPlanActionsOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [incomeKindOpen, setIncomeKindOpen] = useState(false);
  const [expenseKindOpen, setExpenseKindOpen] = useState(false);
  const [eventPreset, setEventPreset] = useState<EventPreset | null>(null);
  const [overrideContext, setOverrideContext] = useState<OverrideContext>("expense_change");
  const [overrideSheetOpen, setOverrideSheetOpen] = useState(false);
  const [overrideMode, setOverrideMode] = useState<"add" | "edit">("add");
  const [editingOverride, setEditingOverride] = useState<ScenarioRuleOverride | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScenarioOneTimeEvent | null>(null);
  const [newRecurringDirection, setNewRecurringDirection] = useState<NewRecurringDirection | null>(null);
  const [debtSheetOpen, setDebtSheetOpen] = useState(false);
  const [recurringDebtOpen, setRecurringDebtOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [removeItem, setRemoveItem] = useState<PlanIncludeItem | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const profileQuery = useProfile();
  const householdsQuery = useHouseholds();
  const scenariosQuery = useWhatIfScenarios();

  const scenarios = scenariosQuery.data?.results ?? [];
  const defaultHousehold = profileQuery.data?.default_household ?? householdsQuery.data?.[0]?.id;
  const selectedHousehold = (householdsQuery.data ?? []).find((h) => h.id === defaultHousehold);
  const selectedScenario = scenarios.find((s: Scenario) => s.id === selectedScenarioId);

  useEffect(() => {
    if (scenarios.length > 0 && selectedScenarioId == null) {
      setSelectedScenarioId(scenarios[0].id);
    }
  }, [scenarios, selectedScenarioId]);

  useEffect(() => {
    if (selectedScenario?.horizon_months) {
      setForecastPeriod(horizonMonthsToParam(selectedScenario.horizon_months));
    }
  }, [selectedScenario?.id, selectedScenario?.horizon_months]);

  const {
    overrides,
    events,
    shocks,
    addedRecurring,
    changesLoading,
    changesReady,
    changesError,
    refetchChanges,
  } = useScenarioChanges(selectedScenarioId, defaultHousehold);

  const inputStamp = scenarioInputStamp({
    scenarioUpdatedAt: selectedScenario?.updated_at,
    overrides,
    events,
    shocks,
    addedRecurring,
  });

  const comparisonQuery = useScenarioComparison(
    selectedScenarioId,
    forecastPeriod,
    defaultHousehold,
    selectedHousehold?.financial_revision,
    inputStamp,
    changesReady
  );

  const debtFormOpen = debtSheetOpen || recurringDebtOpen;
  const overrideFormOpen = overrideSheetOpen;
  const eventFormOpen = eventPreset != null;
  const newRecurringFormOpen = newRecurringDirection != null;

  const formData = useWhatIfFormData(
    {
      accountsLight:
        overrideFormOpen || eventFormOpen || newRecurringFormOpen || debtFormOpen,
      accountsWithBalance: debtFormOpen,
      rules: overrideFormOpen || debtFormOpen,
      categories: overrideFormOpen || eventFormOpen || newRecurringFormOpen || debtFormOpen,
    },
    defaultHousehold
  );
  const accounts = formData.accounts;
  const rules = formData.rules.rules;
  const categoriesList = formData.categories.categories;

  const mutations = useScenarioMutations(selectedScenarioId, defaultHousehold);

  const planItems = useMemo(
    () =>
      buildPlanIncludes(
        (overrides ?? []) as ScenarioRuleOverride[],
        (events ?? []) as ScenarioOneTimeEvent[],
        (shocks ?? []) as ScenarioCategoryShock[],
        (addedRecurring ?? []) as ScenarioAddedRecurring[]
      ),
    [overrides, events, shocks, addedRecurring]
  );

  const comparisonBelongsToSelection =
    comparisonQuery.data == null ||
    selectedScenarioId == null ||
    comparisonQuery.data.scenario_id === selectedScenarioId;
  const comparisonBusy =
    comparisonQuery.isLoading ||
    comparisonQuery.isFetching ||
    changesLoading ||
    !comparisonBelongsToSelection;
  const comparisonStaleOnError =
    comparisonQuery.isError && comparisonQuery.data != null && comparisonBelongsToSelection;
  const horizonMonths = horizonToMonths(forecastPeriod);
  const horizonLabel = `${horizonMonths}-month`;
  const isEmptyScenario = planItems.length === 0 && changesReady && !changesError;

  const invalidate = () => {
    if (selectedScenarioId != null) {
      invalidateScenarioQueries(queryClient, selectedScenarioId, defaultHousehold);
    }
  };

  const refreshAll = async () => {
    setPullRefreshing(true);
    try {
      // Same household ID as scenario changes / comparison / query keys — only refresh revision.
      const householdId = defaultHousehold;
      const householdResult = await householdsQuery.refetch();
      const freshHousehold = (householdResult.data ?? []).find((h) => h.id === householdId);
      await refreshWhatIfScenario({
        queryClient,
        scenarioId: selectedScenarioId,
        horizon: forecastPeriod,
        householdId,
        financialRevision: freshHousehold?.financial_revision,
        scenarioUpdatedAt: selectedScenario?.updated_at,
      });
    } finally {
      setPullRefreshing(false);
    }
  };

  const handleCreateScenario = async (data: Parameters<typeof mutations.createScenarioMu.mutateAsync>[0]) => {
    const created = await mutations.createScenarioMu.mutateAsync(data);
    setCreateOpen(false);
    setSelectedScenarioId(created.id);
    setForecastPeriod(horizonMonthsToParam(created.horizon_months ?? 12));
  };

  const handleRemoveItem = async (item: PlanIncludeItem) => {
    if (item.kind === "override") await mutations.deleteScenarioOverride(item.sourceId);
    else if (item.kind === "event") await mutations.deleteScenarioOneTimeEvent(item.sourceId);
    else if (item.kind === "added_recurring") await mutations.deleteScenarioAddedRecurring(item.sourceId);
    else await mutations.deleteScenarioCategoryShock(item.sourceId);
    invalidate();
  };

  const handleEditItem = (item: PlanIncludeItem) => {
    if (item.kind === "override") {
      const ov = (overrides ?? []).find((o) => o.id === item.sourceId);
      if (!ov) return;
      if (isDebtPaymentOverride(ov as ScenarioRuleOverride)) {
        setEditingOverride(ov as ScenarioRuleOverride);
        setEditingEvent(null);
        setDebtSheetOpen(true);
        return;
      }
      setOverrideContext(ov.rule?.direction === "INCOME" ? "paycheck" : "expense_change");
      setOverrideMode("edit");
      setEditingOverride(ov as ScenarioRuleOverride);
      setOverrideSheetOpen(true);
    } else if (item.kind === "event") {
      const ev = (events ?? []).find((e) => e.id === item.sourceId);
      if (!ev) return;
      if (isDebtScenarioEvent(ev as ScenarioOneTimeEvent)) {
        setEditingEvent(ev as ScenarioOneTimeEvent);
        setEditingOverride(null);
        setDebtSheetOpen(true);
      } else {
        setEditingEvent(ev as ScenarioOneTimeEvent);
        setEventPreset(
          ev.direction === "INCOME" ? "income" : ev.direction === "TRANSFER" ? "transfer" : "expense"
        );
      }
    } else if (item.kind === "added_recurring") {
      const ar = (addedRecurring ?? []).find((a) => a.id === item.sourceId);
      if (ar && isDebtRecurringPayment(ar as ScenarioAddedRecurring)) {
        setRecurringDebtOpen(true);
      }
    }
  };

  const handleIncomeKind = (kind: IncomeChangeKind) => {
    if (kind === "one_time") setEventPreset("income");
    else if (kind === "paycheck") {
      setOverrideContext("paycheck");
      setOverrideMode("add");
      setEditingOverride(null);
      setOverrideSheetOpen(true);
    } else setNewRecurringDirection("INCOME");
  };

  const handleExpenseKind = (kind: ExpenseChangeKind) => {
    if (kind === "one_time") setEventPreset("expense");
    else if (kind === "current") {
      setOverrideContext("expense_change");
      setOverrideMode("add");
      setEditingOverride(null);
      setOverrideSheetOpen(true);
    } else setNewRecurringDirection("EXPENSE");
  };

  if (scenariosQuery.isError) {
    return (
      <Screen>
        <AppHeader title="What-If Plan" onBack={() => router.back()} />
        <ErrorState message={describeApiError(scenariosQuery.error)} onRetry={() => scenariosQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <AppHeader
        title="What-If Plan"
        onBack={() => router.back()}
        right={
          scenarios.length > 0 ? (
            <IconButton name="plus" accessibilityLabel="New what-if plan" onPress={() => setCreateOpen(true)} />
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void refreshAll()}
            tintColor={theme.colors.tint}
          />
        }
      >
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.body, marginBottom: 12 }}>
          Simulate income, bills, or payments without changing your real financial data.
        </Text>

        <ScenarioContextBanner goalId={contextGoalId} debtId={contextDebtId} />

        {scenarios.length === 0 ? (
          <WhatIfEmptyState
            onPickTemplate={(key) => {
              setCreateTemplate(key);
              setCreateOpen(true);
            }}
            onCreateBlank={() => {
              setCreateTemplate("blank");
              setCreateOpen(true);
            }}
          />
        ) : (
          <>
            {selectedScenario ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: theme.spacing.sm,
                  gap: 4,
                }}
              >
                <Pressable
                  onPress={() => setPlanPickerOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Plan ${selectedScenario.name}`}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Plan</Text>
                    <Text style={{ color: theme.colors.text, ...theme.typography.headline }} numberOfLines={1}>
                      {selectedScenario.name} ›
                    </Text>
                  </View>
                </Pressable>
                <IconButton
                  name="ellipsis-v"
                  accessibilityLabel="Plan options"
                  onPress={() => setPlanActionsOpen(true)}
                />
              </View>
            ) : null}

            <View style={{ marginBottom: theme.spacing.md }}>
              <ChipRow
                label="Forecast period"
                options={FORECAST_PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                selected={forecastPeriod}
                onSelect={(v) => setForecastPeriod(v as ForecastHorizon)}
              />
            </View>

            {selectedScenarioId && selectedScenario ? (
              <>
                <PlanSummaryCard
                  scenarioName={selectedScenario.name}
                  comparison={comparisonQuery.data}
                  planItems={planItems}
                  accounts={accounts}
                  loading={comparisonBusy && !comparisonQuery.data}
                  horizonMonths={comparisonHorizonMonths(comparisonQuery.data, horizonMonths)}
                  recalculating={
                    (comparisonQuery.isFetching && !!comparisonQuery.data) ||
                    !comparisonBelongsToSelection
                  }
                  emptyScenario={isEmptyScenario}
                  comparisonFailed={comparisonStaleOnError || (comparisonQuery.isError && !comparisonQuery.data)}
                />

                {changesError ? (
                  <Card style={{ marginBottom: theme.spacing.md }}>
                    <Text style={{ color: theme.colors.critical, marginBottom: theme.spacing.sm }}>
                      Could not load scenario changes. Your plan is still saved — retry to compare impact.
                    </Text>
                    <Button
                      label="Retry"
                      variant="secondary"
                      onPress={() => void refetchChanges()}
                    />
                  </Card>
                ) : null}

                {!isEmptyScenario ? (
                  <ComparisonSection
                    comparison={comparisonQuery.data}
                    horizonLabel={horizonLabel}
                    loading={comparisonBusy}
                    error={comparisonQuery.error}
                    onRetry={() => void comparisonQuery.refetch()}
                  />
                ) : null}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: theme.spacing.md,
                    marginBottom: theme.spacing.sm,
                    gap: 8,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.colors.text, ...theme.typography.headline }} accessibilityRole="header">
                      Changes in this plan
                    </Text>
                    <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
                      Hypothetical only — your real accounts and recurring rules are not modified.
                    </Text>
                  </View>
                  <IconButton
                    name="plus"
                    accessibilityLabel="Add change"
                    onPress={() => {
                      setAddMenuOpen(true);
                    }}
                  />
                </View>

                {contextDebtId ? (
                  <View style={{ marginBottom: theme.spacing.sm }}>
                    <Button
                      label="Model payoff"
                      variant="secondary"
                      onPress={() => {
                        setEditingEvent(null);
                        setEditingOverride(null);
                        setDebtSheetOpen(true);
                      }}
                    />
                  </View>
                ) : null}

                {planItems.length === 0 ? (
                  <EmptyState
                    title="No changes yet"
                    message="Add income, expenses, or bill changes to see how they affect your forecast."
                  />
                ) : (
                  planItems.map((item) => (
                    <ScenarioChangeRow
                      key={item.id}
                      item={item}
                      onEdit={() => handleEditItem(item)}
                      onRemove={() => setRemoveItem(item)}
                    />
                  ))
                )}

                <DetailedImpactSection
                  comparison={comparisonQuery.data}
                  expanded={showDetails}
                  onToggle={() => setShowDetails((v) => !v)}
                />

                {comparisonQuery.data?.forecast_change_groups &&
                comparisonQuery.data.forecast_change_groups.length > 0 ? (
                  <View style={{ marginBottom: theme.spacing.md }}>
                    <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 8 }}>
                      Forecast timeline highlights
                    </Text>
                    {comparisonQuery.data.forecast_change_groups.slice(0, 5).map((g, i) => (
                      <View
                        key={`${g.event}-${i}`}
                        style={{
                          paddingVertical: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: theme.colors.border,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{g.event}</Text>
                        <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>
                          {g.account_name} · {g.frequency !== "one_time" ? `${g.occurrence_count} occurrences` : "One-time"}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <CreateScenarioSheet
        visible={createOpen}
        households={householdsQuery.data ?? []}
        defaultHouseholdId={defaultHousehold}
        initialTemplate={createTemplate}
        submitting={mutations.createScenarioMu.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => void handleCreateScenario(data)}
      />

      <PlanPickerSheet
        visible={planPickerOpen}
        scenarios={scenarios}
        selectedId={selectedScenarioId}
        onClose={() => setPlanPickerOpen(false)}
        onSelect={setSelectedScenarioId}
      />

      {selectedScenario ? (
        <PlanActionsSheet
          visible={planActionsOpen}
          planName={selectedScenario.name}
          renaming={mutations.updateScenarioMu.isPending}
          onClose={() => setPlanActionsOpen(false)}
          onRename={(name) => {
            void mutations.updateScenarioMu.mutateAsync({ id: selectedScenario.id, data: { name } }).then(() => {
              setPlanActionsOpen(false);
            });
          }}
          onAction={(action) => {
            setPlanActionsOpen(false);
            if (action === "duplicate" && selectedScenarioId) {
              void mutations.duplicateScenarioMu.mutateAsync(selectedScenarioId).then((s) => {
                setSelectedScenarioId(s.id);
              });
            } else if (action === "delete") {
              setDeleteConfirmOpen(true);
            }
          }}
        />
      ) : null}

      <AddChangeMenuSheet
        visible={addMenuOpen}
        onClose={() => setAddMenuOpen(false)}
        onAddIncome={() => setIncomeKindOpen(true)}
        onAddExpense={() => setExpenseKindOpen(true)}
        onTransfer={() => setEventPreset("transfer")}
        onPayDownDebt={() => {
          setEditingEvent(null);
          setEditingOverride(null);
          setDebtSheetOpen(true);
        }}
        onRecurringDebt={() => setRecurringDebtOpen(true)}
      />

      <ChangeKindSheet
        visible={incomeKindOpen}
        mode="income"
        onClose={() => setIncomeKindOpen(false)}
        onSelect={handleIncomeKind}
      />
      <ChangeKindSheet
        visible={expenseKindOpen}
        mode="expense"
        onClose={() => setExpenseKindOpen(false)}
        onSelect={handleExpenseKind}
      />

      {selectedScenarioId && eventPreset ? (
        <OneTimeEventSheet
          visible
          preset={eventPreset}
          scenarioId={selectedScenarioId}
          accounts={accounts}
          categories={categoriesList}
          existing={editingEvent}
          onClose={() => {
            setEventPreset(null);
            setEditingEvent(null);
          }}
          onSaved={invalidate}
        />
      ) : null}

      {selectedScenarioId && overrideSheetOpen ? (
        <OverrideFormSheet
          visible
          mode={overrideMode}
          context={overrideContext}
          existing={editingOverride}
          rules={rules}
          accounts={accounts}
          categories={categoriesList}
          scenarioId={selectedScenarioId}
          onClose={() => {
            setOverrideSheetOpen(false);
            setOverrideMode("add");
            setEditingOverride(null);
          }}
          onSaved={invalidate}
        />
      ) : null}

      {selectedScenarioId && newRecurringDirection ? (
        <NewRecurringSheet
          visible
          direction={newRecurringDirection}
          scenarioId={selectedScenarioId}
          accounts={accounts}
          categories={categoriesList}
          onClose={() => setNewRecurringDirection(null)}
          onSaved={invalidate}
        />
      ) : null}

      {selectedScenarioId && debtSheetOpen ? (
        <DebtPaymentSheet
          visible
          scenarioId={selectedScenarioId}
          accounts={accounts}
          rules={rules}
          initialDebtAccountId={contextDebtId}
          existingEvent={editingEvent}
          existingOverride={editingOverride}
          onClose={() => {
            setDebtSheetOpen(false);
            setEditingEvent(null);
            setEditingOverride(null);
          }}
          onSaved={invalidate}
        />
      ) : null}

      {selectedScenarioId && recurringDebtOpen ? (
        <NewRecurringSheet
          visible
          direction="EXPENSE"
          scenarioId={selectedScenarioId}
          accounts={accounts}
          categories={categoriesList}
          onClose={() => setRecurringDebtOpen(false)}
          onSaved={invalidate}
        />
      ) : null}

      <ConfirmDialog
        visible={deleteConfirmOpen}
        title="Delete what-if plan?"
        message="This removes only the hypothetical plan. Your real accounts, transactions, and recurring rules stay unchanged."
        confirmLabel="Delete plan"
        destructive
        loading={mutations.deleteScenarioMu.isPending}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (selectedScenarioId) {
            void mutations.deleteScenarioMu.mutateAsync(selectedScenarioId).then(() => {
              setSelectedScenarioId(null);
              setDeleteConfirmOpen(false);
            });
          }
        }}
      />

      <ConfirmDialog
        visible={removeItem != null}
        title="Remove change?"
        message="This removes the hypothetical change from this plan only."
        confirmLabel="Remove change"
        destructive
        onCancel={() => setRemoveItem(null)}
        onConfirm={() => {
          if (removeItem) {
            void handleRemoveItem(removeItem).then(() => setRemoveItem(null));
          }
        }}
      />
    </Screen>
  );
}
