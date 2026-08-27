export * from "@budget-app/shared/attentionCardDisplay";

import type { DashboardAttentionItem } from "@budget-app/shared";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeftRight, CreditCard } from "lucide-react";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";
import {
  attentionIssueKind,
  attentionSecondaryIsPaymentPlanner,
  attentionSecondaryLabel,
  attentionTransferPresetData,
  PAYMENT_PLANNER_LABEL,
} from "@budget-app/shared/attentionCardDisplay";
import { normalizeSeverity, severityLabel, severityTokens } from "./severity";

export function attentionLedgerPath(_accountId: number): string {
  return "/transactions";
}

export function attentionLedgerState(accountId: number): { accountId: number } {
  return { accountId };
}

export function attentionPaymentPlannerPath(accountId: number): string {
  return `/credit-cards?account=${accountId}`;
}

export function attentionSecondaryPath(item: DashboardAttentionItem): string {
  if (attentionSecondaryIsPaymentPlanner(item)) {
    return attentionPaymentPlannerPath(item.account_id);
  }
  return item.secondary_action?.url || item.url;
}

export function attentionIssueIcon(item: DashboardAttentionItem): LucideIcon {
  switch (attentionIssueKind(item)) {
    case "credit":
      return CreditCard;
    case "transfer":
      return ArrowLeftRight;
    default:
      return AlertTriangle;
  }
}

export function attentionSeverityStyles(status: DashboardAttentionItem["status"]): {
  card: string;
  badge: string;
} {
  const tokens = severityTokens(status);
  return {
    card: tokens.cardClass,
    badge: tokens.badgeClass,
  };
}

export function attentionTransferPreset(item: DashboardAttentionItem): QuickTransactionPreset {
  return attentionTransferPresetData(item);
}

export { severityLabel, normalizeSeverity, PAYMENT_PLANNER_LABEL, attentionSecondaryLabel };
