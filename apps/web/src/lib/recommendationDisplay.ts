/**
 * Web Action Center — client-side snooze/dismiss storage and styling wrappers.
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

const DISMISS_STORAGE_KEY = "budget-app.dashboard.dismissedRecommendations";
const SNOOZE_STORAGE_KEY = "budget-app.dashboard.snoozedRecommendations";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, number>): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadDismissedRecommendationIds(): Set<string> {
  return new Set(Object.keys(readMap(DISMISS_STORAGE_KEY)));
}

export function dismissRecommendation(id: string): void {
  if (id === "survival-mode") return;
  const map = readMap(DISMISS_STORAGE_KEY);
  map[id] = Date.now();
  writeMap(DISMISS_STORAGE_KEY, map);
}

export function snoozeRecommendation(id: string): void {
  if (id === "survival-mode") return;
  const map = readMap(SNOOZE_STORAGE_KEY);
  map[id] = Date.now() + SNOOZE_MS;
  writeMap(SNOOZE_STORAGE_KEY, map);
}

export function unsnoozeRecommendation(id: string): void {
  const map = readMap(SNOOZE_STORAGE_KEY);
  delete map[id];
  writeMap(SNOOZE_STORAGE_KEY, map);
}

export function restoreRecommendation(id: string): void {
  const map = readMap(DISMISS_STORAGE_KEY);
  delete map[id];
  writeMap(DISMISS_STORAGE_KEY, map);
}

export function loadSnoozedRecommendationIds(now = Date.now()): Set<string> {
  const map = readMap(SNOOZE_STORAGE_KEY);
  const active = new Set<string>();
  const pruned: Record<string, number> = {};
  for (const [id, until] of Object.entries(map)) {
    if (until > now) {
      active.add(id);
      pruned[id] = until;
    }
  }
  writeMap(SNOOZE_STORAGE_KEY, pruned);
  return active;
}

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
