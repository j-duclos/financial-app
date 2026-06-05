import { formatCurrency } from "@budget-app/shared";
import type { SpendingTarget, SpendingTargetMetrics } from "@budget-app/shared";
import { formatDateDisplay } from "../../lib/dateDisplay";
import {
  spendingTargetProgressPercent,
  spendingTargetStatusClass,
  SPENDING_TARGET_STATUS_LABELS,
} from "../../lib/spendingTargetDisplay";

export default function SpendingTargetCard({
  target,
  metrics,
  onEdit,
  onDelete,
}: {
  target: SpendingTarget;
  metrics: SpendingTargetMetrics;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const pct = spendingTargetProgressPercent(metrics);
  const name = target.name || metrics.category_name;
  const scheduled = parseFloat(metrics.scheduled_in_period ?? "0");
  const remaining = parseFloat(metrics.remaining_to_target ?? "0");
  const showScheduled = Number.isFinite(scheduled) && scheduled > 0.005;

  const periodLabel = `${formatDateDisplay(metrics.period_start)} – ${formatDateDisplay(metrics.period_end)}`;

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{name}</h3>
          <p className="text-xs text-gray-500 capitalize">
            {metrics.period} limit · {periodLabel}
          </p>
        </div>
        <span
          className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${spendingTargetStatusClass(metrics.status)}`}
        >
          {SPENDING_TARGET_STATUS_LABELS[metrics.status]}
        </span>
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            metrics.status === "above_target" || metrics.status === "risky"
              ? "bg-orange-500"
              : metrics.status === "approaching_target"
                ? "bg-amber-400"
                : "bg-emerald-500"
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      <dl className="text-sm text-gray-800 space-y-0.5">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600">Limit</dt>
          <dd className="font-medium">{formatCurrency(metrics.target_amount)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600">Spent</dt>
          <dd>{formatCurrency(metrics.spent_so_far)}</dd>
        </div>
        {showScheduled && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-600">Scheduled remaining</dt>
            <dd>{formatCurrency(metrics.scheduled_in_period)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-gray-600">Remaining</dt>
          <dd className={remaining < 0 ? "text-red-700 font-medium" : ""}>
            {formatCurrency(metrics.remaining_to_target)}
          </dd>
        </div>
      </dl>

      {metrics.recommendation && (
        <p className="text-xs text-gray-700 border-t border-gray-100 pt-2">
          {metrics.recommendation}
        </p>
      )}
      {(onEdit || onDelete) && (
        <div className="flex flex-wrap gap-3 mt-auto pt-1">
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs text-blue-600 hover:underline"
            >
              Edit limit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-red-600 hover:underline"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </article>
  );
}
