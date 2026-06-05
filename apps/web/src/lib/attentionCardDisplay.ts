import { ACCOUNT_TYPE_LABELS, formatCurrency } from "@budget-app/shared";
import type { DashboardAttentionItem } from "@budget-app/shared";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeftRight, CreditCard } from "lucide-react";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";
import { formatHealthRiskDate } from "./accountHealthDisplay";
import { normalizePaymentActionLabel, PAYMENT_PLANNER_LABEL } from "./paymentPlannerDisplay";
import { normalizeSeverity, severityLabel, severityTokens } from "./severity";

export { PAYMENT_PLANNER_LABEL };

export const ATTENTION_MAX_CARDS = 3;

export const ATTENTION_VIEW_ALL_PATH = "/accounts?attention=1";

const ACTIONABLE_STATUSES = new Set<DashboardAttentionItem["status"]>([
  "critical",
  "risk",
  "watch",
]);

const GENERIC_ACTIONS = new Set([
  "review upcoming activity.",
  "review upcoming activity on this account.",
  "review payment and utilization.",
]);

export function attentionEmptyMessage(_windowDays: number): string {
  return "Nothing needs your attention in this window.";
}

export function attentionLedgerPath(accountId: number): string {
  return "/transactions";
}

export function attentionLedgerState(accountId: number): { accountId: number } {
  return { accountId };
}

export function attentionPaymentPlannerPath(accountId: number): string {
  return `/credit-cards?account=${accountId}`;
}

export function attentionIsActionable(item: DashboardAttentionItem): boolean {
  if (!ACTIONABLE_STATUSES.has(item.status)) return false;
  const reason = item.reason?.trim();
  const action = item.recommended_action?.trim();
  if (!reason && !action) return false;
  const amount = item.amount != null && String(item.amount).trim() !== "";
  if (amount) return true;
  if (item.status === "critical" || item.status === "risk") return true;
  const normalized = action?.toLowerCase() ?? "";
  if (GENERIC_ACTIONS.has(normalized)) return false;
  if (item.status === "watch" && !action) return false;
  return true;
}

