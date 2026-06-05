import type {
  Account,
  DashboardAttentionItem,
  DashboardRecommendation,
  ResolveRiskAction,
  ResolveRiskPlan,
  ResolveRiskSimulationPreview,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { simulationStatusClass, simulationStatusLabel } from "./transferSimulation";
import { normalizeSeverity, severityShowsAlert } from "./severity";
import { snoozeRecommendation } from "./recommendationDisplay";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";

export function accountShowsResolveRisk(
  account: Pick<Account, "account_type" | "health_status" | "risk_status" | "lowest_projected_balance_30_days">
): boolean {
  if (account.account_type === "CREDIT") return false;
  const status = account.health_status ?? account.risk_status;
  if (status === "critical" || status === "risk") return true;
  const low = account.lowest_projected_balance_30_days;
  if (low != null && parseFloat(low) < 0) return true;
  return false;
}

const CREDIT_RESOLVE_TYPES = new Set([
  "reduce_utilization",
  "pay_credit_card",
  "debt_payoff",
]);

/** Utilization / card payoff — use Payment Planner, not the cash-flow resolve-risk drawer. */
export function recommendationIsCreditPayment(rec: DashboardRecommendation): boolean {
  const type = rec.type ?? "";
  if (CREDIT_RESOLVE_TYPES.has(type)) return true;
  if ((rec.id ?? "").startsWith("utilization-")) return true;
  if (rec.impact_type === "credit_utilization") return true;
  const primary = rec.primary_action_url ?? "";
  const secondary = rec.secondary_action_url ?? "";
  if (primary.includes("/credit-cards") || secondary.includes("/credit-cards")) return true;
  const blob = `${rec.title} ${rec.why} ${rec.recommended_action ?? ""}`.toLowerCase();
  if (blob.includes("utilization")) return true;
  return false;
}

export function recommendationShowsResolveRisk(rec: DashboardRecommendation): boolean {
  if (rec.account_id == null) return false;
  if (recommendationIsCreditPayment(rec)) return false;
  const sev = normalizeSeverity(rec.severity);
  return sev === "critical" || sev === "at_risk";
}

export function attentionShowsResolveRisk(item: DashboardAttentionItem): boolean {
  if (item.account_type === "CREDIT") return false;
  return item.status === "critical" || item.status === "risk";
}

export function formatResolveRiskLowest(balance: string | null | undefined): string {
  if (balance == null) return "—";
  return formatCurrency(balance);
}

export function simulationPreviewLines(
  preview: ResolveRiskSimulationPreview | undefined
): { lowestLine: string | null; improvementLine: string | null; statusLabel: string | null } {
  if (!preview?.simulated_lowest_projected_balance && !preview?.base_lowest_projected_balance) {
    return { lowestLine: null, improvementLine: null, statusLabel: null };
  }
  const sim = preview.simulated_lowest_projected_balance;
  const lowestLine =
    sim != null ? `Lowest projected becomes ${formatCurrency(sim)}` : null;
  let improvementLine: string | null = null;
  if (preview.improvement_amount) {
    const imp = parseFloat(preview.improvement_amount);
    if (Number.isFinite(imp) && imp > 0) {
      improvementLine = `Improves balance by ${formatCurrency(preview.improvement_amount)}`;
    }
  }
  const statusLabel = preview.result_status
    ? simulationStatusLabel(
        preview.result_status as "resolved" | "partial" | "failed"
      )
    : preview.risk_resolved
      ? "Risk resolved"
      : null;
  return { lowestLine, improvementLine, statusLabel };
}

export function resolveRiskTransferPreset(
  action: ResolveRiskAction,
  accounts: Account[]
): QuickTransactionPreset | null {
  if (action.kind !== "move_money" || !action.related_account_id || !action.account_id) {
    return null;
  }
  const to = accounts.find((a) => a.id === action.account_id);
  if (!to) return null;
  const amount =
    action.recommended_amount?.replace(/[^\d.]/g, "") ||
    action.simulation?.improvement_amount?.replace(/[^\d.]/g, "");
  const date =
    action.simulation?.transfer_date ||
    action.recommended_date ||
    undefined;
  return {
    accountId: action.account_id,
    mode: "transfer",
    transferToAccountId: action.account_id,
    transferFromAccountId: action.related_account_id,
    defaultAmount: amount || undefined,
    defaultDate: date,
  };
}

export function resolveRiskPlannerUrl(action: ResolveRiskAction): string | null {
  if (action.kind === "reduce_utilization" || action.primary_action_url?.includes("credit-cards")) {
    return action.account_id != null
      ? `/credit-cards?account=${action.account_id}`
      : "/credit-cards";
  }
  return null;
}

export function snoozeResolveRisk(plan: ResolveRiskPlan): void {
  if (plan.snooze_id) snoozeRecommendation(plan.snooze_id);
}

export function actionSeverityShows(action: ResolveRiskAction): boolean {
  return severityShowsAlert(normalizeSeverity(action.severity));
}

export { simulationStatusClass };
