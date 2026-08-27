import type { DashboardInsight, DashboardRecommendation } from "./types";
import { normalizePaymentActionLabel, PAYMENT_PLANNER_LABEL } from "./paymentPlannerDisplay";
import { normalizeSeverity, severityLabel, severityRank, severityShowsAlert } from "./severity";

export const RECOMMENDATION_LIMIT = 5;

export const ACTION_CENTER_PATH = "/action-center";

export const ACTION_CENTER_PAGE_TITLE = "Action Center";

/** Web spending-goals path; mobile uses /spending-limits. */
export const SPENDING_GOALS_PATH = "/spending-goals";

export const VIEW_BUDGET_LABEL = "View budget";

export type RecommendationDisplayState = "active" | "snoozed" | "dismissed";

export type RecommendationListEntry = {
  rec: DashboardRecommendation;
  displayState: RecommendationDisplayState;
};

export type RecommendationTransferPreset = {
  accountId: number;
  mode: "transfer";
  transferToAccountId: number;
  transferFromAccountId?: number;
  defaultAmount?: string;
  defaultDate?: string;
};

export function isSurvivalModeId(id: string | null | undefined): boolean {
  return id === "survival-mode";
}

/** Consistent CTA copy for credit-card payment planner navigation. */
export const OPEN_PAYOFF_PLANNER_LABEL = PAYMENT_PLANNER_LABEL;

export function compareRecommendationsByPriority(
  a: DashboardRecommendation,
  b: DashboardRecommendation
): number {
  const rankDiff =
    severityRank(normalizeSeverity(a.severity)) - severityRank(normalizeSeverity(b.severity));
  if (rankDiff !== 0) return rankDiff;
  const scoreDiff = (b.priority_score ?? 0) - (a.priority_score ?? 0);
  if (scoreDiff !== 0) return scoreDiff;
  const dateA = a.recommended_date || "9999-12-31";
  const dateB = b.recommended_date || "9999-12-31";
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  return (a.id || "").localeCompare(b.id || "");
}

function recommendationSource(
  recommendations: DashboardRecommendation[] | undefined,
  insights: DashboardInsight[] | undefined
): DashboardRecommendation[] {
  return recommendations && recommendations.length > 0
    ? recommendations
    : insights?.map(insightToRecommendation) ?? [];
}

export function recommendationsForDisplay(
  recommendations: DashboardRecommendation[] | undefined,
  insights: DashboardInsight[] | undefined,
  dismissed: Set<string>,
  snoozed: Set<string>,
  limit: number = RECOMMENDATION_LIMIT
): DashboardRecommendation[] {
  return recommendationSource(recommendations, insights)
    .filter((r) => !dismissed.has(r.id) && !snoozed.has(r.id))
    .filter((r) => !isHealthyRecommendationSeverity(r.severity))
    .sort(compareRecommendationsByPriority)
    .slice(0, limit);
}

/** Full Action Center list — includes snoozed and dismissed entries with state labels. */
export function recommendationsForActionCenter(
  recommendations: DashboardRecommendation[] | undefined,
  insights: DashboardInsight[] | undefined,
  dismissed: Set<string>,
  snoozed: Set<string>
): RecommendationListEntry[] {
  return recommendationSource(recommendations, insights)
    .filter((r) => !isHealthyRecommendationSeverity(r.severity))
    .map((rec) => ({
      rec,
      displayState: isSurvivalModeRecommendation(rec)
        ? "active"
        : dismissed.has(rec.id)
          ? "dismissed"
          : snoozed.has(rec.id)
            ? "snoozed"
            : "active",
    }))
    .sort((a, b) => {
      const stateOrder = { active: 0, snoozed: 1, dismissed: 2 };
      const stateDiff = stateOrder[a.displayState] - stateOrder[b.displayState];
      if (stateDiff !== 0) return stateDiff;
      return compareRecommendationsByPriority(a.rec, b.rec);
    });
}

export function actionCenterLinkLabel(): string {
  return "View all actions";
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
  return severityLabel(normalizeSeverity(severity));
}

