import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FinancialGoal } from "@budget-app/shared";
import {
  archiveBucket,
  completeBucket,
  configureBucketFunding,
  createBucket,
  deleteBucket,
  duplicateBucket,
  getBucketsSummary,
  listAccounts,
  listAllBuckets,
  listHouseholds,
  listRuleAllocations,
  listRules,
  pauseBucket,
  updateBucket,
} from "@budget-app/api-client";
import { goalTypeToBucketType, priorityToBucketPriority } from "../lib/bucketGoalTypes";
import {
  buildBucketFundingPayload,
  goalFundingFormFromAllocation,
} from "../lib/goalFundingForm";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import GoalFormModal, { type GoalFormValues } from "../components/goals/GoalFormModal";
import GoalsSummaryBar from "../components/goals/GoalsSummaryBar";
import {
  METRIC_TILE_GRID_4,
  METRIC_TILE_SKELETON_CLASS,
} from "../components/dashboard/metricTileLayout";
import CollapsibleGoalSection from "../components/goals/CollapsibleGoalSection";
import GoalCard from "../components/goals/GoalCard";
import ForecastModal from "../components/goals/ForecastModal";

function buildPayload(householdId: number, values: GoalFormValues) {
  const isDebt = values.goal_type === "debt_payoff";
  const bucketType = goalTypeToBucketType(values.goal_type);
  return {
    household: householdId,
    name: values.name.trim(),
    type: bucketType,
    description: values.description?.trim() ?? "",
    target_amount:
      isDebt && values.starting_debt_amount && parseFloat(values.target_amount) <= 0
        ? values.starting_debt_amount
        : values.target_amount,
    target_date: values.target_date || null,
    linked_account: isDebt
      ? values.linked_credit_account || null
      : values.linked_account || null,
    monthly_target: values.monthly_contribution || "0",
    priority: priorityToBucketPriority(values.priority),
    notes: values.notes,
    include_in_safe_to_spend: values.include_in_safe_to_spend,
    forecast_enabled: values.forecast_enabled,
    auto_fund_enabled: values.auto_fund_enabled,
  };
}

