import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { SpendingTarget } from "@budget-app/shared";
import {
  createSpendingTarget,
  deleteSpendingTarget,
  getSpendingTargetsSummary,
  listCategories,
  listHouseholds,
  listSpendingTargets,
  updateSpendingTarget,
} from "@budget-app/api-client";
import SpendingTargetCard from "../components/spendingTargets/SpendingTargetCard";
import SpendingTargetFormModal from "../components/spendingTargets/SpendingTargetFormModal";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import {
  METRIC_TILE_GRID_4,
  METRIC_TILE_SKELETON_CLASS,
} from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY } from "../lib/pageLayout";

export default function SpendingTargets() {
  const queryClient = useQueryClient();
  const anchor = new Date().toISOString().slice(0, 10);
  const monthKey = anchor.slice(0, 7);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpendingTarget | null>(null);

  const { data: households } = useQuery({
    queryKey: ["households"],
    queryFn: listHouseholds,
  });
  const householdId = households?.[0]?.id ?? null;

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "spending-targets", householdId],
    queryFn: () =>
      listCategories({
        page_size: 500,
        household: householdId!,
        type: "EXPENSE",
      }),
    enabled: householdId != null,
  });
  const categories = categoriesData?.results ?? [];

  const { data: summary, isLoading } = useQuery({
    queryKey: ["spending-targets-summary", householdId, monthKey],
    queryFn: () =>
      getSpendingTargetsSummary({
        household: householdId ?? undefined,
        anchor,
      }),
    enabled: householdId != null,
  });

  const { data: targetsData } = useQuery({
    queryKey: ["spending-targets", householdId, monthKey],
    queryFn: () =>
      listSpendingTargets({
        household: householdId ?? undefined,
        anchor,
        active: true,
      }),
    enabled: householdId != null,
  });

  const targets = targetsData?.results ?? [];
  const metricsById = useMemo(() => {
    const map = new Map<
      number,
      import("@budget-app/shared").SpendingTargetMetrics
    >();
    for (const row of summary?.targets ?? []) {
      map.set(row.target_id, row);
    }
    return map;
  }, [summary?.targets]);

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
      await queryClient.invalidateQueries({ queryKey: ["spending-targets"] });
      await queryClient.invalidateQueries({ queryKey: ["spending-targets-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteSpendingTarget,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["spending-targets"] });
      await queryClient.invalidateQueries({ queryKey: ["spending-targets-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  function confirmDelete(target: SpendingTarget) {
    const label = target.name || target.category.name;
    if (window.confirm(`Delete spending limit for "${label}"? This cannot be undone.`)) {
      deleteMu.mutate(target.id);
    }
  }

  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      {isLoading ? (
        <div className={METRIC_TILE_GRID_4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={METRIC_TILE_SKELETON_CLASS} aria-hidden />
          ))}
        </div>
      ) : summary ? (
        <div className={METRIC_TILE_GRID_4}>
          <DashboardMetricTile
            label="Monthly limits"
            value={formatCurrency(summary.total_monthly_targets)}
          />
          <DashboardMetricTile
            label="Spent this month"
            value={formatCurrency(summary.spent_so_far_total)}
          />
          <DashboardMetricTile
            label="Known upcoming"
            value={formatCurrency(summary.scheduled_in_period_total ?? "0")}
          />
          <DashboardMetricTile
            label="Above / approaching"
            value={`${summary.above_target_count} / ${summary.approaching_target_count}`}
            valueClassName="text-gray-900"
          />
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
        <p className="flex-1 min-w-0 text-sm text-gray-600">
          Set a monthly spending limit per category. Progress uses posted spending plus known future scheduled transactions only.
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
          className="shrink-0 self-end sm:self-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add limit
        </button>
      </div>

      {targets.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-600">
          <p className="font-medium text-gray-900">No spending limits yet</p>
          <p className="mt-1">Use Add limit to create one for an expense category.</p>
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
