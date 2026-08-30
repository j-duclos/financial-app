import type {
  Account,
  DashboardRecommendation,
  ResolveRiskAction,
  ResolveRiskPlan,
} from "@budget-app/shared";
import {
  formatResolveRiskLowest,
  recommendationIsCreditPayment,
  recommendationOpensTransfer,
  recommendationShowsResolveRisk,
  resolveRiskPlannerAccountId,
  resolveRiskViewAccountId,
  resolveRiskTransferPreset as buildResolveRiskTransferPreset,
  simulationPreviewLines,
  actionSeverityShows,
} from "@budget-app/shared";
import { normalizeSeverity, severityShowsAlert } from "./severity";
import { snoozeRecommendation } from "./recommendationDisplay";
import type { QuickTransactionPreset } from "../components/quickActions/QuickTransactionModal";

export {
  formatResolveRiskLowest,
  recommendationIsCreditPayment,
  recommendationOpensTransfer,
  recommendationShowsResolveRisk,
  simulationPreviewLines,
  actionSeverityShows,
};

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

export function resolveRiskTransferPreset(
  action: ResolveRiskAction,
  accounts: Account[]
): QuickTransactionPreset | null {
  const preset = buildResolveRiskTransferPreset(action, accounts);
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

export function resolveRiskViewAccountUrl(action: ResolveRiskAction): string | null {
  const accountId = resolveRiskViewAccountId(action);
  if (accountId == null) return null;
  return `/accounts?account=${accountId}`;
}

export function resolveRiskPlannerUrl(action: ResolveRiskAction): string | null {
  const accountId = resolveRiskPlannerAccountId(action);
  if (accountId == null) return null;
  return `/credit-cards?account=${accountId}`;
}

export function snoozeResolveRisk(plan: ResolveRiskPlan): void {
  if (plan.snooze_id) snoozeRecommendation(plan.snooze_id);
}

export { simulationStatusClass } from "./transferSimulation";

export function recommendationShowsResolveRiskWeb(rec: DashboardRecommendation): boolean {
  return recommendationShowsResolveRisk(rec);
}

export { normalizeSeverity, severityShowsAlert };