export default function Goals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FinancialGoal | null>(null);
  const [forecastGoal, setForecastGoal] = useState<FinancialGoal | null>(null);
  const modalOpen = searchParams.get("new") === "1" || editing != null;

  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const householdId = households?.[0]?.id;

  const { data: allGoals = [], isLoading } = useQuery({
    queryKey: ["buckets", "all"],
    queryFn: () => listAllBuckets(),
    enabled: !!householdId,
  });

  const { data: summary } = useQuery({
    queryKey: ["buckets-summary", householdId],
    queryFn: () => getBucketsSummary({ household: householdId }),
    enabled: !!householdId,
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "goals"],
    queryFn: () => listAccounts({ balance: "true" }),
  });

  const goals = allGoals;
  const accounts = accountsData?.results ?? [];

  const active = useMemo(
    () => goals.filter((g) => g.status === "active" || g.status === "paused"),
    [goals]
  );
  const completed = useMemo(() => goals.filter((g) => g.status === "completed"), [goals]);
  const archived = useMemo(() => goals.filter((g) => g.status === "archived"), [goals]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["buckets"] });
    queryClient.invalidateQueries({ queryKey: ["buckets", "all"] });
    queryClient.invalidateQueries({ queryKey: ["buckets-summary"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
    queryClient.invalidateQueries({ queryKey: ["goals-report"] });
    queryClient.invalidateQueries({ queryKey: ["recurring-rules"] });
    queryClient.invalidateQueries({ queryKey: ["rule-allocations"] });
  };

  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ["recurring-rules", "goals-funding"],
    queryFn: () => listRules(),
    enabled: modalOpen && !!householdId,
  });
  const incomeRules = rulesData?.results ?? [];

  const { data: allocationData } = useQuery({
    queryKey: ["rule-allocations", editing?.id],
    queryFn: () => listRuleAllocations({ bucket: editing!.id }),
    enabled: modalOpen && editing != null,
  });
  const initialFunding = useMemo(() => {
    if (!editing) return undefined;
    const allocation = allocationData?.results?.[0];
    return goalFundingFormFromAllocation(
      editing.auto_fund_enabled ?? false,
      allocation,
      editing.monthly_contribution ?? editing.monthly_target
    );
  }, [editing, allocationData]);

  const saveMu = useMutation({
    mutationFn: async (values: GoalFormValues) => {
      const body = buildPayload(householdId!, values);
      const saved = editing ? await updateBucket(editing.id, body) : await createBucket(body);
      const isDebt = values.goal_type === "debt_payoff";
      if (!isDebt) {
        await configureBucketFunding(saved.id, buildBucketFundingPayload(
          values.funding,
          values.monthly_contribution
        ));
      }
      return saved;
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setSearchParams({});
    },
  });

  const archiveMu = useMutation({ mutationFn: archiveBucket, onSuccess: invalidate });
  const completeMu = useMutation({ mutationFn: completeBucket, onSuccess: invalidate });
  const pauseMu = useMutation({ mutationFn: pauseBucket, onSuccess: invalidate });
  const duplicateMu = useMutation({ mutationFn: duplicateBucket, onSuccess: invalidate });
  const deleteMu = useMutation({
    mutationFn: deleteBucket,
    onSuccess: invalidate,
  });

  function closeModal() {
    setEditing(null);
    setSearchParams({});
  }

  function confirmDelete(goal: FinancialGoal) {
    if (window.confirm(`Delete "${goal.name}"? This cannot be undone.`)) {
      deleteMu.mutate(goal.id);
    }
  }

  function renderCards(list: FinancialGoal[]) {
    return (
      <div className="w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {list.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onForecast={() => setForecastGoal(g)}
              onEdit={() => setEditing(g)}
              onDuplicate={() => duplicateMu.mutate(g.id)}
              onPause={() => pauseMu.mutate(g.id)}
              onComplete={() => completeMu.mutate(g.id)}
              onArchive={() => archiveMu.mutate(g.id)}
              onDelete={() => confirmDelete(g)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      <div className="space-y-2">
        {isLoading ? (
          <div className={METRIC_TILE_GRID_4}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={METRIC_TILE_SKELETON_CLASS} aria-hidden />
            ))}
          </div>
        ) : (
          summary && active.length > 0 && <GoalsSummaryBar summary={summary} />
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <p className="text-sm text-gray-500">
            Reserve money on your accounts without moving balances out of the bank.
          </p>
          <button
            type="button"
            onClick={() => setSearchParams({ new: "1" })}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add goal bucket
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading goals…</p>}

      {!isLoading && goals.length === 0 && (
        <div className="bg-white rounded-lg shadow p-8 text-center space-y-3 w-full">
          <p className="text-gray-600">Create your first goal bucket</p>
          <p className="text-sm text-gray-500">
            Examples: emergency fund, vacation, house down payment, credit card payoff
          </p>
          <button
            type="button"
            onClick={() => setSearchParams({ new: "1" })}
            className="text-blue-600 hover:underline text-sm font-medium"
          >
            Add goal bucket
          </button>
        </div>
      )}

      <CollapsibleGoalSection title="Active goals" count={active.length} defaultOpen>
        {renderCards(active)}
      </CollapsibleGoalSection>

      <CollapsibleGoalSection title="Completed goals" count={completed.length} defaultOpen={false}>
        <div className="opacity-80">{renderCards(completed)}</div>
      </CollapsibleGoalSection>

      <CollapsibleGoalSection title="Archived goals" count={archived.length} defaultOpen={false}>
        <div className="opacity-60">{renderCards(archived)}</div>
      </CollapsibleGoalSection>

      {householdId && (
        <GoalFormModal
          open={modalOpen}
          householdId={householdId}
          accounts={accounts}
          existingGoals={goals}
          incomeRules={incomeRules}
          rulesLoading={rulesLoading}
          initialFunding={initialFunding}
          initial={editing}
          saving={saveMu.isPending}
          onClose={closeModal}
          onSubmit={(values) => saveMu.mutate(values)}
        />
      )}

      {forecastGoal && (
        <ForecastModal open goal={forecastGoal} onClose={() => setForecastGoal(null)} />
      )}
    </div>
  );
}
