import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import type {
  Scenario,
  ScenarioTemplateKey,
  RecurringRule,
  RecurringRuleFrequency,
  ScenarioRuleOverride,
  ScenarioOneTimeEvent,
  ScenarioCategoryShock,
  Account,
  Category,
} from "@budget-app/shared";
import {
  listScenarios,
  listRules,
  listScenarioOverrides,
  listScenarioOneTimeEvents,
  createScenario,
  deleteScenario,
  duplicateScenario,
  createScenarioOverride,
  updateScenarioOverride,
  deleteScenarioOverride,
  createScenarioOneTimeEvent,
  updateScenarioOneTimeEvent,
  deleteScenarioOneTimeEvent,
  getScenarioComparison,
  listScenarioCategoryShocks,
  createScenarioCategoryShock,
  updateScenarioCategoryShock,
  deleteScenarioCategoryShock,
  listHouseholds,
  getProfile,
  listCategories,
  createScenarioAddedRecurring,
  deleteScenarioAddedRecurring,
  listScenarioAddedRecurring,
} from "@budget-app/api-client";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import {
  SCENARIO_TEMPLATES,
  EMPTY_STATE_TEMPLATES,
  templateByKey,
  horizonMonthsToParam,
} from "../lib/scenarioTemplates";
import {
  FORECAST_PERIOD_OPTIONS,
  buildPlanSummary,
  buildDetailedImpactRows,
  PLAN_SUMMARY_RESULT_STYLES,
} from "../lib/scenarioComparisonDisplay";
import { buildPlanIncludes } from "../lib/scenarioPlainLanguage";
import {
  isDebtScenarioEvent,
  isDebtPaymentOverride,
  isDebtRecurringPayment,
} from "../lib/scenarioDebtPayment";
import PayDownDebtModal from "../components/scenarios/PayDownDebtModal";
import AddRecurringDebtPaymentModal from "../components/scenarios/AddRecurringDebtPaymentModal";

type ForecastHorizon = "3m" | "6m" | "12m" | "24m";
type EventPreset = "income" | "expense" | "transfer";
type OverrideContext = "debt" | "paycheck" | "expense_change";
type IncomeChangeKind = "one_time" | "paycheck" | "new_recurring";
type ExpenseChangeKind = "one_time" | "current" | "new_recurring";
type NewRecurringDirection = "INCOME" | "EXPENSE";