export function attentionFilterActionable(
  items: DashboardAttentionItem[]
): DashboardAttentionItem[] {
  return items.filter(attentionIsActionable);
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

export function attentionAccountTypeLabel(item: DashboardAttentionItem): string {
  return ACCOUNT_TYPE_LABELS[item.account_type] ?? item.account_type;
}

export function attentionSeverityLabel(status: DashboardAttentionItem["status"]): string {
  return severityLabel(normalizeSeverity(status));
}

export function attentionIssueIcon(item: DashboardAttentionItem): LucideIcon {
  const reason = (item.reason ?? "").toLowerCase();
  const action = (item.recommended_action ?? "").toLowerCase();
  if (reason.includes("utilization") || item.account_type === "CREDIT") {
    return CreditCard;
  }
  if (
    action.includes("move") ||
    action.includes("add") ||
    action.includes("transfer") ||
    item.secondary_action?.type === "move_money"
  ) {
    return ArrowLeftRight;
  }
  return AlertTriangle;
}

export function attentionShowsResolveRisk(item: DashboardAttentionItem): boolean {
  if (item.account_type === "CREDIT") return false;
  return item.status === "critical" || item.status === "risk";
}

export function attentionShowsPaymentPlanner(item: DashboardAttentionItem): boolean {
  return item.account_type === "CREDIT" || item.account_role === "credit_card";
}

/** Secondary CTA is already Payment Planner (backend sends "Make payment" for credit cards). */
export function attentionSecondaryIsPaymentPlanner(item: DashboardAttentionItem): boolean {
  if (!item.secondary_action) return false;
  if (item.secondary_action.type === "make_payment") return true;
  return attentionSecondaryLabel(item) === PAYMENT_PLANNER_LABEL;
}

/** Fallback Payment Planner when credit has no secondary_action from API. */
export function attentionShowsDedicatedPaymentPlanner(item: DashboardAttentionItem): boolean {
  return attentionShowsPaymentPlanner(item) && !attentionSecondaryIsPaymentPlanner(item);
}

export function attentionSecondaryPath(item: DashboardAttentionItem): string {
  if (attentionSecondaryIsPaymentPlanner(item)) {
    return attentionPaymentPlannerPath(item.account_id);
  }
  return item.secondary_action?.url || item.url;
}

export function attentionShowsSecondaryAction(item: DashboardAttentionItem): boolean {
  return item.secondary_action != null;
}

export function attentionSecondaryLabel(item: DashboardAttentionItem): string | null {
  const raw = item.secondary_action?.label ?? null;
  return raw ? normalizePaymentActionLabel(raw) : null;
}

export function attentionSecondaryOpensTransferModal(item: DashboardAttentionItem): boolean {
  return item.secondary_action?.type === "move_money";
}

/** Preset for funding an account that needs cash (dashboard attention "Move money"). */
export function attentionTransferPreset(item: DashboardAttentionItem): QuickTransactionPreset {
  return {
    accountId: item.account_id,
    mode: "transfer",
    transferToAccountId: item.account_id,
    defaultAmount: item.amount ?? undefined,
  };
}

export function attentionPrimaryLabel(item: DashboardAttentionItem): string {
  return item.primary_action?.label ?? "Open ledger";
}

export function attentionTargetUtilizationLabel(
  item: DashboardAttentionItem
): string | null {
  const raw = item.target_utilization_percent;
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  const pct = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `Target: ${pct}%`;
}

export function attentionKeyAmountLabel(item: DashboardAttentionItem): string | null {
  const raw = item.amount;
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  return formatCurrency(raw);
}

export function attentionRiskDateLabel(item: DashboardAttentionItem): string | null {
  return formatHealthRiskDate(item.risk_date);
}

/** True when the view-all link should appear (more issues than shown on the dashboard). */
export function attentionShowsViewAllLink(
  displayedCount: number,
  totalCount: number
): boolean {
  return totalCount > displayedCount && displayedCount > 0;
}

export function attentionCardsForDisplay(
  items: DashboardAttentionItem[],
  limit = ATTENTION_MAX_CARDS
): DashboardAttentionItem[] {
  return attentionFilterActionable(items).slice(0, limit);
}

/** Primary issue line (projection, utilization, buffer, etc.). */
export function attentionPrimaryIssue(item: DashboardAttentionItem): string | null {
  const reason = item.reason?.trim();
  return reason || null;
}

/** Single action line for attention cards (avoids duplicating amount/date in the body). */
export function attentionActionLine(item: DashboardAttentionItem): string | null {
  const action = item.recommended_action?.trim();
  return action || null;
}

export function attentionActionDuplicatesReason(item: DashboardAttentionItem): boolean {
  const reason = (item.reason ?? "").trim().toLowerCase();
  const action = (item.recommended_action ?? "").trim().toLowerCase();
  if (!reason || !action) return false;
  if (action === reason) return true;
  if (action.includes(reason)) return true;
  if (reason.includes(action)) return true;
  return false;
}

export function attentionShowsActionLine(item: DashboardAttentionItem): boolean {
  const line = attentionActionLine(item);
  if (!line) return false;
  return !attentionActionDuplicatesReason(item);
}

/** Impact amount when not already embedded in the action line. */
export function attentionImpactLine(item: DashboardAttentionItem): string | null {
  if (!attentionShowsKeyAmount(item)) return null;
  const amount = attentionKeyAmountLabel(item);
  if (!amount) return null;
  return `Impact: ${amount}`;
}

/** Risk date when not already in the primary issue text. */
export function attentionDateLine(item: DashboardAttentionItem): string | null {
  if (!attentionShowsRiskDate(item)) return null;
  const dateLabel = attentionRiskDateLabel(item);
  return dateLabel ? `By ${dateLabel}` : null;
}

/** Hide separate amount when it is already stated in the recommended action. */
export function attentionShowsKeyAmount(item: DashboardAttentionItem): boolean {
  const amount = attentionKeyAmountLabel(item);
  if (!amount) return false;
  const action = item.recommended_action?.toLowerCase() ?? "";
  const digits = amount.replace(/[^\d.]/g, "");
  if (digits && action.includes(digits)) return false;
  return true;
}

/** Hide risk date row when the short reason already includes the date. */
export function attentionShowsRiskDate(item: DashboardAttentionItem): boolean {
  const dateLabel = attentionRiskDateLabel(item);
  if (!dateLabel) return false;
  const reason = item.reason?.toLowerCase() ?? "";
  if (reason.includes(dateLabel.toLowerCase())) return false;
  if (item.risk_date) {
    const d = new Date(`${item.risk_date}T12:00:00`);
    const monthShort = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
    const day = d.getDate();
    if (reason.includes(`${monthShort} ${day}`.toLowerCase())) return false;
  }
  return true;
}

/** Hide utilization target when reason already states utilization. */
export function attentionShowsTargetUtilization(item: DashboardAttentionItem): boolean {
  const target = attentionTargetUtilizationLabel(item);
  if (!target) return false;
  if (/utilization/i.test(item.reason ?? "")) return false;
  return true;
}
