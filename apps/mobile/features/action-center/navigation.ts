import type { DashboardRecommendation, RecommendationTransferPreset } from "@budget-app/shared";
import {
  OPEN_LEDGER_LABEL,
  PAYMENT_PLANNER_LABEL,
  recommendationAccountId,
  recommendationIsCreditPayment,
  recommendationOpensTransfer,
  recommendationPayoffPlannerUrl,
  recommendationPrimaryCtaLabel,
  recommendationSecondaryCtaLabel,
  recommendationShowsResolveRisk,
  recommendationTransferPreset,
} from "@budget-app/shared";
import { calendarDatePath, paymentPlannerAccountPath } from "@/features/dashboard/navigation";
import { goalDetailPath } from "@/features/goals/navigation";
import { transactionsForAccountPath } from "@/features/payment-planner/navigation";

export type RecommendationActionKind =
  | "open_ledger"
  | "payment_planner"
  | "transfer"
  | "resolve_risk"
  | "navigate"
  | "view_account";

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

  if (trimmed.includes("/credit-cards")) {
    const accountId = recommendationAccountId(rec);
    return accountId != null ? paymentPlannerAccountPath(accountId) : "/payment-planner";
  }

  if (trimmed.includes("/transactions")) {
    const accountId = recommendationAccountId(rec);
    return accountId != null ? transactionsForAccountPath(accountId) : "/(app)/(tabs)/transactions";
  }

  if (trimmed.startsWith("/recurring")) {
    return "/recurring";
  }

  if (trimmed.startsWith("/spending-goals") || trimmed.startsWith("/budget")) {
    return "/(app)/(tabs)/budget";
  }

  const goalMatch = trimmed.match(/^\/goals\/(\d+)/);
  if (goalMatch) {
    return goalDetailPath(Number(goalMatch[1]));
  }
  if (rec.goal_id != null && rec.goal_id > 0) {
    return goalDetailPath(rec.goal_id);
  }

  if (trimmed.startsWith("/timeline")) {
    const dateMatch = trimmed.match(/[?&]date=([^&]+)/);
    if (dateMatch?.[1]) {
      return calendarDatePath(decodeURIComponent(dateMatch[1]));
    }
    return "/(app)/(tabs)/calendar";
  }

  if (trimmed.startsWith("/accounts")) {
    const accountId = recommendationAccountId(rec);
    return accountId != null ? accountDetailPath(accountId) : "/accounts";
  }

  if (trimmed.startsWith("/goals")) {
    return "/goals";
  }

  if (trimmed.startsWith("/action-center")) {
    return "/action-center";
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
  const opensTransfer = recommendationOpensTransfer(rec);
  const isCredit = recommendationIsCreditPayment(rec);
  const showResolveRisk = recommendationShowsResolveRisk(rec);

  if (showResolveRisk && accountId != null) {
    actions.push({ kind: "resolve_risk", label: "Resolve risk", accountId });
  }

  if (opensTransfer) {
    const preset = recommendationTransferPreset(rec);
    if (preset && preset.transferToAccountId > 0) {
      actions.push({
        kind: "transfer",
        label: recommendationPrimaryCtaLabel(rec),
        accountId,
        transferPreset: preset,
      });
    }
  } else if (rec.primary_action_label && rec.primary_action_url) {
    const label = recommendationPrimaryCtaLabel(rec);
    if (rec.primary_action_url.includes("/credit-cards") && accountId != null) {
      actions.push({ kind: "payment_planner", label, accountId });
    } else if (rec.primary_action_url.includes("/transactions") && accountId != null) {
      actions.push({ kind: "open_ledger", label, accountId });
    } else {
      const href = resolveRecommendationWebUrl(rec.primary_action_url, rec);
      if (href) {
        actions.push({ kind: "navigate", label, href });
      } else if (isCredit && accountId != null) {
        actions.push({ kind: "payment_planner", label, accountId });
      }
    }
  }

  const secondaryLabel = rec.secondary_action_label
    ? recommendationSecondaryCtaLabel(rec)
    : null;
  if (
    secondaryLabel &&
    rec.secondary_action_url &&
    rec.secondary_action_type !== "move_money"
  ) {
    if (rec.secondary_action_url.includes("/credit-cards") && accountId != null) {
      actions.push({ kind: "payment_planner", label: secondaryLabel, accountId });
    } else if (rec.secondary_action_url.includes("/transactions") && accountId != null) {
      actions.push({ kind: "open_ledger", label: secondaryLabel, accountId });
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

function dedupeActions(actions: RecommendationAction[]): RecommendationAction[] {
  const seen = new Set<string>();
  const out: RecommendationAction[] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.label}:${action.accountId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export function openLedgerNavigation(accountId: number) {
  return transactionsForAccountPath(accountId);
}

export function openPaymentPlannerNavigation(accountId: number) {
  return paymentPlannerAccountPath(accountId);
}
