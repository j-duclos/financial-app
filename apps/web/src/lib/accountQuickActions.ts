import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArrowLeftRight,
  CalendarClock,
  CircleDollarSign,
  Download,
  Eraser,
  FileText,
  LineChart,
  List,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Star,
  Trash2,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import type { Account, AccountRelationship, AccountRole, AccountType } from "@budget-app/shared";
import { inferAccountRoleFromType, getEffectiveDisplayName } from "@budget-app/shared";

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
  relationships: AccountRelationship[];
  forecastDays: number;
}

export interface AccountManagementOptions {
  isDefault: boolean;
  lifecycle: "active" | "archived" | "closed" | "deleted";
  setPrimaryPending?: boolean;
  updatePending?: boolean;
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

function relLabel(rel: AccountRelationship, account: Account, allAccounts: Account[]): string {
  const otherId =
    rel.source_account === account.id ? rel.destination_account : rel.source_account;
  const other = allAccounts.find((a) => a.id === otherId);
  const otherName = other ? getEffectiveDisplayName(other) : rel.destination_account_name;
  if (rel.source_account === account.id) {
    return `To ${otherName}`;
  }
  return `From ${otherName}`;
}

function paymentAmountPreset(
  account: Account,
  preset: "statement" | "minimum" | "current"
): string | undefined {
  if (preset === "statement" && account.statement_balance) return account.statement_balance;
  if (preset === "minimum" && account.minimum_payment_amount) return account.minimum_payment_amount;
  if (preset === "current" && account.balance_owed) return account.balance_owed;
  return undefined;
}

function activeRelationshipsFor(account: Account, relationships: AccountRelationship[]): AccountRelationship[] {
  const list = Array.isArray(relationships) ? relationships : [];
  return list.filter(
    (r) =>
      r.is_active &&
      (r.source_account === account.id || r.destination_account === account.id)
  );
}

function savingsTargets(account: Account, allAccounts: Account[]): Account[] {
  return allAccounts.filter(
    (a) =>
      a.id !== account.id &&
      a.household?.id === account.household?.id &&
      (a.role === "savings" ||
        a.role === "emergency_fund" ||
        a.account_type === "SAVINGS")
  );
}

function checkingSources(account: Account, allAccounts: Account[]): Account[] {
  return allAccounts.filter(
    (a) =>
      a.id !== account.id &&
      a.household?.id === account.household?.id &&
      a.account_type !== "CREDIT" &&
      (a.account_type === "CHECKING" || a.role === "spending" || a.role === "bills")
  );
}

function addMonitoringPrimary(primary: QuickActionDef[]) {
  primary.push({
    id: "view_transactions",
    label: "Open Ledger",
    icon: List,
    tier: "primary",
    tooltip: "View transactions for this account",
  });
  primary.push({
    id: "view_forecast",
    label: "Forecast",
    icon: LineChart,
    tier: "primary",
    tooltip: "View projected balance and upcoming activity",
  });
}

function addMoveMoneyPrimary(
  primary: QuickActionDef[],
  account: Account,
  tooltip?: string
) {
  primary.push({
    id: "transfer",
    label: "Move Money",
    icon: ArrowLeftRight,
    tier: "primary",
    tooltip: tooltip ?? "Transfer between accounts",
    payload: { transferFromAccountId: account.id },
  });
}

function addMakePaymentPrimary(
  primary: QuickActionDef[],
  account: Account,
  payload?: QuickActionPayload
) {
  primary.push({
    id: "pay_card",
    label: "Make Payment",
    icon: CircleDollarSign,
    tier: "primary",
    tooltip: "Pay from another account",
    payload,
  });
}

function addTransactionSecondary(secondary: QuickActionDef[], account: Account, role: AccountRole, type: AccountType) {
  if (isCredit(type, role)) {
    secondary.push({
      id: "add_purchase",
      label: "Add Purchase",
      icon: Receipt,
      tier: "secondary",
      tooltip: "Record a charge on this card",
    });
  } else if (isInvestment(type, role)) {
    secondary.push({
      id: "add_contribution",
      label: "Add Contribution",
      icon: Plus,
      tier: "secondary",
    });
  } else {
    secondary.push({
      id: "add_transaction",
      label: "Add Transaction",
      icon: Plus,
      tier: "secondary",
      tooltip: "Record income or expense",
    });
  }
}

function addScheduleSecondary(
  secondary: QuickActionDef[],
  account: Account,
  role: AccountRole,
  type: AccountType
) {
  if (isCredit(type, role) || isLoan(role)) {
    secondary.push({
      id: "schedule_payment",
      label: "Schedule Payment",
      icon: CalendarClock,
      tier: "secondary",
      payload: {
        recurringDirection: isLoan(role) ? "EXPENSE" : "TRANSFER",
      },
    });
  } else if (isSavingsRole(role, type)) {
    secondary.push({
      id: "schedule_savings",
      label: "Schedule Transfer",
      icon: CalendarClock,
      tier: "secondary",
      payload: { recurringDirection: "TRANSFER" },
    });
  } else if (isInvestment(type, role)) {
    secondary.push({
      id: "schedule_contribution",
      label: "Schedule Contribution",
      icon: CalendarClock,
      tier: "secondary",
      payload: { recurringDirection: "EXPENSE" },
    });
  } else {
    secondary.push({
      id: "schedule",
      label: "Schedule Payment",
      icon: CalendarClock,
      tier: "secondary",
    });
  }
}

function addPlaidSecondary(
  secondary: QuickActionDef[],
  isPlaid: boolean,
  unmatched: number
) {
  if (!isPlaid) return;
  secondary.push({
    id: "import_txns",
    label: "Import Transactions",
    icon: Download,
    tier: "secondary",
    badge: unmatched > 0 ? unmatched : undefined,
  });
  secondary.push({
    id: "reconcile",
    label: "Reconcile",
    icon: Scale,
    tier: "secondary",
    badge: unmatched > 0 ? unmatched : undefined,
    tooltip: unmatched > 0 ? `${unmatched} unmatched import(s)` : undefined,
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
    secondary.push({
      id: "mgmt_archive",
      label: "Archive",
      icon: Archive,
      tier: "secondary",
      disabled: opts.updatePending,
    });
    secondary.push({
      id: "mgmt_close",
      label: "Close",
      icon: XCircle,
      tier: "secondary",
      disabled: opts.updatePending,
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

  danger.push({
    id: "mgmt_clear_ledger",
    label: "Clear Transactions",
    icon: Eraser,
    tier: "secondary",
    danger: true,
  });
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
  const rels = activeRelationshipsFor(account, ctx.relationships);

  if (isCredit(type, role)) {
    addMonitoringPrimary(primary);
    addMakePaymentPrimary(primary, account);

    addTransactionSecondary(secondary, account, role, type);
    addScheduleSecondary(secondary, account, role, type);

    if (account.statement_balance) {
      secondary.push({
        id: "view_statement",
        label: "View Statement",
        icon: FileText,
        tier: "secondary",
        tooltip: "Statement balance and due date",
      });
    }

    if (account.statement_balance) {
      secondary.push({
        id: "pay_statement",
        label: "Pay Statement",
        icon: Wallet,
        tier: "secondary",
        payload: {
          paymentPreset: "statement",
          amount: paymentAmountPreset(account, "statement"),
        },
      });
    }
    if (account.minimum_payment_amount) {
      secondary.push({
        id: "pay_minimum",
        label: "Pay Minimum",
        icon: Wallet,
        tier: "secondary",
        payload: {
          paymentPreset: "minimum",
          amount: paymentAmountPreset(account, "minimum"),
        },
      });
    }
    if (account.balance_owed) {
      secondary.push({
        id: "pay_current",
        label: "Pay Balance",
        icon: Wallet,
        tier: "secondary",
        payload: {
          paymentPreset: "current",
          amount: paymentAmountPreset(account, "current"),
        },
      });
    }

    const payFromId = account.autopay_account;
    if (payFromId) {
      const src = ctx.allAccounts.find((a) => a.id === payFromId);
      secondary.push({
        id: "relationship_transfer",
        label: src ? `Autopay from ${getEffectiveDisplayName(src)}` : "Autopay linked",
        icon: ArrowLeftRight,
        tier: "secondary",
        disabled: !src,
        payload: {
          transferFromAccountId: payFromId,
          transferToAccountId: account.id,
          amount: paymentAmountPreset(account, "minimum"),
        },
      });
    } else {
      secondary.push({
        id: "link_payment",
        label: "Link Payment Account",
        icon: Wallet,
        tier: "secondary",
        tooltip: "Set autopay source in account settings",
      });
    }

    if (account.utilization_percent != null) {
      secondary.push({
        id: "view_utilization",
        label: "Utilization",
        icon: TrendingUp,
        tier: "secondary",
      });
    }

    addPlaidSecondary(secondary, isPlaid, unmatched);
  } else if (isLoan(role)) {
    addMonitoringPrimary(primary);
    addMakePaymentPrimary(
      primary,
      account,
      account.minimum_payment_amount ? { amount: account.minimum_payment_amount } : undefined
    );

    addScheduleSecondary(secondary, account, role, type);
    addPlaidSecondary(secondary, isPlaid, unmatched);
  } else if (isInvestment(type, role)) {
    addMonitoringPrimary(primary);

    addTransactionSecondary(secondary, account, role, type);
    addScheduleSecondary(secondary, account, role, type);
    addPlaidSecondary(secondary, isPlaid, unmatched);
  } else if (isSavingsRole(role, type)) {
    addMonitoringPrimary(primary);
    addMoveMoneyPrimary(
      primary,
      account,
      health === "critical" || health === "risk"
        ? (account.health_reason ?? "Account needs attention")
        : undefined
    );

    addTransactionSecondary(secondary, account, role, type);
    addScheduleSecondary(secondary, account, role, type);

    const sources = checkingSources(account, ctx.allAccounts);
    for (const src of sources.slice(0, 2)) {
      secondary.push({
        id: "relationship_transfer",
        label: `From ${getEffectiveDisplayName(src)}`,
        icon: ArrowLeftRight,
        tier: "secondary",
        payload: {
          transferFromAccountId: src.id,
          transferToAccountId: account.id,
        },
      });
    }
    addPlaidSecondary(secondary, isPlaid, unmatched);
  } else if (isCashLike(type, role)) {
    addMonitoringPrimary(primary);
    addMoveMoneyPrimary(
      primary,
      account,
      health === "critical" || health === "risk"
        ? (account.health_reason ?? "Account needs attention")
        : undefined
    );

    addTransactionSecondary(secondary, account, role, type);
    addScheduleSecondary(secondary, account, role, type);

    secondary.push({
      id: "add_income",
      label: "Add Income",
      icon: CircleDollarSign,
      tier: "secondary",
    });

    const savings = savingsTargets(account, ctx.allAccounts);
    if (savings.length === 1) {
      secondary.push({
        id: "move_to_savings",
        label: `Move to ${getEffectiveDisplayName(savings[0])}`,
        icon: PiggyBank,
        tier: "secondary",
        payload: { transferToAccountId: savings[0].id },
      });
    } else if (savings.length > 1) {
      secondary.push({
        id: "move_to_savings",
        label: "Move to Savings",
        icon: PiggyBank,
        tier: "secondary",
      });
    }

    const cards = ctx.allAccounts.filter(
      (a) => a.account_type === "CREDIT" && a.household?.id === account.household?.id
    );
    for (const card of cards.slice(0, 2)) {
      secondary.push({
        id: "pay_card",
        label: `Pay ${getEffectiveDisplayName(card)}`,
        icon: Wallet,
        tier: "secondary",
        payload: {
          transferFromAccountId: account.id,
          transferToAccountId: card.id,
          amount: card.minimum_payment_amount ?? card.statement_balance,
        },
      });
    }

    addPlaidSecondary(secondary, isPlaid, unmatched);
  } else {
    addMonitoringPrimary(primary);
    addMoveMoneyPrimary(primary, account);
    addTransactionSecondary(secondary, account, role, type);
    addScheduleSecondary(secondary, account, role, type);
    addPlaidSecondary(secondary, isPlaid, unmatched);
  }

  for (const rel of rels.slice(0, 3)) {
    const exists = secondary.some(
      (a) =>
        a.id === "relationship_transfer" &&
        a.payload?.relationshipId === rel.id
    );
    if (exists) continue;
    const from =
      rel.source_account === account.id ? account.id : rel.source_account;
    const to =
      rel.destination_account === account.id ? account.id : rel.destination_account;
    secondary.push({
      id: "relationship_transfer",
      label: relLabel(rel, account, ctx.allAccounts),
      icon: ArrowLeftRight,
      tier: "secondary",
      payload: {
        relationshipId: rel.id,
        transferFromAccountId: from,
        transferToAccountId: to,
        amount: rel.default_amount ?? undefined,
      },
    });
  }

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (
    riskDate &&
    isCashLike(type, role) &&
    account.lowest_projected_balance_30_days != null &&
    parseFloat(account.lowest_projected_balance_30_days) < 0
  ) {
    const formatted = new Date(riskDate + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    secondary.unshift({
      id: "move_before_risk",
      label: `Move Money Before ${formatted}`,
      icon: PiggyBank,
      tier: "secondary",
      tooltip: account.health_reason ?? undefined,
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
