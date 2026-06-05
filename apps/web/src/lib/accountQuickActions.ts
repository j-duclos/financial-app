import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  CircleDollarSign,
  List,
  Pencil,
  PiggyBank,
  RotateCcw,
  Scale,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import type { Account, AccountRole, AccountType } from "@budget-app/shared";
import { inferAccountRoleFromType } from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";

export type QuickActionId =
  | "add_expense"
  | "add_income"
  | "add_purchase"
  | "add_contribution"
  | "add_transaction"
  | "transfer"
  | "relationship_transfer"
  | "schedule"
  | "schedule_savings"
  | "schedule_payment"
  | "schedule_contribution"
  | "pay_card"
  | "pay_statement"
  | "pay_minimum"
  | "pay_current"
  | "payment_planner"
  | "move_to_savings"
  | "reconcile"
  | "import_txns"
  | "view_forecast"
  | "view_statement"
  | "view_transactions"
  | "view_upcoming"
  | "view_utilization"
  | "link_payment"
  | "transfer_funds"
  | "move_before_risk"
  | "mgmt_set_default"
  | "mgmt_edit"
  | "mgmt_archive"
  | "mgmt_close"
  | "mgmt_restore"
  | "mgmt_clear_ledger"
  | "mgmt_delete";

export type QuickActionTier = "primary" | "secondary";

export interface QuickActionPayload {
  transferToAccountId?: number;
  transferFromAccountId?: number;
  amount?: string;
  relationshipId?: number;
  paymentPreset?: "statement" | "minimum" | "current";
  recurringDirection?: "INCOME" | "EXPENSE" | "TRANSFER";
}

export interface QuickActionDef {
  id: QuickActionId;
  label: string;
  icon: LucideIcon;
  tier: QuickActionTier;
  disabled?: boolean;
  badge?: number;
  tooltip?: string;
  danger?: boolean;
  payload?: QuickActionPayload;
}

export interface QuickActionsContext {
  plaidLinkedAccountIds: Set<number>;
  allAccounts: Account[];
  forecastDays: number;
}

export interface AccountManagementOptions {
  isDefault: boolean;
  lifecycle: "active" | "archived" | "closed" | "deleted";
  setPrimaryPending?: boolean;
  updatePending?: boolean;
}

function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

/** Suggested transfer amount to cover a projected shortfall (e.g. move-before-risk). */
export function inboundTransferAmount(account: Account): string | undefined {
  const lowest = parseAmount(account.lowest_projected_balance_30_days);
  if (lowest != null && lowest < 0) {
    return String(Math.abs(lowest).toFixed(2));
  }
  const sts = parseAmount(account.available_to_spend);
  if (sts != null && sts < 0) {
    return String(Math.abs(sts).toFixed(2));
  }
  return undefined;
}

function isCashLike(type: AccountType, role: AccountRole): boolean {
  if (type === "CREDIT") return false;
  if (role === "savings" || role === "emergency_fund") return false;
  if (type === "INVESTMENT" || type === "RETIREMENT_401K") return false;
  return true;
}

function isSavingsRole(role: AccountRole, type: AccountType): boolean {
  return role === "savings" || role === "emergency_fund" || type === "SAVINGS";
}

function isInvestment(type: AccountType, role: AccountRole): boolean {
  return type === "INVESTMENT" || type === "RETIREMENT_401K" || role === "investment";
}

function isLoan(role: AccountRole): boolean {
  return role === "loan";
}

function isCredit(type: AccountType, role: AccountRole): boolean {
  return type === "CREDIT" || role === "credit_card";
}

function addMonitoringPrimary(primary: QuickActionDef[]) {
  primary.push({
    id: "view_transactions",
    label: "Open Ledger",
    icon: List,
    tier: "primary",
    tooltip: "View transactions for this account",
  });
}

function addTransferMoneyPrimary(
  primary: QuickActionDef[],
  account: Account,
  tooltip?: string
) {
  primary.push({
    id: "transfer",
    label: "Transfer Money",
    icon: ArrowLeftRight,
    tier: "primary",
    tooltip: tooltip ?? "Transfer between accounts",
  });
}

function addPaymentPlannerPrimary(
  primary: QuickActionDef[],
  account: Account,
  payload?: QuickActionPayload
) {
  primary.push({
    id: "payment_planner",
    label: "Payment Planner",
    icon: CircleDollarSign,
    tier: "primary",
    tooltip: "Payoff timeline, interest, and payment scenarios",
    payload,
  });
}

