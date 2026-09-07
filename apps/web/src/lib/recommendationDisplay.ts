/**
 * Web Action Center — display helpers. Snooze/dismiss state lives on the backend.
 * Pure recommendation logic lives in @budget-app/shared.
 */
import type { DashboardRecommendation } from "@budget-app/shared";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";
import {
  recommendationTransferPreset as buildTransferPreset,
  type RecommendationListEntry,
} from "@budget-app/shared";
import { severityTokens } from "./severity";

export {
  ACTION_CENTER_PAGE_TITLE,
  ACTION_CENTER_PATH,
  OPEN_PAYOFF_PLANNER_LABEL,
  RECOMMENDATION_LIMIT,
  actionCenterLinkLabel,
  compareRecommendationsByPriority,
  insightToRecommendation,
  isHealthyRecommendationSeverity,
  isSurvivalModeId,
  isSurvivalModeRecommendation,
  recommendationActionLabel,
  recommendationImpactLine,
  recommendationOpensTransfer,
  recommendationPayoffPlannerUrl,
  recommendationPreferenceSets,
  recommendationPrimaryCtaLabel,
  recommendationSecondaryCtaLabel,
  recommendationTransferAccounts,
  recommendationTransferAmount,
  recommendationsEmptyMessage,
  recommendationsForActionCenter,
  recommendationsForDisplay,
  sanitizeRecommendationCopy,
  type RecommendationDisplayState,
  type RecommendationListEntry,
} from "@budget-app/shared";

export function recommendationSeverityLabel(severity: string): string {
  return severityTokens(severity).label;
}

export function recommendationSeverityClass(severity: string): string {
  return severityTokens(severity).cardClass;
}

export function recommendationSeverityBadgeClass(severity: string): string {
  return severityTokens(severity).badgeClass;
}

/** Opens QuickTransactionModal on the dashboard (from API move_money recommendations). */
export function recommendationTransferPreset(
  rec: DashboardRecommendation
): QuickTransactionPreset | null {
  const preset = buildTransferPreset(rec);
  if (!preset) return null;
  return {
    accountId: preset.accountId,
    mode: "transfer",
    transferToAccountId: preset.transferToAccountId,
    transferFromAccountId: preset.transferFromAccountId,
    defaultAmount: preset.defaultAmount,
    defaultDate: preset.defaultDate,
  };
}

export type { RecommendationListEntry as WebRecommendationListEntry };
