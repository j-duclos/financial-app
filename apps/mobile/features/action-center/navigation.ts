import type { DashboardRecommendation, RecommendationTransferPreset } from "@budget-app/shared";
import {
  OPEN_LEDGER_LABEL,
  PAYMENT_PLANNER_LABEL,
  recommendationAccountId,
  recommendationIsDebtPayoff,
  recommendationIsUtilizationHealth,
  recommendationLedgerFocus,
  recommendationOpensTransfer,
  recommendationPayoffPlannerUrl,
  recommendationPrimaryCtaLabel,
  recommendationPrimaryDestinationKind,
  recommendationSecondaryCtaLabel,
  recommendationShowsResolveRisk,
  recommendationTransferActionLabel,
  recommendationTransferPreset,
} from "@budget-app/shared";
import { calendarDatePath, paymentPlannerAccountPath } from "@/features/dashboard/navigation";
import { goalDetailPath } from "@/features/goals/navigation";
import {
  transactionsForAccountPath,
  transactionsForForecastRiskPath,
} from "@/features/payment-planner/navigation";

export type RecommendationActionKind =
  | "open_ledger"
  | "payment_planner"
  | "transfer"
  | "resolve_risk"
  | "navigate"
  | "view_account"
  | "snooze"
  | "dismiss";

export type RecommendationAction = {
  kind: RecommendationActionKind;
  label: string;
  accountId?: number;
  transferPreset?: RecommendationTransferPreset;
  href?:
    | string
    | {
        pathname: string;
        params?: Record<string, string>;
      };
};

export function accountDetailPath(accountId: number): `/account/${number}` {
  return `/account/${accountId}`;
}

export function resolveRecommendationWebUrl(
  url: string,
  rec: DashboardRecommendation
):
  | string
  | {
      pathname: string;
      params?: Record<string, string>;
    }
  | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/recurring")) return "/recurring";
  if (trimmed.startsWith("/spending-goals") || trimmed.startsWith("/budget")) {
    return "/spending-limits";
  }

  const goalMatch = trimmed.match(/^\/goals\/(\d+)/);
  if (goalMatch) return goalDetailPath(Number(goalMatch[1]));
  if (rec.goal_id != null && rec.goal_id > 0 && trimmed.startsWith("/goals")) {
    return goalDetailPath(rec.goal_id);
  }

  if (trimmed.startsWith("/timeline")) {
    const dateMatch = trimmed.match(/[?&]date=([^&]+)/);
    if (dateMatch?.[1]) {
      return calendarDatePath(decodeURIComponent(dateMatch[1]));
    }
    return "/(app)/(tabs)/calendar";
  }

  const kind = recommendationPrimaryDestinationKind(rec);
  const accountId = recommendationAccountId(rec);
  const focus = recommendationLedgerFocus(rec);

  if (kind === "view_account" && accountId != null) {
    return accountDetailPath(accountId);
  }
  if (kind === "payment_planner") {
    return accountId != null ? paymentPlannerAccountPath(accountId) : "/payment-planner";
  }
  if (kind === "open_ledger" && accountId != null) {
    return transactionsForForecastRiskPath({
      accountId,
      accountName: rec.account_name ?? undefined,
      focusDate: focus?.focusDate,
      focusTransactionId: focus?.focusTransactionId,
    });
  }

  if (trimmed.startsWith("/accounts")) {
    return accountId != null ? accountDetailPath(accountId) : "/(app)/(tabs)/accounts";
  }
  if (trimmed.startsWith("/goals")) return "/goals";
  if (trimmed.startsWith("/action-center")) return "/action-center";

  if (trimmed.includes("/transactions")) {
    return accountId != null ? transactionsForAccountPath(accountId) : "/(app)/(tabs)/transactions";
  }

  if (trimmed.includes("/credit-cards")) {
    return recommendationIsDebtPayoff(rec)
      ? accountId != null
        ? paymentPlannerAccountPath(accountId)
        : "/payment-planner"
      : accountId != null
        ? accountDetailPath(accountId)
        : "/(app)/(tabs)/accounts";
  }

  return null;
}

function pushNavigateAction(
  actions: RecommendationAction[],
  label: string,
  url: string,
  rec: DashboardRecommendation
): void {
  const href = resolveRecommendationWebUrl(url, rec);
  if (!href) return;
  actions.push({ kind: "navigate", label, href });
}