export function recommendationsEmptyMessage(): string {
  return "Nothing needs attention right now.\n\nYour current forecast and account targets are within the configured limits.";
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

export function recommendationTransferPreset(
  rec: DashboardRecommendation
): RecommendationTransferPreset | null {
  const { fromId, toId } = recommendationTransferAccounts(rec);
  if (toId == null) return null;
  return {
    accountId: toId,
    mode: "transfer",
    transferToAccountId: toId,
    transferFromAccountId: fromId ?? undefined,
    defaultAmount: recommendationTransferAmount(rec),
    defaultDate: rec.recommended_date ?? undefined,
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
    if (
      /^(view goals|spending goals|view spending goals|spending limits|view spending limits|view budget|budget)$/i.test(
        trimmed
      )
    ) {
      return VIEW_BUDGET_LABEL;
    }
  }
  if (/^timeline$/i.test(trimmed)) return "Open calendar";
  if (/^open timeline$/i.test(trimmed)) return "Open calendar";
  if (/^view timeline$/i.test(trimmed)) return "Open calendar";
  if (/^calendar$/i.test(trimmed)) return "Open calendar";
  if (/^view calendar$/i.test(trimmed)) return "Open calendar";
  if (/^view forecast$/i.test(trimmed)) return "View forecast";
  if (/^(debt payoff|payment planner|payoff planner|open payoff planner|make payment)$/i.test(trimmed)) {
    return PAYMENT_PLANNER_LABEL;
  }
  return normalizePaymentActionLabel(label);
}

const INTERNAL_COPY_RE = /\s*\([^)]*placeholder[^)]*\)\.?/gi;

export function sanitizeRecommendationCopy(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(INTERNAL_COPY_RE, "").replace(/\s+/g, " ").trim();
}

export function isSurvivalModeRecommendation(rec: DashboardRecommendation): boolean {
  return rec.type === "survival_mode" || isSurvivalModeId(rec.id);
}

export function recommendationPrimaryCtaLabel(rec: DashboardRecommendation): string {
  if (recommendationOpensTransfer(rec)) {
    const raw = rec.recommended_amount ?? rec.impact_value;
    if (raw) {
      const amount = String(raw).replace(/^\$/, "");
      return `Transfer $${amount}`;
    }
    return "Transfer";
  }
  return (
    recommendationActionLabel(rec.primary_action_label, rec.primary_action_url) ??
    rec.primary_action_label ??
    "Continue"
  );
}

export function recommendationSecondaryCtaLabel(
  rec: DashboardRecommendation,
  label?: string | null,
  url?: string | null
): string | null {
  const resolvedUrl = url ?? rec.secondary_action_url;
  const resolvedLabel = label ?? rec.secondary_action_label;
  if (recommendationOpensTransfer(rec) && resolvedUrl?.includes("/timeline")) {
    return "View forecast";
  }
  return recommendationActionLabel(resolvedLabel, resolvedUrl);
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

export function recommendationAccountId(rec: DashboardRecommendation): number | null {
  if (rec.account_id != null) return rec.account_id;
  const idMatch = rec.id.match(/^attention-(\d+)$/);
  if (idMatch) return Number(idMatch[1]);
  const url = rec.primary_action_url || rec.secondary_action_url || "";
  const um = url.match(/account=(\d+)/);
  return um ? Number(um[1]) : null;
}

export function recommendationShowsOpenLedger(rec: DashboardRecommendation): boolean {
  return recommendationAccountId(rec) != null;
}

/** Canonical open-ledger label when no primary CTA is provided. */
export const OPEN_LEDGER_LABEL = "Open ledger";

export function recommendationResolveRiskLabel(): string {
  return "Resolve risk";
}

/** Mobile parity label for cash shortfall transfer actions (dashboard attention uses Fix Shortfall). */
export const FIX_SHORTFALL_LABEL = "Fix Shortfall";

export function recommendationFixShortfallLabel(rec: DashboardRecommendation): string {
  if (recommendationOpensTransfer(rec)) {
    const amount = recommendationTransferAmount(rec);
    if (amount) return `Transfer $${amount}`;
    return FIX_SHORTFALL_LABEL;
  }
  return recommendationResolveRiskLabel();
}

export function recommendationUtilizationUsesConfiguredTarget(
  rec: DashboardRecommendation,
  userTargetPercent: number
): boolean {
  const blob = `${rec.why} ${rec.recommended_action ?? ""} ${rec.projected_improvement ?? ""}`;
  const targetStr = `${userTargetPercent}%`;
  if (!blob.includes(targetStr) && !blob.includes(`${userTargetPercent.toFixed(0)}%`)) {
    return false;
  }
  const hardcodedWrong = ["30%", "70%", "75%"].filter((t) => t !== targetStr);
  return !hardcodedWrong.some((t) => blob.includes(t));
}

export function formatRecommendationAmountLine(rec: DashboardRecommendation): string | null {
  if (rec.recommended_action) return sanitizeRecommendationCopy(rec.recommended_action);
  if (rec.projected_improvement) return sanitizeRecommendationCopy(rec.projected_improvement);
  const impact = recommendationImpactLine(rec);
  return impact ? sanitizeRecommendationCopy(impact) : null;
}
