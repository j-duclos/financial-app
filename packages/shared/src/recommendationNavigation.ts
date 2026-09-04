import type { DashboardRecommendation } from "./types";
import {
  recommendationAccountId,
  recommendationIsDebtPayoff,
  recommendationPrimaryOpensTransfer,
} from "./recommendationDisplay";

export type RecommendationDestinationKind =
  | "view_account"
  | "payment_planner"
  | "open_ledger"
  | "transfer"
  | "navigate"
  | "resolve_risk";

export type RecommendationLedgerFocus = {
  accountId: number;
  focusDate?: string | null;
  focusTransactionId?: number | null;
};

const UTILIZATION_TYPES = new Set(["reduce_utilization", "utilization_above_target"]);

/** Credit utilization / health — Account Detail, not Payment Planner. */
export function recommendationIsUtilizationHealth(rec: DashboardRecommendation): boolean {
  const type = rec.type ?? "";
  if (UTILIZATION_TYPES.has(type)) return true;
  if (rec.impact_type === "credit_utilization") return true;
  if ((rec.id ?? "").startsWith("utilization-")) return true;
  if (type === "pay_credit_card" && rec.impact_type === "credit_utilization") return true;
  return false;
}

/** Cash/checking forecast risk — ledger with optional focus context. */
export function recommendationIsCashForecastRisk(rec: DashboardRecommendation): boolean {
  const type = rec.type ?? "";
  if (type === "restore_buffer" || type === "move_money") return true;
  if ((rec.id ?? "").startsWith("attention-")) return true;
  if (rec.impact_type === "overdraft_avoidance" || rec.impact_type === "buffer") return true;
  return false;
}

/**
 * Semantic primary destination — explicit `type` / `primary_action_type` win over legacy URLs.
 * Secondary move_money must not make the whole-card primary a transfer.
 */
export function recommendationPrimaryDestinationKind(
  rec: DashboardRecommendation
): RecommendationDestinationKind | null {
  const accountId = recommendationAccountId(rec);
  const primaryType = (rec.primary_action_type ?? "").trim().toLowerCase();

  if (rec.goal_id != null && rec.goal_id > 0) return "navigate";
  if (recommendationIsDebtPayoff(rec)) return "payment_planner";
  if (recommendationIsUtilizationHealth(rec)) return "view_account";

  if (primaryType === "view_account" && accountId != null) return "view_account";
  if (primaryType === "open_ledger" && accountId != null) return "open_ledger";
  if (primaryType === "move_money" || recommendationPrimaryOpensTransfer(rec)) {
    return "transfer";
  }

  if (recommendationIsCashForecastRisk(rec) && accountId != null) {
    return "open_ledger";
  }

  const primaryUrl = (rec.primary_action_url ?? "").trim();
  if (primaryUrl.startsWith("/spending-goals") || primaryUrl.startsWith("/budget")) {
    return "navigate";
  }
  if (primaryUrl.startsWith("/timeline")) return "navigate";
  if (primaryUrl.startsWith("/goals")) return "navigate";
  if (primaryUrl.startsWith("/recurring")) return "navigate";

  // Legacy URL fallback — utilization vs debt already decided above.
  if (primaryUrl.includes("/credit-cards")) {
    return recommendationIsDebtPayoff(rec) ? "payment_planner" : "view_account";
  }
  if (primaryUrl.includes("/transactions") && accountId != null) return "open_ledger";
  if (primaryUrl.startsWith("/accounts") && accountId != null) return "view_account";

  if (accountId != null) {
    if ((rec.id ?? "").startsWith("attention-") || rec.type === "move_money") {
      return "open_ledger";
    }
    return "view_account";
  }

  if (primaryUrl) return "navigate";
  return null;
}

export function recommendationDisplayAccountName(rec: DashboardRecommendation): string | null {
  const name = rec.account_name?.trim();
  return name || null;
}

export function recommendationLedgerFocus(rec: DashboardRecommendation): RecommendationLedgerFocus | null {
  const accountId = recommendationAccountId(rec);
  if (accountId == null) return null;
  const focusDate = rec.recommended_date?.slice(0, 10) || null;
  const focusTransactionId =
    rec.transaction_id != null && Number.isFinite(rec.transaction_id)
      ? rec.transaction_id
      : null;
  return { accountId, focusDate, focusTransactionId };
}

/** Web primary navigation target for recommendation cards. */
export function recommendationWebPrimaryTarget(rec: DashboardRecommendation): {
  to: string;
  state?: Record<string, unknown>;
} {
  const kind = recommendationPrimaryDestinationKind(rec);
  const accountId = recommendationAccountId(rec);
  const focus = recommendationLedgerFocus(rec);

  if (kind === "view_account" && accountId != null) {
    return { to: `/accounts?account=${accountId}` };
  }
  if (kind === "payment_planner") {
    return accountId != null
      ? { to: `/credit-cards?account=${accountId}` }
      : { to: "/credit-cards" };
  }
  if (kind === "open_ledger" && accountId != null) {
    const state: Record<string, unknown> = { accountId };
    if (focus?.focusDate) state.prefillDate = focus.focusDate;
    if (focus?.focusTransactionId != null) {
      state.focus = "ledger-event";
      state.focusTransactionId = focus.focusTransactionId;
    }
    return { to: "/transactions", state };
  }
  if (kind === "transfer") {
    return accountId != null
      ? { to: "/transactions", state: { accountId } }
      : { to: "/transactions" };
  }

  const url = (rec.primary_action_url ?? "/transactions").trim();
  if (url.includes("/transactions")) {
    return accountId != null
      ? { to: "/transactions", state: { accountId } }
      : { to: "/transactions" };
  }
  return { to: url || "/transactions" };
}

export function recommendationWebPrimaryLabel(rec: DashboardRecommendation): string {
  const kind = recommendationPrimaryDestinationKind(rec);
  if (kind === "view_account") return "View account";
  if (kind === "payment_planner") return "Payment Planner";
  if (kind === "open_ledger") return "Open ledger";
  if (kind === "transfer" || recommendationPrimaryOpensTransfer(rec)) {
    const raw = rec.recommended_amount ?? rec.impact_value;
    if (raw) return `Transfer $${String(raw).replace(/^\$/, "")}`;
    return "Transfer";
  }
  return rec.primary_action_label?.trim() || "Continue";
}
