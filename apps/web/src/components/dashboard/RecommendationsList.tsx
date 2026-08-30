import { Link } from "react-router-dom";
import type { DashboardRecommendation } from "@budget-app/shared";
import {
  OPEN_PAYOFF_PLANNER_LABEL,
  recommendationDisplayAccountName,
  recommendationOpensTransfer,
  recommendationPayoffPlannerUrl,
  recommendationPrimaryCtaLabel,
  recommendationSecondaryCtaLabel,
  recommendationSeverityClass,
  recommendationWebPrimaryLabel,
  recommendationWebPrimaryTarget,
  type RecommendationDisplayState,
  type RecommendationListEntry,
} from "@budget-app/shared";
import {
  recommendationCardCopy,
  type ActionCenterGroup,
} from "../../lib/actionCenterView";
import { recommendationShowsResolveRisk } from "../../lib/resolveRiskDisplay";
import { severityTokens } from "../../lib/severity";
import SeverityBadge from "../shared/SeverityBadge";

function stateBadgeLabel(state: RecommendationDisplayState): string | null {
  if (state === "snoozed") return "Snoozed";
  if (state === "dismissed") return "Dismissed";
  return null;
}

const primaryButtonClass =
  "inline-flex items-center justify-center min-h-8 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm";
const secondaryButtonClass =
  "inline-flex items-center justify-center min-h-8 rounded-md px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 hover:underline";