function addReconcileSecondary(
  secondary: QuickActionDef[],
  isPlaid: boolean,
  unmatched: number
) {
  secondary.push({
    id: "reconcile",
    label: "Reconcile",
    icon: Scale,
    tier: "secondary",
    tooltip:
      isPlaid && unmatched > 0
        ? `${unmatched} unmatched import(s)`
        : "Compare your ledger to your statement balance",
  });
}

export function buildAccountManagementActions(
  opts: AccountManagementOptions
): { secondary: QuickActionDef[]; danger: QuickActionDef[] } {
  const secondary: QuickActionDef[] = [];
  const danger: QuickActionDef[] = [];

  if (opts.lifecycle === "active") {
    if (!opts.isDefault) {
      secondary.push({
        id: "mgmt_set_default",
        label: "Set as Default",
        icon: Star,
        tier: "secondary",
        disabled: opts.setPrimaryPending,
      });
    }
    secondary.push({
      id: "mgmt_edit",
      label: "Edit",
      icon: Pencil,
      tier: "secondary",
    });
  } else if (opts.lifecycle !== "deleted") {
    secondary.push({
      id: "mgmt_restore",
      label: "Restore",
      icon: RotateCcw,
      tier: "secondary",
      disabled: opts.updatePending,
    });
  }

  if (opts.lifecycle === "active") {
    danger.push({
      id: "mgmt_close",
      label: "Close Account",
      icon: XCircle,
      tier: "secondary",
      disabled: opts.updatePending,
      danger: true,
    });
  }

  danger.push({
    id: "mgmt_delete",
    label: "Delete",
    icon: Trash2,
    tier: "secondary",
    danger: true,
  });

  return { secondary, danger };
}

export function buildAccountQuickActions(
  account: Account,
  role: AccountRole,
  ctx: QuickActionsContext
): { primary: QuickActionDef[]; secondary: QuickActionDef[] } {
  const primary: QuickActionDef[] = [];
  const secondary: QuickActionDef[] = [];
  const type = account.account_type;
  const health = account.health_status ?? account.risk_status;
  const unmatched = account.health_details?.unmatched_import_count ?? 0;
  const isPlaid = ctx.plaidLinkedAccountIds.has(account.id);

  if (isCredit(type, role)) {
    addMonitoringPrimary(primary);
    addPaymentPlannerPrimary(primary, account);
  } else if (isLoan(role)) {
    addMonitoringPrimary(primary);
    addPaymentPlannerPrimary(
      primary,
      account,
      account.minimum_payment_amount ? { amount: account.minimum_payment_amount } : undefined
    );
  } else if (isInvestment(type, role)) {
    addMonitoringPrimary(primary);
  } else if (isSavingsRole(role, type)) {
    addMonitoringPrimary(primary);
    addTransferMoneyPrimary(
      primary,
      account,
      health === "critical" || health === "risk"
        ? (account.health_reason ?? "Account needs attention")
        : undefined
    );
  } else if (isCashLike(type, role)) {
    addMonitoringPrimary(primary);
    addTransferMoneyPrimary(
      primary,
      account,
      health === "critical" || health === "risk"
        ? (account.health_reason ?? "Account needs attention")
        : undefined
    );
  } else {
    addMonitoringPrimary(primary);
    addTransferMoneyPrimary(primary, account);
  }

  addReconcileSecondary(secondary, isPlaid, unmatched);

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (
    riskDate &&
    isCashLike(type, role) &&
    account.lowest_projected_balance_30_days != null &&
    parseFloat(account.lowest_projected_balance_30_days) < 0
  ) {
    const formatted = formatDateDisplay(riskDate);
    secondary.unshift({
      id: "move_before_risk",
      label: `Move Money Before ${formatted}`,
      icon: PiggyBank,
      tier: "secondary",
      tooltip: account.health_reason ?? undefined,
      payload: {
        transferToAccountId: account.id,
        amount: inboundTransferAmount(account),
      },
    });
  }

  const dedupe = (items: QuickActionDef[]) => {
    const seen = new Set<string>();
    return items.filter((a) => {
      const key = `${a.id}:${a.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return { primary: dedupe(primary), secondary: dedupe(secondary) };
}

export function accountRoleForQuickActions(account: Account): AccountRole {
  return account.role ?? inferAccountRoleFromType(account.account_type);
}