export function transferPresetPath(preset: RecommendationTransferPreset): {
  pathname: "/transaction/new";
  params: {
    mode: string;
    from: string;
    to: string;
    amount: string;
    date: string;
  };
} {
  return {
    pathname: "/transaction/new",
    params: {
      mode: "transfer",
      from: preset.transferFromAccountId != null ? String(preset.transferFromAccountId) : "",
      to: String(preset.transferToAccountId),
      amount: preset.defaultAmount ?? "",
      date: preset.defaultDate ?? "",
    },
  };
}

export function survivalModePlannerPath(): {
  pathname: "/payment-planner";
  params: { mode: string };
} {
  return {
    pathname: "/payment-planner",
    params: { mode: "survival" },
  };
}

export function recommendationActions(rec: DashboardRecommendation): RecommendationAction[] {
  const accountId = recommendationAccountId(rec);
  const actions: RecommendationAction[] = [];

  if (recommendationShowsResolveRisk(rec) && accountId != null) {
    actions.push({ kind: "resolve_risk", label: "Resolve risk", accountId });
  }

  if (recommendationOpensTransfer(rec)) {
    const preset = recommendationTransferPreset(rec);
    if (preset && preset.transferToAccountId > 0) {
      actions.push({
        kind: "transfer",
        label: recommendationTransferActionLabel(rec),
        accountId,
        transferPreset: preset,
      });
    }
  } else if (rec.primary_action_label && rec.primary_action_url) {
    const label = recommendationPrimaryCtaLabel(rec);
    const kind = recommendationPrimaryDestinationKind(rec);
    if (kind === "payment_planner" && accountId != null) {
      actions.push({ kind: "payment_planner", label, accountId });
    } else if (kind === "open_ledger" && accountId != null) {
      actions.push({ kind: "open_ledger", label, accountId });
    } else if (kind === "view_account" && accountId != null) {
      actions.push({ kind: "view_account", label: "View account", accountId });
    } else {
      const href = resolveRecommendationWebUrl(rec.primary_action_url, rec);
      if (href) actions.push({ kind: "navigate", label, href });
    }
  }

  const secondaryLabel = rec.secondary_action_label
    ? recommendationSecondaryCtaLabel(rec)
    : null;
  if (secondaryLabel && rec.secondary_action_url && rec.secondary_action_type !== "move_money") {
    const secondaryKind = (rec.secondary_action_type ?? "").toLowerCase();
    if (secondaryKind === "view_account" && accountId != null) {
      actions.push({ kind: "view_account", label: secondaryLabel, accountId });
    } else if (
      (secondaryKind === "open_ledger" || rec.secondary_action_url.includes("/transactions")) &&
      accountId != null
    ) {
      actions.push({ kind: "open_ledger", label: secondaryLabel, accountId });
    } else if (
      recommendationIsDebtPayoff(rec) &&
      rec.secondary_action_url.includes("/credit-cards") &&
      accountId != null
    ) {
      actions.push({ kind: "payment_planner", label: secondaryLabel, accountId });
    } else if (
      !recommendationIsUtilizationHealth(rec) &&
      rec.secondary_action_url.includes("/credit-cards") &&
      accountId != null
    ) {
      actions.push({ kind: "payment_planner", label: secondaryLabel, accountId });
    } else {
      pushNavigateAction(actions, secondaryLabel, rec.secondary_action_url, rec);
    }
  }

  const plannerUrl = recommendationPayoffPlannerUrl(rec);
  if (plannerUrl && accountId != null && !actions.some((a) => a.kind === "payment_planner")) {
    actions.push({ kind: "payment_planner", label: PAYMENT_PLANNER_LABEL, accountId });
  }

  if (accountId != null && !actions.some((a) => a.kind === "open_ledger")) {
    actions.unshift({ kind: "open_ledger", label: OPEN_LEDGER_LABEL, accountId });
  }

  return dedupeActions(actions);
}

function hrefKey(href: RecommendationAction["href"]): string {
  if (href == null) return "";
  if (typeof href === "string") return href;
  const params = href.params
    ? Object.entries(href.params)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("&")
    : "";
  return `${href.pathname}?${params}`;
}

function actionIdentity(action: RecommendationAction): string {
  return [
    action.kind,
    action.accountId ?? "",
    hrefKey(action.href),
    action.transferPreset?.transferToAccountId ?? "",
  ].join(":");
}

function destinationsOverlap(a: RecommendationAction, b: RecommendationAction): boolean {
  if (a.kind === b.kind) {
    if (a.kind === "navigate") return hrefKey(a.href) === hrefKey(b.href);
    if (a.accountId != null && b.accountId != null) return a.accountId === b.accountId;
    return true;
  }
  return false;
}

