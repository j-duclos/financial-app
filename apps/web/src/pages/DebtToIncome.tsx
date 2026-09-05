import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  calculateDti,
  createDtiDebtItem,
  createDtiIncomeSource,
  deleteDtiDebtItem,
  deleteDtiIncomeSource,
  getDtiProfile,
  listDtiCreditCardSuggestions,
  listDtiDebtItems,
  listDtiIncomeSources,
  saveDtiProfile,
  updateDtiDebtItem,
  updateDtiIncomeSource,
} from "@budget-app/api-client";
import type {
  DtiCreditCardSuggestion,
  DtiDebtItem,
  DtiDebtItemWritePayload,
  DtiIncomeSource,
  DtiIncomeSourceWritePayload,
  DtiProfileWritePayload,
  DtiProposedHousingInput,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import {
  METRIC_TILE_GRID_3,
  METRIC_TILE_GRID_4,
  METRIC_TILE_SKELETON_CLASS,
} from "../components/dashboard/metricTileLayout";
import PlanningSubnav from "../components/PlanningSubnav";
import DtiDebtFormModal, { type DtiDebtFormPrefill } from "../components/dti/DtiDebtFormModal";
import DtiIncomeFormModal from "../components/dti/DtiIncomeFormModal";
import DtiProfileFormModal from "../components/dti/DtiProfileFormModal";
import { useDefaultHouseholdId } from "../hooks/useDefaultHouseholdId";
import {
  DTI_PLANNING_DISCLAIMER,
  INCOME_TYPE_LABELS,
  compareActualToTarget,
  debtRowView,
  formatDtiMoney,
  formatDtiPercent,
  groupDtiWarnings,
  isZeroMoney,
  payoffImpactSentence,
  rankPayoffImpactsByPayment,
} from "../lib/dtiDisplay";
import {
  PROPOSED_HOUSING_FIELDS,
  buildDtiCalculationRequest,
  emptyProposedHousingDraft,
  normalizeProposedHousingDraft,
  proposedHousingPayloadForRequest,
  subtractMoneyStrings,
  suggestionPrefill,
  sumProposedHousingDraft,
  toggleExcludedDebtItemId,
  type ProposedHousingDraft,
} from "../lib/dtiForm";
import { dtiCalculationInputsKey, dtiQueryKeys } from "../lib/dtiQueryKeys";
import { PAGE_SHELL_PY } from "../lib/pageLayout";

const PROPOSED_FIELD_LABELS: Record<(typeof PROPOSED_HOUSING_FIELDS)[number], string> = {
  principal_and_interest: "Principal and interest",
  property_taxes: "Property taxes",
  homeowners_insurance: "Homeowners insurance",
  mortgage_insurance: "Mortgage insurance",
  hoa_dues: "HOA dues",
  other_required_housing_costs: "Other required housing costs",
};

export default function DebtToIncome() {
  const queryClient = useQueryClient();
  const { householdId, isLoading: householdLoading, isError: householdError, refetch } =
    useDefaultHouseholdId();

  const [proposedDraft, setProposedDraft] = useState<ProposedHousingDraft>(emptyProposedHousingDraft());
  const [proposedErrors, setProposedErrors] = useState<Partial<ProposedHousingDraft>>({});
  const [appliedProposed, setAppliedProposed] = useState<DtiProposedHousingInput | null>(null);
  const [excludedDebtIds, setExcludedDebtIds] = useState<number[]>([]);

  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<DtiIncomeSource | null>(null);
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DtiDebtItem | null>(null);
  const [debtPrefill, setDebtPrefill] = useState<DtiDebtFormPrefill | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    setProposedDraft(emptyProposedHousingDraft());
    setProposedErrors({});
    setAppliedProposed(null);
    setExcludedDebtIds([]);
  }, [householdId]);

  const profileQuery = useQuery({
    queryKey: dtiQueryKeys.profile(householdId ?? 0),
    queryFn: () => getDtiProfile(householdId!),
    enabled: !!householdId,
  });
  const incomeQuery = useQuery({
    queryKey: dtiQueryKeys.incomeSources(householdId ?? 0),
    queryFn: () => listDtiIncomeSources(householdId!),
    enabled: !!householdId,
  });
  const debtQuery = useQuery({
    queryKey: dtiQueryKeys.debtItems(householdId ?? 0),
    queryFn: () => listDtiDebtItems(householdId!),
    enabled: !!householdId,
  });
  const suggestionQuery = useQuery({
    queryKey: dtiQueryKeys.creditCardSuggestions(householdId ?? 0),
    queryFn: () => listDtiCreditCardSuggestions(householdId!),
    enabled: !!householdId,
  });

  const listsReady =
    !!householdId && profileQuery.isSuccess && incomeQuery.isSuccess && debtQuery.isSuccess;

  const baselineKey = dtiCalculationInputsKey(
    appliedProposed ? proposedHousingPayloadForRequest(appliedProposed) : null,
    []
  );
  const combinedKey = dtiCalculationInputsKey(
    appliedProposed ? proposedHousingPayloadForRequest(appliedProposed) : null,
    excludedDebtIds
  );

  const baselineQuery = useQuery({
    queryKey: dtiQueryKeys.calculation(householdId ?? 0, baselineKey),
    queryFn: () =>
      calculateDti(
        buildDtiCalculationRequest({
          householdId: householdId!,
          proposedHousing: appliedProposed,
          excludedDebtItemIds: [],
        })
      ),
    enabled: listsReady,
  });
  const combinedQuery = useQuery({
    queryKey: dtiQueryKeys.calculation(householdId ?? 0, combinedKey),
    queryFn: () =>
      calculateDti(
        buildDtiCalculationRequest({
          householdId: householdId!,
          proposedHousing: appliedProposed,
          excludedDebtItemIds: excludedDebtIds,
        })
      ),
    enabled: listsReady && excludedDebtIds.length > 0,
  });

  const calc = baselineQuery.data;
  const combined = combinedQuery.data;
  const profile = profileQuery.data;
  const incomes = incomeQuery.data ?? [];
  const debts = debtQuery.data ?? [];
  const suggestions = suggestionQuery.data ?? [];
  const warnings = groupDtiWarnings(calc?.warnings ?? []);
  const rankedImpacts = useMemo(
    () => rankPayoffImpactsByPayment(calc?.payoff_impacts ?? []),
    [calc?.payoff_impacts]
  );

  useEffect(() => {
    if (!debtQuery.isSuccess) return;
    const valid = new Set(debts.map((row) => row.id));
    setExcludedDebtIds((current) => {
      const next = current.filter((id) => valid.has(id));
      return next.length === current.length ? current : next;
    });
  }, [debtQuery.isSuccess, debts]);

  function invalidateDti(options: {
    profile?: boolean;
    income?: boolean;
    debt?: boolean;
    suggestions?: boolean;
  } = {}) {
    if (!householdId) return;
    if (options.profile) void queryClient.invalidateQueries({ queryKey: dtiQueryKeys.profile(householdId) });
    if (options.income) {
      void queryClient.invalidateQueries({ queryKey: dtiQueryKeys.incomeSources(householdId) });
    }
    if (options.debt) void queryClient.invalidateQueries({ queryKey: dtiQueryKeys.debtItems(householdId) });
    if (options.suggestions) {
      void queryClient.invalidateQueries({ queryKey: dtiQueryKeys.creditCardSuggestions(householdId) });
    }
    void queryClient.invalidateQueries({ queryKey: ["dti", "calculation", householdId] });
  }

  const incomeSaveMu = useMutation({
    mutationFn: (payload: DtiIncomeSourceWritePayload) =>
      editingIncome
        ? updateDtiIncomeSource(editingIncome.id, payload)
        : createDtiIncomeSource(payload),
    onSuccess: () => {
      invalidateDti({ income: true });
      setIncomeModalOpen(false);
      setEditingIncome(null);
    },
  });
  const incomeToggleMu = useMutation({
    mutationFn: ({ id, included }: { id: number; included: boolean }) =>
      updateDtiIncomeSource(id, { included }),
    onSuccess: () => invalidateDti({ income: true }),
  });
  const incomeDeleteMu = useMutation({
    mutationFn: deleteDtiIncomeSource,
    onSuccess: () => invalidateDti({ income: true }),
  });
  const debtSaveMu = useMutation({
    mutationFn: (payload: DtiDebtItemWritePayload) =>
      editingDebt ? updateDtiDebtItem(editingDebt.id, payload) : createDtiDebtItem(payload),
    onSuccess: () => {
      invalidateDti({ debt: true, suggestions: true });
      setDebtModalOpen(false);
      setEditingDebt(null);
      setDebtPrefill(null);
    },
  });
  const debtToggleMu = useMutation({
    mutationFn: ({ id, included }: { id: number; included: boolean }) =>
      updateDtiDebtItem(id, { included }),
    onSuccess: () => invalidateDti({ debt: true }),
  });
  const debtDeleteMu = useMutation({
    mutationFn: deleteDtiDebtItem,
    onSuccess: () => invalidateDti({ debt: true, suggestions: true }),
  });
  const profileSaveMu = useMutation({
    mutationFn: (payload: DtiProfileWritePayload) => saveDtiProfile(householdId!, payload),
    onSuccess: () => {
      invalidateDti({ profile: true });
      setProfileModalOpen(false);
    },
  });

  function openAddIncome() {
    setEditingIncome(null);
    incomeSaveMu.reset();
    setIncomeModalOpen(true);
  }
  function openAddDebt(prefill: DtiDebtFormPrefill | null = null) {
    setEditingDebt(null);
    setDebtPrefill(prefill);
    debtSaveMu.reset();
    setDebtModalOpen(true);
  }
  function addSuggestedCard(suggestion: DtiCreditCardSuggestion) {
    const pre = suggestionPrefill(suggestion);
    openAddDebt({
      name: pre.name,
      debt_type: pre.debt_type,
      monthly_payment: pre.monthly_payment,
      outstanding_balance: pre.outstanding_balance,
      payment_source: pre.payment_source,
      linked_account_id: pre.linked_account_id,
      included: pre.included,
      months_remaining: "",
      notes: "",
    });
  }

  const loadingLists =
    !!householdId &&
    (profileQuery.isLoading || incomeQuery.isLoading || debtQuery.isLoading || baselineQuery.isLoading);
  const loadError =
    profileQuery.isError || incomeQuery.isError || debtQuery.isError || baselineQuery.isError;
  const showPercents = calc?.status === "calculated";
  const proposedResult = appliedProposed ? calc?.proposed ?? null : null;
  const backComparison = compareActualToTarget(
    showPercents ? calc?.current.back_end_dti_percent : null,
    calc?.inputs.target_back_end_dti_percent
  );
  const frontComparison = compareActualToTarget(
    showPercents ? calc?.current.front_end_dti_percent : null,
    calc?.inputs.target_front_end_dti_percent
  );
  const enteredProposedTotal = sumProposedHousingDraft(proposedDraft);
  const capacity = calc?.capacity.max_proposed_housing_payment_at_target;

  function applyProposedHousing() {
    const result = normalizeProposedHousingDraft(proposedDraft);
    if (!result.ok) {
      setProposedErrors(result.errors);
      return;
    }
    setProposedErrors({});
    setAppliedProposed(result.payload);
  }
  function clearProposedHousing() {
    setProposedDraft(emptyProposedHousingDraft());
    setProposedErrors({});
    setAppliedProposed(null);
  }

  if (householdLoading) {
    return (
      <PageShell>
        <p className="text-sm text-gray-500 animate-pulse">Loading household…</p>
      </PageShell>
    );
  }
  if (householdError) {
    return (
      <PageShell>
        <ErrorState message="Could not load your household." onRetry={() => refetch()} />
      </PageShell>
    );
  }
  if (!householdId) {
    return (
      <PageShell>
        <p className="text-sm text-gray-600">
          Add a household in Settings before using the Debt-to-Income calculator.
        </p>
      </PageShell>
    );
  }

  return (
    <div className={`${PAGE_SHELL_PY} space-y-6`}>
      <header className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">Debt-to-Income</h1>
        <p className="text-sm text-gray-600">
          See how your monthly debt payments and housing costs compare with your gross monthly income.
        </p>
        <p className="text-xs text-gray-500">{DTI_PLANNING_DISCLAIMER}</p>
        <PlanningSubnav />
      </header>

      {loadingLists ? (
        <div className={METRIC_TILE_GRID_4} aria-busy="true" aria-label="Loading DTI summary">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={METRIC_TILE_SKELETON_CLASS} />
          ))}
        </div>
      ) : null}

      {loadError ? (
        <ErrorState
          message="Could not load DTI data."
          onRetry={() => {
            void profileQuery.refetch();
            void incomeQuery.refetch();
            void debtQuery.refetch();
            void suggestionQuery.refetch();
            void baselineQuery.refetch();
          }}
        />
      ) : null}

      {!loadingLists && calc ? (
        <>
          {warnings.page
            .filter((w) => w.code !== "gross_income_required")
            .map((warning) => (
              <p key={warning.code} className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {warning.message}
              </p>
            ))}

          {calc.status === "gross_income_required" ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
              <p className="text-sm font-medium text-amber-950">
                Add at least one included gross monthly income source to calculate DTI.
              </p>
              <p className="text-sm text-amber-900">
                Configured housing {formatDtiMoney(calc.inputs.current_housing_payment)} and other monthly
                debt {formatDtiMoney(calc.inputs.non_housing_monthly_debt)} are still shown below.
              </p>
              <button
                type="button"
                onClick={openAddIncome}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                Add income source
              </button>
            </section>
          ) : null}

          <div className="xl:grid xl:grid-cols-3 xl:gap-4 space-y-4 xl:space-y-0">
            <section className="xl:col-span-2 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">DTI summary</h2>
              <div className={METRIC_TILE_GRID_3}>
                <DashboardMetricTile
                  label="Gross monthly income"
                  value={formatDtiMoney(calc.inputs.gross_monthly_income)}
                />
                <DashboardMetricTile
                  label="Current housing payment"
                  value={formatDtiMoney(calc.inputs.current_housing_payment)}
                  subtitle={profile?.current_housing_label || undefined}
                />
                <DashboardMetricTile
                  label="Other monthly debt"
                  value={formatDtiMoney(calc.inputs.non_housing_monthly_debt)}
                />
                <DashboardMetricTile
                  label="Total monthly obligations"
                  value={formatDtiMoney(calc.current.total_monthly_obligations)}
                />
                <DashboardMetricTile
                  label="Front-end DTI"
                  help="Housing payment ÷ gross monthly income"
                  value={showPercents ? formatDtiPercent(calc.current.front_end_dti_percent) : "Not available"}
                  subtitle="Housing payment ÷ gross monthly income"
                />
                <DashboardMetricTile
                  label="Back-end DTI"
                  help="Housing plus other debt payments ÷ gross monthly income"
                  value={showPercents ? formatDtiPercent(calc.current.back_end_dti_percent) : "Not available"}
                  subtitle="Housing plus other debt payments ÷ gross monthly income"
                />
              </div>
              {proposedResult ? (
                <div className={METRIC_TILE_GRID_4}>
                  <DashboardMetricTile
                    label="Proposed total housing payment"
                    value={formatDtiMoney(proposedResult.housing?.total)}
                  />
                  <DashboardMetricTile
                    label="Proposed front-end DTI"
                    help="Proposed housing payment ÷ gross monthly income"
                    value={showPercents ? formatDtiPercent(proposedResult.front_end_dti_percent) : "Not available"}
                  />
                  <DashboardMetricTile
                    label="Proposed back-end DTI"
                    help="Proposed housing plus other debt payments ÷ gross monthly income"
                    value={showPercents ? formatDtiPercent(proposedResult.back_end_dti_percent) : "Not available"}
                  />
                  <DashboardMetricTile
                    label="Change from current back-end DTI"
                    value={
                      showPercents &&
                      calc.current.back_end_dti_percent &&
                      proposedResult.back_end_dti_percent
                        ? `${calc.current.back_end_dti_percent}% → ${proposedResult.back_end_dti_percent}%`
                        : "Not available"
                    }
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TargetMeter
                  label="Back-end DTI vs your selected target"
                  actual={showPercents ? calc.current.back_end_dti_percent : null}
                  target={calc.inputs.target_back_end_dti_percent}
                  comparison={backComparison}
                />
                {calc.inputs.target_front_end_dti_percent ? (
                  <TargetMeter
                    label="Front-end DTI vs your selected target"
                    actual={showPercents ? calc.current.front_end_dti_percent : null}
                    target={calc.inputs.target_front_end_dti_percent}
                    comparison={frontComparison}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    profileSaveMu.reset();
                    setProfileModalOpen(true);
                  }}
                  className="text-sm font-medium text-blue-700 hover:underline min-h-[44px]"
                >
                  Edit housing and targets
                </button>
              </div>
              {warnings.housing.map((warning) => (
                <p
                  key={warning.code}
                  className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2"
                >
                  {warning.message}
                </p>
              ))}
              <section className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-indigo-950">
                  Estimated housing payment at your selected back-end DTI target
                </h3>
                <p className="text-2xl font-bold tabular-nums text-indigo-950">
                  {formatDtiMoney(capacity)}
                </p>
                <p className="text-sm text-indigo-900">
                  This is the total housing payment—not the home price—and includes principal,
                  interest, taxes, insurance, mortgage insurance, HOA dues, and other required housing
                  costs.
                </p>
                {capacity && isZeroMoney(capacity) ? (
                  <p className="text-sm text-indigo-900">
                    Existing monthly debt uses all of the capacity at your selected target, so there is
                    no remaining estimated housing payment at that target.
                  </p>
                ) : null}
              </section>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-900">Test a proposed home payment</h2>
              <p className="text-sm text-gray-600">
                Enter the complete estimated monthly housing payment. This replaces your current housing payment for the proposed calculation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
                {PROPOSED_HOUSING_FIELDS.map((field) => (
                  <label key={field} className="block text-sm">
                    <span className="text-gray-700">{PROPOSED_FIELD_LABELS[field]}</span>
                    <input
                      value={proposedDraft[field]}
                      onChange={(e) =>
                        setProposedDraft((draft) => ({ ...draft, [field]: e.target.value }))
                      }
                      inputMode="decimal"
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
                      aria-invalid={Boolean(proposedErrors[field])}
                    />
                    {proposedErrors[field] ? (
                      <p className="mt-1 text-xs text-red-600" role="alert">
                        {proposedErrors[field]}
                      </p>
                    ) : null}
                  </label>
                ))}
              </div>
              <p className="text-sm text-gray-700">
                Entered total: {formatCurrency(enteredProposedTotal)}
              </p>
              {proposedResult?.housing ? (
                <p className="text-sm font-medium text-gray-900">
                  Proposed total housing payment: {formatDtiMoney(proposedResult.housing.total)}
                </p>
              ) : null}
              {warnings.proposed.map((warning) => (
                <p key={warning.code} className="text-sm text-amber-900">
                  {warning.message}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyProposedHousing}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
                >
                  Calculate
                </button>
                <button
                  type="button"
                  onClick={clearProposedHousing}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 min-h-[44px]"
                >
                  Clear proposed home
                </button>
              </div>
            </section>
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Income used</h2>
              <button
                type="button"
                onClick={openAddIncome}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                Add income source
              </button>
            </div>
            {incomes.length === 0 ? (
              <p className="text-sm text-gray-600">No income sources yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {incomes.map((row) => (
                  <li key={row.id} className="p-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">{row.name}</p>
                      <p className="text-sm text-gray-600">
                        {INCOME_TYPE_LABELS[row.income_type]} · {formatCurrency(row.gross_monthly_amount)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={row.included}
                          disabled={
                            incomeToggleMu.isPending && incomeToggleMu.variables?.id === row.id
                          }
                          onChange={(e) =>
                            incomeToggleMu.mutate({ id: row.id, included: e.target.checked })
                          }
                        />
                        Include in calculation
                      </label>
                      <button
                        type="button"
                        className="text-sm text-blue-700 hover:underline min-h-[44px]"
                        onClick={() => {
                          setEditingIncome(row);
                          incomeSaveMu.reset();
                          setIncomeModalOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-sm text-red-700 hover:underline min-h-[44px]"
                        onClick={() => {
                          if (window.confirm(`Delete income source "${row.name}"?`)) {
                            incomeDeleteMu.mutate(row.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {suggestions.length > 0 ? (
            <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <h2 className="text-base font-semibold text-gray-900">Credit cards not yet included</h2>
              <p className="text-sm text-gray-600">
                These active cards are suggestions only. Nothing is added until you confirm.
              </p>
              <ul className="space-y-2">
                {suggestions.map((card) => (
                  <li
                    key={card.account_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white border border-blue-100 px-3 py-2"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{card.effective_display_name}</p>
                      <p className="text-sm text-gray-600">
                        Balance {formatCurrency(card.current_balance)} · Minimum{" "}
                        {card.minimum_payment_amount
                          ? formatCurrency(card.minimum_payment_amount)
                          : "Not available"}
                        {card.minimum_payment_usable ? "" : " · minimum not usable"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addSuggestedCard(card)}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
                    >
                      Add to DTI
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">Monthly debt obligations</h2>
              <button
                type="button"
                onClick={() => openAddDebt()}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                Add debt
              </button>
            </div>
            {debts.length === 0 ? (
              <p className="text-sm text-gray-600">No monthly debt obligations yet.</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Balance</th>
                        <th className="px-3 py-2 font-medium">Effective payment</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Included</th>
                        <th className="px-3 py-2 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debts.map((row) => (
                        <DebtTableRow
                          key={row.id}
                          row={row}
                          modeledPaidOff={excludedDebtIds.includes(row.id)}
                          warnings={warnings.byDebtId[row.id] ?? []}
                          toggling={debtToggleMu.isPending && debtToggleMu.variables?.id === row.id}
                          onToggle={(included) => debtToggleMu.mutate({ id: row.id, included })}
                          onEdit={() => {
                            setEditingDebt(row);
                            setDebtPrefill(null);
                            debtSaveMu.reset();
                            setDebtModalOpen(true);
                          }}
                          onDelete={() => {
                            if (window.confirm(`Delete debt "${row.name}"?`)) {
                              debtDeleteMu.mutate(row.id);
                            }
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden space-y-3">
                  {debts.map((row) => {
                    const view = debtRowView(row);
                    return (
                    <li key={row.id} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">{row.name}</p>
                          <p className="text-sm text-gray-600">{view.typeLabel}</p>
                        </div>
                        {excludedDebtIds.includes(row.id) ? (
                          <span className="text-xs font-medium text-indigo-800 bg-indigo-50 px-2 py-1 rounded">
                            Modeled as paid off
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-gray-800">
                        Effective monthly payment {view.effectivePaymentLabel}
                      </p>
                      <p className="text-sm text-gray-600">{view.paymentSource}</p>
                      {view.showLinkedMinimumSync ? (
                        <p className="text-xs text-gray-500">
                          Synced from account minimum. Updates when the linked account minimum changes.
                        </p>
                      ) : null}
                      {view.linkedAccountLabel ? (
                        <p className="text-sm text-gray-600">
                          Linked: {view.linkedAccountLabel}
                        </p>
                      ) : null}
                      {view.balanceLabel ? (
                        <p className="text-sm text-gray-600">
                          Balance {view.balanceLabel}
                        </p>
                      ) : null}
                      {view.monthsRemainingLabel ? (
                        <p className="text-sm text-gray-600">{view.monthsRemainingLabel}</p>
                      ) : null}
                      {(warnings.byDebtId[row.id] ?? []).map((warning) => (
                        <p key={warning.code} className="text-sm text-amber-800">
                          {warning.message}
                        </p>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <label className="flex items-center gap-2 text-sm min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={row.included}
                            disabled={debtToggleMu.isPending && debtToggleMu.variables?.id === row.id}
                            onChange={(e) =>
                              debtToggleMu.mutate({ id: row.id, included: e.target.checked })
                            }
                          />
                          Include in calculation
                        </label>
                        <button
                          type="button"
                          className="text-sm text-blue-700 hover:underline min-h-[44px]"
                          onClick={() => {
                            setEditingDebt(row);
                            setDebtPrefill(null);
                            debtSaveMu.reset();
                            setDebtModalOpen(true);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-sm text-red-700 hover:underline min-h-[44px]"
                          onClick={() => {
                            if (window.confirm(`Delete debt "${row.name}"?`)) {
                              debtDeleteMu.mutate(row.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Debt payoff impact</h2>
            <p className="text-sm text-gray-600">
              This models removing the monthly obligation entirely. A partial balance payment does not
              remove the payment.
            </p>
            {rankedImpacts.length === 0 ? (
              <p className="text-sm text-gray-600">No included debts to model as paid off.</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-3 py-2 font-medium">Debt</th>
                        <th className="px-3 py-2 font-medium">Payment removed</th>
                        <th className="px-3 py-2 font-medium">Current back-end</th>
                        <th className="px-3 py-2 font-medium">After payoff</th>
                        <th className="px-3 py-2 font-medium">Reduction</th>
                        <th className="px-3 py-2 font-medium">Added housing capacity</th>
                        <th className="px-3 py-2 font-medium">Model as paid off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedImpacts.map((impact) => (
                        <tr key={impact.debt_item_id ?? impact.name} className="border-t border-gray-100">
                          <td className="px-3 py-2">{impact.name}</td>
                          <td className="px-3 py-2">{formatDtiMoney(impact.effective_monthly_payment)}</td>
                          <td className="px-3 py-2">{formatDtiPercent(impact.current_back_end_dti)}</td>
                          <td className="px-3 py-2">{formatDtiPercent(impact.back_end_dti_after_payoff)}</td>
                          <td className="px-3 py-2">
                            {formatDtiPercent(impact.dti_reduction_percentage_points)}
                          </td>
                          <td className="px-3 py-2">
                            {formatDtiMoney(impact.additional_housing_capacity_at_target)}
                          </td>
                          <td className="px-3 py-2">
                            {impact.debt_item_id != null ? (
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={excludedDebtIds.includes(impact.debt_item_id)}
                                  onChange={() =>
                                    setExcludedDebtIds((ids) =>
                                      toggleExcludedDebtItemId(ids, impact.debt_item_id!)
                                    )
                                  }
                                />
                                <span className="sr-only">Model {impact.name} as paid off</span>
                              </label>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="md:hidden space-y-3">
                  {rankedImpacts.map((impact) => (
                    <li key={impact.debt_item_id ?? impact.name} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
                      <p className="font-medium text-gray-900">{impact.name}</p>
                      <p className="text-sm text-gray-700">{payoffImpactSentence(impact)}</p>
                      <p className="text-sm text-gray-600">
                        Additional housing-payment capacity at your selected target:{" "}
                        {formatDtiMoney(impact.additional_housing_capacity_at_target)}
                      </p>
                      {impact.debt_item_id != null ? (
                        <label className="flex items-center gap-2 text-sm min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={excludedDebtIds.includes(impact.debt_item_id)}
                            onChange={() =>
                              setExcludedDebtIds((ids) =>
                                toggleExcludedDebtItemId(ids, impact.debt_item_id!)
                              )
                            }
                          />
                          Model as paid off
                        </label>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {excludedDebtIds.length > 0 && combinedQuery.isLoading ? (
              <p className="text-sm text-gray-600">Updating combined payoff simulation…</p>
            ) : null}
            {excludedDebtIds.length > 0 && combinedQuery.isError ? (
              <ErrorState
                message="Could not load the combined payoff simulation."
                onRetry={() => {
                  void combinedQuery.refetch();
                }}
              />
            ) : null}
            {excludedDebtIds.length > 0 && combined ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-2">
                <h3 className="text-sm font-semibold text-indigo-950">Combined payoff simulation</h3>
                <p className="text-sm text-indigo-900">
                  These debts stay in your saved list. Modeling them as paid off does not change included flags or delete them.
                </p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-indigo-800">Current back-end DTI</dt>
                    <dd className="font-medium">
                      {showPercents ? formatDtiPercent(calc.current.back_end_dti_percent) : "Not available"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-indigo-800">Back-end DTI after selected payoffs</dt>
                    <dd className="font-medium">
                      {combined.status === "calculated"
                        ? formatDtiPercent(combined.current.back_end_dti_percent)
                        : "Not available"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-indigo-800">Monthly obligations removed</dt>
                    <dd className="font-medium">
                      {formatDtiMoney(
                        subtractMoneyStrings(
                          calc.current.total_monthly_obligations,
                          combined.current.total_monthly_obligations
                        )
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-indigo-800">New estimated housing payment at your selected target</dt>
                    <dd className="font-medium">
                      {formatDtiMoney(combined.capacity.max_proposed_housing_payment_at_target)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-indigo-800">Change in capacity</dt>
                    <dd className="font-medium">
                      {formatDtiMoney(
                        subtractMoneyStrings(
                          combined.capacity.max_proposed_housing_payment_at_target,
                          calc.capacity.max_proposed_housing_payment_at_target
                        )
                      )}
                    </dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => setExcludedDebtIds([])}
                  className="rounded-md border border-indigo-300 px-3 py-2 text-sm text-indigo-900 min-h-[44px]"
                >
                  Clear selected payoffs
                </button>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left min-h-[44px]"
              aria-expanded={howOpen}
              onClick={() => setHowOpen((v) => !v)}
            >
              <span className="text-base font-semibold text-gray-900">How this calculation works</span>
              <span className="text-sm text-gray-500">{howOpen ? "Hide" : "Show"}</span>
            </button>
            {howOpen ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
                <li>Gross monthly income uses only included income sources.</li>
                <li>Front-end DTI uses housing only.</li>
                <li>Back-end DTI uses housing plus included monthly debts.</li>
                <li>Proposed housing replaces current housing.</li>
                <li>
                  Budget expenses such as utilities, groceries, and subscriptions are not automatically
                  included.
                </li>
                <li>Lenders may treat debts and income differently.</li>
                <li>The calculator is for planning and does not determine approval.</li>
              </ul>
            ) : null}
          </section>
        </>
      ) : null}

      {householdId ? (
        <>
          <DtiIncomeFormModal
            open={incomeModalOpen}
            householdId={householdId}
            initial={editingIncome}
            saving={incomeSaveMu.isPending}
            error={incomeSaveMu.error}
            onClose={() => {
              setIncomeModalOpen(false);
              setEditingIncome(null);
            }}
            onSubmit={(payload) => incomeSaveMu.mutate(payload)}
          />
          <DtiDebtFormModal
            open={debtModalOpen}
            householdId={householdId}
            initial={editingDebt}
            prefill={debtPrefill}
            debts={debts}
            suggestions={suggestions}
            saving={debtSaveMu.isPending}
            error={debtSaveMu.error}
            onClose={() => {
              setDebtModalOpen(false);
              setEditingDebt(null);
              setDebtPrefill(null);
            }}
            onSubmit={(payload) => debtSaveMu.mutate(payload)}
          />
          <DtiProfileFormModal
            open={profileModalOpen}
            initial={profile ?? null}
            saving={profileSaveMu.isPending}
            error={profileSaveMu.error}
            onClose={() => setProfileModalOpen(false)}
            onSubmit={(payload) => profileSaveMu.mutate(payload)}
          />
        </>
      ) : null}
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      <h1 className="text-lg font-semibold text-gray-900">Debt-to-Income</h1>
      <p className="text-sm text-gray-600">
        See how your monthly debt payments and housing costs compare with your gross monthly income.
      </p>
      <p className="text-xs text-gray-500">{DTI_PLANNING_DISCLAIMER}</p>
      <PlanningSubnav />
      {children}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
      >
        Retry
      </button>
    </div>
  );
}

function TargetMeter({
  label,
  actual,
  target,
  comparison,
}: {
  label: string;
  actual: string | null | undefined;
  target: string | null | undefined;
  comparison: ReturnType<typeof compareActualToTarget>;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm text-gray-800">
        {formatDtiPercent(actual)} vs target {formatDtiPercent(target)}
      </p>
      <div
        className="h-2 rounded bg-gray-100"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={comparison.meterPercent}
      >
        <div
          className={`h-2 rounded ${comparison.status === "above" ? "bg-amber-500" : "bg-blue-600"}`}
          style={{ width: `${comparison.meterPercent}%` }}
        />
      </div>
      <p className="text-sm text-gray-700">{comparison.label}</p>
    </div>
  );
}

function DebtTableRow({
  row,
  modeledPaidOff,
  warnings,
  toggling,
  onToggle,
  onEdit,
  onDelete,
}: {
  row: DtiDebtItem;
  modeledPaidOff: boolean;
  warnings: Array<{ code: string; message: string }>;
  toggling: boolean;
  onToggle: (included: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const view = debtRowView(row);
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="px-3 py-2">
        <p className="font-medium text-gray-900">{row.name}</p>
        {modeledPaidOff ? (
          <p className="text-xs text-indigo-800">Modeled as paid off</p>
        ) : null}
        {view.linkedAccountLabel ? (
          <p className="text-xs text-gray-500">{view.linkedAccountLabel}</p>
        ) : null}
        {view.monthsRemainingLabel ? (
          <p className="text-xs text-gray-500">{view.monthsRemainingLabel}</p>
        ) : null}
        {warnings.map((warning) => (
          <p key={warning.code} className="text-xs text-amber-800 mt-1">
            {warning.message}
          </p>
        ))}
      </td>
      <td className="px-3 py-2">{view.typeLabel}</td>
      <td className="px-3 py-2">{view.balanceLabel ?? "—"}</td>
      <td className="px-3 py-2">{view.effectivePaymentLabel}</td>
      <td className="px-3 py-2">
        {view.paymentSource}
        {view.showLinkedMinimumSync ? (
          <span className="block text-xs text-gray-500">
            Updates when the linked account minimum changes.
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row.included}
            disabled={toggling}
            onChange={(e) => onToggle(e.target.checked)}
          />
          Include in calculation
        </label>
      </td>
      <td className="px-3 py-2">
        <button type="button" className="text-blue-700 hover:underline mr-3 min-h-[44px]" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="text-red-700 hover:underline min-h-[44px]" onClick={onDelete}>
          Delete
        </button>
      </td>
    </tr>
  );
}
