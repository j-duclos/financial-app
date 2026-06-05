import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { DashboardRecommendation, DashboardSummary } from "@budget-app/shared";
import {
  dismissRecommendation,
  loadDismissedRecommendationIds,
  loadSnoozedRecommendationIds,
  OPEN_PAYOFF_PLANNER_LABEL,
  recommendationActionLabel,
  recommendationImpactLine,
  recommendationOpensTransfer,
  recommendationPayoffPlannerUrl,
  recommendationSeverityClass,
  recommendationsEmptyMessage,
  recommendationsForDisplay,
  snoozeRecommendation,
} from "../../lib/recommendationDisplay";
import { attentionLedgerState } from "../../lib/attentionCardDisplay";
import SeverityBadge from "../shared/SeverityBadge";
import { recommendationShowsResolveRisk } from "../../lib/resolveRiskDisplay";

function accountIdFromRecommendation(rec: DashboardRecommendation): number | null {
  const m = rec.id.match(/^attention-(\d+)$/);
  if (m) return Number(m[1]);
  const url = rec.primary_action_url || rec.secondary_action_url || "";
  const um = url.match(/account=(\d+)/);
  return um ? Number(um[1]) : null;
}

function RecommendationDetailBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 leading-none mb-0.5">
        {label}
      </p>
      <div className="text-sm text-gray-800 leading-snug">{children}</div>
    </div>
  );
}

function RecommendationCard({
  rec,
  onExecuteTransfer,
  onResolveRisk,
  onDismiss,
  onSnooze,
}: {
  rec: DashboardRecommendation;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  const impact = recommendationImpactLine(rec);
  const plannerUrl = recommendationPayoffPlannerUrl(rec);
  const primaryUrl = rec.primary_action_url ?? "/transactions";
  const accountId = accountIdFromRecommendation(rec);
  const navState = accountId ? attentionLedgerState(accountId) : undefined;
  const opensTransferModal = recommendationOpensTransfer(rec);

  const primaryButtonClass =
    "inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm";
  const secondaryButtonClass =
    "inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50";

  return (
    <article
      className={`flex h-full min-h-0 flex-col rounded-lg border p-2.5 sm:p-3 ${recommendationSeverityClass(rec.severity)}`}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900">
          {rec.title}
        </h3>
        <SeverityBadge severity={rec.severity} compact />
      </header>

      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <RecommendationDetailBlock label="Why">
          <p className="text-gray-700">{rec.why}</p>
        </RecommendationDetailBlock>
        {rec.recommended_action && (
          <RecommendationDetailBlock label="What">
            <p className="font-medium text-gray-900">{rec.recommended_action}</p>
          </RecommendationDetailBlock>
        )}
        {impact && (
          <RecommendationDetailBlock label="Impact">
            <p>{impact}</p>
          </RecommendationDetailBlock>
        )}
      </div>

      <footer className="mt-2.5 flex flex-col gap-2 border-t border-black/5 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {recommendationShowsResolveRisk(rec) && onResolveRisk && rec.account_id != null && (
            <button
              type="button"
              onClick={onResolveRisk}
              className={primaryButtonClass}
            >
              Resolve risk
            </button>
          )}
          {rec.primary_action_label && (rec.primary_action_url || opensTransferModal) ? (
            opensTransferModal && onExecuteTransfer ? (
              <button
                type="button"
                onClick={() => onExecuteTransfer(rec)}
                className={primaryButtonClass}
              >
                {recommendationActionLabel(rec.primary_action_label, rec.primary_action_url) ??
                  "Execute transfer"}
              </button>
            ) : (
              <Link
                to={
                  rec.primary_action_url!.includes("/transactions")
                    ? "/transactions"
                    : rec.primary_action_url!
                }
                state={navState}
                className={primaryButtonClass}
              >
                {recommendationActionLabel(rec.primary_action_label, rec.primary_action_url)}
              </Link>
            )
          ) : (
            <Link
              to={primaryUrl.includes("/transactions") ? "/transactions" : primaryUrl}
              state={navState}
              className={secondaryButtonClass}
            >
              Open ledger
            </Link>
          )}
          {rec.secondary_action_label &&
            rec.secondary_action_url &&
            rec.secondary_action_type !== "move_money" && (
              <Link to={rec.secondary_action_url} className={primaryButtonClass}>
                {recommendationActionLabel(rec.secondary_action_label)}
              </Link>
            )}
          {plannerUrl && (
            <Link to={plannerUrl} className={secondaryButtonClass}>
              {OPEN_PAYOFF_PLANNER_LABEL}
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-xs text-gray-600">
          <button
            type="button"
            onClick={onSnooze}
            className="rounded px-2 py-1 font-medium hover:bg-black/5 hover:text-gray-900"
          >
            Snooze
          </button>
          <span className="text-gray-300" aria-hidden>
            ·
          </span>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded px-2 py-1 font-medium hover:bg-black/5 hover:text-gray-900"
          >
            Dismiss
          </button>
        </div>
      </footer>
    </article>
  );
}

export default function RecommendationsSection({
  summary,
  onExecuteTransfer,
  onResolveRisk,
}: {
  summary: DashboardSummary;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: (accountId: number) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const items = useMemo(() => {
    void refresh;
    const dismissed = loadDismissedRecommendationIds();
    const snoozed = loadSnoozedRecommendationIds();
    return recommendationsForDisplay(
      summary.recommendations,
      summary.insights,
      dismissed,
      snoozed
    );
  }, [summary.recommendations, summary.insights, refresh]);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-600">
        {recommendationsEmptyMessage()}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3">
      {items.map((rec) => (
        <RecommendationCard
          key={rec.id}
          rec={rec}
          onExecuteTransfer={onExecuteTransfer}
          onResolveRisk={
            onResolveRisk && rec.account_id != null
              ? () => onResolveRisk(rec.account_id!)
              : undefined
          }
          onDismiss={() => {
            dismissRecommendation(rec.id);
            setRefresh((n) => n + 1);
          }}
          onSnooze={() => {
            snoozeRecommendation(rec.id);
            setRefresh((n) => n + 1);
          }}
        />
      ))}
    </div>
  );
}