export function SurvivalModeBanner({
  entry,
}: {
  entry: RecommendationListEntry;
}) {
  const { rec } = entry;
  const tokens = severityTokens("critical");
  const { condition, action } = recommendationCardCopy(rec);
  const body = action && action !== condition ? `${condition} ${action}`.trim() : condition;
  const href = rec.primary_action_url || "/credit-cards?mode=survival";

  return (
    <aside
      className={`flex flex-col gap-2 rounded-lg px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${tokens.cardClass}`}
      aria-label="Survival mode recommended"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{rec.title}</p>
        <p className="mt-0.5 text-sm leading-snug text-gray-800">{body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link to={href} className={primaryButtonClass}>
          {recommendationPrimaryCtaLabel(rec)}
        </Link>
      </div>
    </aside>
  );
}

export function RecommendationCard({
  rec,
  displayState = "active",
  onExecuteTransfer,
  onResolveRisk,
  onDismiss,
  onSnooze,
  onRestore,
  onUnsnooze,
}: {
  rec: DashboardRecommendation;
  displayState?: RecommendationDisplayState;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: () => void;
  onDismiss?: () => void;
  onSnooze?: () => void;
  onRestore?: () => void;
  onUnsnooze?: () => void;
}) {
  const { condition, action } = recommendationCardCopy(rec);
  const plannerUrl = recommendationPayoffPlannerUrl(rec);
  const primaryTarget = recommendationWebPrimaryTarget(rec);
  const opensTransferModal = recommendationOpensTransfer(rec);
  const inactive = displayState !== "active";
  const showResolveRisk =
    recommendationShowsResolveRisk(rec) && onResolveRisk && rec.account_id != null && !opensTransferModal;
  const stateLabel = stateBadgeLabel(displayState);
  const primaryLabel = recommendationWebPrimaryLabel(rec);
  const contextLine = recommendationDisplayAccountName(rec);
  const secondaryLabel = rec.secondary_action_label
    ? recommendationSecondaryCtaLabel(rec)
    : null;

  return (
    <article
      className={`flex h-full min-h-0 flex-col rounded-lg border p-2.5 sm:p-3 ${recommendationSeverityClass(rec.severity)} ${
        inactive ? "opacity-75" : ""
      }`}
    >
      <header className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-gray-900">
          {rec.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {stateLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
              {stateLabel}
            </span>
          )}
          <SeverityBadge severity={rec.severity} compact />
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-1.5 min-w-0">
        {contextLine ? (
          <p className="text-xs font-medium text-gray-500">{contextLine}</p>
        ) : null}
        {condition && <p className="text-sm leading-snug text-gray-700">{condition}</p>}
        {action && <p className="text-sm leading-snug font-medium text-gray-900">{action}</p>}
      </div>

      <footer className="mt-2.5 flex flex-col gap-2 border-t border-black/5 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {!inactive ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {showResolveRisk && (
                <button type="button" onClick={onResolveRisk} className={primaryButtonClass}>
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
                    {primaryLabel}
                  </button>
                ) : (
                  <Link
                    to={primaryTarget.to}
                    state={primaryTarget.state}
                    className={primaryButtonClass}
                  >
                    {primaryLabel}
                  </Link>
                )
              ) : (
                <Link
                  to={primaryTarget.to}
                  state={primaryTarget.state}
                  className={secondaryButtonClass}
                >
                  {primaryLabel}
                </Link>
              )}
              {secondaryLabel &&
                rec.secondary_action_url &&
                rec.secondary_action_type !== "move_money" && (
                  <Link to={rec.secondary_action_url} className={secondaryButtonClass}>
                    {secondaryLabel}
                  </Link>
                )}
              {plannerUrl && (
                <Link to={plannerUrl} className={secondaryButtonClass}>
                  {OPEN_PAYOFF_PLANNER_LABEL}
                </Link>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 text-xs text-gray-600">
              {onSnooze && (
                <>
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
                </>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  className="rounded px-2 py-1 font-medium hover:bg-black/5 hover:text-gray-900"
                >
                  Dismiss
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex shrink-0 items-center gap-2 text-xs">
            {displayState === "snoozed" && onUnsnooze && (
              <button
                type="button"
                onClick={onUnsnooze}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-800 hover:bg-gray-50"
              >
                Unsnooze
              </button>
            )}
            {displayState === "dismissed" && onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-800 hover:bg-gray-50"
              >
                Restore
              </button>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}

function RecommendationGrid({
  entries,
  onExecuteTransfer,
  onResolveRisk,
  onDismiss,
  onSnooze,
  onRestore,
  onUnsnooze,
}: {
  entries: RecommendationListEntry[];
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: (accountId: number) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onRestore?: (id: string) => void;
  onUnsnooze?: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-3">
      {entries.map(({ rec, displayState }) => (
        <RecommendationCard
          key={rec.id}
          rec={rec}
          displayState={displayState}
          onExecuteTransfer={onExecuteTransfer}
          onResolveRisk={
            onResolveRisk && rec.account_id != null
              ? () => onResolveRisk(rec.account_id!)
              : undefined
          }
          onDismiss={onDismiss && displayState === "active" ? () => onDismiss(rec.id) : undefined}
          onSnooze={onSnooze && displayState === "active" ? () => onSnooze(rec.id) : undefined}
          onRestore={
            onRestore && displayState === "dismissed" ? () => onRestore(rec.id) : undefined
          }
          onUnsnooze={
            onUnsnooze && displayState === "snoozed" ? () => onUnsnooze(rec.id) : undefined
          }
        />
      ))}
    </div>
  );
}

type ListProps = {
  groups: ActionCenterGroup[];
  inactive?: RecommendationListEntry[];
  emptyMessage: string;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: (accountId: number) => void;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onRestore?: (id: string) => void;
  onUnsnooze?: (id: string) => void;
};

export default function RecommendationsList({
  groups,
  inactive = [],
  emptyMessage,
  onExecuteTransfer,
  onResolveRisk,
  onDismiss,
  onSnooze,
  onRestore,
  onUnsnooze,
}: ListProps) {
  if (groups.length === 0 && inactive.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-600">
        {emptyMessage}
      </div>
    );
  }

  const gridProps = {
    onExecuteTransfer,
    onResolveRisk,
    onDismiss,
    onSnooze,
    onRestore,
    onUnsnooze,
  };

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key} aria-label={`${group.label} · ${group.count}`}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            {group.label} · {group.count}
          </h2>
          <RecommendationGrid entries={group.entries} {...gridProps} />
        </section>
      ))}
      {inactive.length > 0 && (
        <section aria-label="Snoozed and dismissed">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Snoozed & dismissed · {inactive.length}
          </h2>
          <RecommendationGrid entries={inactive} {...gridProps} />
        </section>
      )}
    </div>
  );
}