function destinationFromKind(
  rec: DashboardRecommendation,
  kind: ReturnType<typeof recommendationPrimaryDestinationKind>
): RecommendationAction | null {
  const accountId = recommendationAccountId(rec);
  if (kind == null) return null;

  switch (kind) {
    case "view_account":
      return accountId != null
        ? { kind: "view_account", label: "View account", accountId }
        : null;
    case "payment_planner":
      return accountId != null
        ? { kind: "payment_planner", label: PAYMENT_PLANNER_LABEL, accountId }
        : { kind: "navigate", label: PAYMENT_PLANNER_LABEL, href: "/payment-planner" };
    case "open_ledger":
      return accountId != null
        ? { kind: "open_ledger", label: OPEN_LEDGER_LABEL, accountId }
        : null;
    case "transfer": {
      const preset = recommendationTransferPreset(rec);
      if (preset) {
        return {
          kind: "transfer",
          label: recommendationTransferActionLabel(rec),
          accountId: accountId ?? undefined,
          transferPreset: preset,
        };
      }
      return accountId != null
        ? { kind: "open_ledger", label: OPEN_LEDGER_LABEL, accountId }
        : null;
    }
    case "resolve_risk":
      return accountId != null
        ? { kind: "resolve_risk", label: "Resolve risk", accountId }
        : null;
    case "navigate": {
      const primaryUrl = (rec.primary_action_url ?? "").trim();
      if (rec.goal_id != null && rec.goal_id > 0) {
        return { kind: "navigate", label: "Open goal", href: goalDetailPath(rec.goal_id) };
      }
      const goalMatch = primaryUrl.match(/^\/goals\/(\d+)/);
      if (goalMatch) {
        return {
          kind: "navigate",
          label: "Open goal",
          href: goalDetailPath(Number(goalMatch[1])),
        };
      }
      if (primaryUrl.startsWith("/spending-goals") || primaryUrl.startsWith("/budget")) {
        return {
          kind: "navigate",
          label: recommendationPrimaryCtaLabel(rec),
          href: "/spending-limits",
        };
      }
      const href = resolveRecommendationWebUrl(primaryUrl, rec);
      if (href) {
        return { kind: "navigate", label: recommendationPrimaryCtaLabel(rec), href };
      }
      return null;
    }
    default:
      return null;
  }
}

export function getRecommendationDestination(
  rec: DashboardRecommendation
): RecommendationAction | null {
  if (rec.primary_action_url?.startsWith("/timeline")) {
    const href = resolveRecommendationWebUrl(rec.primary_action_url, rec);
    if (href) {
      return {
        kind: "navigate",
        label:
          recommendationSecondaryCtaLabel(rec, "View forecast", rec.primary_action_url) ??
          "View forecast",
        href,
      };
    }
  }

  return destinationFromKind(rec, recommendationPrimaryDestinationKind(rec));
}

export function getRecommendationSecondaryActions(
  rec: DashboardRecommendation,
  opts?: { includeSnoozeDismiss?: boolean }
): RecommendationAction[] {
  const primary = getRecommendationDestination(rec);
  const secondary = recommendationActions(rec).filter((action) => {
    if (!primary) return true;
    return !destinationsOverlap(action, primary);
  });

  if (opts?.includeSnoozeDismiss) {
    secondary.push({ kind: "snooze", label: "Snooze" });
    secondary.push({ kind: "dismiss", label: "Dismiss" });
  }

  return dedupeActions(secondary);
}

function dedupeActions(actions: RecommendationAction[]): RecommendationAction[] {
  const seen = new Set<string>();
  const out: RecommendationAction[] = [];
  for (const action of actions) {
    const key =
      action.kind === "snooze" || action.kind === "dismiss"
        ? action.kind
        : `${actionIdentity(action)}:${action.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export function openLedgerNavigation(accountId: number, rec?: DashboardRecommendation) {
  if (rec) {
    const focus = recommendationLedgerFocus(rec);
    if (focus?.focusDate || focus?.focusTransactionId != null) {
      return transactionsForForecastRiskPath({
        accountId,
        accountName: rec.account_name ?? undefined,
        focusDate: focus.focusDate,
        focusTransactionId: focus.focusTransactionId,
      });
    }
  }
  return transactionsForAccountPath(accountId);
}

export function openPaymentPlannerNavigation(accountId: number) {
  return paymentPlannerAccountPath(accountId);
}
