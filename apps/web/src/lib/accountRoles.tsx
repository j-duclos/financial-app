import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  Landmark,
  PiggyBank,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { AccountRole } from "@budget-app/shared";

export type AccountRoleMeta = {
  label: string;
  icon: LucideIcon;
  badgeClass: string;
  description?: string;
};

export const ACCOUNT_ROLE_META: Record<AccountRole, AccountRoleMeta> = {
  spending: {
    label: "Spending",
    icon: Wallet,
    badgeClass:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800",
    description: "Main everyday spending account",
  },
  bills: {
    label: "Bills",
    icon: Receipt,
    badgeClass:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
    description: "Used for scheduled bills and autopay",
  },
  savings: {
    label: "Savings",
    icon: PiggyBank,
    badgeClass:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800",
    description: "General savings account",
  },
  emergency_fund: {
    label: "Emergency Fund",
    icon: ShieldCheck,
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
    description: "Money reserved for emergencies",
  },
  credit_card: {
    label: "Credit Card",
    icon: CreditCard,
    badgeClass:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
    description: "Revolving credit card account",
  },
  loan: {
    label: "Loan",
    icon: Landmark,
    badgeClass:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-800",
    description: "Installment loan or debt account",
  },
  investment: {
    label: "Investment",
    icon: TrendingUp,
    badgeClass:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800",
    description: "Investment or brokerage account",
  },
  cash_reserve: {
    label: "Cash Reserve",
    icon: Banknote,
    badgeClass:
      "bg-cyan-100 text-cyan-800 border-cyan-200 dark:bg-cyan-950 dark:text-cyan-200 dark:border-cyan-800",
    description: "Cash reserve or buffer account",
  },
  other: {
    label: "Other",
    icon: CircleDollarSign,
    badgeClass:
      "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
    description: "Other account purpose",
  },
};

const ACCOUNT_ROLE_KEYS = Object.keys(ACCOUNT_ROLE_META) as AccountRole[];

export function normalizeAccountRole(role: string | null | undefined): AccountRole {
  if (role && ACCOUNT_ROLE_KEYS.includes(role as AccountRole)) {
    return role as AccountRole;
  }
  return "other";
}

export function getAccountRoleMeta(role: string | null | undefined): AccountRoleMeta {
  return ACCOUNT_ROLE_META[normalizeAccountRole(role)];
}

export const ACCOUNT_ROLE_OPTIONS = ACCOUNT_ROLE_KEYS.map((value) => ({
  value,
  ...ACCOUNT_ROLE_META[value],
}));
