import { useQuery } from "@tanstack/react-query";
import { X, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import type { Account, ResolveRiskAction } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { getResolveRiskPlan } from "@budget-app/api-client";
import SeverityBadge from "../shared/SeverityBadge";
import {
  formatResolveRiskLowest,
  resolveRiskPlannerUrl,
  resolveRiskTransferPreset,
  simulationPreviewLines,
  simulationStatusClass,
  snoozeResolveRisk,
} from "../../lib/resolveRiskDisplay";
import { dismissRecommendation } from "../../lib/recommendationDisplay";

type Props = {
  open: boolean;
  accountId: number;
  accountName: string;
  forecastDays: number;
  accounts: Account[];
  onClose: () => void;
  onApplyTransfer: (preset: NonNullable<ReturnType<typeof resolveRiskTransferPreset>>) => void;
  onSnoozed?: () => void;
};

function ActionCard({
  action,
  accounts,
  onApplyTransfer,
}: {
  action: ResolveRiskAction;
  accounts: Account[];
  onApplyTransfer: Props["onApplyTransfer"];
}) {
  const preview = action.simulation;
  const { lowestLine, improvementLine, statusLabel } = simulationPreviewLines(preview);
  const transferPreset = resolveRiskTransferPreset(action, accounts);
  const plannerUrl = resolveRiskPlannerUrl(action);
  const status = preview?.result_status as "resolved" | "partial" | "failed" | undefined;

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-gray-900 leading-snug">{action.title}</h4>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">{action.why}</p>
        </div>
        <SeverityBadge severity={action.severity} compact />
      </div>

      {action.recommended_action && (
        <p className="text-sm font-medium text-gray-800">{action.recommended_action}</p>
      )}

      {(lowestLine || improvementLine || preview?.recovery_insight) && (
        <div
          className={`rounded-md border px-2.5 py-2 text-xs space-y-1 ${
            preview?.risk_resolved
              ? "border-emerald-200 bg-emerald-50/80 text-emerald-900"
              : "border-gray-200 bg-gray-50 text-gray-800"
          }`}
        >
          <p className="font-semibold text-[10px] uppercase tracking-wide text-gray-500">
            Simulation result
          </p>
          {lowestLine && <p className="font-medium">{lowestLine}</p>}
          {improvementLine && <p>{improvementLine}</p>}
          {preview?.recovery_insight && (
            <p className="text-gray-600">{preview.recovery_insight}</p>
          )}
          {statusLabel && status && (
            <p className={`font-semibold ${simulationStatusClass(status)}`}>{statusLabel}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {transferPreset && (
          <button
            type="button"
            onClick={() => onApplyTransfer(transferPreset)}
            className="inline-flex rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Apply transfer
          </button>
        )}
        {plannerUrl && (
          <Link
            to={plannerUrl}
            className="inline-flex rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            Payment Planner
          </Link>
        )}
        {!transferPreset && action.primary_action_url && (
          <Link
            to={action.primary_action_url}
            className="inline-flex rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            {action.primary_action_label ?? "Open"}
          </Link>
        )}
      </div>
    </article>
  );
}

export default function ResolveRiskModal({
  open,
  accountId,
  accountName,
  forecastDays,
  accounts,
  onClose,
  onApplyTransfer,
  onSnoozed,
}: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["resolve-risk", accountId, forecastDays],
    queryFn: () => getResolveRiskPlan({ account_id: accountId, days: forecastDays }),
    enabled: open && accountId > 0,
    staleTime: 60_000,
  });

  if (!open) return null;

  const summary = data?.summary;
  const actions = data?.actions ?? [];

  const handleSnooze = () => {
    if (data) snoozeResolveRisk(data);
    onSnoozed?.();
    onClose();
  };

  const handleDismiss = () => {
    dismissRecommendation(`attention-${accountId}`);
    onSnoozed?.();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Resolve risk for ${accountName}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg h-full bg-white shadow-2xl flex flex-col motion-safe:animate-in motion-safe:slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-gray-900">Resolve risk</h2>
              <p className="text-xs text-gray-500">{accountName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {isLoading && (
            <p className="text-sm text-gray-500">Running forecast simulation…</p>
          )}
          {isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>Could not load resolve-risk plan.</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 text-blue-600 underline text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {data && !data.eligible && (
            <p className="text-sm text-gray-600">{data.message}</p>
          )}

          {summary && data?.eligible && (
            <section className="rounded-lg border border-red-200 bg-red-50/60 p-3 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-red-800">
                Risk summary
              </h3>
              <p className="text-sm text-gray-900 leading-snug">{summary.headline}</p>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-gray-500">Lowest projected</dt>
                <dd className="font-semibold text-red-800 tabular-nums">
                  {formatResolveRiskLowest(summary.lowest_projected_balance)}
                </dd>
                {summary.risk_date_label && (
                  <>
                    <dt className="text-gray-500">Risk date</dt>
                    <dd className="font-medium text-gray-900">{summary.risk_date_label}</dd>
                  </>
                )}
                <dt className="text-gray-500">Forecast window</dt>
                <dd className="font-medium text-gray-900">{summary.forecast_days} days</dd>
                {summary.available_to_spend != null && (
                  <>
                    <dt className="text-gray-500">Safe to spend</dt>
                    <dd className="font-medium tabular-nums">
                      {formatCurrency(summary.available_to_spend)}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}

          {data?.eligible && actions.length > 0 && (
            <section className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden />
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Suggested actions
                </h3>
              </div>
              <div className="space-y-2">
                {actions.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    accounts={accounts}
                    onApplyTransfer={onApplyTransfer}
                  />
                ))}
              </div>
            </section>
          )}

          {data?.eligible && actions.length === 0 && !isLoading && (
            <p className="text-sm text-gray-600">
              No automated fixes found. Review upcoming transactions on the calendar or move
              money manually.
            </p>
          )}
        </div>

        <footer className="border-t border-gray-200 px-4 py-3 flex flex-wrap gap-2 shrink-0 bg-gray-50/80">
          <Link
            to={`/timeline?account=${accountId}`}
            className="inline-flex rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Open calendar
          </Link>
          <button
            type="button"
            onClick={handleSnooze}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1"
          >
            Snooze
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-xs font-medium text-gray-500 hover:text-gray-900 px-2 py-1"
          >
            Dismiss
          </button>
        </footer>
      </div>
    </div>
  );
}