export default function Scenarios() {
  const [modalOpen, setModalOpen] = useState(false);
  const [overrideModal, setOverrideModal] = useState<"add" | ScenarioRuleOverride | null>(null);
  const [eventModal, setEventModal] = useState<EventPreset | null>(null);
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [recurringDebtModalOpen, setRecurringDebtModalOpen] = useState(false);
  const [editingRecurringDebt, setEditingRecurringDebt] =
    useState<import("@budget-app/shared").ScenarioAddedRecurring | null>(null);
  const [editingEvent, setEditingEvent] = useState<ScenarioOneTimeEvent | null>(null);
  const [editingDebtOverride, setEditingDebtOverride] = useState<ScenarioRuleOverride | null>(null);
  const [editingShock, setEditingShock] = useState<ScenarioCategoryShock | null>(null);
  const [overrideContext, setOverrideContext] = useState<OverrideContext>("expense_change");
  const [shockModal, setShockModal] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | "">("");
  const [forecastPeriod, setForecastPeriod] = useState<ForecastHorizon>("12m");
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [incomeKindPickerOpen, setIncomeKindPickerOpen] = useState(false);
  const [expenseKindPickerOpen, setExpenseKindPickerOpen] = useState(false);
  const [newRecurringOpen, setNewRecurringOpen] = useState<NewRecurringDirection | null>(null);

  const [formTemplate, setFormTemplate] = useState<ScenarioTemplateKey>("blank");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formHorizonMonths, setFormHorizonMonths] = useState(12);
  const [formHouseholdId, setFormHouseholdId] = useState<number | "">("");

  const queryClient = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const { data: scenariosData } = useQuery({ queryKey: ["scenarios"], queryFn: () => listScenarios() });
  const { data: rulesData } = useQuery({ queryKey: ["rules"], queryFn: () => listRules() });
  const { data: accountsData } = useOperationalAccounts();
  const scenarios = scenariosData?.results ?? [];
  const rules = rulesData?.results ?? [];
  const accounts = accountsData?.results ?? [];
  const defaultHousehold = profile?.default_household ?? households?.[0]?.id;
  const resolvedHousehold = formHouseholdId || defaultHousehold;

  const selectedScenario = scenarios.find((s: Scenario) => s.id === selectedScenarioId);

  const {
    data: comparison,
    isLoading: comparisonLoading,
    isFetching: comparisonFetching,
  } = useQuery({
    queryKey: ["scenario-compare", selectedScenarioId, forecastPeriod, defaultHousehold],
    queryFn: () =>
      getScenarioComparison(selectedScenarioId as number, {
        horizon: forecastPeriod,
        household_id: defaultHousehold || undefined,
      }),
    enabled: !!selectedScenarioId,
  });
  const comparisonBusy = comparisonLoading || comparisonFetching;

  const { data: overrides } = useQuery({
    queryKey: ["scenario-overrides", selectedScenarioId],
    queryFn: () => listScenarioOverrides(selectedScenarioId as number),
    enabled: !!selectedScenarioId,
  });

  const { data: oneTimeEvents } = useQuery({
    queryKey: ["scenario-events", selectedScenarioId],
    queryFn: () => listScenarioOneTimeEvents(selectedScenarioId as number),
    enabled: !!selectedScenarioId,
  });

  const { data: categoryShocks } = useQuery({
    queryKey: ["scenario-shocks", selectedScenarioId],
    queryFn: () => listScenarioCategoryShocks(selectedScenarioId as number),
    enabled: !!selectedScenarioId,
  });

  const { data: addedRecurring } = useQuery({
    queryKey: ["scenario-added-recurring", selectedScenarioId],
    queryFn: () => listScenarioAddedRecurring(selectedScenarioId as number),
    enabled: !!selectedScenarioId,
  });

  useEffect(() => {
    if (selectedScenario?.horizon_months) {
      setForecastPeriod(horizonMonthsToParam(selectedScenario.horizon_months));
    }
  }, [selectedScenario?.id, selectedScenario?.horizon_months]);

  const planIncludes = useMemo(
    () =>
      buildPlanIncludes(
        (overrides ?? []) as ScenarioRuleOverride[],
        (oneTimeEvents ?? []) as ScenarioOneTimeEvent[],
        (categoryShocks ?? []) as ScenarioCategoryShock[],
        (addedRecurring ?? []) as import("@budget-app/shared").ScenarioAddedRecurring[]
      ),
    [overrides, oneTimeEvents, categoryShocks, addedRecurring]
  );

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", defaultHousehold],
    queryFn: () => listCategories({ household: defaultHousehold as number }),
    enabled: !!defaultHousehold,
  });
  const categories = categoriesData?.results ?? categoriesData ?? [];

  const invalidateScenario = () => {
    queryClient.invalidateQueries({ queryKey: ["scenarios"] });
    queryClient.invalidateQueries({ queryKey: ["rules"] });
    queryClient.invalidateQueries({ queryKey: ["scenario-overrides", selectedScenarioId] });
    queryClient.invalidateQueries({ queryKey: ["scenario-events", selectedScenarioId] });
    queryClient.invalidateQueries({ queryKey: ["scenario-compare", selectedScenarioId] });
    queryClient.invalidateQueries({ queryKey: ["scenario-shocks", selectedScenarioId] });
    queryClient.invalidateQueries({ queryKey: ["scenario-added-recurring", selectedScenarioId] });
  };

  const createScenarioMu = useMutation({
    mutationFn: createScenario,
    onSuccess: (s) => {
      invalidateScenario();
      setModalOpen(false);
      setSelectedScenarioId(s.id);
      setForecastPeriod(horizonMonthsToParam(s.horizon_months ?? 12));
      resetCreateForm();
    },
  });

  const deleteScenarioMu = useMutation({
    mutationFn: deleteScenario,
    onSuccess: () => {
      setSelectedScenarioId("");
      invalidateScenario();
    },
  });

  const duplicateMu = useMutation({
    mutationFn: (id: number) => duplicateScenario(id),
    onSuccess: (s) => {
      invalidateScenario();
      setSelectedScenarioId(s.id);
    },
  });

  function resetCreateForm() {
    setFormName("");
    setFormDescription("");
    setFormTemplate("blank");
    setFormHorizonMonths(12);
  }

  function openCreateWithTemplate(key: ScenarioTemplateKey) {
    const t = templateByKey(key);
    setFormTemplate(key);
    setFormName(t.key === "blank" ? "" : t.label);
    setFormDescription(t.description);
    setModalOpen(true);
  }

  function applyTemplateFields(key: ScenarioTemplateKey) {
    const t = templateByKey(key);
    setFormTemplate(key);
    if (!formName.trim() || SCENARIO_TEMPLATES.some((x) => x.label === formName)) {
      setFormName(key === "blank" ? "" : t.label);
    }
    setFormDescription(t.description);
  }

  function handleEditPlanItem(item: ReturnType<typeof buildPlanIncludes>[number]) {
    if (item.kind === "override") {
      const ov = (overrides ?? []).find((o) => o.id === item.sourceId);
      if (ov) {
        if (isDebtPaymentOverride(ov as ScenarioRuleOverride)) {
          setEditingDebtOverride(ov as ScenarioRuleOverride);
          setDebtModalOpen(true);
          return;
        }
        setOverrideContext(ov.rule?.direction === "INCOME" ? "paycheck" : "expense_change");
        setOverrideModal(ov as ScenarioRuleOverride);
      }
    } else if (item.kind === "event") {
      const ev = (oneTimeEvents ?? []).find((e) => e.id === item.sourceId);
      if (ev) {
        if (isDebtScenarioEvent(ev as ScenarioOneTimeEvent)) {
          setEditingEvent(ev as ScenarioOneTimeEvent);
          setDebtModalOpen(true);
        } else {
          setEditingEvent(ev as ScenarioOneTimeEvent);
        }
      }
    } else if (item.kind === "added_recurring") {
      const ar = (addedRecurring ?? []).find((a) => a.id === item.sourceId);
      if (ar && isDebtRecurringPayment(ar as import("@budget-app/shared").ScenarioAddedRecurring)) {
        setEditingRecurringDebt(ar as import("@budget-app/shared").ScenarioAddedRecurring);
        setRecurringDebtModalOpen(true);
      }
    } else {
      const sh = (categoryShocks ?? []).find((s) => s.id === item.sourceId);
      if (sh) setEditingShock(sh as ScenarioCategoryShock);
    }
  }

  function handleRemovePlanItem(item: ReturnType<typeof buildPlanIncludes>[number]) {
    if (item.kind === "override") {
      deleteScenarioOverride(item.sourceId).then(invalidateScenario);
    } else if (item.kind === "event") {
      deleteScenarioOneTimeEvent(item.sourceId).then(invalidateScenario);
    } else if (item.kind === "added_recurring") {
      deleteScenarioAddedRecurring(item.sourceId).then(invalidateScenario);
    } else {
      deleteScenarioCategoryShock(item.sourceId).then(invalidateScenario);
    }
  }

  return (
    <div className={PAGE_SHELL_PY}>
      {scenarios.length === 0 ? (
        <EmptyState onPickTemplate={openCreateWithTemplate} onCreate={() => setModalOpen(true)} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <label className="text-sm min-w-[12rem] flex-1">
              <span className="block text-gray-600 mb-1">What-if plan</span>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                <option value="">—</option>
                {scenarios.map((s: Scenario) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm min-w-[10rem]">
              <span className="block text-gray-600 mb-1">Forecast period</span>
              <select
                value={forecastPeriod}
                onChange={(e) => setForecastPeriod(e.target.value as ForecastHorizon)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
              >
                {FORECAST_PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setModalOpen(true);
              }}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 shrink-0"
            >
              New What-If Plan
            </button>
          </div>

          {selectedScenarioId && (
            <PlanAddToolbar
              onAddIncome={() => setIncomeKindPickerOpen(true)}
              onAddExpense={() => setExpenseKindPickerOpen(true)}
              onPayDownDebt={() => {
                setEditingEvent(null);
                setEditingDebtOverride(null);
                setDebtModalOpen(true);
              }}
              onAddRecurringDebtPayment={() => {
                setEditingRecurringDebt(null);
                setRecurringDebtModalOpen(true);
              }}
              onTransfer={() => setEventModal("transfer")}
            />
          )}

          {selectedScenarioId && selectedScenario && (
            <>
              <PlanSummaryCard
                scenario={selectedScenario}
                comparison={comparison}
                planItems={planIncludes}
                accounts={accounts as Account[]}
                loading={comparisonBusy}
              />

              <ChangesInPlanSection
                items={planIncludes}
                onEdit={handleEditPlanItem}
                onRemove={handleRemovePlanItem}
              />

              <OptionalDetailsSection
                comparison={comparison}
                loading={comparisonBusy}
                visible={showOptionalDetails}
                onToggle={() => setShowOptionalDetails((v) => !v)}
              />

              <PlanActionBar
                onDuplicate={() => duplicateMu.mutate(selectedScenarioId as number)}
                onDelete={() => {
                  if (confirm("Delete this what-if plan? Your real plan stays unchanged.")) {
                    deleteScenarioMu.mutate(selectedScenarioId as number);
                  }
                }}
              />
            </>
          )}
        </>
      )}

      {modalOpen && (
        <CreateScenarioModal
          households={households ?? []}
          householdId={resolvedHousehold}
          onHouseholdChange={setFormHouseholdId}
          template={formTemplate}
          onTemplateChange={applyTemplateFields}
          name={formName}
          onNameChange={setFormName}
          description={formDescription}
          onDescriptionChange={setFormDescription}
          horizonMonths={formHorizonMonths}
          onHorizonMonthsChange={setFormHorizonMonths}
          onClose={() => setModalOpen(false)}
          onSubmit={() => {
            const hId = resolvedHousehold;
            if (!hId || !formName.trim()) return;
            createScenarioMu.mutate({
              household: hId,
              name: formName.trim(),
              description: formDescription.trim(),
              template: formTemplate,
              horizon_months: formHorizonMonths,
            });
          }}
          submitting={createScenarioMu.isPending}
        />
      )}

      {overrideModal && selectedScenarioId && (
        <OverrideFormModal
          mode={overrideModal === "add" ? "add" : "edit"}
          context={overrideContext}
          existing={overrideModal === "add" ? null : overrideModal}
          rules={rules as RecurringRule[]}
          accounts={accounts as Account[]}
          categories={categories as Category[]}
          scenarioId={selectedScenarioId as number}
          onClose={() => setOverrideModal(null)}
          onSaved={invalidateScenario}
        />
      )}

      {incomeKindPickerOpen && (
        <ChangeKindPickerModal
          title="What kind of income change?"
          fieldName="income-change-kind"
          options={INCOME_KIND_OPTIONS}
          onClose={() => setIncomeKindPickerOpen(false)}
          onSelect={(kind) => {
            setIncomeKindPickerOpen(false);
            if (kind === "one_time") {
              setEventModal("income");
            } else if (kind === "paycheck") {
              setOverrideContext("paycheck");
              setOverrideModal("add");
            } else {
              setNewRecurringOpen("INCOME");
            }
          }}
        />
      )}

      {expenseKindPickerOpen && (
        <ChangeKindPickerModal
          title="What kind of expense change?"
          fieldName="expense-change-kind"
          options={EXPENSE_KIND_OPTIONS}
          onClose={() => setExpenseKindPickerOpen(false)}
          onSelect={(kind) => {
            setExpenseKindPickerOpen(false);
            if (kind === "one_time") {
              setEventModal("expense");
            } else if (kind === "current") {
              setOverrideContext("expense_change");
              setOverrideModal("add");
            } else {
              setNewRecurringOpen("EXPENSE");
            }
          }}
        />
      )}

      {newRecurringOpen && selectedScenarioId && selectedScenario && (
        <ScenarioNewRecurringModal
          direction={newRecurringOpen}
          scenarioId={selectedScenarioId as number}
          accounts={accounts as Account[]}
          categories={categories as Category[]}
          onClose={() => setNewRecurringOpen(null)}
          onSaved={invalidateScenario}
        />
      )}

      {eventModal && selectedScenarioId && (
        <OneTimeEventModal
          preset={eventModal}
          titleOverride={
            eventModal === "income"
              ? "Add one-time income"
              : eventModal === "expense"
                ? "Add one-time expense"
                : undefined
          }
          accounts={accounts as Account[]}
          categories={categories as Category[]}
          scenarioId={selectedScenarioId as number}
          onClose={() => setEventModal(null)}
          onSaved={invalidateScenario}
        />
      )}

      {editingEvent && selectedScenarioId && !isDebtScenarioEvent(editingEvent) && (
        <OneTimeEventModal
          preset={
            editingEvent.direction === "INCOME"
              ? "income"
              : editingEvent.direction === "TRANSFER"
                ? "transfer"
                : "expense"
          }
          existing={editingEvent}
          accounts={accounts as Account[]}
          categories={categories as Category[]}
          scenarioId={selectedScenarioId as number}
          onClose={() => setEditingEvent(null)}
          onSaved={invalidateScenario}
        />
      )}

      {shockModal && selectedScenarioId && (
        <CategoryShockModal
          categories={categories as Category[]}
          scenarioId={selectedScenarioId as number}
          onClose={() => setShockModal(false)}
          onSaved={invalidateScenario}
        />
      )}

      {editingShock && selectedScenarioId && (
        <CategoryShockModal
          categories={categories as Category[]}
          scenarioId={selectedScenarioId as number}
          existing={editingShock}
          onClose={() => setEditingShock(null)}
          onSaved={invalidateScenario}
        />
      )}

      {recurringDebtModalOpen && selectedScenarioId && (
        <AddRecurringDebtPaymentModal
          scenarioId={selectedScenarioId as number}
          accounts={accounts as Account[]}
          existing={editingRecurringDebt}
          onClose={() => {
            setRecurringDebtModalOpen(false);
            setEditingRecurringDebt(null);
          }}
          onSaved={invalidateScenario}
        />
      )}

      {debtModalOpen && selectedScenarioId && (
        <PayDownDebtModal
          scenarioId={selectedScenarioId as number}
          accounts={accounts as Account[]}
          rules={rules as RecurringRule[]}
          existingEvent={editingEvent}
          existingOverride={editingDebtOverride}
          onClose={() => {
            setDebtModalOpen(false);
            setEditingEvent(null);
            setEditingDebtOverride(null);
          }}
          onSaved={invalidateScenario}
        />
      )}

    </div>
  );
}

function EmptyState({
  onPickTemplate,
  onCreate,
}: {
  onPickTemplate: (k: ScenarioTemplateKey) => void;
  onCreate: () => void;
}) {
  return (
    <div className="text-center py-12">
      <h2 className="text-lg font-medium text-gray-900 mb-2">Create a what-if plan</h2>
      <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
        See what happens if you change income, bills, or spending — without touching your real plan.
      </p>
      <div className="grid sm:grid-cols-2 gap-3 max-w-lg mx-auto mb-6">
        {EMPTY_STATE_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPickTemplate(t.key)}
            className="text-left p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
          >
            <p className="font-medium text-sm">{t.label}</p>
            <p className="text-xs text-gray-500 mt-1">{t.description}</p>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="text-sm text-blue-600 hover:underline"
      >
        Or start with a blank plan
      </button>
    </div>
  );
}

function PlanSummaryCard({
  scenario,
  comparison,
  planItems,
  accounts,
  loading,
}: {
  scenario: Scenario;
  comparison: import("@budget-app/shared").ScenarioComparisonResponse | undefined;
  planItems: ReturnType<typeof buildPlanIncludes>;
  accounts: Account[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="h-48 bg-gray-100 animate-pulse rounded-xl mb-6" />;
  }

  const summary = buildPlanSummary(comparison, planItems, accounts);
  if (!summary) return null;

  return (
    <div
      className={`mb-6 rounded-xl border-2 px-6 py-5 ${PLAN_SUMMARY_RESULT_STYLES[summary.result]}`}
    >
      <h2 className="text-xl font-bold mb-4">{scenario.name}</h2>

      <p className="text-sm font-semibold tracking-widest uppercase mb-2">
        Result: {summary.result}
      </p>

      <p className="text-base font-medium mb-4">{summary.headline}</p>

      {summary.listItems.length > 0 && (
        <div className="mb-5">
          {summary.listHeading && (
            <p className="text-sm font-semibold mb-2">{summary.listHeading}</p>
          )}
          <ul className="space-y-1.5 text-sm">
            {summary.listItems.map((line) => (
              <li key={line} className="flex gap-2">
                <span
                  className={`shrink-0 font-semibold ${
                    summary.listStyle === "impact" ? "opacity-70" : "text-green-700"
                  }`}
                  aria-hidden
                >
                  {summary.listStyle === "impact" ? "•" : "✓"}
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.showMetricsFooter && (
      <div className="space-y-2 text-sm border-t border-current/10 pt-4">
        {summary.footerLines.map((line) => (
          <p key={line} className="text-base font-semibold">
            {line}
          </p>
        ))}
      </div>
      )}
    </div>
  );
}

function ChangesInPlanSection({
  items,
  onEdit,
  onRemove,
}: {
  items: ReturnType<typeof buildPlanIncludes>;
  onEdit: (item: ReturnType<typeof buildPlanIncludes>[number]) => void;
  onRemove: (item: ReturnType<typeof buildPlanIncludes>[number]) => void;
}) {
  return (
    <div className="mb-6">
      <h3 className="font-medium text-gray-900 mb-3">Changes in this plan</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
          No changes yet — add income, expenses, or bill changes to see what happens.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
            >
              <div>
                <p className="font-medium text-gray-900">
                  <span className="text-green-600 mr-1.5" aria-hidden>✓</span>
                  {item.actionLabel}
                </p>
                <p className="text-sm text-gray-700 mt-0.5 pl-5 whitespace-pre-line">{item.detailLabel}</p>
                {item.accountLabel && (
                  <p className="text-xs text-gray-500 mt-1 pl-5">{item.accountLabel}</p>
                )}
              </div>
              <div className="flex gap-3 shrink-0 pl-5 sm:pl-0">
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="text-blue-600 hover:underline text-xs font-medium"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item)}
                  className="text-red-600 hover:underline text-xs font-medium"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OptionalDetailsSection({
  comparison,
  loading,
  visible,
  onToggle,
}: {
  comparison: import("@budget-app/shared").ScenarioComparisonResponse | undefined;
  loading: boolean;
  visible: boolean;
  onToggle: () => void;
}) {
  if (loading || !comparison?.metrics) return null;

  const rows = buildDetailedImpactRows(comparison);

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="text-sm text-gray-600 hover:text-gray-900 font-medium"
      >
        {visible ? "Hide detailed impact" : "Show detailed impact"}
      </button>
      {visible && (
        <div className="mt-3 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-sm font-medium text-gray-900">Detailed Impact</p>
            <p className="text-xs text-gray-500 mt-1">
              What this plan looks like over your forecast period — not a before/after comparison.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Metric</th>
                  <th className="px-4 py-2 font-medium">In this plan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 text-gray-600">{row.label}</td>
                    <td
                      className={`px-4 py-2.5 font-medium ${
                        row.change === "No change" ? "text-gray-500" : "text-gray-900"
                      }`}
                    >
                      {row.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const INCOME_KIND_OPTIONS: {
  kind: IncomeChangeKind;
  title: string;
  hint: string;
}[] = [
  {
    kind: "one_time",
    title: "One-time income",
    hint: "Tax refund, bonus, gift, sale",
  },
  {
    kind: "paycheck",
    title: "Future paycheck change",
    hint: "New job, raise, reduced hours",
  },
  {
    kind: "new_recurring",
    title: "New recurring income",
    hint: "Rental income, side business, child support, pension",
  },
];

const EXPENSE_KIND_OPTIONS: {
  kind: ExpenseChangeKind;
  title: string;
  hint: string;
}[] = [
  {
    kind: "one_time",
    title: "One-time expense",
    hint: "Car repair, medical bill, one-off purchase",
  },
  {
    kind: "current",
    title: "Current expense change",
    hint: "Rent increase, insurance went up, cancel a bill",
  },
  {
    kind: "new_recurring",
    title: "New recurring expense",
    hint: "New subscription, childcare, loan payment",
  },
];

function ChangeKindPickerModal<K extends string>({
  title,
  fieldName,
  options,
  onClose,
  onSelect,
}: {
  title: string;
  fieldName: string;
  options: { kind: K; title: string; hint: string }[];
  onClose: () => void;
  onSelect: (kind: K) => void;
}) {
  const [selected, setSelected] = useState<K>(options[0].kind);

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-gray-600 mb-4">Choose the type of change you want to model.</p>
      <fieldset className="space-y-2 mb-4">
        {options.map((opt) => (
          <label
            key={opt.kind}
            className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected === opt.kind
                ? "border-blue-500 bg-blue-50/60"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name={fieldName}
              value={opt.kind}
              checked={selected === opt.kind}
              onChange={() => setSelected(opt.kind)}
              className="mt-0.5 shrink-0"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{opt.title}</span>
              <span className="block text-xs text-gray-500 mt-0.5">{opt.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <ModalActions
        onClose={onClose}
        onSubmit={() => onSelect(selected)}
        submitLabel="Continue"
        submitting={false}
      />
    </Modal>
  );
}

function ScenarioNewRecurringModal({
  direction,
  scenarioId,
  accounts,
  categories,
  onClose,
  onSaved,
}: {
  direction: NewRecurringDirection;
  scenarioId: number;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isIncome = direction === "INCOME";
  const filteredCategories = categories.filter((c) =>
    isIncome ? c.category_type === "INCOME" : c.category_type === "EXPENSE"
  );
  const paymentAccounts = accounts.filter(
    (a) =>
      a.account_type === "CHECKING" ||
      a.account_type === "SAVINGS" ||
      a.account_type === "CASH" ||
      (!isIncome && a.account_type === "CREDIT")
  );

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<number | "">("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [frequency, setFrequency] = useState<RecurringRuleFrequency>("MONTHLY_DAY");
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim() || !amount.trim() || !accountId) return;
    setSaving(true);
    setError(null);
    try {
      await createScenarioAddedRecurring(scenarioId, {
        name: name.trim(),
        account_id: accountId as number,
        category_id: categoryId === "" ? null : (categoryId as number),
        direction,
        amount: String(Math.abs(parseFloat(amount))),
        currency: "USD",
        frequency,
        interval: 1,
        day_of_month: frequency === "MONTHLY_DAY" ? dayOfMonth : undefined,
        start_date: startDate,
        end_date: endDate || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not add ${isIncome ? "income" : "expense"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isIncome ? "New recurring income" : "New recurring expense"} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        {isIncome
          ? "Adds new income in this what-if plan only — your current plan stays the same until you apply the change for real."
          : "Adds a new expense in this what-if plan only — your current plan stays the same until you apply the change for real."}
      </p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isIncome ? "e.g. Rental income" : "e.g. Gym membership"}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Amount">
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label={isIncome ? "Deposit account" : "Paid from account"}>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {paymentAccounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Category (optional)">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {filteredCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="How often">
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as RecurringRuleFrequency)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Every 2 weeks</option>
          <option value="MONTHLY_DAY">Monthly</option>
          <option value="YEARLY">Yearly</option>
        </select>
      </Field>
      {frequency === "MONTHLY_DAY" && (
        <Field label="Day of month">
          <input
            type="number"
            min={1}
            max={31}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start date">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </Field>
        <Field label="End date (optional)">
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </Field>
      </div>
      <ModalActions
        onClose={onClose}
        onSubmit={handleSubmit}
        submitLabel={isIncome ? "Add income" : "Add expense"}
        submitting={saving}
      />
    </Modal>
  );
}

function PlanAddToolbar({
  onAddIncome,
  onAddExpense,
  onPayDownDebt,
  onAddRecurringDebtPayment,
  onTransfer,
}: {
  onAddIncome: () => void;
  onAddExpense: () => void;
  onPayDownDebt: () => void;
  onAddRecurringDebtPayment: () => void;
  onTransfer: () => void;
}) {
  return (
    <div className="mb-6">
      <p className="text-sm font-medium text-gray-700 mb-2">Add to this plan</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAddIncome}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 hover:border-blue-300"
        >
          Add Income Change
        </button>
        <button
          type="button"
          onClick={onAddExpense}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 hover:border-blue-300"
        >
          Add Expense Change
        </button>
        <button
          type="button"
          onClick={onTransfer}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 hover:border-blue-300"
        >
          Transfer money
        </button>
        <button
          type="button"
          onClick={onPayDownDebt}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 hover:border-blue-300"
        >
          Pay down debt
        </button>
        <button
          type="button"
          onClick={onAddRecurringDebtPayment}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded text-sm hover:bg-gray-50 hover:border-blue-300"
        >
          Add Recurring Payment
        </button>
      </div>
    </div>
  );
}

function PlanActionBar({
  onDuplicate,
  onDelete,
}: {
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 pt-2 border-t border-gray-100">
      <button
        type="button"
        onClick={onDuplicate}
        className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50"
      >
        Duplicate plan
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="px-3 py-1.5 border border-red-200 text-red-700 rounded text-sm hover:bg-red-50"
      >
        Delete plan
      </button>
    </div>
  );
}

function CreateScenarioModal({
  households,
  householdId,
  onHouseholdChange,
  template,
  onTemplateChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  horizonMonths,
  onHorizonMonthsChange,
  onClose,
  onSubmit,
  submitting,
}: {
  households: { id: number; name: string }[];
  householdId: number | "" | undefined;
  onHouseholdChange: (id: number | "") => void;
  template: ScenarioTemplateKey;
  onTemplateChange: (k: ScenarioTemplateKey) => void;
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  horizonMonths: number;
  onHorizonMonthsChange: (n: number) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const t = templateByKey(template);
  return (
    <Modal title="New what-if plan" onClose={onClose}>
      <Field label="Household">
        <select
          value={householdId || ""}
          onChange={(e) => onHouseholdChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {households.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Template">
        <select
          value={template}
          onChange={(e) => onTemplateChange(e.target.value as ScenarioTemplateKey)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          {SCENARIO_TEMPLATES.map((x) => (
            <option key={x.key} value={x.key}>{x.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t.label}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={2}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Forecast period">
        <select
          value={horizonMonths}
          onChange={(e) => onHorizonMonthsChange(Number(e.target.value))}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
          <option value={24}>24 months</option>
        </select>
      </Field>
      {t.suggestedOverrideHints.length > 0 && (
        <p className="text-xs text-gray-500 mb-3">After creating, consider: {t.suggestedOverrideHints.join("; ")}</p>
      )}
      <ModalActions onClose={onClose} onSubmit={onSubmit} submitLabel="Create" submitting={submitting} />
    </Modal>
  );
}

function OverrideFormModal({
  mode,
  context,
  existing,
  rules,
  accounts,
  categories,
  scenarioId,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit";
  context: OverrideContext;
  existing: ScenarioRuleOverride | null;
  rules: RecurringRule[];
  accounts: Account[];
  categories: Category[];
  scenarioId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ruleId, setRuleId] = useState(existing?.rule?.id ?? "");
  const [amount, setAmount] = useState(existing?.override_amount ?? "");
  const [active, setActive] = useState<string>(
    existing?.override_active === false ? "false" : existing?.override_active === true ? "true" : ""
  );
  const [startDate, setStartDate] = useState(existing?.override_start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.override_end_date ?? "");
  const [accountId, setAccountId] = useState(existing?.override_account?.id ?? "");
  const [categoryId, setCategoryId] = useState(existing?.override_category?.id ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const ruleOptions = useMemo(() => {
    if (context === "paycheck") {
      return rules
        .filter((r) => r.direction === "INCOME")
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (context === "expense_change") {
      return rules
        .filter((r) => r.direction === "EXPENSE")
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return rules;
  }, [context, rules]);

  async function handleSubmit() {
    if (!ruleId && mode === "add") return;
    setSaving(true);
    const body = {
      rule_id: Number(ruleId),
      override_amount: amount === "" ? null : String(amount),
      override_active: active === "" ? null : active === "true",
      // Only send schedule dates when user set them — blank means "same schedule, new amount".
      override_start_date:
        context === "paycheck" && !startDate.trim()
          ? null
          : startDate.trim() || null,
      override_end_date: endDate.trim() || null,
      override_account_id: accountId === "" ? null : Number(accountId),
      override_category_id: categoryId === "" ? null : Number(categoryId),
      notes,
    };
    try {
      if (mode === "add") {
        await createScenarioOverride(scenarioId, body);
      } else if (existing) {
        await updateScenarioOverride(existing.id, body);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title =
    mode === "add"
      ? context === "debt"
        ? "Change debt payment"
        : context === "paycheck"
          ? "Change paycheck"
          : "Change current expense"
      : context === "paycheck"
        ? "Edit paycheck change"
        : "Edit expense change";

  const ruleFieldLabel =
    context === "paycheck"
      ? "Paycheck or income source"
      : "Bill or expense";

  return (
    <Modal title={title} onClose={onClose}>
      {context === "paycheck" && mode === "add" && (
        <p className="text-xs text-gray-500 mb-3">
          Change amount or timing for an existing paycheck or other income deposit.
        </p>
      )}
      {context === "expense_change" && mode === "add" && (
        <p className="text-xs text-gray-500 mb-3">
          Change amount, cancel, or timing for an existing bill or recurring expense.
        </p>
      )}
      {mode === "add" && (
        <Field label={ruleFieldLabel}>
          <select
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {ruleOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({formatCurrency(r.amount, r.currency)})
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field
        label={
          context === "paycheck"
            ? "New paycheck amount"
            : context === "expense_change"
              ? "New expense amount"
              : "New amount"
        }
      >
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <Field label="Status">
        <select
          value={active}
          onChange={(e) => setActive(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">No change</option>
          <option value="true">Keep active</option>
          <option value="false">Cancel / pause</option>
        </select>
      </Field>
      {context === "paycheck" ? (
        <p className="text-xs text-gray-500 -mt-1 mb-2">
          Leave start/end blank to change the amount on your existing paycheck schedule. Only set dates if you
          want to delay or end the raise.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label={context === "paycheck" ? "Start date (optional)" : "Start date"}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>
        <Field label={context === "paycheck" ? "End date (optional)" : "End date"}>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>
      </div>
      <Field label="Account (optional)">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border px-2 py-1.5 text-sm">
          <option value="">—</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Category (optional)">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border px-2 py-1.5 text-sm">
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
      </Field>
      <ModalActions onClose={onClose} onSubmit={handleSubmit} submitLabel="Save" submitting={saving} />
    </Modal>
  );
}

function OneTimeEventModal({
  preset,
  existing,
  accounts,
  categories,
  scenarioId,
  titleOverride,
  onClose,
  onSaved,
}: {
  preset: EventPreset;
  existing?: ScenarioOneTimeEvent;
  accounts: Account[];
  categories: Category[];
  scenarioId: number;
  titleOverride?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const presetDirection: Record<EventPreset, "INCOME" | "EXPENSE" | "TRANSFER"> = {
    income: "INCOME",
    expense: "EXPENSE",
    transfer: "TRANSFER",
  };
  const presetTitle: Record<EventPreset, string> = {
    income: "Add income",
    expense: "Add expense",
    transfer: "Transfer money",
  };
  const presetDescription: Record<EventPreset, string> = {
    income: "",
    expense: "",
    transfer: "",
  };

  const defaultIncomeDescription = "e.g. Tax refund, bonus, gift";
  const defaultExpenseDescription = "e.g. Car repair, medical bill, purchase";

  const [date, setDate] = useState(existing?.date ?? "");
  const [accountId, setAccountId] = useState<number | "">(existing?.account?.id ?? existing?.account_id ?? "");
  const [transferToAccountId, setTransferToAccountId] = useState<number | "">(
    existing?.transfer_to_account?.id ?? existing?.transfer_to_account_id ?? ""
  );
  const [description, setDescription] = useState(existing?.description ?? presetDescription[preset]);
  const [direction, setDirection] = useState<"INCOME" | "EXPENSE" | "TRANSFER">(
    existing?.direction ?? presetDirection[preset]
  );
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [categoryId, setCategoryId] = useState<number | "">(existing?.category?.id ?? existing?.category_id ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const isTransfer = preset === "transfer" || direction === "TRANSFER";

  async function handleSubmit() {
    if (!date || !amount) return;
    if (isTransfer) {
      if (!accountId || !transferToAccountId || accountId === transferToAccountId) return;
    } else if (!accountId || !description) {
      return;
    }

    const toAccount = accounts.find((a) => a.id === transferToAccountId);
    const resolvedDescription =
      isTransfer
        ? description.trim() ||
          (toAccount ? `Transfer to ${toAccount.name}` : "Transfer")
        : description;

    setSaving(true);
    try {
      const body = {
        date,
        account_id: accountId as number,
        transfer_to_account_id: isTransfer ? (transferToAccountId as number) : null,
        description: resolvedDescription,
        direction: isTransfer ? ("TRANSFER" as const) : direction,
        amount: String(Math.abs(parseFloat(amount))),
        category_id: categoryId === "" ? null : (categoryId as number),
        notes,
      };
      if (existing) {
        await updateScenarioOneTimeEvent(existing.id, body);
      } else {
        await createScenarioOneTimeEvent(scenarioId, body);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = existing ? "Edit change" : titleOverride ?? presetTitle[preset];

  return (
    <Modal title={title} onClose={onClose}>
      {preset === "income" && !existing && (
        <p className="text-xs text-gray-500 mb-3">
          A single deposit on one date — not a repeating paycheck.
        </p>
      )}
      {preset === "expense" && !existing && (
        <p className="text-xs text-gray-500 mb-3">
          A single charge on one date — not a repeating bill.
        </p>
      )}
      <Field label="Date">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
      </Field>
      {isTransfer ? (
        <>
          <Field label="From account">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === transferToAccountId}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To account">
            <select
              value={transferToAccountId}
              onChange={(e) => setTransferToAccountId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded border px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id} disabled={a.id === accountId}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border px-2 py-1.5 text-sm">
            <option value="">—</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Description">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-sm"
          placeholder={
            preset === "income"
              ? defaultIncomeDescription
              : preset === "expense"
                ? defaultExpenseDescription
                : isTransfer
                  ? "Optional — e.g. Move to savings"
                  : undefined
          }
        />
      </Field>
      {preset === "expense" && (
        <Field label="Type">
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className="w-full rounded border px-2 py-1.5 text-sm">
            <option value="EXPENSE">Expense</option>
            <option value="INCOME">Income</option>
            <option value="TRANSFER">Transfer</option>
          </select>
        </Field>
      )}
      <Field label="Amount">
        <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
      </Field>
      <Field label="Category (optional)">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value === "" ? "" : Number(e.target.value))} className="w-full rounded border px-2 py-1.5 text-sm">
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
      </Field>
      <ModalActions onClose={onClose} onSubmit={handleSubmit} submitLabel={existing ? "Save" : "Add change"} submitting={saving} />
    </Modal>
  );
}

function CategoryShockModal({
  categories,
  scenarioId,
  existing,
  onClose,
  onSaved,
}: {
  categories: Category[];
  scenarioId: number;
  existing?: ScenarioCategoryShock;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<number | "">(existing?.category?.id ?? existing?.category_id ?? "");
  const [percentChange, setPercentChange] = useState(existing?.percent_change ?? "40");
  const [startDate, setStartDate] = useState(existing?.start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!categoryId || !startDate || percentChange === "") return;
    setSaving(true);
    try {
      const body = {
        category_id: categoryId as number,
        percent_change: String(percentChange),
        start_date: startDate,
        end_date: endDate || null,
      };
      if (existing) {
        await updateScenarioCategoryShock(existing.id, body);
      } else {
        await createScenarioCategoryShock(scenarioId, body);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={existing ? "Edit spending change" : "Change spending category"} onClose={onClose}>
      <p className="text-xs text-gray-500 mb-3">
        Adjust how much you spend in a category for part of the forecast (e.g. groceries +20%).
      </p>
      <Field label="Category">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value === "" ? "" : Number(e.target.value))}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Change amount (%)">
        <input
          type="number"
          step="1"
          value={percentChange}
          onChange={(e) => setPercentChange(e.target.value)}
          placeholder="40 for +40%"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>
        <Field label="End date (optional)">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>
      </div>
      <ModalActions onClose={onClose} onSubmit={handleSubmit} submitLabel={existing ? "Save" : "Add adjustment"} submitting={saving} />
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-medium mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function ModalActions({
  onClose,
  onSubmit,
  submitLabel,
  submitting,
}: {
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitting: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 mt-2">
      <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </div>
  );
}
