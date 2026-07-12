import { Link } from "react-router-dom";
import type { DashboardAttentionItem } from "@budget-app/shared";
import {
  ATTENTION_MAX_CARDS,
  ATTENTION_VIEW_ALL_PATH,
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionCardsForDisplay,
  attentionEmptyMessage,
  attentionIssueIcon,
  attentionLedgerPath,
  attentionLedgerState,
  attentionPaymentPlannerPath,
  attentionSecondaryPath,
  PAYMENT_PLANNER_LABEL,
  attentionDateLine,
  attentionImpactLine,
  attentionPrimaryIssue,
  attentionPrimaryLabel,
  attentionSecondaryLabel,
  attentionSecondaryOpensTransferModal,
  attentionSeverityStyles,
  attentionShowsActionLine,
  attentionShowsDedicatedPaymentPlanner,
  attentionShowsSecondaryAction,
  attentionShowsViewAllLink,
} from "../../lib/attentionCardDisplay";
import SeverityBadge from "../shared/SeverityBadge";

interface AttentionCardProps {
  item: DashboardAttentionItem;
  onMoveMoney?: (item: DashboardAttentionItem) => void;
}

export default function AttentionCard({ item, onMoveMoney }: AttentionCardProps) {
  const showSecondary = attentionShowsSecondaryAction(item);
  const styles = attentionSeverityStyles(item.status);
  const primaryIssue = attentionPrimaryIssue(item);
  const actionLine = attentionShowsActionLine(item) ? attentionActionLine(item) : null;
  const impactLine = attentionImpactLine(item);
  const dateLine = attentionDateLine(item);
  const IssueIcon = attentionIssueIcon(item);

  return (
    <article
      className={`rounded-lg border border-gray-200 p-3 flex flex-col gap-2 min-h-[10rem] ${styles.card}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Link
            to={item.url}
            className="font-semibold text-gray-900 hover:text-blue-600 truncate block"
          >
            {item.account_name}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
              {attentionAccountTypeLabel(item)}
            </span>
          </div>
        </div>
        <SeverityBadge severity={item.status} compact />
      </div>

      {primaryIssue && (
        <div className="flex items-start gap-1.5 text-sm text-gray-800">
          <IssueIcon className="h-4 w-4 shrink-0 text-gray-400 mt-0.5" aria-hidden />
          <p className="min-w-0 leading-snug">{primaryIssue}</p>
        </div>
      )}

      {(impactLine || dateLine) && (
        <p className="text-xs text-gray-600 pl-5">
          {[impactLine, dateLine].filter(Boolean).join(" · ")}
        </p>
      )}

      {actionLine && (
        <p className="text-sm font-medium text-gray-900 pl-5">{actionLine}</p>
      )}

      <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
        <Link
          to={attentionLedgerPath(item.account_id)}
          state={attentionLedgerState(item.account_id)}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
          {attentionPrimaryLabel(item)}
        </Link>
        {showSecondary && item.secondary_action && (
          attentionSecondaryOpensTransferModal(item) ? (
            <button
              type="button"
              onClick={() => onMoveMoney?.(item)}
              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {attentionSecondaryLabel(item)}
            </button>
          ) : (
            <Link
              to={attentionSecondaryPath(item)}
              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              {attentionSecondaryLabel(item)}
            </Link>
          )
        )}
        {attentionShowsDedicatedPaymentPlanner(item) && (
          <Link
            to={attentionPaymentPlannerPath(item.account_id)}
            className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
          >
            {PAYMENT_PLANNER_LABEL}
          </Link>
        )}
      </div>
    </article>
  );
}

export function AttentionCardGrid({
  items,
  windowDays,
  totalCount,
  onMoveMoney,
}: {
  items: DashboardAttentionItem[];
  windowDays: number;
  totalCount: number;
  onMoveMoney?: (item: DashboardAttentionItem) => void;
}) {
  const cards = attentionCardsForDisplay(items, ATTENTION_MAX_CARDS);

  if (cards.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-3 text-sm text-gray-600">
        {attentionEmptyMessage(windowDays)}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((item) => (
          <AttentionCard
            key={item.account_id}
            item={item}
            onMoveMoney={onMoveMoney}
          />
        ))}
      </div>
      {attentionShowsViewAllLink(cards.length, totalCount) && (
        <div className="flex justify-end">
          <Link to={ATTENTION_VIEW_ALL_PATH} className="text-sm text-blue-600 hover:underline">
            View all accounts needing attention
          </Link>
        </div>
      )}
    </div>
  );
}
