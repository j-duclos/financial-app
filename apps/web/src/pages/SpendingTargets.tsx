import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { SpendingTarget } from "@budget-app/shared";
import {
  createSpendingTarget,
  deleteSpendingTarget,
  getSpendingTargetsSummary,
  listCategories,
  listSpendingTargets,
  updateSpendingTarget,
} from "@budget-app/api-client";
import SpendingTargetCard from "../components/spendingTargets/SpendingTargetCard";
import SpendingTargetFormModal from "../components/spendingTargets/SpendingTargetFormModal";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import {
  METRIC_TILE_GRID_5,
  METRIC_TILE_SKELETON_CLASS,
} from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import { useProfileQuery } from "../lib/profileQuery";
import { invalidateSpendingTargetDependents } from "../lib/financialQueryRefresh";
import { parseOptionalMetricAmount } from "../lib/spendingTargetDisplay";

export default function SpendingTargets() {
  const queryClient = useQueryClient();
  const anchor = new Date().toISOString().slice(0, 10);
  const monthKey = anchor.slice(0, 7);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpendingTarget | null>(null);

  const { data: profile, isFetched: profileFetched } = useProfileQuery();
  const householdId = profile?.default_household ?? null;

  const {
    data: summary,
    isLoading,
    isError: summaryError,
    isFetching: summaryFetching,
    isPlaceholderData: summaryPlaceholder,
  } = useQuery({
    queryKey: ["spending-targets-summary", householdId, monthKey, anchor],
    queryFn: () =>
      getSpendingTargetsSummary({
        household: householdId ?? undefined,
        anchor,
      }),
    enabled: householdId != null,
    placeholderData: keepPreviousData,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "spending-targets", householdId],
    queryFn: () =>
      listCategories({
        page_size: 500,
        household: householdId!,
        type: "EXPENSE",
      }),
    enabled: householdId != null && (modalOpen || Boolean(summary)),
    staleTime: 5 * 60 * 1000,
  });
  const categories = categoriesData?.results ?? [];

  const {
    data: targetsData,
    isError: targetsError,
    isPlaceholderData: targetsPlaceholder,
  } = useQuery({
    queryKey: ["spending-targets", householdId, monthKey, anchor],
    queryFn: () =>
      listSpendingTargets({
        household: householdId ?? undefined,
        anchor,
        active: true,
      }),
    enabled: householdId != null,
    placeholderData: keepPreviousData,
  });

  const dataMatchesPeriod =
    summary != null &&
    summary.anchor_date.slice(0, 7) === monthKey &&
    !summaryPlaceholder &&
    !targetsPlaceholder;
  const isUpdatingPeriod = (summaryFetching || targetsPlaceholder) && !dataMatchesPeriod;

  const targets = dataMatchesPeriod ? (targetsData?.results ?? []) : [];
  const metricsById = useMemo(() => {
    const map = new Map<
      number,
      import("@budget-app/shared").SpendingTargetMetrics
    >();
    if (!dataMatchesPeriod) return map;
    for (const row of summary?.targets ?? []) {
      map.set(row.target_id, row);
    }
    return map;
  }, [summary?.targets, dataMatchesPeriod]);

  const saveMu = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (editing) {
        return updateSpendingTarget(editing.id, body);
      }
      return createSpendingTarget(
        body as Parameters<typeof createSpendingTarget>[0]
      );
    },
    onSuccess: async () => {
      setModalOpen(false);
      setEditing(null);
      invalidateSpendingTargetDependents(queryClient);
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteSpendingTarget,
    onSuccess: async () => {
      invalidateSpendingTargetDependents(queryClient);
    },
  });

  function confirmDelete(target: SpendingTarget) {
    const label = target.name || target.category.name;
    if (window.confirm(`Delete budget for "${label}"? This cannot be undone.`)) {
      deleteMu.mutate(target.id);
    }
  }

  const displaySummary = dataMatchesPeriod ? summary : undefined;
  const remaining = displaySummary?.remaining_to_targets_total;
  const remainingNum = parseOptionalMetricAmount(remaining);

  if (profileFetched && householdId == null) {
    return (
      <div className={`${PAGE_SHELL_PY} space-y-4`}>
        <h1 className="text-lg font-semibold text-gray-900">Budget</h1>
        <p className="text-sm text-gray-600">
          Set a default household in Profile &amp; Settings to manage spending limits.
        </p>
      </div>
    );
  }

  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Budget</h1>
        <p className="text-sm text-gray-600 mt-1">
          Set and track monthly spending by category.
        </p>
      </div>
      {isUpdatingPeriod ? (
        <p className="text-sm text-gray-500" aria-live="polite">
          Updating…
        </p>
      ) : null}
      {summaryError && !displaySummary ? (
        <p className="text-sm text-red-700">Could not load budget summary.</p>
      ) : null}
      {isLoading && !displaySummary ? (
        <div className={METRIC_TILE_GRID_5}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={METRIC_TILE_SKELETON_CLASS} aria-hidden />
          ))}
        </div>
      ) : displaySummary ? (
        <div className={METRIC_TILE_GRID_5}>
          <DashboardMetricTile
            label="Category budget"
            value={formatCurrency(displaySummary.total_monthly_targets)}
          />
          <DashboardMetricTile
            label="Spent"
            value={formatCurrency(displaySummary.spent_so_far_total)}
          />
          <DashboardMetricTile
            label="Known upcoming"
            value={formatCurrency(displaySummary.scheduled_in_period_total ?? "0")}
          />
          <DashboardMetricTile
            label="Remaining"
            value={formatCurrency(remaining ?? "0")}
            valueClassName={
              remainingNum != null && remainingNum < 0 ? "text-red-700" : "text-emerald-700"
            }
          />
          <DashboardMetricTile
            label="Above / approaching"
            value={`${displaySummary.above_target_count} / ${displaySummary.approaching_target_count}`}
            valueClassName="text-gray-900"
          />
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <p className="flex-1 min-w-0 text-sm text-gray-600">
          Progress uses posted spending plus known future scheduled transactions only.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="shrink-0 self-end sm:self-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add spending limit
        </button>
      </div>

      {targetsError ? (
        <p className="text-sm text-red-700">Could not load spending limits.</p>
      ) : null}

      {targets.length === 0 && !isLoading && !targetsError && dataMatchesPeriod && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
          <p className="font-medium text-gray-900">No category budgets yet</p>
          <p className="mt-1">Use Add spending limit to create one for an expense category.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {targets.map((target) => {
          const metrics = metricsById.get(target.id) ?? target.metrics;
          if (!metrics) return null;
          return (
            <SpendingTargetCard
              key={target.id}
              target={target}
              metrics={metrics}
              onEdit={() => {
                setEditing(target);
                setModalOpen(true);
              }}
              onDelete={() => confirmDelete(target)}
            />
          );
        })}
      </div>

      <SpendingTargetFormModal
        open={modalOpen}
        categories={categories}
        householdId={householdId}
        initial={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={(body) => saveMu.mutate(body)}
      />
    </div>
  );
}
