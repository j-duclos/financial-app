import { ACCOUNT_TYPE_LABELS, formatCurrency } from "./utils";
import type { DashboardAttentionItem } from "./types";
import { formatHealthRiskDate } from "./dateDisplay";
import { normalizePaymentActionLabel, PAYMENT_PLANNER_LABEL } from "./paymentPlannerDisplay";
import { normalizeSeverity, severityLabel } from "./severity";

export { PAYMENT_PLANNER_LABEL };

export const ATTENTION_FIX_SHORTFALL_LABEL = "Fix Shortfall";

export const ATTENTION_MAX_CARDS = 3;

/**
 * Home “Attention Required → View all” destination.
 * Action Center is the full recommendation list; Accounts is inventory/health only.
 */
export const ATTENTION_VIEW_ALL_PATH = "/action-center";

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

export type AttentionTransferPresetData = {
  accountId: number;
  mode: "transfer";
  transferToAccountId: number;
  defaultAmount?: string;
  defaultDate: string;
  fixShortfall: boolean;
};

export type AttentionIssueKind = "credit" | "transfer" | "warning";

export function attentionEmptyMessage(_windowDays: number): string {
  return "Nothing needs your attention in this window.";
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

export function attentionAccountTypeLabel(item: DashboardAttentionItem): string {
  return ACCOUNT_TYPE_LABELS[item.account_type] ?? item.account_type;
}

export function attentionSeverityLabel(status: DashboardAttentionItem["status"]): string {
  return severityLabel(normalizeSeverity(status));
}

export function attentionIssueKind(item: DashboardAttentionItem): AttentionIssueKind {
  const reason = (item.reason ?? "").toLowerCase();
  const action = (item.recommended_action ?? "").toLowerCase();
  if (reason.includes("utilization") || item.account_type === "CREDIT") {
    return "credit";
  }
  if (
    action.includes("move") ||
    action.includes("add") ||
    action.includes("transfer") ||
    item.secondary_action?.type === "move_money"
  ) {
    return "transfer";
  }
  return "warning";
}

export function attentionShowsPaymentPlanner(item: DashboardAttentionItem): boolean {
  return item.account_type === "CREDIT" || item.account_role === "credit_card";
}

export function attentionSecondaryIsPaymentPlanner(item: DashboardAttentionItem): boolean {
  if (!item.secondary_action) return false;
  if (item.secondary_action.type === "make_payment") return true;
  return attentionSecondaryLabel(item) === PAYMENT_PLANNER_LABEL;
}

export function attentionShowsDedicatedPaymentPlanner(item: DashboardAttentionItem): boolean {
  return attentionShowsPaymentPlanner(item) && !attentionSecondaryIsPaymentPlanner(item);
}

export function attentionShowsSecondaryAction(item: DashboardAttentionItem): boolean {
  return item.secondary_action != null;
}

export function attentionSecondaryLabel(item: DashboardAttentionItem): string | null {
  if (item.secondary_action?.type === "move_money") {
    return ATTENTION_FIX_SHORTFALL_LABEL;
  }
  const raw = item.secondary_action?.label ?? null;
  return raw ? normalizePaymentActionLabel(raw) : null;
}

export function attentionSecondaryOpensTransferModal(item: DashboardAttentionItem): boolean {
  return item.secondary_action?.type === "move_money";
}

export function attentionIsCashShortfall(item: DashboardAttentionItem): boolean {
  return attentionSecondaryOpensTransferModal(item);
}

export function attentionTransferPresetData(item: DashboardAttentionItem): AttentionTransferPresetData {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const riskDate = item.risk_date?.slice(0, 10);
  const defaultDate = riskDate && riskDate >= todayIso ? riskDate : todayIso;
  return {
    accountId: item.account_id,
    mode: "transfer",
    transferToAccountId: item.account_id,
    defaultAmount: item.amount ?? undefined,
    defaultDate,
    fixShortfall: true,
  };
}

export function attentionPrimaryLabel(item: DashboardAttentionItem): string {
  return item.primary_action?.label ?? "Open ledger";
}

export function attentionTargetUtilizationLabel(item: DashboardAttentionItem): string | null {
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

export function attentionShowsViewAllLink(displayedCount: number, totalCount: number): boolean {
  return totalCount > displayedCount && displayedCount > 0;
}

export function attentionCardsForDisplay(
  items: DashboardAttentionItem[],
  limit = ATTENTION_MAX_CARDS
): DashboardAttentionItem[] {
  return attentionFilterActionable(items).slice(0, limit);
}

export function attentionPrimaryIssue(item: DashboardAttentionItem): string | null {
  const reason = item.reason?.trim();
  return reason || null;
}

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

export function attentionImpactLine(item: DashboardAttentionItem): string | null {
  if (!attentionShowsKeyAmount(item)) return null;
  const amount = attentionKeyAmountLabel(item);
  if (!amount) return null;
  return `Impact: ${amount}`;
}

export function attentionDateLine(item: DashboardAttentionItem): string | null {
  if (!attentionShowsRiskDate(item)) return null;
  const dateLabel = attentionRiskDateLabel(item);
  return dateLabel ? `By ${dateLabel}` : null;
}

export function attentionShowsKeyAmount(item: DashboardAttentionItem): boolean {
  const amount = attentionKeyAmountLabel(item);
  if (!amount) return false;
  const action = item.recommended_action?.toLowerCase() ?? "";
  const digits = amount.replace(/[^\d.]/g, "");
  if (digits && action.includes(digits)) return false;
  return true;
}

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

export function attentionShowsTargetUtilization(item: DashboardAttentionItem): boolean {
  const target = attentionTargetUtilizationLabel(item);
  if (!target) return false;
  if (/utilization/i.test(item.reason ?? "")) return false;
  return true;
}
