import type { DashboardRecommendation } from "@budget-app/shared";
import {
  compareRecommendationsByPriority,
  isSurvivalModeRecommendation,
  sanitizeRecommendationCopy,
  type RecommendationListEntry,
} from "./recommendationDisplay";
import { normalizeSeverity, severityLabel, type SeverityLevel } from "./severity";

export const ACTION_URGENCY_GROUPS = ["critical", "at_risk", "watch"] as const;

export type ActionUrgencyGroup = (typeof ACTION_URGENCY_GROUPS)[number];

export type ActionCenterGroup = {
  key: ActionUrgencyGroup;
  label: string;
  count: number;
  entries: RecommendationListEntry[];
};

export type ActionCenterSummary = {
  total: number;
  critical: number;
  atRisk: number;
  watch: number;
};

export type ActionCenterView = {
  survival: RecommendationListEntry | null;
  groups: ActionCenterGroup[];
  inactive: RecommendationListEntry[];
  summary: ActionCenterSummary;
  summaryText: string;
};

export function recommendationStrategyKey(rec: DashboardRecommendation): string {
  const type = rec.type || "";
  if (isSurvivalModeRecommendation(rec)) return "survival_mode";
  if (type === "debt_payoff") return "debt_payoff:household";
  return rec.id;
}

function copyHasApr(text: string): boolean {
  return /\bAPR\b/i.test(text);
}

function copyHasInterestSavings(text: string): boolean {
  return /versus minimum|vs minimum/i.test(text);
}

function mergeOverlappingEntries(
  base: RecommendationListEntry,
  extra: RecommendationListEntry
): RecommendationListEntry {
  const rec = { ...base.rec };
  const extraWhy = sanitizeRecommendationCopy(extra.rec.why);
  const extraAction = sanitizeRecommendationCopy(
    extra.rec.projected_improvement || extra.rec.recommended_action
  );
  const baseWhy = sanitizeRecommendationCopy(rec.why);
  const baseImp = sanitizeRecommendationCopy(rec.projected_improvement);

  if (copyHasApr(extraWhy) && !copyHasApr(baseWhy)) {
    rec.why = extraWhy;
  }
  if (extraAction && copyHasInterestSavings(extraAction) && !copyHasInterestSavings(baseImp)) {
    rec.projected_improvement = extraAction;
    rec.recommended_action = extraAction;
  }
  if (
    rec.title.toLowerCase().includes("debt payoff opportunity") &&
    extra.rec.title.toLowerCase().startsWith("prioritize")
  ) {
    rec.title = extra.rec.title;
  }
  const extraScore = extra.rec.priority_score ?? 0;
  const baseScore = rec.priority_score ?? 0;
  if (extraScore > baseScore) rec.priority_score = extraScore;
  if (rec.account_id == null && extra.rec.account_id != null) {
    rec.account_id = extra.rec.account_id;
  }
  const stateOrder = { active: 0, snoozed: 1, dismissed: 2 };
  const displayState =
    stateOrder[extra.displayState] < stateOrder[base.displayState]
      ? extra.displayState
      : base.displayState;
  return { rec, displayState };
}

/** Semantic consolidation — never title-based. Independent types/accounts stay separate. */
export function consolidateRecommendationEntries(
  entries: RecommendationListEntry[]
): RecommendationListEntry[] {
  const merged = new Map<string, RecommendationListEntry>();
  const order: string[] = [];
  for (const entry of entries) {
    const key = recommendationStrategyKey(entry.rec);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { rec: { ...entry.rec }, displayState: entry.displayState });
      order.push(key);
      continue;
    }
    const extraScore = entry.rec.priority_score ?? 0;
    const existingScore = existing.rec.priority_score ?? 0;
    if (extraScore > existingScore) {
      merged.set(key, mergeOverlappingEntries(entry, existing));
    } else {
      merged.set(key, mergeOverlappingEntries(existing, entry));
    }
  }
  return order.map((key) => merged.get(key)!);
}

function urgencyGroup(rec: DashboardRecommendation): ActionUrgencyGroup | null {
  const level = normalizeSeverity(rec.severity);
  if (level === "healthy") return null;
  return level;
}

export function actionCenterSummaryText(summary: ActionCenterSummary): string {
  const parts = [`${summary.total} action${summary.total === 1 ? "" : "s"}`];
  if (summary.critical > 0) parts.push(`${summary.critical} critical`);
  if (summary.atRisk > 0) parts.push(`${summary.atRisk} at risk`);
  if (summary.watch > 0) parts.push(`${summary.watch} watch`);
  return parts.join(" · ");
}

function normalizedText(value: string): string {
  return sanitizeRecommendationCopy(value).toLowerCase().replace(/[.$]/g, "");
}

function isRedundantCopy(candidate: string, ...others: string[]): boolean {
  const needle = normalizedText(candidate);
  if (!needle) return true;
  return others.some((other) => {
    const hay = normalizedText(other);
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

export function recommendationCardCopy(rec: DashboardRecommendation): {
  condition: string;
  action: string | null;
} {
  const condition = sanitizeRecommendationCopy(rec.why);
  const actionCandidates = [
    sanitizeRecommendationCopy(rec.recommended_action),
    sanitizeRecommendationCopy(rec.projected_improvement),
  ].filter(Boolean);
  const action =
    actionCandidates.find((line) => !isRedundantCopy(line, rec.title, condition)) ?? null;
  return { condition, action };
}

export function buildActionCenterView(entries: RecommendationListEntry[]): ActionCenterView {
  const consolidated = consolidateRecommendationEntries(entries).sort((a, b) => {
    const stateOrder = { active: 0, snoozed: 1, dismissed: 2 };
    const stateDiff = stateOrder[a.displayState] - stateOrder[b.displayState];
    if (stateDiff !== 0) return stateDiff;
    return compareRecommendationsByPriority(a.rec, b.rec);
  });

  const survival =
    consolidated.find((entry) => isSurvivalModeRecommendation(entry.rec)) ?? null;

  const actionEntries = consolidated.filter((entry) => !isSurvivalModeRecommendation(entry.rec));
  const activeActions = actionEntries.filter((entry) => entry.displayState === "active");
  const inactive = actionEntries.filter((entry) => entry.displayState !== "active");

  const grouped = new Map<ActionUrgencyGroup, RecommendationListEntry[]>();
  for (const key of ACTION_URGENCY_GROUPS) grouped.set(key, []);
  for (const entry of activeActions) {
    const key = urgencyGroup(entry.rec);
    if (!key) continue;
    grouped.get(key)!.push(entry);
  }

  const groups: ActionCenterGroup[] = ACTION_URGENCY_GROUPS.flatMap((key) => {
    const groupEntries = grouped.get(key) ?? [];
    if (groupEntries.length === 0) return [];
    return [
      {
        key,
        label: severityLabel(key as SeverityLevel).toUpperCase(),
        count: groupEntries.length,
        entries: groupEntries,
      },
    ];
  });

  const summary: ActionCenterSummary = {
    total: activeActions.length,
    critical: grouped.get("critical")?.length ?? 0,
    atRisk: grouped.get("at_risk")?.length ?? 0,
    watch: grouped.get("watch")?.length ?? 0,
  };

  return {
    survival,
    groups,
    inactive,
    summary,
    summaryText: actionCenterSummaryText(summary),
  };
}
