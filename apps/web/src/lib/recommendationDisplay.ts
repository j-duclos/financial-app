import type { DashboardInsight, DashboardRecommendation } from "@budget-app/shared";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";
import { normalizeSeverity, severityShowsAlert, severityTokens } from "./severity";

const DISMISS_STORAGE_KEY = "budget-app.dashboard.dismissedRecommendations";
const SNOOZE_STORAGE_KEY = "budget-app.dashboard.snoozedRecommendations";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const RECOMMENDATION_LIMIT = 5;

import { normalizePaymentActionLabel, PAYMENT_PLANNER_LABEL } from "./paymentPlannerDisplay";
import { SPENDING_GOALS_PATH, VIEW_SPENDING_LIMITS_LABEL } from "./spendingTargetDisplay";

/** Consistent CTA copy for credit-card payment planner navigation. */
export const OPEN_PAYOFF_PLANNER_LABEL = PAYMENT_PLANNER_LABEL;

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
  const map = readMap(DISMISS_STORAGE_KEY);
  map[id] = Date.now();
  writeMap(DISMISS_STORAGE_KEY, map);
}

export function snoozeRecommendation(id: string): void {
  const map = readMap(SNOOZE_STORAGE_KEY);
  map[id] = Date.now() + SNOOZE_MS;
  writeMap(SNOOZE_STORAGE_KEY, map);
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

export function recommendationsForDisplay(
  recommendations: DashboardRecommendation[] | undefined,
  insights: DashboardInsight[] | undefined,
  dismissed: Set<string>,
  snoozed: Set<string>
): DashboardRecommendation[] {
  const source =
    recommendations && recommendations.length > 0
      ? recommendations
      : insights?.map(insightToRecommendation) ?? [];
  return source
    .filter((r) => !dismissed.has(r.id) && !snoozed.has(r.id))
    .filter((r) => !isHealthyRecommendationSeverity(r.severity))
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, RECOMMENDATION_LIMIT);
}

/** Stable / positive cards are not shown in the recommendations grid. */
export function isHealthyRecommendationSeverity(severity: string | undefined): boolean {
  return !severityShowsAlert(normalizeSeverity(severity));
}

export function insightToRecommendation(insight: DashboardInsight): DashboardRecommendation {
  return {
    id: insight.id,
    severity: insight.severity,
    title: insight.title,
    why: insight.message,
    recommended_action: insight.action_label,
    impact_label: insight.metric_label,
    impact_value: insight.metric_value,
    primary_action_label: insight.action_label,
    primary_action_url: insight.action_url,
    primary_action_type: "navigate",
    secondary_action_label: insight.secondary_action_label,
    secondary_action_url: insight.secondary_action_url,
    secondary_action_type: "navigate",
  };
}

export function recommendationImpactLine(rec: DashboardRecommendation): string | null {
  if (rec.projected_improvement) {
    return rec.projected_improvement;
  }
  if (!rec.impact_label || !rec.impact_value) return null;
  const label = rec.impact_label.toLowerCase();
  if (label.includes("amount") || label.includes("shortfall") || label.includes("net")) {
    return `${rec.impact_label}: $${rec.impact_value.replace(/^\$/, "")}`;
  }
  return `${rec.impact_label}: ${rec.impact_value}`;
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

export function recommendationsEmptyMessage(): string {
  return "No active recommendations — your forecast looks stable.";
}

export function recommendationOpensTransfer(rec: DashboardRecommendation): boolean {
  return rec.secondary_action_type === "move_money" || rec.primary_action_type === "move_money";
}

export function recommendationTransferAccounts(rec: DashboardRecommendation): {
  fromId: number | null;
  toId: number | null;
} {
  if (rec.account_id != null && rec.related_account_id != null) {
    return { fromId: rec.related_account_id, toId: rec.account_id };
  }
  const url = rec.primary_action_url ?? "";
  const from = url.match(/[?&]from=(\d+)/);
  const to = url.match(/[?&]to=(\d+)/);
  return {
    fromId: from ? Number(from[1]) : null,
    toId: to ? Number(to[1]) : null,
  };
}

export function recommendationTransferAmount(rec: DashboardRecommendation): string | undefined {
  const raw = rec.recommended_amount ?? rec.impact_value;
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d.]/g, "");
  return cleaned || undefined;
}

/** Opens QuickTransactionModal on the dashboard (from API move_money recommendations). */
export function recommendationTransferPreset(rec: DashboardRecommendation): QuickTransactionPreset | null {
  const { fromId, toId } = recommendationTransferAccounts(rec);
  if (toId == null) return null;
  return {
    accountId: toId,
    mode: "transfer",
    transferToAccountId: toId,
    transferFromAccountId: fromId ?? undefined,
    defaultAmount: recommendationTransferAmount(rec),
  };
}

/** User-facing label for recommendation CTAs (nav says Calendar; route stays /timeline). */
export function recommendationActionLabel(
  label: string | null | undefined,
  actionUrl?: string | null
): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  if (actionUrl?.includes(SPENDING_GOALS_PATH)) {
    if (/^(view goals|spending goals|view spending goals|spending limits|view spending limits)$/i.test(trimmed)) {
      return VIEW_SPENDING_LIMITS_LABEL;
    }
  }
  if (/^timeline$/i.test(trimmed)) return "Open calendar";
  if (/^open timeline$/i.test(trimmed)) return "Open calendar";
  if (/^view timeline$/i.test(trimmed)) return "Open calendar";
  if (/^calendar$/i.test(trimmed)) return "Open calendar";
  if (/^view calendar$/i.test(trimmed)) return "Open calendar";
  if (/^(debt payoff|payment planner|payoff planner|open payoff planner|make payment)$/i.test(trimmed)) {
    return PAYMENT_PLANNER_LABEL;
  }
  return normalizePaymentActionLabel(label);
}

/** Extra planner button only when primary/secondary do not already link to the planner. */
export function recommendationPayoffPlannerUrl(rec: DashboardRecommendation): string | null {
  const primary = rec.primary_action_url ?? "";
  const secondary = rec.secondary_action_url ?? "";
  if (primary.includes("/credit-cards") || secondary.includes("/credit-cards")) {
    return null;
  }
  const url = secondary || primary;
  const m = url.match(/account=(\d+)/);
  if (m && (rec.title.toLowerCase().includes("credit") || rec.why.toLowerCase().includes("utilization"))) {
    return `/credit-cards?account=${m[1]}`;
  }
  return null;
}
